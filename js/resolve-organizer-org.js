/**
 * Resolves organizations/{orgId} for the signed-in organizer via users/{uid},
 * and repairs users/{uid} via the repairUserProfile Cloud Function when the doc
 * is missing but orgId can be inferred (sessionStorage or organization ownerUid).
 */
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const FUNCTIONS_REGION = "us-central1";

function orgIdFromUserSnap(data) {
  const d = data || {};
  return String(d.orgId || d.organizationId || "").trim();
}

/**
 * @returns {Promise<{ ok: true, orgId: string } | { ok: false, message: string }>}
 */
export async function resolveOrganizerOrgId(app, auth, db) {
  const user = auth.currentUser;
  if (!user) {
    return { ok: false, message: "Sign in with your organizer email." };
  }

  const uRef = doc(db, "users", user.uid);
  let uSnap = await getDoc(uRef);
  if (uSnap.exists()) {
    const oid = orgIdFromUserSnap(uSnap.data());
    if (oid) {
      try {
        sessionStorage.setItem("orgId", oid);
      } catch (_e) {}
      return { ok: true, orgId: oid };
    }
  }

  const cached = String(sessionStorage.getItem("orgId") || "").trim();
  const functions = getFunctions(app, FUNCTIONS_REGION);
  const repair = httpsCallable(functions, "repairUserProfile");

  if (cached) {
    try {
      await repair({ orgId: cached });
    } catch (e) {
      console.warn("repairUserProfile (cached orgId) failed", e);
    }
    uSnap = await getDoc(uRef);
    if (uSnap.exists()) {
      const oid = orgIdFromUserSnap(uSnap.data());
      if (oid) {
        try {
          sessionStorage.setItem("orgId", oid);
        } catch (_e) {}
        return { ok: true, orgId: oid };
      }
    }
  }

  try {
    await repair({});
  } catch (e) {
    const code = e?.code ? String(e.code) : "";
    const msg = e?.message ? String(e.message) : "Could not restore your organizer profile.";
    console.warn("repairUserProfile (lookup by owner) failed", e);
    return {
      ok: false,
      message:
        code === "functions/failed-precondition"
          ? msg
          : "Your organizer profile is missing. If you already created an organization, try again in a moment; otherwise complete first-time signup, or use the same site URL (hosted page) you used when you registered."
    };
  }

  uSnap = await getDoc(uRef);
  if (uSnap.exists()) {
    const oid = orgIdFromUserSnap(uSnap.data());
    if (oid) {
      try {
        sessionStorage.setItem("orgId", oid);
      } catch (_e) {}
      return { ok: true, orgId: oid };
    }
  }

  return {
    ok: false,
    message:
      "Your organizer profile could not be loaded. Sign out, sign in again from this same site URL, or complete first-time signup if setup never finished."
  };
}
