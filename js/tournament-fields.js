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
/** Public registration page (register-complete) — stored on registration docs for traceability */
export const REGISTRANT_SOURCE_DIRECT_REGISTRATION = "direct_registration";
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

/** Registration page UI bucket (distinct from legacy `eventType` = golf_tournament on the event doc). */
export const REGISTRATION_PAGE_EVENT_TOURNAMENT = "tournament";
export const REGISTRATION_PAGE_EVENT_CLINIC = "clinic";
export const REGISTRATION_PAGE_EVENT_CAMP = "camp";
/** General / non-golf gatherings — labeled "event" in UI */
export const REGISTRATION_PAGE_EVENT_GENERAL = "event";

/**
 * Normalize a single string to a registration-page event bucket.
 * Accepts legacy Firestore values (golf_tournament, general, etc.).
 */
export function normalizeRegistrationPageEventType(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "tournament" || raw === EVENT_CATEGORY_GOLF || raw === "golf" || raw === EVENT_TYPE_GOLF_TOURNAMENT) {
    return REGISTRATION_PAGE_EVENT_TOURNAMENT;
  }
  if (raw === REGISTRATION_PAGE_EVENT_CLINIC) return REGISTRATION_PAGE_EVENT_CLINIC;
  if (raw === REGISTRATION_PAGE_EVENT_CAMP) return REGISTRATION_PAGE_EVENT_CAMP;
  if (raw === REGISTRATION_PAGE_EVENT_GENERAL || raw === EVENT_CATEGORY_GENERAL) return REGISTRATION_PAGE_EVENT_GENERAL;
  return "";
}

/**
 * Source of truth: event document `eventType` (organizer-set), then `eventCategory`, then normalized category.
 * If still unknown, logs a warning and defaults to tournament for backward compatibility.
 */
export function resolveRegistrationPageEventTypeFromDocument(t) {
  const doc = t || {};
  const fromEventType = normalizeRegistrationPageEventType(doc.eventType);
  if (fromEventType) return fromEventType;
  const fromCategory = normalizeRegistrationPageEventType(doc.eventCategory);
  if (fromCategory) return fromCategory;
  const cat = normalizeEventCategory(doc);
  if (cat === EVENT_CATEGORY_CLINIC) return REGISTRATION_PAGE_EVENT_CLINIC;
  if (cat === EVENT_CATEGORY_CAMP) return REGISTRATION_PAGE_EVENT_CAMP;
  if (cat === EVENT_CATEGORY_GENERAL) return REGISTRATION_PAGE_EVENT_GENERAL;
  if (cat === EVENT_CATEGORY_GOLF) return REGISTRATION_PAGE_EVENT_TOURNAMENT;
  console.warn(
    "[registration] Missing or unknown eventType/eventCategory on event document; defaulting registration UI to tournament",
    { eventType: doc.eventType, eventCategory: doc.eventCategory }
  );
  return REGISTRATION_PAGE_EVENT_TOURNAMENT;
}

/**
 * Title Case display labels for UI buckets (tournament | clinic | camp | event).
 * Stored Firestore values stay golf_tournament, clinic, camp, general.
 */
export const EVENT_TYPE_LABELS = {
  [REGISTRATION_PAGE_EVENT_TOURNAMENT]: "Tournament",
  [REGISTRATION_PAGE_EVENT_CLINIC]: "Clinic",
  [REGISTRATION_PAGE_EVENT_CAMP]: "Camp",
  [REGISTRATION_PAGE_EVENT_GENERAL]: "General Event",
};

export function getEventTypeDisplayLabel(pageEventTypeKey) {
  const k = String(pageEventTypeKey || "").trim();
  return EVENT_TYPE_LABELS[k] || EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_TOURNAMENT];
}

/**
 * Normalize to UI bucket: tournament | clinic | camp | event.
 * Pass a tournament document, or stored eventCategory / eventType string.
 */
export function normalizeEventType(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return resolveRegistrationPageEventTypeFromDocument(value);
  }
  const direct = normalizeRegistrationPageEventType(value);
  if (direct) return direct;
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return REGISTRATION_PAGE_EVENT_TOURNAMENT;
  return resolveRegistrationPageEventTypeFromDocument({ eventCategory: s, eventType: s });
}

export function getEventTypeDisplayLabelFromStoredCategory(storedCategoryOrType) {
  return getEventTypeDisplayLabel(normalizeEventType(storedCategoryOrType));
}

