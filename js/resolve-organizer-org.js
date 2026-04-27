/**
 * Resolves organizations/{orgId} for the signed-in organizer via users/{uid}
 * (orgIds, activeOrgId, roleByOrg; legacy orgId/organizationId migrated the same
 * way as in Cloud Functions), and repairs users/{uid} via repairUserProfile when
 * the doc is missing but orgs can be inferred (sessionStorage or organization ownerUid).
 *
 * Staff: repair({}) may throw if not an org owner. Re-reads users/{uid} after repair.
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
    return String(sessionStorage.getItem("activeOrgId") || sessionStorage.getItem("orgId") || "").trim();
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

/** Legacy single orgId / organizationId (pre–multi-org schema). */
function legacyOrgIdFromUserData(data) {
  const d = data || {};
  const candidates = [d.orgId, d.organizationId];
  for (const c of candidates) {
    const oid = normalizeOrgIdValue(c);
    if (oid) return oid;
  }
  return "";
}

function normalizeOrgIdsArrayOnly(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => normalizeOrgIdValue(x)).filter(Boolean))];
}

function isPlatformGlobalRoleValue(role) {
  const r = String(role || "")
    .trim()
    .toLowerCase();
  return r === "super_admin" || r === "support_admin";
}

/**
 * Merges orgIds, activeOrgId, roleByOrg with legacy orgId — matches functions/index.js buildMergedUserOrgState.
 */
export function buildMergedUserOrgStateClient(data) {
  const d = data || {};
  const legacy = legacyOrgIdFromUserData(d);
  const fromList = normalizeOrgIdsArrayOnly(d.orgIds);
  const orgIds = [...new Set([...fromList, ...(legacy ? [legacy] : [])])];
  let roleByOrg = {};
  if (d.roleByOrg && typeof d.roleByOrg === "object" && !Array.isArray(d.roleByOrg)) {
    roleByOrg = { ...d.roleByOrg };
  }
  const topRole = String(d.role || "")
    .trim()
    .toLowerCase();
  for (const id of orgIds) {
    if (roleByOrg[id]) continue;
    if (id === legacy && topRole) {
      roleByOrg[id] = isPlatformGlobalRoleValue(topRole) ? "admin" : topRole;
    } else {
      roleByOrg[id] = "admin";
    }
  }
  let active = String(d.activeOrgId || "").trim();
  if (orgIds.length) {
    if (!active || !orgIds.includes(active)) {
      [active] = orgIds;
    }
  } else {
    active = "";
  }
  return {
    orgIds,
    roleByOrg,
    activeOrgId: active,
    effectiveOrgId: orgIds.length ? active : legacy || "",
    legacyOrg: legacy,
  };
}

/** Effective “current” org for the signed-in organizer (active or first in orgIds, else legacy). */
export function getEffectiveOrganizerOrgIdFromUserData(data) {
  return buildMergedUserOrgStateClient(data).effectiveOrgId;
}


/** Lowercase role string for comparisons. */
export function normalizeUserRole(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

/** Internal platform roles: can list all organizations on the dashboard (see Firestore rules). */
export function isPlatformAdminRole(role) {
  const r = normalizeUserRole(role);
  return r === "super_admin" || r === "support_admin";
}

/** Persist the active org for this tab (mirrors orgId for legacy call sites). */
export function persistSessionActiveOrgId(orgId) {
  const o = String(orgId || "").trim();
  if (!o) return;
  try {
    sessionStorage.setItem("orgId", o);
  } catch (_e) {}
  try {
    sessionStorage.setItem("activeOrgId", o);
  } catch (_e) {}
  try {
    sessionStorage.setItem("selectedOrgId", o);
  } catch (_e) {}
  try {
    localStorage.setItem("selectedOrgId", o);
  } catch (_e) {}
}

/**
 * Single read of users/{uid} for dashboard: role + orgId (effective active org).
 * Org fallback matches readOrganizerOrgIdFromUserDoc (sessionStorage only when user doc is missing / read fails).
 */
export async function readDashboardAuthContext(db, uid) {
  let role = "";
  try {
    const snap = await getUserDocSnapshot(db, uid);
    const exists = typeof snap.exists === "function" ? snap.exists() : !!snap.exists;
    if (exists) {
      const data = snap.data() || {};
      const globalRole = normalizeUserRole(data.role);
      const oid = getEffectiveOrganizerOrgIdFromUserData(data);
      if (isPlatformAdminRole(globalRole)) {
        return { role: globalRole, orgId: oid };
      }
      const perOrg = oid && data.roleByOrg && data.roleByOrg[oid] ? data.roleByOrg[oid] : data.role;
      role = normalizeUserRole(perOrg);
      if (oid) return { role, orgId: oid };
      return { role, orgId: "" };
    }
    return { role: "", orgId: sessionStorageOrgIdFallback() };
  } catch (e) {
    console.warn("[readDashboardAuthContext] users/{uid} read failed", e);
  }
  return { role: "", orgId: sessionStorageOrgIdFallback() };
}

async function getUserDocSnapshot(db, uid) {
  const uRef = doc(db, "users", uid);
  return withFirestoreRetry(() => getDoc(uRef));
}

/**
 * Reads users/{uid} via cache-first getDoc (no server-only reads). Uses retry on offline-like errors.
 * Falls back to sessionStorage orgId only when the user doc is missing or the read throws — not when
 * the doc exists but has no org fields (avoids showing another org’s data from a stale sessionStorage).
 */
export async function readOrganizerOrgIdFromUserDoc(db, uid) {
  const trySnap = (snap) => {
    const exists = typeof snap.exists === "function" ? snap.exists() : !!snap.exists;
    if (!exists) return "";
    return getEffectiveOrganizerOrgIdFromUserData(snap.data());
  };

  try {
    const snap = await getUserDocSnapshot(db, uid);
    const exists = typeof snap.exists === "function" ? snap.exists() : !!snap.exists;
    const oid = trySnap(snap);
    if (oid) return oid;
    if (!exists) return sessionStorageOrgIdFallback();
    return "";
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
    const oid = data ? getEffectiveOrganizerOrgIdFromUserData(data) : "";
    const active = data?.active;
    const m = data ? buildMergedUserOrgStateClient(data) : null;
    console.info("[resolveOrganizerOrgId]", label, {
      docExists: exists,
      orgId: oid || "(empty)",
      orgIds: m ? m.orgIds : [],
      activeOrgId: m ? m.activeOrgId : "",
      active: active === undefined ? "(undefined)" : active,
      role: data?.role ?? "(none)",
      keys: data ? Object.keys(data) : [],
    });

    if (oid) {
      try {
        persistSessionActiveOrgId(oid);
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
      persistSessionActiveOrgId(fb);
    } catch (_e) {}
    return { ok: true, orgId: fb };
  }

  const docExists =
    uSnap && (typeof uSnap.exists === "function" ? uSnap.exists() : uSnap.exists);
  const userData = docExists ? uSnap.data() || {} : null;
  const hasOrg = userData
    ? buildMergedUserOrgStateClient(userData).orgIds.length > 0
    : false;
  console.info("[resolveOrganizerOrgId] profile has no orgId — using uid fallback. docExists:", !!docExists, "hasOrg:", hasOrg);

  return { ok: true, orgId: user.uid || "" };
}
