/**
 * Normalized tournament / registration field helpers.
 * Keeps backward compatibility with legacy `startType` while preferring `assignmentType`.
 */

export const EVENT_TYPE_GOLF_TOURNAMENT = "golf_tournament";

/** Primary event classification for roster UI and import behavior */
export const EVENT_CATEGORY_GOLF = "golf_tournament";
export const EVENT_CATEGORY_CLINIC = "clinic";
export const EVENT_CATEGORY_CAMP = "camp";
export const EVENT_CATEGORY_GENERAL = "general";

export const ASSIGNMENT_SHOTGUN = "shotgun";
export const ASSIGNMENT_TEE_TIMES = "tee_times";

/** Player self-serve registration flow */
export const REGISTRANT_SOURCE_WEB = "web_registration";
/** Organizer spreadsheet / Excel import */
export const REGISTRANT_SOURCE_CSV_IMPORT = "csv_import";
/** Organizer added/edited from roster modal */
export const REGISTRANT_SOURCE_ADMIN_MANUAL = "admin_manual";

/** How players may register (admin policy) */
export const REGISTRANT_SOURCE_MODE_LINK = "registration_link";
export const REGISTRANT_SOURCE_MODE_UPLOAD = "upload";
export const REGISTRANT_SOURCE_MODE_BOTH = "both";

/**
 * @param {object} [t] tournament document
 * @returns {typeof ASSIGNMENT_SHOTGUN | typeof ASSIGNMENT_TEE_TIMES}
 */
export function normalizeAssignmentType(t) {
  const raw = String(t?.assignmentType || t?.startType || "shotgun").toLowerCase();
  return raw === "tee_times" ? ASSIGNMENT_TEE_TIMES : ASSIGNMENT_SHOTGUN;
}

/**
 * @param {object} [t] tournament document
 * @returns {string}
 */
export function normalizeEventType(t) {
  const raw = String(t?.eventType || "").trim().toLowerCase();
  if (raw) return raw;
  return EVENT_TYPE_GOLF_TOURNAMENT;
}

/**
 * Golf vs clinic/camp/general — drives roster columns and import grouping.
 * Defaults to golf when unset (backward compatible).
 * @returns {typeof EVENT_CATEGORY_GOLF | typeof EVENT_CATEGORY_CLINIC | typeof EVENT_CATEGORY_CAMP | typeof EVENT_CATEGORY_GENERAL}
 */
export function normalizeEventCategory(t) {
  const c = String(t?.eventCategory || "").trim().toLowerCase();
  if (c === EVENT_CATEGORY_CLINIC) return EVENT_CATEGORY_CLINIC;
  if (c === EVENT_CATEGORY_CAMP) return EVENT_CATEGORY_CAMP;
  if (c === EVENT_CATEGORY_GENERAL) return EVENT_CATEGORY_GENERAL;
  if (c === EVENT_CATEGORY_GOLF || c === "golf") return EVENT_CATEGORY_GOLF;
  const legacy = String(t?.eventType || "").trim().toLowerCase();
  if (legacy === EVENT_CATEGORY_CLINIC) return EVENT_CATEGORY_CLINIC;
  if (legacy === EVENT_CATEGORY_CAMP) return EVENT_CATEGORY_CAMP;
  if (legacy === EVENT_CATEGORY_GENERAL) return EVENT_CATEGORY_GENERAL;
  return EVENT_CATEGORY_GOLF;
}

export function isGolfEventCategory(t) {
  return normalizeEventCategory(t) === EVENT_CATEGORY_GOLF;
}

/**
 * @param {object} [t] tournament document
 * @returns {typeof REGISTRANT_SOURCE_MODE_LINK | typeof REGISTRANT_SOURCE_MODE_UPLOAD | typeof REGISTRANT_SOURCE_MODE_BOTH}
 */