/**
 * Single source of truth for which surfaces appear per normalized UI bucket
 * (tournament | clinic | camp | event). Drives admin sections, registration field groups,
 * and roster tools/columns (merged in getRosterPageUiConfig).
 * Sponsor configuration in admin is always available for every event type; copy there is
 * event-aware, and tournament-only placements are labeled in the sponsor panel—not hidden.
 */
export const EVENT_TYPE_VISIBILITY = {
  [REGISTRATION_PAGE_EVENT_TOURNAMENT]: {
    showFormatSection: true,
    showStartsAssignmentsSection: true,
    showTeamRegistrationOptions: true,
    showVenueCourseField: true,
    showPlayerFields: true,
    showTeamNameField: true,
    showHandicapFields: true,
    showScoringOptions: true,
    showLeaderboardOptions: true,
    showRosterStartingHole: true,
    showRosterScoringColumns: true,
    showRosterTeamColumns: true,
    showRulesSheetPrint: true,
    showPrintPlacards: true,
    showJoinLinkInRoster: true,
    showPrintAttendance: false,
    showSessionFields: false,
    showInstructorFields: false,
    showAttendeeFields: false,
  },
  [REGISTRATION_PAGE_EVENT_CLINIC]: {
    showFormatSection: false,
    showStartsAssignmentsSection: false,
    showTeamRegistrationOptions: false,
    showVenueCourseField: false,
    showPlayerFields: false,
    showTeamNameField: false,
    showHandicapFields: false,
    showScoringOptions: false,
    showLeaderboardOptions: false,
    showRosterStartingHole: false,
    showRosterScoringColumns: false,
    showRosterTeamColumns: false,
    showRulesSheetPrint: false,
    showPrintPlacards: false,
    showJoinLinkInRoster: false,
    showPrintAttendance: true,
    showSessionFields: true,
    showInstructorFields: true,
    showAttendeeFields: true,
  },
  [REGISTRATION_PAGE_EVENT_CAMP]: {
    showFormatSection: false,
    showStartsAssignmentsSection: false,
    showTeamRegistrationOptions: false,
    showVenueCourseField: false,
    showPlayerFields: false,
    showTeamNameField: false,
    showHandicapFields: false,
    showScoringOptions: false,
    showLeaderboardOptions: false,
    showRosterStartingHole: false,
    showRosterScoringColumns: false,
    showRosterTeamColumns: false,
    showRulesSheetPrint: false,
    showPrintPlacards: false,
    showJoinLinkInRoster: false,
    showPrintAttendance: true,
    showSessionFields: true,
    showInstructorFields: true,
    showAttendeeFields: true,
  },
  [REGISTRATION_PAGE_EVENT_GENERAL]: {
    showFormatSection: false,
    showStartsAssignmentsSection: false,
    showTeamRegistrationOptions: false,
    showVenueCourseField: false,
    showPlayerFields: false,
    showTeamNameField: false,
    showHandicapFields: false,
    showScoringOptions: false,
    showLeaderboardOptions: false,
    showRosterStartingHole: false,
    showRosterScoringColumns: false,
    showRosterTeamColumns: false,
    showRulesSheetPrint: false,
    showPrintPlacards: false,
    showJoinLinkInRoster: false,
    showPrintAttendance: true,
    showSessionFields: false,
    showInstructorFields: false,
    showAttendeeFields: true,
  },
};

/**
 * @param {string} normalizedEventType tournament | clinic | camp | event
 */
export function getEventTypeVisibility(normalizedEventType) {
  const k = String(normalizedEventType || "").trim();
  return EVENT_TYPE_VISIBILITY[k] || EVENT_TYPE_VISIBILITY[REGISTRATION_PAGE_EVENT_TOURNAMENT];
}

/** @param {string} normalizedEventType */
export function isTournamentEventType(normalizedEventType) {
  return String(normalizedEventType || "").trim() === REGISTRATION_PAGE_EVENT_TOURNAMENT;
}

/**
 * Returns the visibility map for a normalized or raw event type string / doc-shaped input.
 * Logs one line for debugging; DOM updates stay in page scripts (e.g. applyAdminEventTypeVisibility in admin.html).
 * @param {string | object} eventTypeOrDoc
 */
