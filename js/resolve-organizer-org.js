/**
 * Resolves organizations/{orgId} for the signed-in organizer via users/{uid},
 * and repairs users/{uid} via the repairUserProfile Cloud Function when the doc
 * is missing but orgId can be inferred (sessionStorage or organization ownerUid).
 *
 * Staff accounts: repair({}) may throw (not org owner). We always re-read users/{uid}
 * from the server after repair so a valid orgId on the profile still succeeds.
 */
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import {
  doc,
  getDoc,
  getDocFromServer,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const FUNCTIONS_REGION = "us-central1";

function normalizeOrgIdValue(raw) {
  if (raw == null) return "";
  if (typeof raw === "object") {
    if (typeof raw.id === "string") {
      return String(raw.id).trim();
    }
    if (typeof raw.path === "string") {
      const parts = raw.path.split("/").filter(Boolean);
      return String(parts[parts.length - 1] || "").trim();
    }
    return "";
  }
  let s = String(raw).trim();
  if (!s) return "";
  if (s.startsWith("organizations/")) {
    const parts = s.split("/").filter(Boolean);
    s = String(parts[parts.length - 1] || "").trim();
  }
  return s;
}

/** Prefer orgId, then organizationId; treat empty-string orgId as missing so the other field can win. */
function orgIdFromUserSnap(data) {
  const d = data || {};
  const candidates = [d.orgId, d.organizationId];
  for (const c of candidates) {
    const oid = normalizeOrgIdValue(c);
    if (oid) return oid;
  }
  return "";
}

async function getUserDocSnapshot(db, uid, source) {
  const uRef = doc(db, "users", uid);
  if (source === "server") {
    try {
      return await getDocFromServer(uRef);
    } catch (e) {
      console.warn("[resolveOrganizerOrgId] getDocFromServer failed; using cache.", e);
      return getDoc(uRef);
    }
  }
  return getDoc(uRef);
}

/**
 * Reads users/{uid} from Firestore (cache-first, then server) and returns org id from orgId or organizationId.
 * Use when resolveOrganizerOrgId fails but the profile document is readable.
 */
export async function readOrganizerOrgIdFromUserDoc(db, uid) {
  const uRef = doc(db, "users", uid);
  const trySnap = (snap) => {
    const exists = typeof snap.exists === "function" ? snap.exists() : !!snap.exists;
    if (!exists) return "";
    return orgIdFromUserSnap(snap.data());
  };

  let oid = trySnap(await getDoc(uRef));
  if (oid) return oid;

  try {
    oid = trySnap(await getDocFromServer(uRef));
  } catch (e) {
    console.warn("[readOrganizerOrgIdFromUserDoc] getDocFromServer failed", e);
  }
  return oid || "";
}

/**
 * @returns {Promise<{ ok: true, orgId: string } | { ok: false, message: string }>}
 * `ok: false` only when there is no signed-in user. If the profile has no orgId,
 * returns `ok: true` with `orgId` set to the current user's UID (same path as organizations/{uid}).
 */
export async function resolveOrganizerOrgId(app, auth, db) {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) {
    return { ok: false, message: "Please sign in with your organizer account." };
  }

  await user.getIdToken(true);

  const uid = user.uid;
  console.info("[resolveOrganizerOrgId] auth uid:", uid);

  const tryReturnFromSnap = (uSnap, label) => {
    const exists = typeof uSnap.exists === "function" ? uSnap.exists() : !!uSnap.exists;
    const data = exists ? uSnap.data() || {} : null;
    const oid = data ? orgIdFromUserSnap(data) : "";
    const active = data?.active;
    console.info("[resolveOrganizerOrgId]", label, {
      docExists: exists,
      orgId: oid || "(empty)",
      active: active === undefined ? "(undefined)" : active,
      role: data?.role ?? "(none)",
      keys: data ? Object.keys(data) : [],
    });

    if (oid) {
      try {
        sessionStorage.setItem("orgId", oid);
      } catch (_e) {}
      return { ok: true, orgId: oid };
    }
    return null;
  };

  // Prefer server so we never treat a stale cache miss as "no profile" (fixes staff vs repair({}) race).
  let uSnap = await getUserDocSnapshot(db, uid, "server");
  let resolved = tryReturnFromSnap(uSnap, "server-first");
  if (resolved) return resolved;

  const cached = String(sessionStorage.getItem("orgId") || "").trim();
  const functions = getFunctions(app, FUNCTIONS_REGION);
  const repair = httpsCallable(functions, "repairUserProfile");

  if (cached) {
    try {
      await repair({ orgId: cached });
    } catch (e) {
      console.warn("repairUserProfile (cached orgId) failed", e);
    }
    uSnap = await getUserDocSnapshot(db, uid, "server");
    resolved = tryReturnFromSnap(uSnap, "after-cached-repair");
    if (resolved) return resolved;
  }

  try {
    await repair({});
  } catch (e) {
    console.warn("repairUserProfile (lookup by owner) failed (expected for staff)", e);
  }

  uSnap = await getUserDocSnapshot(db, uid, "server");
  resolved = tryReturnFromSnap(uSnap, "after-repair-failed");
  if (resolved) return resolved;

  const docExists =
    uSnap && (typeof uSnap.exists === "function" ? uSnap.exists() : uSnap.exists);
  const userData = docExists ? uSnap.data() || {} : null;
  const hasOrg = userData ? !!orgIdFromUserSnap(userData) : false;
  console.info("[resolveOrganizerOrgId] profile has no orgId — using uid fallback. docExists:", !!docExists, "hasOrg:", hasOrg);

  return { ok: true, orgId: user.uid || "" };
}
