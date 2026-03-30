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
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// --- setupOrganization: creates organizations/{orgId} + users/{uid} (Admin SDK; bypasses rules) ---

exports.setupOrganization = onCall(
  {
    region: "us-central1",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in before creating an organization.");
    }

    const uid = request.auth.uid;
    const email = safeText(request.auth.token?.email || "");
    const courseName = safeText(request.data?.courseName);
    if (!courseName) {
      throw new HttpsError("invalid-argument", "courseName is required.");
    }

    const userRef = db.collection("users").doc(uid);
    const existing = await userRef.get();
    if (existing.exists) {
      const orgId = safeText(existing.data()?.orgId);
      if (orgId) {
        return { orgId, alreadySetup: true };
      }
    }

    const orgRef = db.collection("organizations").doc();
    const orgId = orgRef.id;

    await db.runTransaction(async (transaction) => {
      transaction.set(orgRef, {
        name: courseName,
        ownerUid: uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.set(userRef, {
        orgId,
        email,
        role: "admin",
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return { orgId, alreadySetup: false };
  }
);

// --- String helpers (aligned with register-complete.html) ---

function safeText(value, fallback = "") {
  return String(value || fallback || "").trim();
}

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