export function applyEventTypeVisibility(eventTypeOrDoc) {
  const k = normalizeEventType(eventTypeOrDoc);
  const visibility = getEventTypeVisibility(k);
  console.info("[event-type-ui] applyEventTypeVisibility", {
    normalizedEventType: k,
    visibility,
  });
  return visibility;
}

/**
 * Central copy + flags for register-complete.html (event type drives registration behavior).
 */
export const REGISTRATION_PAGE_UI = {
  [REGISTRATION_PAGE_EVENT_TOURNAMENT]: {
    pageTitle: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_TOURNAMENT]} Registration`,
    heading: "Register Team",
    helperText:
      "Add your team name, captain, and roster. Handicap fields appear when the organizer enables them for this event.",
    submitLabel: "Register Team",
    successMessage: "Team registration submitted successfully.",
    finePrint: "Your registration will be saved for this event.",
    useTeamFlow: true,
    showPlayerFields: true,
    showTeamName: true,
    showHandicapFields: true,
  },
  [REGISTRATION_PAGE_EVENT_CLINIC]: {
    pageTitle: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CLINIC]} Registration`,
    heading: `Register for ${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CLINIC]}`,
    helperText: "Tell us who you are and how to reach you. Optional session or time preferences go in the fields below.",
    submitLabel: `Register for ${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CLINIC]}`,
    successMessage: "Clinic registration submitted successfully.",
    finePrint: "Submit once per participant (or as instructed by the organizer).",
    useTeamFlow: false,
    showPlayerFields: false,
    showTeamName: false,
    showHandicapFields: false,
  },
  [REGISTRATION_PAGE_EVENT_CAMP]: {
    pageTitle: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CAMP]} Registration`,
    heading: `Register for ${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CAMP]}`,
    helperText: "Tell us who you are and how to reach you. Add notes if the organizer should know anything specific.",
    submitLabel: `Register for ${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CAMP]}`,
    successMessage: "Camp registration submitted successfully.",
    finePrint: "Submit once per participant (or as instructed by the organizer).",
    useTeamFlow: false,
    showPlayerFields: false,
    showTeamName: false,
    showHandicapFields: false,
  },
  [REGISTRATION_PAGE_EVENT_GENERAL]: {
    pageTitle: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_GENERAL]} Registration`,
    heading: `Register for ${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_GENERAL]}`,
    helperText: "Tell us who you are and how to reach you. The organizer will follow up with details if needed.",
    submitLabel: "Register",
    successMessage: "Registration submitted successfully.",
    finePrint: "Your details are sent to the event organizer.",
    useTeamFlow: false,
    showPlayerFields: false,
    showTeamName: false,
    showHandicapFields: false,
  },
};

/**
 * @param {string} pageType
 * @returns {typeof REGISTRATION_PAGE_UI[keyof typeof REGISTRATION_PAGE_UI] & { visibility: typeof EVENT_TYPE_VISIBILITY[keyof typeof EVENT_TYPE_VISIBILITY], showAttendeeSessionFields: boolean, showAttendeeInstructorField: boolean }}
 */
export function getRegistrationPageUiConfig(pageType) {
  const k = String(pageType || "").trim();
  const base = REGISTRATION_PAGE_UI[k] || REGISTRATION_PAGE_UI[REGISTRATION_PAGE_EVENT_TOURNAMENT];
  const vis = getEventTypeVisibility(k);
  return {
    ...base,
    visibility: vis,
    showAttendeeSessionFields: vis.showSessionFields,
    showAttendeeInstructorField: vis.showInstructorFields,
  };
}

/**
 * Same bucket resolution as the registration page — event document `eventType`, then `eventCategory`.
 * Use this for roster so terminology stays aligned with register-complete / admin.
 */
export const resolveRosterPageEventTypeFromDocument = resolveRegistrationPageEventTypeFromDocument;

/**
 * Organizer roster: labels, columns, and which golf/scoring tools apply.
 * Keys match REGISTRATION_PAGE_EVENT_* (tournament | clinic | camp | event).
 */