export function normalizeRegistrantSourceMode(t) {
  const raw = String(t?.registrantSourceMode || "").trim().toLowerCase();
  if (raw === REGISTRANT_SOURCE_MODE_LINK) return REGISTRANT_SOURCE_MODE_LINK;
  if (raw === REGISTRANT_SOURCE_MODE_UPLOAD) return REGISTRANT_SOURCE_MODE_UPLOAD;
  if (raw === REGISTRANT_SOURCE_MODE_BOTH) return REGISTRANT_SOURCE_MODE_BOTH;
  return REGISTRANT_SOURCE_MODE_BOTH;
}

/** Lowercase trimmed team name for duplicate detection during import. */
export function normalizeTeamKeyForImport(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeRegistrantSource(r) {
  const raw = String(r?.registrantSource || r?.source || "").trim().toLowerCase();
  if (raw === "register-complete" || raw === "web_registration") return REGISTRANT_SOURCE_WEB;
  if (raw === "csv_import" || raw === "import") return REGISTRANT_SOURCE_CSV_IMPORT;
  if (raw === "admin_manual" || raw === "admin") return REGISTRANT_SOURCE_ADMIN_MANUAL;
  if (raw) return raw;
  return REGISTRANT_SOURCE_WEB;
}

/** Roster table header for assignment column */
export function rosterAssignmentColumnTitle(tournamentMeta) {
  if (!isGolfEventCategory(tournamentMeta)) {
    return "Session / Time / Group";
  }
  if (normalizeAssignmentType(tournamentMeta) === ASSIGNMENT_TEE_TIMES) {
    return "Tee time";
  }
  return "Starting Hole";
}

/** Next-open hint label in summary pills */
export function rosterNextOpenLabel(tournamentMeta) {
  if (!isGolfEventCategory(tournamentMeta)) {
    return "Next slot:";
  }
  if (normalizeAssignmentType(tournamentMeta) === ASSIGNMENT_TEE_TIMES) {
    return "Next tee time:";
  }
  return "Next open hole:";
}

/**
 * Single cell display for assignment column on roster.
 */
export function formatRosterAssignmentDisplay(r, tournamentMeta) {
  if (!isGolfEventCategory(tournamentMeta)) {
    const parts = [
      String(r?.session || "").trim(),
      String(r?.timeSlot || "").trim(),
      String(r?.groupLabel || r?.group || "").trim(),
    ].filter(Boolean);
    if (parts.length) return parts.join(" • ");
    return "—";
  }
  if (normalizeAssignmentType(tournamentMeta) === ASSIGNMENT_TEE_TIMES) {
    return String(r?.teeTime || "").trim() || "—";
  }
  return String(r?.assignedHole || "").trim() || "—";
}

export function compareRosterAssignmentSort(a, b, tournamentMeta) {
  if (!isGolfEventCategory(tournamentMeta)) {
    const sa = [
      String(a?.session || ""),
      String(a?.timeSlot || ""),
      String(a?.groupLabel || a?.group || ""),
      String(a?.teamName || ""),
    ].join("\t");
    const sb = [
      String(b?.session || ""),
      String(b?.timeSlot || ""),
      String(b?.groupLabel || b?.group || ""),
      String(b?.teamName || ""),
    ].join("\t");
    const c = sa.localeCompare(sb);
    if (c !== 0) return c;
    return String(a?.teamName || "").localeCompare(String(b?.teamName || ""));
  }
  if (normalizeAssignmentType(tournamentMeta) === ASSIGNMENT_TEE_TIMES) {
    const ta = String(a?.teeTime || "").trim();
    const tb = String(b?.teeTime || "").trim();
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a?.teamName || "").localeCompare(String(b?.teamName || ""));
  }
  return compareHoleLabels(a?.assignedHole, b?.assignedHole);
}

function compareHoleLabels(a, b) {
  const A = holeSortKey(a);
  const B = holeSortKey(b);
  if (A.wave !== B.wave) return A.wave - B.wave;
  return A.hole - B.hole;
}

function holeSortKey(label) {
  const s = String(label || "").trim().toUpperCase();
  if (!s) return { hole: 999, wave: 999 };
  const m = s.match(/^([1-9]|1[0-8])([A-Z])$/);
  if (!m) return { hole: 999, wave: 999 };
  return { hole: parseInt(m[1], 10), wave: m[2].charCodeAt(0) - 65 };
}
