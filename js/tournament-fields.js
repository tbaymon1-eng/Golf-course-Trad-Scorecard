/**
 * Normalized tournament / registration field helpers.
 * Keeps backward compatibility with legacy `startType` while preferring `assignmentType`.
 */

import { formatTime } from "./time-format.js";

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
    heading: "Sign up your team",
    helperText:
      "Add your team name, contact person, and player names. If handicaps are on for this event, those fields appear below.",
    submitLabel: "Complete registration",
    successMessage: "You’re signed up. The organizer has your details.",
    finePrint: "Your information is saved for this event.",
    useTeamFlow: true,
    showPlayerFields: true,
    showTeamName: true,
    showHandicapFields: true,
  },
  [REGISTRATION_PAGE_EVENT_CLINIC]: {
    pageTitle: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CLINIC]} Registration`,
    heading: `Sign up for this ${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CLINIC].toLowerCase()}`,
    helperText: "Tell us who you are and how to reach you. Add session or time preferences if the form includes them.",
    submitLabel: "Complete registration",
    successMessage: "You’re signed up. The organizer has your details.",
    finePrint: "Complete one form per person unless the organizer tells you otherwise.",
    useTeamFlow: false,
    showPlayerFields: false,
    showTeamName: false,
    showHandicapFields: false,
  },
  [REGISTRATION_PAGE_EVENT_CAMP]: {
    pageTitle: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CAMP]} Registration`,
    heading: `Sign up for this ${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_CAMP].toLowerCase()}`,
    helperText: "Tell us who you are and how to reach you. Use notes for anything the organizer should know.",
    submitLabel: "Complete registration",
    successMessage: "You’re signed up. The organizer has your details.",
    finePrint: "Complete one form per person unless the organizer tells you otherwise.",
    useTeamFlow: false,
    showPlayerFields: false,
    showTeamName: false,
    showHandicapFields: false,
  },
  [REGISTRATION_PAGE_EVENT_GENERAL]: {
    pageTitle: `${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_GENERAL]} Registration`,
    heading: `Sign up for this ${EVENT_TYPE_LABELS[REGISTRATION_PAGE_EVENT_GENERAL].toLowerCase()}`,
    helperText: "Tell us who you are and how to reach you. The organizer will follow up if they need more.",
    submitLabel: "Complete registration",
    successMessage: "You’re signed up. The organizer has your details.",
    finePrint: "Your details go straight to the event organizer.",
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
    searchPlaceholder: "Search team, contact, player, or assignment…",
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
    emptyState: "No one signed up yet.",
    copyRosterLabel: "📋 Copy List",
    copyAlphaLabel: "📋 Copy Alpha List",
    addEntryLabel: "➕ Add sign-up",
    modalAddTitle: "Add sign-up",
    modalEditTitle: "Edit sign-up",
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
    emptyState: "No one signed up yet.",
    copyRosterLabel: "📋 Copy List",
    copyAlphaLabel: "📋 Copy Alpha List",
    addEntryLabel: "➕ Add sign-up",
    modalAddTitle: "Add sign-up",
    modalEditTitle: "Edit sign-up",
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
    collectionLabel: "Who is signed up",
    teamColumnLabel: "Primary contact",
    playersColumnLabel: "Names",
    assignmentColumnFallback: "Details",
    searchPlaceholder: "Search name, email, phone, notes, or status…",
    emptyState: "No one signed up yet.",
    copyRosterLabel: "📋 Copy List",
    copyAlphaLabel: "📋 Copy Alpha List",
    addEntryLabel: "➕ Add sign-up",
    modalAddTitle: "Add sign-up",
    modalEditTitle: "Edit sign-up",
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
    const raw = String(r?.teeTime || "").trim();
    if (!raw) return "—";
    return formatTime(raw) || "—";
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

/* -------------------------------------------------------------------------- */
/* Event registration model (structure, scoring, participant sizing)         */
/* New fields are optional; missing values infer legacy-safe defaults.       */
/* -------------------------------------------------------------------------- */

/** One registration contact, one named participant */
export const REGISTRATION_STRUCTURE_SINGLE = "single";
/** One registration contact, multiple participants are one team */
export const REGISTRATION_STRUCTURE_TEAM = "team";
/** One registration contact, multiple participants = separate individuals */
export const REGISTRATION_STRUCTURE_MULTI_INDIVIDUAL = "multi_individual";

export const SCORING_STRUCTURE_INDIVIDUAL = "individual";
export const SCORING_STRUCTURE_TEAM = "team";
export const SCORING_STRUCTURE_NONE = "none";

/**
 * Fixed vs flexible participant count per registration.
 * Stored as `participantCountMode` on the event document (not `entryMode`, which is legacy timing).
 */
export const PARTICIPANT_COUNT_MODE_FIXED = "fixed";
export const PARTICIPANT_COUNT_MODE_FLEX = "flex";

function clampInt(n, lo, hi) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

/**
 * @param {object} [t]
 * @returns {typeof REGISTRATION_STRUCTURE_SINGLE | typeof REGISTRATION_STRUCTURE_TEAM | typeof REGISTRATION_STRUCTURE_MULTI_INDIVIDUAL}
 */
export function resolveRegistrationStructure(t) {
  const raw = String(t?.registrationStructure || "").trim().toLowerCase();
  if (
    raw === REGISTRATION_STRUCTURE_SINGLE ||
    raw === REGISTRATION_STRUCTURE_TEAM ||
    raw === REGISTRATION_STRUCTURE_MULTI_INDIVIDUAL
  ) {
    return raw;
  }
  const page = resolveRegistrationPageEventTypeFromDocument(t || {});
  if (page !== REGISTRATION_PAGE_EVENT_TOURNAMENT) return REGISTRATION_STRUCTURE_SINGLE;
  return REGISTRATION_STRUCTURE_TEAM;
}

function formatImpliesTeamScoring(t) {
  const fmt = String(t?.formatOfPlay || t?.format || "").trim().toLowerCase();
  return fmt.includes("scramble") || fmt.includes("best ball") || fmt.includes("bestball");
}

/**
 * @param {object} [t]
 * @returns {typeof SCORING_STRUCTURE_INDIVIDUAL | typeof SCORING_STRUCTURE_TEAM | typeof SCORING_STRUCTURE_NONE}
 */
export function resolveScoringStructure(t) {
  const raw = String(t?.scoringType || t?.scoringStructure || "").trim().toLowerCase();
  if (
    raw === SCORING_STRUCTURE_INDIVIDUAL ||
    raw === SCORING_STRUCTURE_TEAM ||
    raw === SCORING_STRUCTURE_NONE
  ) {
    return raw;
  }
  const vis = getEventTypeVisibility(resolveRegistrationPageEventTypeFromDocument(t));
  if (!vis.showLeaderboardOptions) return SCORING_STRUCTURE_NONE;
  if (formatImpliesTeamScoring(t)) return SCORING_STRUCTURE_TEAM;
  return SCORING_STRUCTURE_INDIVIDUAL;
}

/**
 * @param {object} [t]
 * @returns {typeof PARTICIPANT_COUNT_MODE_FIXED | typeof PARTICIPANT_COUNT_MODE_FLEX}
 */
export function resolveParticipantCountMode(t) {
  const raw = String(t?.participantCountMode || t?.registrationParticipantEntryMode || "").trim().toLowerCase();
  if (raw === PARTICIPANT_COUNT_MODE_FIXED || raw === PARTICIPANT_COUNT_MODE_FLEX) return raw;
  return PARTICIPANT_COUNT_MODE_FLEX;
}

/**
 * Participant count rules per registration (distinct from legacy `entryMode` = pre_event / onsite).
 * @param {object} [t]
 */
export function resolveParticipantSizingRules(t) {
  const rs = resolveRegistrationStructure(t);
  const mode = resolveParticipantCountMode(t);

  if (rs === REGISTRATION_STRUCTURE_SINGLE) {
    return {
      participantCountMode: PARTICIPANT_COUNT_MODE_FIXED,
      minParticipantsPerRegistration: 1,
      maxParticipantsPerRegistration: 1,
      defaultParticipantsPerRegistration: 1,
    };
  }

  if (rs === REGISTRATION_STRUCTURE_TEAM) {
    let minP = clampInt(t?.minParticipantsPerRegistration, 1, 6);
    let maxP = clampInt(t?.maxParticipantsPerRegistration, 1, 6);
    let defP = clampInt(t?.defaultParticipantsPerRegistration, 1, 6);
    if (mode === PARTICIPANT_COUNT_MODE_FIXED) {
      const fs = clampInt(defP || maxP || minP || 4, 1, 6);
      minP = maxP = defP = fs;
    } else {
      if (maxP < minP) maxP = minP;
      defP = clampInt(defP || 4, minP, maxP);
    }
    return {
      participantCountMode: mode,
      minParticipantsPerRegistration: minP,
      maxParticipantsPerRegistration: maxP,
      defaultParticipantsPerRegistration: defP,
    };
  }

  let minP =
    t?.minParticipantsPerRegistration != null ? clampInt(t.minParticipantsPerRegistration, 1, 20) : 1;
  let maxP =
    t?.maxParticipantsPerRegistration != null ? clampInt(t.maxParticipantsPerRegistration, minP, 20) : 6;
  let defP =
    t?.defaultParticipantsPerRegistration != null
      ? clampInt(t.defaultParticipantsPerRegistration, minP, maxP)
      : Math.min(2, maxP);
  if (maxP < minP) maxP = minP;
  defP = clampInt(defP, minP, maxP);
  return {
    participantCountMode: mode,
    minParticipantsPerRegistration: minP,
    maxParticipantsPerRegistration: maxP,
    defaultParticipantsPerRegistration: defP,
  };
}

/**
 * Unified config for admin, registration, join, roster, and leaderboard.
 * @param {object} [t] tournament / event document
 */
export function getEventRegistrationModel(t) {
  const registrationStructure = resolveRegistrationStructure(t);
  return {
    registrationStructure,
    scoringStructure: resolveScoringStructure(t),
    ...resolveParticipantSizingRules(t),
  };
}

export function countNamedParticipantsInPlayerDetails(playerDetails) {
  if (!Array.isArray(playerDetails)) return 0;
  let n = 0;
  const seen = new Set();
  for (const p of playerDetails) {
    const name = String(p?.name || "").trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    n += 1;
  }
  return n;
}

/**
 * Client + server validation for named participants only (no blank placeholders).
 * @param {object} tournamentDoc
 * @param {Array<{name?: string}>} playerDetails
 */
export function validateRegistrationParticipantCounts(tournamentDoc, playerDetails) {
  const rules = resolveParticipantSizingRules(tournamentDoc || {});
  const n = countNamedParticipantsInPlayerDetails(playerDetails);
  if (n < 1) {
    return { ok: false, message: "Add at least one person with a name.", rules, count: n };
  }
  if (n < rules.minParticipantsPerRegistration) {
    return {
      ok: false,
      message: `This sign-up needs at least ${rules.minParticipantsPerRegistration} people listed by name.`,
      rules,
      count: n,
    };
  }
  if (n > rules.maxParticipantsPerRegistration) {
    return {
      ok: false,
      message: `This sign-up allows at most ${rules.maxParticipantsPerRegistration} people listed by name.`,
      rules,
      count: n,
    };
  }
  return { ok: true, rules, count: n };
}

/**
 * Registration page copy + flags merged with event document (golf / tournament flows).
 * @param {object} [tournamentDoc]
 */
export function getRegistrationPageUiConfigForTournament(tournamentDoc) {
  const pageType = resolveRegistrationPageEventTypeFromDocument(tournamentDoc || {});
  const base = getRegistrationPageUiConfig(pageType);
  const vis = getEventTypeVisibility(pageType);
  const model = getEventRegistrationModel(tournamentDoc);

  if (pageType !== REGISTRATION_PAGE_EVENT_TOURNAMENT || !vis.showPlayerFields) {
    return { ...base, eventRegModel: model };
  }

  const rs = model.registrationStructure;
  const out = {
    ...base,
    eventRegModel: model,
    regStructure: rs,
    showTeamNameField: rs === REGISTRATION_STRUCTURE_TEAM,
    contactSectionTitle: "Your information",
    captainNameLabel:
      rs === REGISTRATION_STRUCTURE_MULTI_INDIVIDUAL
        ? "Contact name"
        : rs === REGISTRATION_STRUCTURE_SINGLE
          ? "Player name"
          : "Captain name",
    captainEmailLabel: "Email",
    captainPhoneLabel: "Phone",
    participant1Visible: rs === REGISTRATION_STRUCTURE_MULTI_INDIVIDUAL,
    hidePlayers2Thru6: rs === REGISTRATION_STRUCTURE_SINGLE,
    flexParticipantCountUi:
      rs === REGISTRATION_STRUCTURE_MULTI_INDIVIDUAL && model.participantCountMode === PARTICIPANT_COUNT_MODE_FLEX,
    targetParticipantSlots: model.defaultParticipantsPerRegistration,
  };

  if (rs === REGISTRATION_STRUCTURE_SINGLE) {
    out.heading = "Sign up one player";
    out.submitLabel = "Complete registration";
    out.successMessage = "You’re signed up. The organizer has your details.";
    out.helperText =
      "One player per form. Enter the player’s name and how to reach you (the person filling this out).";
  } else if (rs === REGISTRATION_STRUCTURE_MULTI_INDIVIDUAL) {
    out.heading = "Sign up multiple players";
    out.submitLabel = "Complete registration";
    out.successMessage = "You’re signed up. The organizer has your details.";
    out.helperText =
      "Add the contact person first, then each player by name. Each name is its own player for this event—they are not scored as one team unless the organizer set that up separately.";
  }
  return out;
}

/**
 * Roster labels/columns adjusted for registration structure (esp. multi-individual golf).
 * @param {string} pageType
 * @param {object} [tournamentDoc]
 */
export function getRosterPageUiConfigForTournament(pageType, tournamentDoc) {
  const base = getRosterPageUiConfig(pageType);
  const t = tournamentDoc || {};
  const model = getEventRegistrationModel(t);
  if (!isGolfEventCategory(t)) return { ...base, eventRegModel: model };

  if (model.registrationStructure === REGISTRATION_STRUCTURE_MULTI_INDIVIDUAL) {
    return {
      ...base,
      eventRegModel: model,
      collectionLabel: "Who is signed up",
      teamColumnLabel: "Signed up by / contact",
      playersColumnLabel: "Players",
      captainContactLabel: "Contact",
      searchPlaceholder: "Search contact, player, email, phone, or assignment…",
    };
  }
  return { ...base, eventRegModel: model };
}
