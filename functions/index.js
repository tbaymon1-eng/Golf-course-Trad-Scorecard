/**
 * Tournament registration — server-side hole assignment
 *
 * registerTeam: Callable HTTPS function that assigns the next available starting hole
 * atomically (Firestore transaction) and creates the registration document.
 *
 * This prevents two concurrent clients from reading the same "next hole" on the
 * client and both writing the same assignedHole.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// --- setupOrganization: creates organizations/{orgId} + users/{uid} (Admin SDK; bypasses rules) ---

function safeText(value, fallback = "") {
  return String(value || fallback || "").trim();
}

/** Match client js/resolve-organizer-org.js: orgId or organizationId; skip empty orgId string. */
function orgIdFromUserSnapData(data) {
  if (!data) return "";
  const candidates = [data.orgId, data.organizationId];
  for (const raw of candidates) {
    if (raw == null) continue;
    if (typeof raw === "string") {
      const s = safeText(raw);
      if (s) return s;
      continue;
    }
    if (typeof raw === "object" && raw && typeof raw.id === "string") {
      const s = safeText(raw.id);
      if (s) return s;
    }
  }
  return "";
}

/** Lowercase, trim, collapse spaces to hyphens, strip characters outside a-z0-9-. */
function normalizeOrgSlug(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Logs JSON lines for Cloud Logging / emulator console. Avoid logging full PII in production if needed.
 */
function logSetup(step, payload) {
  try {
    console.log(
      JSON.stringify({
        fn: "setupOrganization",
        step,
        t: new Date().toISOString(),
        ...payload,
      })
    );
  } catch (_e) {
    console.log("[setupOrganization]", step, payload);
  }
}

function mapFirestoreOrUnknownError(err) {
  const code = err && err.code ? String(err.code) : "";
  const msg = err && err.message ? String(err.message) : String(err || "unknown");

  if (code === "permission-denied") {
    return new HttpsError(
      "permission-denied",
      "Firestore write was denied. Check service account permissions and Firestore rules for the Admin SDK."
    );
  }
  if (code === "failed-precondition" || code === "aborted") {
    return new HttpsError(
      "failed-precondition",
      "Could not complete the database transaction. Try again in a moment."
    );
  }
  if (code === "resource-exhausted") {
    return new HttpsError(
      "resource-exhausted",
      "Database temporarily busy. Try again shortly."
    );
  }

  return new HttpsError(
    "internal",
    "Organization setup failed. See function logs for details."
  );
}

exports.setupOrganization = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    const runId = `so_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

    try {
      logSetup("start", {
        runId,
        hasAuth: !!request.auth,
        authUid: request.auth?.uid || null,
        tokenEmailPresent: !!(request.auth?.token && request.auth.token.email),
      });

      if (!request.auth) {
        logSetup("reject_no_auth", { runId });
        throw new HttpsError("unauthenticated", "User must be signed in.");
      }

      const uid = request.auth.uid;
      const email = safeText(request.auth.token?.email || "");
      const { courseName: rawCourseName } = request.data || {};
      const courseName = safeText(rawCourseName);

      logSetup("incoming_data", {
        runId,
        uid,
        courseName,
        courseNameLength: courseName.length,
        emailFromToken: email || "(empty)",
      });

      if (!courseName) {
        logSetup("reject_no_courseName", { runId, uid });
        throw new HttpsError("invalid-argument", "Course name required.");
      }

      const userRef = db.doc(`users/${uid}`);

      logSetup("before_transaction", { runId, userPath: userRef.path });

      let out;
      try {
        out = await db.runTransaction(async (tx) => {
          const userSnap = await tx.get(userRef);

          if (userSnap.exists) {
           const existingOrgId = orgIdFromUserSnapData(userSnap.data());
            if (existingOrgId) {
              return { orgId: existingOrgId, alreadySetup: true };
            }
          }

          const orgRef = db.collection("organizations").doc();
          const orgId = orgRef.id;

          tx.set(orgRef, {
            name: courseName,
            ownerUid: uid,
            createdAt: FieldValue.serverTimestamp(),
          });

          tx.set(
            userRef,
            {
              orgId,
              email,
              role: "admin",
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          return { orgId, alreadySetup: false };
        });

        logSetup("after_transaction", {
          runId,
          orgId: out.orgId,
          alreadySetup: !!out.alreadySetup,
        });
      } catch (e) {
        logSetup("transaction_error", {
          runId,
          message: String(e?.message || e),
          code: e?.code || "",
        });
        throw mapFirestoreOrUnknownError(e);
      }

      logSetup("return_ok", { runId, orgId: out.orgId, alreadySetup: out.alreadySetup });
      return out;
    } catch (e) {
      if (e instanceof HttpsError) {
        logSetup("rethrow_https", { runId, code: e.code, message: e.message });
        throw e;
      }
      logSetup("unexpected_throw", {
        runId,
        message: String(e?.message || e),
        stack: e?.stack ? String(e.stack).slice(0, 800) : "",
      });
      throw mapFirestoreOrUnknownError(e);
    }
  }
);

/**
 * Repairs users/{uid} when the document is missing or lacks orgId, using Admin SDK.
 * Links the signed-in user to an organization they own (ownerUid) or to an explicit orgId
 * after verifying ownership. Client writes to users/{uid} are denied by Firestore rules.
 */
exports.repairUserProfile = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const uid = request.auth.uid;
    const email = safeText(request.auth.token?.email || "");
    const requestedOrgId = safeText((request.data || {}).orgId);

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const existing = orgIdFromUserSnapData(userSnap.data());
      if (existing) {
        return { orgId: existing, repaired: false };
      }
    }

    let orgId = requestedOrgId;

    if (!orgId) {
      const q = await db.collection("organizations").where("ownerUid", "==", uid).limit(10).get();
      if (q.empty) {
        throw new HttpsError(
          "failed-precondition",
          "Complete first-time signup, or contact support if you already created an organization."
        );
      }
      if (q.size > 1) {
        throw new HttpsError(
          "failed-precondition",
          "Multiple organizations are owned by this account. Contact support or pass a specific organization id."
        );
      }
      orgId = q.docs[0].id;
    } else {
      const orgSnap = await db.collection("organizations").doc(orgId).get();
      if (!orgSnap.exists) {
        throw new HttpsError("not-found", "Organization not found.");
      }
      const ownerUid = safeText(orgSnap.data()?.ownerUid);
      if (ownerUid !== uid) {
        throw new HttpsError(
          "permission-denied",
          "This account is not the owner of that organization."
        );
      }
    }

    const payload = {
      orgId,
      email,
      role: "admin",
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!userSnap.exists) {
      payload.createdAt = FieldValue.serverTimestamp();
    }

    await userRef.set(payload, { merge: true });

    return { orgId, repaired: true };
  }
);

/**
 * Staff self-signup: after Firebase Auth account exists, verify org slug + invite code and write users/{uid}.
 */
exports.staffSignupWithInvite = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const uid = request.auth.uid;
    const email = safeText(request.auth.token?.email || "");
    const data = request.data || {};
    const displayName = safeText(data.displayName);
    const inviteCode = safeText(data.inviteCode);
    const slug = normalizeOrgSlug(data.golfCourseName != null ? data.golfCourseName : data.slug);

    if (!displayName) {
      throw new HttpsError("invalid-argument", "Display name is required.");
    }
    if (!inviteCode) {
      throw new HttpsError("invalid-argument", "Staff invite code is required.");
    }
    if (!slug) {
      throw new HttpsError("invalid-argument", "Golf course name is required.");
    }

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const existingOrg = orgIdFromUserSnapData(userSnap.data());
      if (existingOrg) {
        throw new HttpsError(
          "already-exists",
          "This account is already linked to an organization. Sign in instead."
        );
      }
    }

    const q = await db.collection("organizations").where("slug", "==", slug).limit(2).get();
    if (q.empty) {
      throw new HttpsError(
        "not-found",
        "No organization matches that golf course name. Check spelling or ask your manager for the exact course name."
      );
    }
    if (q.size > 1) {
      throw new HttpsError(
        "failed-precondition",
        "Multiple organizations match this name. Contact support."
      );
    }

    const orgDoc = q.docs[0];
    const orgData = orgDoc.data() || {};
    if (orgData.active === false) {
      throw new HttpsError(
        "failed-precondition",
        "This organization is not accepting new staff signups right now."
      );
    }

    const expected = safeText(orgData.staffInviteCode || orgData.inviteCode); 
    if (!expected || inviteCode !== expected) {
      throw new HttpsError("permission-denied", "Invalid invite code.");
    }

    const payload = {
      displayName,
      email,
      orgId: orgDoc.id,
      role: "admin",
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!userSnap.exists) {
      payload.createdAt = FieldValue.serverTimestamp();
    }

    await userRef.set(payload, { merge: true });

    return { orgId: orgDoc.id, ok: true };
  }
);

// --- String helpers (aligned with register-complete.html) ---
// safeText is defined above (used by setupOrganization).

/**
 * Normalize hole labels like "1a", "10B" → "1A", "10B".
 * Returns "" if invalid.
 */
function normalizeHoleLabel(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "";
  const m = s.match(/^([1-9]|1[0-8])([A-Z])$/);
  if (!m) return "";
  return `${parseInt(m[1], 10)}${m[2]}`;
}

/**
 * Default shotgun-style order: 1A→2A→…→18A→1B→… for up to `maxWaves` waves (A–L).
 * Matches register-complete.html: buildDefaultSlotSequence(12).
 */
function buildDefaultSlotSequence(maxWaves = 12) {
  const slots = [];
  for (let wave = 0; wave < maxWaves; wave++) {
    const letter = String.fromCharCode(65 + wave);
    for (let hole = 1; hole <= 18; hole++) {
      slots.push(`${hole}${letter}`);
    }
  }
  return slots;
}

/**
 * Custom order from comma-separated hole list on the tournament doc.
 */
function buildCustomSlotSequence(raw) {
  const parts = String(raw || "")
    .split(",")
    .map((x) => normalizeHoleLabel(x))
    .filter(Boolean);

  const unique = [];
  const seen = new Set();
  parts.forEach((p) => {
    if (seen.has(p)) return;
    seen.add(p);
    unique.push(p);
  });
  return unique;
}

/**
 * Resolve which hole sequence to use from tournament settings.
 * Returns [] when auto-assign is off (caller assigns no hole; status stays registered).
 */
function getAssignmentSequence(tournament) {
  const autoAssignEnabled = String(tournament?.autoAssignEnabled || "on").toLowerCase();
  const holeAssignmentMode = String(tournament?.holeAssignmentMode || "default").toLowerCase();
  const customHoleFlow = safeText(tournament?.customHoleFlow, "");

  if (autoAssignEnabled === "off") return [];

  if (holeAssignmentMode === "custom") {
    const custom = buildCustomSlotSequence(customHoleFlow);
    if (custom.length) return custom;
  }

  return buildDefaultSlotSequence(12);
}

/**
 * From all current registration docs, collect holes already taken (non-cancelled only).
 * Reads assignedHole or legacy startHole; normalizes label.
 */
function collectUsedHolesFromSnapshot(registrationsSnapshot) {
  const used = new Set();
  registrationsSnapshot.forEach((docSnap) => {
    const x = docSnap.data() || {};
    const status = String(x.status || "").toLowerCase();
    if (status === "cancelled") return;

    const hole = normalizeHoleLabel(x.assignedHole || x.startHole || "");
    if (hole) used.add(hole);
  });
  return used;
}

/**
 * First slot in `sequence` not present in `used`.
 */
function pickNextAvailableSlot(sequence, used) {
  for (const slot of sequence) {
    if (!used.has(slot)) return slot;
  }
  return "";
}

/**
 * Validates and sanitizes client-supplied player details (max 6).
 */
function sanitizePlayerDetails(raw, handicapEnabled) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const player of raw) {
    if (!player || typeof player !== "object") continue;
    const name = safeText(player.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const item = {
      name,
      isCaptain: !!player.isCaptain,
    };
    if (handicapEnabled) {
      const h = Number(player.handicap ?? 0);
      item.handicap = Number.isFinite(h) ? Math.max(0, Math.min(54, Math.round(h))) : 0;
    }
    out.push(item);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Builds the registration document fields (same shape as register-complete.html buildRegistrationPayload).
 */
function buildRegistrationDocument(tournament, tournamentId, clientData, assignedHole) {
  const handicapOn = !!clientData.handicapEnabled;
  const playerDetails = sanitizePlayerDetails(clientData.playerDetails, handicapOn);
  const players = playerDetails.map((p) => p.name);

  const t = tournament || {};

  const resolvedCourseId = (() => {
    const id = String(t.courseId || t.defaultCourse || "").trim();
    const l = id.toLowerCase();
    if (l === "tradition" || l === "cypress") return l;
    return id;
  })();

  return {
    tournamentId: safeText(tournamentId),
    tournamentName: safeText(t.tournamentName || t.name, ""),
    defaultCourse: safeText(t.defaultCourse, ""),
    courseId: resolvedCourseId,
    formatOfPlay: safeText(t.formatOfPlay, ""),
    format: String(t.formatOfPlay || "").trim().toLowerCase(),
    teamName: safeText(clientData.teamName, ""),
    captainName: safeText(clientData.captainName, ""),
    captainEmail: safeText(clientData.captainEmail, ""),
    captainPhone: safeText(clientData.captainPhone, ""),
    players,
    playerDetails,
    handicapEnabled: handicapOn,
    handicapPercent: handicapOn ? Number(t.handicapPercent || clientData.handicapPercent || 100) : 0,
    notes: safeText(clientData.notes, ""),
    assignedHole: assignedHole || "",
    status: assignedHole ? "assigned" : "registered",
    source: "register-complete",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Same fields as stored on Firestore, without server timestamps (for callable JSON response).
 */
function buildPlainRegistrationForClient(tournament, tournamentId, clientData, assignedHole) {
  const handicapOn = !!clientData.handicapEnabled;
  const playerDetails = sanitizePlayerDetails(clientData.playerDetails, handicapOn);
  const players = playerDetails.map((p) => p.name);
  const t = tournament || {};

  const resolvedCourseId = (() => {
    const id = String(t.courseId || t.defaultCourse || "").trim();
    const l = id.toLowerCase();
    if (l === "tradition" || l === "cypress") return l;
    return id;
  })();

  return {
    tournamentId: safeText(tournamentId),
    tournamentName: safeText(t.tournamentName || t.name, ""),
    defaultCourse: safeText(t.defaultCourse, ""),
    courseId: resolvedCourseId,
    formatOfPlay: safeText(t.formatOfPlay, ""),
    format: String(t.formatOfPlay || "").trim().toLowerCase(),
    teamName: safeText(clientData.teamName, ""),
    captainName: safeText(clientData.captainName, ""),
    captainEmail: safeText(clientData.captainEmail, ""),
    captainPhone: safeText(clientData.captainPhone, ""),
    players,
    playerDetails,
    handicapEnabled: handicapOn,
    handicapPercent: handicapOn ? Number(t.handicapPercent || clientData.handicapPercent || 100) : 0,
    notes: safeText(clientData.notes, ""),
    assignedHole: assignedHole || "",
    status: assignedHole ? "assigned" : "registered",
    source: "register-complete",
  };
}

/**
 * Callable: atomically assign hole + create registration.
 *
 * Input: { organizationId?, orgId?, tournamentId, teamName, ... }
 * organizationId / orgId: when set, tournament lives under organizations/{id}/tournaments/{tournamentId}
 * Output: { registrationId, assignedHole, registration }
 */
exports.registerTeam = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required. Please refresh and try again.");
    }

    const data = request.data || {};
    const organizationId = safeText(data.organizationId || data.orgId);
    const tournamentId = safeText(data.tournamentId);
    if (!tournamentId) {
      throw new HttpsError("invalid-argument", "tournamentId is required.");
    }

    const hasAnyDetail =
      safeText(data.teamName) ||
      safeText(data.captainName) ||
      safeText(data.captainEmail) ||
      safeText(data.captainPhone) ||
      safeText(data.notes) ||
      (Array.isArray(data.playerDetails) && data.playerDetails.some((p) => safeText(p?.name)));

    if (!hasAnyDetail) {
      throw new HttpsError(
        "invalid-argument",
        "Please enter at least one name, team, or contact detail before submitting."
      );
    }

    const tournamentRef = organizationId
      ? db.collection("organizations").doc(organizationId).collection("tournaments").doc(tournamentId)
      : db.collection("tournaments").doc(tournamentId);
    const registrationsCol = tournamentRef.collection("registrations");

    const result = await db.runTransaction(async (transaction) => {
      // --- All reads first (Firestore transaction rule) ---
      const tournamentSnap = await transaction.get(tournamentRef);
      if (!tournamentSnap.exists) {
        throw new HttpsError("not-found", "Tournament not found.");
      }

      const tournament = tournamentSnap.data() || {};
      const registrationsSnap = await transaction.get(registrationsCol);

      const sequence = getAssignmentSequence(tournament);
      const used = collectUsedHolesFromSnapshot(registrationsSnap);

      let assignedHole = "";
      if (sequence.length > 0) {
        assignedHole = pickNextAvailableSlot(sequence, used);
        if (!assignedHole) {
          throw new HttpsError(
            "resource-exhausted",
            "No open starting holes are available for this tournament."
          );
        }
      }

      const clientData = {
        teamName: data.teamName,
        captainName: data.captainName,
        captainEmail: data.captainEmail,
        captainPhone: data.captainPhone,
        playerDetails: data.playerDetails,
        notes: data.notes,
        handicapEnabled: data.handicapEnabled,
        handicapPercent: data.handicapPercent,
      };

      const regPayload = buildRegistrationDocument(tournament, tournamentId, clientData, assignedHole);

      const newRegRef = registrationsCol.doc();
      transaction.set(newRegRef, regPayload);

      return {
        registrationId: newRegRef.id,
        assignedHole,
        registration: buildPlainRegistrationForClient(
          tournament,
          tournamentId,
          clientData,
          assignedHole
        ),
      };
    });

    return result;
  }
);

/**
 * Deletes all documents in a collection (batched). Used for tournament subcollections.
 */
async function deleteCollectionInBatches(collectionRef) {
  let more = true;
  while (more) {
    const snap = await collectionRef.limit(500).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    more = snap.size === 500;
  }
}

/** Fetch image bytes and build a data URL for OpenAI vision (avoids hotlink issues). */
async function fetchImageAsDataUrl(imageUrl) {
  const res = await fetch(imageUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    throw new Error(`Image fetch failed: HTTP ${res.status}`);
  }
  const rawCt = res.headers.get("content-type") || "";
  const ct = rawCt.split(";")[0].trim().toLowerCase() || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) {
    throw new Error("Image too large (max 20 MB)");
  }
  const b64 = buf.toString("base64");
  return { dataUrl: `data:${ct};base64,${b64}`, contentType: ct };
}

function parseJsonFromModelContent(raw) {
  let s = String(raw || "").trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  if (fence) {
    s = fence[1].trim();
  }
  return JSON.parse(s);
}

/**
 * Validates extracted shape: 18 holes, pars, tee keys match yard columns per hole.
 * @returns {{ ok: true, courseName: string, teeSets: string[], holes: object[] } | { ok: false }}
 */
function validateExtractedScorecard(parsed) {
  if (!parsed || typeof parsed !== "object") return { ok: false };
  const courseName = safeText(parsed.courseName);
  const teeSetsRaw = Array.isArray(parsed.teeSets) ? parsed.teeSets : [];
  const teeSets = teeSetsRaw.map((t) => String(t).trim()).filter(Boolean);
  if (teeSets.length < 1) return { ok: false };
  if (teeSets.length > 12) return { ok: false };

  const holesRaw = Array.isArray(parsed.holes) ? parsed.holes : [];
  if (holesRaw.length !== 18) return { ok: false };

  const byHole = new Map();
  for (const h of holesRaw) {
    if (!h || typeof h !== "object") return { ok: false };
    const hn = Number(h.hole);
    if (!Number.isFinite(hn) || hn < 1 || hn > 18) return { ok: false };
    const par = Number(h.par);
    if (!Number.isFinite(par)) return { ok: false };
    const handicap = Number(h.handicap);
    if (!Number.isFinite(handicap)) return { ok: false };
    if (!h.yards || typeof h.yards !== "object") return { ok: false };

    for (const teeName of teeSets) {
      if (!(teeName in h.yards)) return { ok: false };
      const y = Number(h.yards[teeName]);
      if (!Number.isFinite(y) || y < 0) return { ok: false };
    }
    const yardKeys = Object.keys(h.yards);
    if (yardKeys.length !== teeSets.length) return { ok: false };
    for (const k of yardKeys) {
      if (!teeSets.includes(k)) return { ok: false };
    }

    byHole.set(hn, {
      hole: hn,
      par: Math.round(par),
      handicap: Math.round(handicap),
      yards: teeSets.reduce((acc, name) => {
        acc[name] = Math.round(Number(h.yards[name]));
        return acc;
      }, {}),
    });
  }

  if (byHole.size !== 18) return { ok: false };
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    if (!byHole.has(n)) return { ok: false };
    holes.push(byHole.get(n));
  }

  return { ok: true, courseName, teeSets, holes };
}

/**
 * If the model listed too few tee names but each hole's "yards" includes extra columns
 * (same keys on every hole), expand teeSets to match hole 1 column order.
 */
function normalizeParsedScorecardTeeSets(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const holesRaw = Array.isArray(parsed.holes) ? parsed.holes : [];
  if (holesRaw.length !== 18) return parsed;

  const sortedHoles = [...holesRaw].sort((a, b) => Number(a.hole) - Number(b.hole));
  const keysPerHole = sortedHoles.map((h) => {
    if (!h || typeof h !== "object" || !h.yards || typeof h.yards !== "object") return null;
    return Object.keys(h.yards).filter((k) => {
      const y = Number(h.yards[k]);
      return Number.isFinite(y) && y >= 0;
    });
  });
  if (keysPerHole.some((k) => !k || k.length === 0)) return parsed;

  const firstKeys = keysPerHole[0];
  const setEq = (a, b) => {
    if (a.length !== b.length) return false;
    const sa = new Set(a);
    if (sa.size !== a.length) return false;
    return b.every((k) => sa.has(k));
  };
  if (!keysPerHole.every((keys) => setEq(keys, firstKeys))) return parsed;

  const declared = (Array.isArray(parsed.teeSets) ? parsed.teeSets : [])
    .map((t) => String(t).trim())
    .filter(Boolean);

  if (firstKeys.length <= declared.length) return parsed;

  const ordered = [];
  const seen = new Set();
  for (const d of declared) {
    if (firstKeys.includes(d) && !seen.has(d)) {
      ordered.push(d);
      seen.add(d);
    }
  }
  for (const k of firstKeys) {
    if (!seen.has(k)) {
      ordered.push(k);
      seen.add(k);
    }
  }
  if (ordered.length === firstKeys.length && ordered.length <= 12) {
    parsed.teeSets = ordered;
  }
  return parsed;
}

const SCORECARD_EXTRACTION_PROMPT = `You are a golf scorecard digitization assistant. Read the scorecard image and extract all visible tabular data.

Return ONLY a single JSON object (no markdown fences, no commentary before or after) with this exact structure (one example hole shown; you must output all 18 holes with the same shape):
{
  "courseName": "",
  "teeSets": ["Gold", "Forest", "Blue", "Stone", "Copper"],
  "holes": [
    {
      "hole": 1,
      "par": 4,
      "handicap": 10,
      "yards": {
        "Gold": 420,
        "Forest": 400,
        "Blue": 380,
        "Stone": 360,
        "Copper": 340
      }
    }
  ]
}

Strict rules:
- "holes" must contain exactly 18 objects, one for each hole number 1 through 18 (include front and back nine).
- Every hole must have a numeric "par".
- Every hole must have a numeric "handicap" (stroke index / handicap ranking as shown on the card).
- **Tee / yardage columns:** Include EVERY distinct yardage column visible on the card (often 4–8 columns). Scorecards may list tees in multiple horizontal bands or stacked blocks (e.g. Gold, Forest, Blue, Stone, Copper). Scan the entire yardage table—do NOT stop after two or three columns. If you see five tee names, "teeSets" must have five names and every hole's "yards" must have five matching keys with numeric values.
- "teeSets" lists those tee/column names in the same order as the yardage columns appear on the scorecard (left-to-right, or top-to-bottom if that matches how columns are labeled).
- For every hole, "yards" must include exactly one numeric yardage for each name in "teeSets", using the same keys as in "teeSets".
- Do not omit holes. If a value is unreadable, estimate from context or use 0 only for yardage with a note in courseName — prefer leaving par/handicap as numbers you can infer.
- Use integers for yards and par when shown as whole numbers.
- Support at least 6 tee columns when the image shows that many; there is no benefit to merging or dropping columns.

Output valid JSON only.`;

async function callOpenAiVisionExtract(apiKey, dataUrl) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      temperature: 0.1,
      max_output_tokens: 16384,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: SCORECARD_EXTRACTION_PROMPT
            },
            {
              type: "input_image",
              image_url: dataUrl
            }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(120000),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    let errMsg = bodyText.slice(0, 500);
    try {
      const j = JSON.parse(bodyText);
      errMsg = j.error?.message || errMsg;
    } catch (_e) {
      /* ignore */
    }
    throw new Error(`OpenAI API error: ${res.status} ${errMsg}`);
  }

  const body = JSON.parse(bodyText);
  let content = body.output_text;

if (!content && Array.isArray(body.output)) {
  const first = body.output[0];
  const part = first?.content?.find(c => c.type === "output_text");
  content = part?.text;
}

if (!content || typeof content !== "string") {
  throw new Error("OpenAI returned no message content");
}
  return parseJsonFromModelContent(content);
}

/**
 * Callable: extract tee/hole data from a scorecard image URL via OpenAI Vision.
 * Does not write Firestore. Client applies returned fields to the course builder only.
 */
exports.extractScorecardData = onCall(
  {
    region: "us-central1",
    cors: true,
    secrets: [OPENAI_API_KEY],
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in to extract scorecard data.");
    }

    const data = req.data || {};
    const scorecardImageUrl = safeText(data.scorecardImageUrl);
    if (!scorecardImageUrl) {
      throw new HttpsError("invalid-argument", "scorecardImageUrl is required.");
    }

    const orgId = safeText(data.orgId);
    const courseId = safeText(data.courseId);

    if (orgId) {
      const userSnap = await db.collection("users").doc(req.auth.uid).get();
      const userData = userSnap.exists ? userSnap.data() || {} : {};
      const userOrgId = safeText(userData.orgId || userData.organizationId);
      const role = String(userData.role || "")
        .trim()
        .toLowerCase();
      const isPlatformAdmin = role === "super_admin" || role === "support_admin";
      if (userOrgId !== orgId && !isPlatformAdmin) {
        throw new HttpsError(
          "permission-denied",
          "Organization does not match your signed-in account."
        );
      }
    }

    const apiKey = OPENAI_API_KEY.value();
    if (!apiKey) {
      return { error: true, message: "Could not extract scorecard" };
    }

    try {
      const { dataUrl } = await fetchImageAsDataUrl(scorecardImageUrl);
      const parsed = await callOpenAiVisionExtract(apiKey, dataUrl);
      normalizeParsedScorecardTeeSets(parsed);
      const validated = validateExtractedScorecard(parsed);
      if (!validated.ok) {
        return { error: true, message: "Could not extract scorecard" };
      }

      return {
        courseName: validated.courseName,
        teeSets: validated.teeSets,
        holes: validated.holes,
        notes: "Extracted with OpenAI Vision. Review all values before saving.",
        warnings: [
          "Automated extraction may contain errors. Compare each cell to the scorecard image.",
        ],
        incomplete: false,
        meta: {
          orgId: orgId || null,
          courseId: courseId || null,
          imageUrlLength: scorecardImageUrl.length,
        },
      };
    } catch (e) {
      console.error("[extractScorecardData]", e && e.message ? e.message : e);
      return { error: true, message: "Could not extract scorecard" };
    }
  }
);

/**
 * Callable: permanently delete an org tournament and its registrations, submissions, and alerts.
 * Must be invoked by a signed-in user whose users/{uid}.orgId matches the tournament org.
 */
exports.deleteTournament = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to delete a tournament.");
    }

    const data = request.data || {};
    const orgId = safeText(data.orgId || data.organizationId);
    const tournamentId = safeText(data.tournamentId);
    if (!orgId || !tournamentId) {
      throw new HttpsError("invalid-argument", "orgId (or organizationId) and tournamentId are required.");
    }

    const userSnap = await db.collection("users").doc(request.auth.uid).get();
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const userOrgId = safeText(userData.orgId || userData.organizationId);
    const role = String(userData.role || "")
      .trim()
      .toLowerCase();
    const isPlatformAdmin = role === "super_admin" || role === "support_admin";

    const orgSnap = await db.collection("organizations").doc(orgId).get();
    if (!orgSnap.exists) {
      throw new HttpsError("not-found", "Organization not found.");
    }
    const orgOwnerUid = safeText(orgSnap.data()?.ownerUid);
    const isOrgOwner = !!orgOwnerUid && orgOwnerUid === request.auth.uid;
    const isOrgMember = !!userOrgId && userOrgId === orgId;

    if (!isOrgMember && !isOrgOwner && !isPlatformAdmin) {
      throw new HttpsError("permission-denied", "You can only delete tournaments in your organization.");
    }

    const tournamentRef = db
      .collection("organizations")
      .doc(orgId)
      .collection("tournaments")
      .doc(tournamentId);

    const tSnap = await tournamentRef.get();
    if (!tSnap.exists) {
      throw new HttpsError("not-found", "Tournament not found.");
    }

    await deleteCollectionInBatches(tournamentRef.collection("registrations"));
    await deleteCollectionInBatches(tournamentRef.collection("submissions"));
    await deleteCollectionInBatches(tournamentRef.collection("alerts"));

    await tournamentRef.delete();

    return { ok: true };
  }
);
