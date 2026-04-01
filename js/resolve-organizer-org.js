/**
 * Resolves organizations/{orgId} for the signed-in organizer via users/{uid},
 * and repairs users/{uid} via the repairUserProfile Cloud Function when the doc
 * is missing but orgId can be inferred (sessionStorage or organization ownerUid).
 *
 * Staff accounts: repair({}) may throw (not org owner). After repair we re-read users/{uid}
 * (cache-first getDoc + retry) so a valid orgId on the profile still succeeds.
 */
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const FUNCTIONS_REGION = "us-central1";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Firestore client offline / transient network (esp. mobile Safari). */
export function isOfflineLikeFirestoreError(e) {
  const code = String(e?.code || "");
  const msg = String(e?.message || "").toLowerCase();
  return (
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    code === "resource-exhausted" ||
    /offline|client is offline|network|unavailable|failed to get document/i.test(msg)
  );
}

/**
 * Runs a Firestore read; on offline-like failure waits 500ms and retries once.
 */
export async function withFirestoreRetry(operation) {
  try {
    return await operation();
  } catch (e) {
    if (!isOfflineLikeFirestoreError(e)) throw e;
    console.warn("[firestore] read failed (will retry once):", e?.code || e?.message);
    await sleep(500);
    return await operation();
  }
}

function sessionStorageOrgIdFallback() {
  try {
    return String(sessionStorage.getItem("orgId") || "").trim();
  } catch (_e) {
    return "";
  }
}

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

async function getUserDocSnapshot(db, uid) {
  const uRef = doc(db, "users", uid);
  return withFirestoreRetry(() => getDoc(uRef));
}

/**
 * Reads users/{uid} via cache-first getDoc (no server-only reads). Uses retry on offline-like errors.
 * Falls back to sessionStorage orgId if reads fail but org was known from a prior session.
 */
export async function readOrganizerOrgIdFromUserDoc(db, uid) {
  const trySnap = (snap) => {
    const exists = typeof snap.exists === "function" ? snap.exists() : !!snap.exists;
    if (!exists) return "";
    return orgIdFromUserSnap(snap.data());
  };

  try {
    const snap = await getUserDocSnapshot(db, uid);
    const oid = trySnap(snap);
    if (oid) return oid;
  } catch (e) {
    console.warn("[readOrganizerOrgIdFromUserDoc] users/{uid} read failed", e);
  }
  return sessionStorageOrgIdFallback();
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

  let uSnap;
  try {
    uSnap = await getUserDocSnapshot(db, uid);
  } catch (e) {
    console.warn("[resolveOrganizerOrgId] users/{uid} read failed", e);
    const fb = sessionStorageOrgIdFallback();
    if (fb) {
      return { ok: true, orgId: fb };
    }
    return {
      ok: false,
      message: isOfflineLikeFirestoreError(e)
        ? "You appear offline. Check your connection, then try again."
        : e?.message || "Could not load your organizer profile.",
    };
  }

  let resolved = tryReturnFromSnap(uSnap, "cache-first");
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
    try {
      uSnap = await getUserDocSnapshot(db, uid);
      resolved = tryReturnFromSnap(uSnap, "after-cached-repair");
      if (resolved) return resolved;
    } catch (e) {
      console.warn("[resolveOrganizerOrgId] re-read after cached repair failed", e);
    }
  }

  try {
    await repair({});
  } catch (e) {
    console.warn("repairUserProfile (lookup by owner) failed (expected for staff)", e);
  }

  try {
    uSnap = await getUserDocSnapshot(db, uid);
    resolved = tryReturnFromSnap(uSnap, "after-repair");
    if (resolved) return resolved;
  } catch (e) {
    console.warn("[resolveOrganizerOrgId] re-read after repair failed", e);
  }

  const fb = sessionStorageOrgIdFallback();
  if (fb) {
    try {
      sessionStorage.setItem("orgId", fb);
    } catch (_e) {}
    return { ok: true, orgId: fb };
  }

  const docExists =
    uSnap && (typeof uSnap.exists === "function" ? uSnap.exists() : uSnap.exists);
  const userData = docExists ? uSnap.data() || {} : null;
  const hasOrg = userData ? !!orgIdFromUserSnap(userData) : false;
  console.info("[resolveOrganizerOrgId] profile has no orgId — using uid fallback. docExists:", !!docExists, "hasOrg:", hasOrg);

  return { ok: true, orgId: user.uid || "" };
}
