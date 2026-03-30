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
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// --- setupOrganization: creates organizations/{orgId} + users/{uid} (Admin SDK; bypasses rules) ---

function safeText(value, fallback = "") {
  return String(value || fallback || "").trim();
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
            const existingOrgId = safeText(userSnap.data()?.orgId);
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

  return {
    tournamentId: safeText(tournamentId),
    tournamentName: safeText(t.tournamentName || t.name, ""),
    defaultCourse: safeText(t.defaultCourse, ""),
    courseId: String(t.defaultCourse || "").trim().toLowerCase(),
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

  return {
    tournamentId: safeText(tournamentId),
    tournamentName: safeText(t.tournamentName || t.name, ""),
    defaultCourse: safeText(t.defaultCourse, ""),
    courseId: String(t.defaultCourse || "").trim().toLowerCase(),
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

    const orgSnap = await db.collection("organizations").doc(orgId).get();
    if (!orgSnap.exists) {
      throw new HttpsError("not-found", "Organization not found.");
    }
    const orgOwnerUid = safeText(orgSnap.data()?.ownerUid);
    const isOrgOwner = !!orgOwnerUid && orgOwnerUid === request.auth.uid;
    const isOrgMember = !!userOrgId && userOrgId === orgId;

    if (!isOrgMember && !isOrgOwner) {
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