export const ROSTER_PAGE_UI = {
  [REGISTRATION_PAGE_EVENT_TOURNAMENT]: {
    pageTitle: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_TOURNAMENT]} Roster`,
    heading: "Roster",
    entityLabel: "Players",
    collectionLabel: "Teams",
    teamColumnLabel: "Team",
    playersColumnLabel: "Players",
    assignmentColumnFallback: "Hole",
    searchPlaceholder: "Search team, captain, player, or assignment…",
    emptyState: "No teams yet.",
    copyRosterLabel: "📋 Copy Roster",
    copyAlphaLabel: "📋 Copy Alpha List",
    addEntryLabel: "➕ Add Team",
    modalAddTitle: "Add Team",
    modalEditTitle: "Edit Team",
    saveEntryButtonLabel: "💾 Save Team",
    assignedPillLabel: "Assigned",
    uniqueCountLabel: "Unique players",
    nextSlotPillPrefix: "Next open hole:",
    showTeams: true,
    showScoringColumns: true,
    showStartingHole: true,
    showLeaderboardActions: true,
    showRulesSheetPrint: true,
    showPrintPlacards: true,
    showJoinLinkAction: true,
    showSessionFields: false,
    showInstructorFields: false,
    showHandicapInTable: true,
    showContactInTable: false,
    showNextSlotPill: true,
    showPrintAttendance: false,
    printAttendanceLabel: "🖨 Print Sign-In Sheet",
    showAlertOrganizer: true,
    statusFilterOptions: [
      { value: "all", label: "All Statuses" },
      { value: "registered", label: "Registered" },
      { value: "assigned", label: "Assigned" },
      { value: "checked_in", label: "Checked In" },
      { value: "scoring", label: "Scoring" },
      { value: "finished", label: "Finished" },
      { value: "cancelled", label: "Cancelled" },
    ],
  },
  [REGISTRATION_PAGE_EVENT_CLINIC]: {
    pageTitle: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CLINIC]} Roster`,
    heading: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CLINIC]} Attendees`,
    entityLabel: "Attendees",
    collectionLabel: "Groups",
    teamColumnLabel: "Group / name",
    playersColumnLabel: "Participants",
    assignmentColumnFallback: "Session / time",
    searchPlaceholder: "Search name, email, phone, session, instructor, or status…",
    emptyState: "No clinic registrations yet.",
    copyRosterLabel: "📋 Copy List",
    copyAlphaLabel: "📋 Copy Alpha List",
    addEntryLabel: "➕ Add Registration",
    modalAddTitle: "Add Registration",
    modalEditTitle: "Edit Registration",
    saveEntryButtonLabel: "💾 Save",
    assignedPillLabel: "Scheduled",
    uniqueCountLabel: "Unique names",
    nextSlotPillPrefix: "Next slot:",
    showTeams: false,
    showScoringColumns: false,
    showStartingHole: false,
    showLeaderboardActions: false,
    showRulesSheetPrint: false,
    showPrintPlacards: false,
    showJoinLinkAction: false,
    showSessionFields: true,
    showInstructorFields: true,
    showHandicapInTable: false,
    showContactInTable: true,
    showNextSlotPill: false,
    showPrintAttendance: true,
    printAttendanceLabel: "🖨 Print Sign-In Sheet",
    showAlertOrganizer: true,
    statusFilterOptions: [
      { value: "all", label: "All Statuses" },
      { value: "registered", label: "Registered" },
      { value: "confirmed", label: "Confirmed" },
      { value: "checked_in", label: "Checked In" },
      { value: "attended", label: "Attended" },
      { value: "cancelled", label: "Cancelled" },
      { value: "no_show", label: "No-show" },
    ],
  },
  [REGISTRATION_PAGE_EVENT_CAMP]: {
    pageTitle: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CAMP]} Roster`,
    heading: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CAMP]} Participants`,
    entityLabel: "Participants",
    collectionLabel: "Groups",
    teamColumnLabel: "Group / name",
    playersColumnLabel: "Participants",
    assignmentColumnFallback: "Session / group",
    searchPlaceholder: "Search name, email, phone, session, group, or status…",
    emptyState: "No camp registrations yet.",
    copyRosterLabel: "📋 Copy List",
    copyAlphaLabel: "📋 Copy Alpha List",
    addEntryLabel: "➕ Add Registration",
    modalAddTitle: "Add Registration",
    modalEditTitle: "Edit Registration",
    saveEntryButtonLabel: "💾 Save",
    assignedPillLabel: "Scheduled",
    uniqueCountLabel: "Unique names",
    nextSlotPillPrefix: "Next slot:",
    showTeams: false,
    showScoringColumns: false,
    showStartingHole: false,
    showLeaderboardActions: false,
    showRulesSheetPrint: false,
    showPrintPlacards: false,
    showJoinLinkAction: false,
    showSessionFields: true,
    showInstructorFields: true,
    showHandicapInTable: false,
    showContactInTable: true,
    showNextSlotPill: false,
    showPrintAttendance: true,
    printAttendanceLabel: "🖨 Print Attendance Sheet",
    showAlertOrganizer: true,
    statusFilterOptions: [
      { value: "all", label: "All Statuses" },
      { value: "registered", label: "Registered" },
      { value: "confirmed", label: "Confirmed" },
      { value: "checked_in", label: "Checked In" },
      { value: "attended", label: "Attended" },
      { value: "cancelled", label: "Cancelled" },
      { value: "no_show", label: "No-show" },
    ],
  },
  [REGISTRATION_PAGE_EVENT_GENERAL]: {
    pageTitle: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_GENERAL]} Attendees`,
    heading: "Attendee List",
    entityLabel: "Attendees",
    collectionLabel: "Registrations",
    teamColumnLabel: "Registrant",
    playersColumnLabel: "Names",
    assignmentColumnFallback: "Details",
    searchPlaceholder: "Search name, email, phone, notes, or status…",
    emptyState: "No registrations yet.",
    copyRosterLabel: "📋 Copy List",
    copyAlphaLabel: "📋 Copy Alpha List",
    addEntryLabel: "➕ Add Registration",
    modalAddTitle: "Add Registration",
    modalEditTitle: "Edit Registration",
    saveEntryButtonLabel: "💾 Save",
    assignedPillLabel: "Confirmed",
    uniqueCountLabel: "Unique names",
    nextSlotPillPrefix: "Next:",
    showTeams: false,
    showScoringColumns: false,
    showStartingHole: false,
    showLeaderboardActions: false,
    showRulesSheetPrint: false,
    showPrintPlacards: false,
    showJoinLinkAction: false,
    showSessionFields: false,
    showInstructorFields: false,
    showHandicapInTable: false,
    showContactInTable: true,
    showNextSlotPill: false,
    showPrintAttendance: true,
    printAttendanceLabel: "🖨 Print Attendee List",
    showAlertOrganizer: true,
    statusFilterOptions: [
      { value: "all", label: "All Statuses" },
      { value: "registered", label: "Registered" },
      { value: "confirmed", label: "Confirmed" },
      { value: "checked_in", label: "Checked In" },
      { value: "attended", label: "Attended" },
      { value: "cancelled", label: "Cancelled" },
      { value: "no_show", label: "No-show" },
    ],
  },
};

/**
 * Labels from ROSTER_PAGE_UI; layout/tool flags from EVENT_TYPE_VISIBILITY so one map owns visibility.
 * @param {string} pageType
 */
export function getRosterPageUiConfig(pageType) {
  const k = String(pageType || "").trim();
  const labels = ROSTER_PAGE_UI[k] || ROSTER_PAGE_UI[REGISTRATION_PAGE_EVENT_TOURNAMENT];
  const vis = getEventTypeVisibility(k);
  return {
    ...labels,
    visibility: vis,
    showScoringColumns: vis.showRosterScoringColumns,
    showStartingHole: vis.showRosterStartingHole,
    showTeams: vis.showRosterTeamColumns,
    showRulesSheetPrint: vis.showRulesSheetPrint,
    showPrintPlacards: vis.showPrintPlacards,
    showJoinLinkAction: vis.showJoinLinkInRoster,
    showSessionFields: vis.showSessionFields,
    showInstructorFields: vis.showInstructorFields,
    showHandicapInTable: vis.showHandicapFields,
    showContactInTable: vis.showAttendeeFields,
    showNextSlotPill: vis.showRosterStartingHole,
    showPrintAttendance: vis.showPrintAttendance,
  };
}

/**
 * @param {object} [t] tournament document
 * @returns {boolean}
 */
export function registrationPageUsesTeamFlow(t) {
  return getRegistrationPageUiConfig(resolveRegistrationPageEventTypeFromDocument(t)).useTeamFlow;
}

/**
 * @param {object} [t] tournament document
 * @returns {boolean}
 */
export function registrationPageUsesAttendeeFlow(t) {
  return !registrationPageUsesTeamFlow(t);
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
  if (
    raw === "register-complete" ||
    raw === "web_registration" ||
    raw === REGISTRANT_SOURCE_DIRECT_REGISTRATION
  ) {
    return REGISTRANT_SOURCE_WEB;
  }
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
