/**
 * CSV / Excel import: parsing, column mapping, duplicate matching, payloads.
 * No Firebase dependencies.
 */

import {
  REGISTRANT_SOURCE_CSV_IMPORT,
  normalizeTeamKeyForImport,
  EVENT_CATEGORY_GOLF,
  normalizeEventCategory,
} from "./tournament-fields.js";

export { normalizeTeamKeyForImport };

/**
 * `tier`: "core" = default mapping rows; "advanced" = behind "Show advanced fields" in admin.
 */
export const IMPORT_FIELD_KEYS = [
  { id: "firstName", label: "First name (required)", tier: "core" },
  { id: "lastName", label: "Last name (required)", tier: "core" },
  { id: "email", label: "Email (optional)", tier: "core" },
  { id: "teamName", label: "Team name (optional)", tier: "core" },
  { id: "phone", label: "Phone", tier: "advanced" },
  { id: "gender", label: "Gender", tier: "advanced" },
  { id: "teamFlight", label: "Team flight", tier: "advanced" },
  { id: "handicap", label: "Handicap", tier: "advanced" },
  { id: "playerNames", label: "Player names (comma-separated)", tier: "advanced" },
  { id: "player2", label: "Player 2 name", tier: "advanced" },
  { id: "player3", label: "Player 3 name", tier: "advanced" },
  { id: "player4", label: "Player 4 name", tier: "advanced" },
  { id: "player5", label: "Player 5 name", tier: "advanced" },
  { id: "player6", label: "Player 6 name", tier: "advanced" },
  { id: "session", label: "Session", tier: "advanced" },
  { id: "timeSlot", label: "Time slot", tier: "advanced" },
  { id: "teeTime", label: "Tee time (golf)", tier: "advanced" },
  { id: "startingHole", label: "Starting hole / slot", tier: "advanced" },
  { id: "cart", label: "Cart # / cart group", tier: "advanced" },
  { id: "group", label: "Group / pairing", tier: "advanced" },
  { id: "pairing", label: "Pairing code", tier: "advanced" },
  { id: "instructor", label: "Instructor", tier: "advanced" },
  { id: "paidStatus", label: "Paid status", tier: "advanced" },
  { id: "notes", label: "Notes", tier: "advanced" },
];

export const DUPLICATE_MODE_ADD_ONLY = "add_only";
export const DUPLICATE_MODE_UPDATE = "update_matching";
export const DUPLICATE_MODE_SKIP = "skip_duplicates";

/** Roster advanced import: how rows become registrations */
export const ROSTER_IMPORT_GROUPING_INDIVIDUAL = "individual";
export const ROSTER_IMPORT_GROUPING_FIXED_SIZE = "fixed_size";
export const ROSTER_IMPORT_GROUPING_SPREADSHEET = "spreadsheet_columns";
export const ROSTER_IMPORT_GROUPING_MANUAL_LATER = "manual_later";

export const ROSTER_TEAM_NAMING_TEAM_N = "team_n";
export const ROSTER_TEAM_NAMING_CAPTAIN_LAST = "captain_last";
export const ROSTER_TEAM_NAMING_SPREADSHEET = "spreadsheet";

const IMPORT_FIELD_LABELS = Object.fromEntries(IMPORT_FIELD_KEYS.map((f) => [f.id, f.label]));

function pushUniqueIssue(bucket, text) {
  if (!text) return;
  if (!bucket.includes(text)) bucket.push(text);
}

function rowHasReadableData(row) {
  return Object.values(row || {}).some((v) => String(v || "").trim());
}

export function validateImportMappingSelections(mapping, eventCategory) {
  const m = mapping || {};
  const issues = [];
  const fieldsByColumn = new Map();
  Object.entries(m).forEach(([fieldId, columnName]) => {
    if (!columnName) return;
    const key = String(columnName).trim().toLowerCase();
    if (!key) return;
    if (!fieldsByColumn.has(key)) fieldsByColumn.set(key, { columnName: String(columnName), fieldIds: [] });
    fieldsByColumn.get(key).fieldIds.push(fieldId);
  });

  fieldsByColumn.forEach(({ fieldIds }) => {
    const uniq = Array.from(new Set(fieldIds));
    if (uniq.length < 2) return;
    const issueCountBefore = issues.length;
    const hasTeam = uniq.includes("teamName");
    const hasEmail = uniq.includes("email");
    const hasFirst = uniq.includes("firstName");
    const hasLast = uniq.includes("lastName");
    const hasStructuredName = uniq.includes("firstName") || uniq.includes("lastName");

    if (hasStructuredName && hasTeam) {
      pushUniqueIssue(issues, "Name and team can’t use the same column.");
    }
    if (hasTeam && hasEmail) {
      pushUniqueIssue(issues, "Team name and email can’t use the same column.");
    }
    if (hasFirst && hasLast) {
      pushUniqueIssue(issues, "First name and last name can’t use the same column.");
    }

    if (issues.length === issueCountBefore) {
      const labels = uniq.map((id) => IMPORT_FIELD_LABELS[id] || id).join(", ");
      pushUniqueIssue(issues, `These fields use the same column: ${labels}`);
    }
  });

  const cat = normalizeEventCategory({ eventCategory });
  const isGolf = cat === EVENT_CATEGORY_GOLF;
  const hasStructuredName = !!(m.firstName && m.lastName);
  if (isGolf && !hasStructuredName) {
    pushUniqueIssue(issues, "First and Last Name are required");
  }
  if (!isGolf && !m.email && !hasStructuredName) {
    pushUniqueIssue(issues, "Add an email or map first and last name columns.");
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function pickImportCell(row, columnKey) {
  if (!columnKey) return "";
  return String(row?.[columnKey] || "").trim();
}

export function playerNameFromParts(first, last) {
  return `${String(first || "").trim()} ${String(last || "").trim()}`.trim();
}

export function normalizeEmailKey(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

export function normalizePhoneKey(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length >= 10) return d.slice(-10);
  return d;
}

export function normalizeNameSessionKey(displayName, session, timeSlot) {
  const n = String(displayName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const s = String(session || "")
    .trim()
    .toLowerCase();
  const t = String(timeSlot || "")
    .trim()
    .toLowerCase();
  return `${n}|${s}|${t}`;
}

function parsePlayerListFromRow(row, m) {
  const out = [];
  const comma = pickImportCell(row, m.playerNames);
  if (comma) {
    comma
      .split(/[,;]+/)
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .forEach((n) => out.push(n));
  }
  ["player2", "player3", "player4", "player5", "player6"].forEach((key) => {
    const v = pickImportCell(row, m[key]);
    if (v) out.push(v);
  });
  const seen = new Set();
  const uniq = [];
  out.forEach((n) => {
    const k = n.toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    uniq.push(n);
  });
  return uniq.slice(0, 6);
}

function mergePlayerDetailsFromRowRecs(rowRecs) {
  const out = [];
  const seen = new Set();
  (rowRecs || []).forEach((rec) => {
    (rec.playerDetails || []).forEach((pd) => {
      const name = String(pd.name || "").trim();
      const k = name.toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      const h = pd.handicap;
      const handicapVal =
        h != null && h !== "" && Number.isFinite(Number(h)) ? Math.max(0, Math.min(54, Math.round(Number(h)))) : null;
      out.push({
        name,
        isCaptain: out.length === 0,
        ...(handicapVal != null ? { handicap: handicapVal } : {}),
      });
    });
  });
  return out.map((pd, idx) => ({ ...pd, isCaptain: idx === 0 }));
}

function pickFirstNonEmptyStringFromRecs(rowRecs, key) {
  for (const rec of rowRecs || []) {
    const v = String(rec?.[key] || "").trim();
    if (v) return v;
  }
  return "";
}

function pickFirstStartingHoleFromRecs(rowRecs) {
  for (const rec of rowRecs || []) {
    const n = Number(rec?.startingHole);
    if (Number.isFinite(n) && n >= 1 && n <= 18) return Math.round(n);
  }
  return null;
}

function mergeNotesFromRecs(rowRecs) {
  const parts = [];
  const seen = new Set();
  (rowRecs || []).forEach((rec) => {
    String(rec?.notes || "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((line) => {
        const k = line.toLowerCase();
        if (seen.has(k)) return;
        seen.add(k);
        parts.push(line);
      });
  });
  return parts.join("\n").trim();
}

/**
 * @param {object} team
 * @param {string} team.teamKey
 * @param {string} [team.displayTeamName]
 * @param {object[]} team.rowRecs
 * @param {number[]} team.sourceRows
 * @param {string[]} team.importIssues
 * @param {string} [team._incompleteHint]
 */
function finalizeGolfRegistrationFromAggregate(team) {
  const rowRecs = team.rowRecs || [];
  const playerDetails = mergePlayerDetailsFromRowRecs(rowRecs);
  if (!playerDetails.length) return null;
  const uniquePlayers = playerDetails.map((p) => p.name);
  const captainName = uniquePlayers[0] || "";
  const captainEmail = team.captainEmail || pickFirstNonEmptyStringFromRecs(rowRecs, "captainEmail");
  const captainPhone = team.captainPhone || pickFirstNonEmptyStringFromRecs(rowRecs, "captainPhone");
  const teeTime = pickFirstNonEmptyStringFromRecs(rowRecs, "teeTime");
  const assignedHole = pickFirstNonEmptyStringFromRecs(rowRecs, "assignedHole");
  const startingHole = pickFirstStartingHoleFromRecs(rowRecs);
  const matchEmail = normalizeEmailKey(captainEmail);
  const matchPhone = normalizePhoneKey(captainPhone);
  const matchNameSession = normalizeNameSessionKey(captainName, team.session || "", team.timeSlot || "");
  const importIssues = (team.importIssues || []).slice();
  if (team._incompleteHint) pushUniqueIssue(importIssues, team._incompleteHint);

  const out = {
    eventCategory: EVENT_CATEGORY_GOLF,
    teamKey: team.teamKey,
    teamName: String(team.displayTeamName || team.teamKey || "").trim() || team.teamKey,
    captainName,
    captainEmail: captainEmail || "",
    captainPhone: captainPhone || "",
    players: uniquePlayers,
    playerDetails,
    session: team.session || "",
    timeSlot: team.timeSlot || "",
    teeTime,
    assignedHole,
    groupLabel: team.groupLabel || "",
    instructor: pickFirstNonEmptyStringFromRecs(rowRecs, "instructor") || "",
    paidStatus: pickFirstNonEmptyStringFromRecs(rowRecs, "paidStatus") || "",
    notes: mergeNotesFromRecs(rowRecs),
    matchEmail,
    matchPhone,
    matchNameSession,
    _sourceRows: (team.sourceRows || []).slice(),
    _importIssues: importIssues,
  };
  if (startingHole != null) out.startingHole = startingHole;
  return out;
}

function clampImportInt(n, lo, hi) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function pickSpreadsheetGroupingCell(row, m, spreadsheetGroupBy) {
  const by = String(spreadsheetGroupBy || "teamName").trim();
  if (by === "group") return pickImportCell(row, m.group) || pickImportCell(row, m.pairing);
  if (by === "pairing") return pickImportCell(row, m.pairing) || pickImportCell(row, m.group);
  if (by === "cart") return pickImportCell(row, m.cart);
  if (by === "teeTime") return pickImportCell(row, m.teeTime) || pickImportCell(row, m.timeSlot);
  if (by === "timeSlot") return pickImportCell(row, m.timeSlot);
  return pickImportCell(row, m.teamName);
}

function displayNameFromRow(row, m) {
  return playerNameFromParts(pickImportCell(row, m.firstName), pickImportCell(row, m.lastName)).trim();
}

function formatRosterSyntheticTeamName(teamNamingStyle, chunkIndex, firstRow, m) {
  const style = String(teamNamingStyle || ROSTER_TEAM_NAMING_TEAM_N).trim();
  if (style === ROSTER_TEAM_NAMING_CAPTAIN_LAST) {
    const ln = String(pickImportCell(firstRow, m.lastName) || "").trim();
    const fn = String(pickImportCell(firstRow, m.firstName) || "").trim();
    if (ln) return fn ? `${ln} · ${fn}` : ln;
  }
  if (style === ROSTER_TEAM_NAMING_SPREADSHEET) {
    const tn = String(pickImportCell(firstRow, m.teamName) || "").trim();
    if (tn) return tn;
  }
  return `Team ${chunkIndex + 1}`;
}

/**
 * Preview rows for operator confirmation (subset of mapped columns + resolved fields).
 * @param {Record<string, string>[]} mappedRows
 * @param {Record<string, string>} mapping
 * @param {number} [limit]
 */
export function buildImportPreviewRows(mappedRows, mapping, limit = 200) {
  const m = mapping || {};
  const keys = [
    "firstName",
    "lastName",
    "email",
    "phone",
    "handicap",
    "teamName",
    "group",
    "pairing",
    "teeTime",
    "timeSlot",
    "startingHole",
    "cart",
    "notes",
  ];
  const slice = (mappedRows || []).filter(rowHasReadableData).slice(0, limit);
  return slice.map((row, idx) => {
    const o = { _row: idx + 2 };
    keys.forEach((k) => {
      if (m[k]) o[k] = pickImportCell(row, m[k]);
    });
    o._displayName = displayNameFromRow(row, m);
    return o;
  });
}

/**
 * Advanced roster import: grouping modes beyond legacy "group by team column".
 * @param {Record<string, string>[]} mappedRows
 * @param {Record<string, string>} mapping
 * @param {string} eventCategory
 * @param {object} [opts]
 */
export function buildRosterAdvancedImportRecords(mappedRows, mapping, eventCategory, opts = {}) {
  const cat = normalizeEventCategory({ eventCategory }) || EVENT_CATEGORY_GOLF;
  const groupingMode = String(opts.groupingMode || ROSTER_IMPORT_GROUPING_SPREADSHEET).trim();
  const fixedGroupSize = clampImportInt(opts.fixedGroupSize, 1, 12);
  const spreadsheetGroupBy = String(opts.spreadsheetGroupBy || "teamName").trim();
  const teamNamingStyle = String(opts.teamNamingStyle || ROSTER_TEAM_NAMING_SPREADSHEET).trim();
  const markIncomplete = opts.markIncompleteGroups !== false;

  if (cat !== EVENT_CATEGORY_GOLF) {
    if (groupingMode === ROSTER_IMPORT_GROUPING_FIXED_SIZE) {
      return buildNonGolfFixedSizeRecords(mappedRows, mapping, cat, fixedGroupSize, teamNamingStyle, markIncomplete);
    }
    return buildImportRecordsFromMappedRows(mappedRows, mapping, cat);
  }

  if (groupingMode === ROSTER_IMPORT_GROUPING_FIXED_SIZE) {
    return buildGolfFixedSizeRecords(mappedRows, mapping, fixedGroupSize, teamNamingStyle, markIncomplete);
  }
  if (groupingMode === ROSTER_IMPORT_GROUPING_INDIVIDUAL || groupingMode === ROSTER_IMPORT_GROUPING_MANUAL_LATER) {
    return buildGolfIndividualRecords(mappedRows, mapping, teamNamingStyle);
  }
  return buildGolfSpreadsheetColumnRecords(mappedRows, mapping, spreadsheetGroupBy);
}

function buildGolfSpreadsheetColumnRecords(mappedRows, mapping, spreadsheetGroupBy) {
  let ignoredBlankRows = 0;
  const groupedMap = new Map();
  (mappedRows || []).forEach((r, rowIdx) => {
    if (!rowHasReadableData(r)) {
      ignoredBlankRows += 1;
      return;
    }
    const rec = rowToImportRecord(r, mapping, EVENT_CATEGORY_GOLF, rowIdx + 2);
    const cell = pickSpreadsheetGroupingCell(r, mapping, spreadsheetGroupBy);
    const fallback = String(rec.teamName || displayNameFromRow(r, mapping) || `Imported Team ${rowIdx + 2}`).trim();
    const teamKey = String(cell || fallback).trim() || fallback;
    if (!groupedMap.has(teamKey)) {
      groupedMap.set(teamKey, {
        teamKey,
        displayTeamName: teamKey,
        captainEmail: "",
        captainPhone: "",
        session: "",
        timeSlot: "",
        groupLabel: "",
        sourceRows: [],
        importIssues: [],
        rowRecs: [],
      });
    }
    const group = groupedMap.get(teamKey);
    if (!group.captainEmail && rec.captainEmail) group.captainEmail = rec.captainEmail;
    if (!group.captainPhone && rec.captainPhone) group.captainPhone = rec.captainPhone;
    if (rec.session) group.session = rec.session;
    if (rec.timeSlot) group.timeSlot = rec.timeSlot;
    if (rec.groupLabel) group.groupLabel = rec.groupLabel;
    group.rowRecs.push(rec);
    (rec._sourceRows || []).forEach((n) => group.sourceRows.push(n));
    (rec._importIssues || []).forEach((issue) => {
      if (issue && !group.importIssues.includes(issue)) group.importIssues.push(issue);
    });
  });

  const regs = [];
  for (const team of groupedMap.values()) {
    const fin = finalizeGolfRegistrationFromAggregate(team);
    if (fin) regs.push(fin);
  }
  return { regs, skippedRows: 0, ignoredBlankRows };
}

function buildGolfIndividualRecords(mappedRows, mapping, teamNamingStyle) {
  let ignoredBlankRows = 0;
  const regs = [];
  (mappedRows || []).forEach((r, rowIdx) => {
    if (!rowHasReadableData(r)) {
      ignoredBlankRows += 1;
      return;
    }
    const rec = rowToImportRecord(r, mapping, EVENT_CATEGORY_GOLF, rowIdx + 2);
    const disp = displayNameFromRow(r, mapping) || rec.captainName || rec.teamName;
    let teamName = disp;
    if (teamNamingStyle === ROSTER_TEAM_NAMING_CAPTAIN_LAST) {
      teamName = captainLastNameTeamLabel(r, mapping) || disp;
    } else if (teamNamingStyle === ROSTER_TEAM_NAMING_TEAM_N) {
      teamName = `Player ${regs.length + 1}`;
    } else if (teamNamingStyle === ROSTER_TEAM_NAMING_SPREADSHEET) {
      const tn = String(pickImportCell(r, mapping.teamName) || "").trim();
      teamName = tn || disp;
    }
    teamName = `${String(teamName).trim()} · row ${rowIdx + 2}`;
    rec.teamName = teamName;
    rec.teamKey = teamName;
    rec.matchNameSession = `${rec.matchNameSession}|row:${rowIdx + 2}`;
    regs.push(rec);
  });
  return { regs, skippedRows: 0, ignoredBlankRows };
}

function captainLastNameTeamLabel(row, m) {
  const ln = String(pickImportCell(row, m.lastName) || "").trim();
  const fn = String(pickImportCell(row, m.firstName) || "").trim();
  if (ln) return fn ? `${ln} · ${fn}` : ln;
  return displayNameFromRow(row, m);
}

function buildGolfFixedSizeRecords(mappedRows, mapping, fixedGroupSize, teamNamingStyle, markIncomplete) {
  const rows = (mappedRows || []).filter((r) => rowHasReadableData(r));
  let ignoredBlankRows = (mappedRows || []).length - rows.length;
  const regs = [];
  for (let i = 0; i < rows.length; i += fixedGroupSize) {
    const chunk = rows.slice(i, i + fixedGroupSize);
    const sourceRows = [];
    const rowRecs = [];
    const importIssues = [];
    chunk.forEach((r, j) => {
      const rec = rowToImportRecord(r, mapping, EVENT_CATEGORY_GOLF, i + j + 2);
      rowRecs.push(rec);
      (rec._sourceRows || []).forEach((n) => sourceRows.push(n));
      (rec._importIssues || []).forEach((issue) => {
        if (issue && !importIssues.includes(issue)) importIssues.push(issue);
      });
    });
    const chunkIndex = Math.floor(i / fixedGroupSize);
    const displayTeamName = formatRosterSyntheticTeamName(teamNamingStyle, chunkIndex, chunk[0], mapping);
    const teamKey = displayTeamName;
    let captainEmail = "";
    let captainPhone = "";
    rowRecs.forEach((rec) => {
      if (!captainEmail && rec.captainEmail) captainEmail = rec.captainEmail;
      if (!captainPhone && rec.captainPhone) captainPhone = rec.captainPhone;
    });
    let incompleteHint = "";
    if (markIncomplete && chunk.length < fixedGroupSize) {
      incompleteHint = `Incomplete group: ${chunk.length} of ${fixedGroupSize} players in this chunk`;
    }
    const fin = finalizeGolfRegistrationFromAggregate({
      teamKey,
      displayTeamName,
      captainEmail,
      captainPhone,
      session: pickFirstNonEmptyStringFromRecs(rowRecs, "session"),
      timeSlot: pickFirstNonEmptyStringFromRecs(rowRecs, "timeSlot"),
      groupLabel: pickFirstNonEmptyStringFromRecs(rowRecs, "groupLabel"),
      sourceRows,
      importIssues,
      rowRecs,
      _incompleteHint: incompleteHint,
    });
    if (fin) regs.push(fin);
  }
  return { regs, skippedRows: 0, ignoredBlankRows };
}

function buildNonGolfFixedSizeRecords(mappedRows, mapping, cat, fixedGroupSize, teamNamingStyle, markIncomplete) {
  const rows = (mappedRows || []).filter((r) => rowHasReadableData(r));
  let ignoredBlankRows = (mappedRows || []).length - rows.length;
  const regs = [];
  for (let i = 0; i < rows.length; i += fixedGroupSize) {
    const chunk = rows.slice(i, i + fixedGroupSize);
    const rowRecs = chunk.map((r, j) => rowToImportRecord(r, mapping, cat, i + j + 2));
    const chunkIndex = Math.floor(i / fixedGroupSize);
    const teamName = formatRosterSyntheticTeamName(teamNamingStyle, chunkIndex, chunk[0], mapping);
    const players = [];
    const seen = new Set();
    rowRecs.forEach((rec) => {
      (rec.players || []).forEach((p) => {
        const k = String(p || "")
          .trim()
          .toLowerCase();
        if (!k || seen.has(k)) return;
        seen.add(k);
        players.push(String(p).trim());
      });
    });
    if (!players.length) continue;
    const captainName = players[0];
    const playerDetails = players.map((name, idx) => ({ name, isCaptain: idx === 0 }));
    const captainEmail = pickFirstNonEmptyStringFromRecs(rowRecs, "captainEmail");
    const captainPhone = pickFirstNonEmptyStringFromRecs(rowRecs, "captainPhone");
    const session = pickFirstNonEmptyStringFromRecs(rowRecs, "session");
    const timeSlot = pickFirstNonEmptyStringFromRecs(rowRecs, "timeSlot");
    const groupLabel = pickFirstNonEmptyStringFromRecs(rowRecs, "groupLabel");
    const importIssues = [];
    rowRecs.forEach((rec) =>
      (rec._importIssues || []).forEach((issue) => {
        if (issue && !importIssues.includes(issue)) importIssues.push(issue);
      })
    );
    if (markIncomplete && chunk.length < fixedGroupSize) {
      pushUniqueIssue(importIssues, `Incomplete group: ${chunk.length} of ${fixedGroupSize} rows in this chunk`);
    }
    const sourceRows = [];
    rowRecs.forEach((rec) => (rec._sourceRows || []).forEach((n) => sourceRows.push(n)));
    regs.push({
      eventCategory: cat,
      teamName,
      captainName,
      captainEmail,
      captainPhone,
      players,
      playerDetails,
      session,
      timeSlot,
      groupLabel,
      instructor: pickFirstNonEmptyStringFromRecs(rowRecs, "instructor") || "",
      paidStatus: pickFirstNonEmptyStringFromRecs(rowRecs, "paidStatus") || "",
      notes: mergeNotesFromRecs(rowRecs),
      matchEmail: normalizeEmailKey(captainEmail),
      matchPhone: normalizePhoneKey(captainPhone),
      matchNameSession: normalizeNameSessionKey(captainName, session, timeSlot),
      _sourceRows: sourceRows,
      _importIssues: importIssues,
    });
  }
  return { regs, skippedRows: 0, ignoredBlankRows };
}

/**
 * One logical import record (one roster row target).
 */
export function rowToImportRecord(row, m, eventCategory, sourceRowNumber = null) {
  const importIssues = [];
  const email = pickImportCell(row, m.email);
  const phone = pickImportCell(row, m.phone);
  const session = pickImportCell(row, m.session);
  const timeSlot = pickImportCell(row, m.timeSlot);
  const teeTimeCell = pickImportCell(row, m.teeTime);
  const teeTime =
    teeTimeCell ||
    (normalizeEventCategory({ eventCategory }) === EVENT_CATEGORY_GOLF ? pickImportCell(row, m.timeSlot) : "");
  const groupLabel =
    pickImportCell(row, m.teamFlight) ||
    pickImportCell(row, m.group) ||
    pickImportCell(row, m.pairing);
  const instructor = pickImportCell(row, m.instructor);
  const paidStatus = pickImportCell(row, m.paidStatus);
  const gender = pickImportCell(row, m.gender);
  const cart = pickImportCell(row, m.cart);
  let notes = pickImportCell(row, m.notes);
  if (gender) {
    notes = [notes, `Gender: ${gender}`].filter(Boolean).join("\n").trim();
  }
  if (cart) {
    notes = [notes, `Cart: ${cart}`].filter(Boolean).join("\n").trim();
  }

  const startRaw = pickImportCell(row, m.startingHole);
  let startingHole = null;
  let assignedHole = "";
  if (startRaw) {
    const n = Number(String(startRaw).replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && n >= 1 && n <= 18) {
      startingHole = Math.round(n);
    } else {
      assignedHole = String(startRaw).trim();
    }
  }
  let teamNameRaw = pickImportCell(row, m.teamName);
  const fnRaw = pickImportCell(row, m.firstName);
  const lnRaw = pickImportCell(row, m.lastName);
  let displayName = playerNameFromParts(fnRaw, lnRaw);
  if (!String(fnRaw).trim() || !String(lnRaw).trim()) {
    pushUniqueIssue(importIssues, "First and Last Name are required");
  }
  if (!teamNameRaw) {
    teamNameRaw = displayName || `Imported Team ${sourceRowNumber || 1}`;
    importIssues.push("Team name was missing, so we generated one");
  }
  const hcRaw = pickImportCell(row, m.handicap);
  const handicapNum = hcRaw ? Number(hcRaw) : NaN;
  const handicapVal = Number.isFinite(handicapNum) ? Math.max(0, Math.min(54, Math.round(handicapNum))) : null;

  const playersFromCols = parsePlayerListFromRow(row, m);
  let players = playersFromCols.length ? playersFromCols : displayName ? [displayName] : [];
  if (!players.length && teamNameRaw) players = [teamNameRaw];

  const captainName = players[0] || displayName || teamNameRaw || "";
  const teamName = teamNameRaw || captainName || displayName || "Team";

  const playerDetails = players.slice(0, 6).map((name, idx) => {
    const pd = { name, isCaptain: idx === 0 };
    if (handicapVal != null && idx === 0) pd.handicap = handicapVal;
    return pd;
  });

  const matchEmail = normalizeEmailKey(email);
  const matchPhone = normalizePhoneKey(phone);
  const matchNameSession = normalizeNameSessionKey(captainName || displayName, session, timeSlot);

  return {
    eventCategory,
    teamName,
    captainName,
    captainEmail: email,
    captainPhone: phone,
    players,
    playerDetails,
    session,
    timeSlot,
    teeTime,
    startingHole,
    assignedHole,
    groupLabel,
    instructor,
    paidStatus,
    notes,
    matchEmail,
    matchPhone,
    matchNameSession,
    _rowDebug: null,
    _sourceRows: Number.isFinite(sourceRowNumber) ? [sourceRowNumber] : [],
    _importIssues: importIssues,
  };
}

/**
 * Golf: group rows by team name; clinic: one record per data row.
 */
export function buildImportRecordsFromMappedRows(mappedRows, mapping, eventCategory) {
  const cat = eventCategory || EVENT_CATEGORY_GOLF;
  let skippedRows = 0;
  let ignoredBlankRows = 0;

  if (cat !== EVENT_CATEGORY_GOLF) {
    const regs = [];
    mappedRows.forEach((row, rowIdx) => {
      if (!rowHasReadableData(row)) {
        ignoredBlankRows += 1;
        return;
      }
      const rec = rowToImportRecord(row, mapping, cat, rowIdx + 2);
      regs.push(rec);
    });
    return { regs, skippedRows, ignoredBlankRows };
  }

  const groupedMap = new Map();
  mappedRows.forEach((r, rowIdx) => {
    if (!rowHasReadableData(r)) {
      ignoredBlankRows += 1;
      return;
    }
    const rec = rowToImportRecord(r, mapping, EVENT_CATEGORY_GOLF, rowIdx + 2);
    const teamKey = String(rec.teamName || `Imported Team ${rowIdx + 2}`).trim();
    if (!groupedMap.has(teamKey)) {
      groupedMap.set(teamKey, {
        teamKey,
        displayTeamName: teamKey,
        captainEmail: "",
        captainPhone: "",
        session: "",
        timeSlot: "",
        groupLabel: "",
        sourceRows: [],
        importIssues: [],
        rowRecs: [],
      });
    }
    const group = groupedMap.get(teamKey);
    if (!group.captainEmail && rec.captainEmail) group.captainEmail = rec.captainEmail;
    if (!group.captainPhone && rec.captainPhone) group.captainPhone = rec.captainPhone;
    if (rec.session) group.session = rec.session;
    if (rec.timeSlot) group.timeSlot = rec.timeSlot;
    if (rec.groupLabel) group.groupLabel = rec.groupLabel;
    group.rowRecs.push(rec);
    (rec._sourceRows || []).forEach((n) => group.sourceRows.push(n));
    (rec._importIssues || []).forEach((issue) => {
      if (issue && !group.importIssues.includes(issue)) group.importIssues.push(issue);
    });
  });

  const regs = [];
  for (const team of groupedMap.values()) {
    const fin = finalizeGolfRegistrationFromAggregate(team);
    if (fin) regs.push(fin);
  }

  return { regs, skippedRows, ignoredBlankRows };
}

/** @param {{ forEach: (fn: (d: { id: string, data: () => object }) => void) => void }} existingSnap */
function matchEntryFromDoc(id, data) {
  const email = normalizeEmailKey(data.captainEmail || data.email || "");
  const phone = normalizePhoneKey(data.captainPhone || data.phone || "");
  const captainName = String(data.captainName || "").trim();
  const session = String(data.session || "").trim();
  const timeSlot = String(data.timeSlot || "").trim();
  const nameSession = normalizeNameSessionKey(captainName, session, timeSlot);
  return {
    id,
    data,
    matchEmail: email,
    matchPhone: phone,
    matchNameSession: nameSession,
  };
}

export function indexRegistrationsForMatching(existingSnap) {
  const list = [];
  existingSnap.forEach((docSnap) => {
    list.push(matchEntryFromDoc(docSnap.id, docSnap.data() || {}));
  });
  return list;
}

/** After creating a registration during import, keep in-memory index in sync for same-batch dedupe. */
export function pushImportMatchIndexEntry(indexed, id, data) {
  indexed.push(matchEntryFromDoc(id, data));
}

/**
 * Priority: email → phone → name+session
 * @returns {{ id: string, data: object } | null}
 */
export function findMatchingRegistration(rec, indexed) {
  if (rec.matchEmail) {
    const hit = indexed.find((x) => x.matchEmail && x.matchEmail === rec.matchEmail);
    if (hit) return { id: hit.id, data: hit.data };
  }
  if (rec.matchPhone) {
    const hit = indexed.find((x) => x.matchPhone && x.matchPhone === rec.matchPhone);
    if (hit) return { id: hit.id, data: hit.data };
  }
  if (rec.matchNameSession && rec.matchNameSession !== "||") {
    const hit = indexed.find((x) => x.matchNameSession === rec.matchNameSession);
    if (hit) return { id: hit.id, data: hit.data };
  }
  return null;
}

/** Captain / primary contact keys for import duplicate checks (not full multi-player fan-out). */
export function extractImportCaptainIdentityKeys(rec) {
  return {
    email: normalizeEmailKey(rec?.captainEmail ?? rec?.email ?? ""),
    phone: normalizePhoneKey(rec?.captainPhone ?? rec?.phone ?? ""),
    name: String(rec?.captainName || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " "),
  };
}

/**
 * Detect duplicate risks before writing: existing roster matches + duplicate contacts within the import batch.
 * @param {object[]} stagedRegs
 * @param {ReturnType<typeof indexRegistrationsForMatching>} indexedExisting
 * @param {{ updateExisting?: boolean }} opts
 * @returns {{ warnings: string[], skipIndices: Set<number> }}
 */
export function analyzeImportDuplicateRisks(stagedRegs, indexedExisting, opts = {}) {
  const updateExisting = !!opts.updateExisting;
  const warnings = [];
  const skipIndices = new Set();
  const seenEmail = new Map();
  const seenPhone = new Map();
  const seenName = new Map();

  (stagedRegs || []).forEach((rec, idx) => {
    const keys = extractImportCaptainIdentityKeys(rec);
    const teamLabel = String(rec.teamName || rec.teamKey || `Group ${idx + 1}`).trim();

    if (indexedExisting && indexedExisting.length) {
      const existingMatch = findMatchingRegistration(rec, indexedExisting);
      if (existingMatch && existingMatch.id) {
        warnings.push(
          `“${teamLabel}” matches an existing sign-up (${existingMatch.id}). ${
            updateExisting ? "Will update that registration when you import." : "Will be skipped."
          }`
        );
        if (!updateExisting) skipIndices.add(idx);
      }
    }

    if (keys.email) {
      if (seenEmail.has(keys.email)) {
        const first = seenEmail.get(keys.email) + 1;
        warnings.push(
          `“${teamLabel}” (import #${idx + 1}): duplicate captain email in file (${keys.email}) — same as import #${first}. Skipped.`
        );
        skipIndices.add(idx);
      } else {
        seenEmail.set(keys.email, idx);
      }
    } else if (keys.phone) {
      if (seenPhone.has(keys.phone)) {
        warnings.push(
          `“${teamLabel}” (import #${idx + 1}): duplicate captain phone in file — same as another row. Skipped.`
        );
        skipIndices.add(idx);
      } else {
        seenPhone.set(keys.phone, idx);
      }
    } else if (keys.name.length > 2) {
      if (seenName.has(keys.name)) {
        warnings.push(
          `“${teamLabel}” (import #${idx + 1}): duplicate captain name with no email/phone — skipped as possible duplicate.`
        );
        skipIndices.add(idx);
      } else {
        seenName.set(keys.name, idx);
      }
    }
  });

  return { warnings, skipIndices };
}

/** Counts staged groups flagged incomplete (fixed-size last chunk, etc.). */
export function countIncompleteImportGroups(stagedRegs) {
  let n = 0;
  (stagedRegs || []).forEach((r) => {
    if ((r._importIssues || []).some((x) => String(x || "").includes("Incomplete group"))) n += 1;
  });
  return n;
}

export function buildImportRegisterTeamPayload({
  tournamentId,
  organizationId,
  reg,
  handicapOn,
  handicapPercent,
  registrantSource = REGISTRANT_SOURCE_CSV_IMPORT,
}) {
  const teamName = String(reg.teamName || reg.teamKey || "").trim();
  const payload = {
    tournamentId,
    organizationId,
    teamName,
    captainName: reg.captainName,
    captainEmail: reg.captainEmail,
    captainPhone: reg.captainPhone,
    playerDetails: reg.playerDetails,
    notes: String(reg.notes || ""),
    handicapEnabled: handicapOn,
    handicapPercent: handicapOn ? Number(handicapPercent || 100) : 0,
    registrantSource,
  };
  if (String(reg.importStatus || "").trim()) payload.importStatus = String(reg.importStatus).trim();
  if (Array.isArray(reg.importIssues) && reg.importIssues.length) payload.importIssues = reg.importIssues.slice(0, 20);
  return payload;
}

/**
 * Non-golf create payload (client writes Firestore directly).
 */
export function buildNonGolfRegistrationWritePayload(rec, tournamentTemplate, handicapOn, handicapPercent) {
  const t = tournamentTemplate || {};
  const eventCategory = normalizeEventCategory({
    eventCategory: rec?.eventCategory || t?.eventCategory,
    eventType: t?.eventType,
  });
  const isGolfEvent = eventCategory === EVENT_CATEGORY_GOLF;
  const resolvedCourseId = (() => {
    const id = String(t.courseId || t.defaultCourse || "").trim();
    const l = id.toLowerCase();
    if (l === "tradition" || l === "cypress") return l;
    return id;
  })();
  const payload = {
    tournamentId: String(t.tournamentId || "").trim(),
    tournamentName: String(t.tournamentName || t.name || "").trim(),
    defaultCourse: String(t.defaultCourse || "").trim(),
    courseId: resolvedCourseId,
    formatOfPlay: String(t.formatOfPlay || "").trim(),
    format: String(t.formatOfPlay || "").trim().toLowerCase(),
    teamName: rec.teamName,
    captainName: rec.captainName,
    captainEmail: rec.captainEmail,
    captainPhone: rec.captainPhone,
    players: rec.players,
    playerDetails: rec.playerDetails,
    handicapEnabled: !!handicapOn,
    handicapPercent: handicapOn ? Number(handicapPercent || 100) : 0,
    notes: String(rec.notes || ""),
    session: rec.session || "",
    timeSlot: rec.timeSlot || "",
    groupLabel: rec.groupLabel || "",
    instructor: rec.instructor || "",
    paidStatus: rec.paidStatus || "",
    status: "registered",
    registrantSource: REGISTRANT_SOURCE_CSV_IMPORT,
    source: "csv_import",
  };
  if (!isGolfEvent) {
    payload.assignedHole = "";
    payload.teeTime = "";
  } else {
    if (rec?.assignedHole != null) payload.assignedHole = String(rec.assignedHole || "").trim();
    if (rec?.teeTime != null) payload.teeTime = String(rec.teeTime || "").trim();
    if (rec?.startingHole != null && rec.startingHole !== "") {
      const n = Number(rec.startingHole);
      if (Number.isFinite(n)) payload.startingHole = Math.max(1, Math.min(18, Math.round(n)));
    }
    if (String(rec?.status || "").trim()) payload.status = String(rec.status).trim();
  }
  if (String(rec.importStatus || "").trim()) payload.importStatus = String(rec.importStatus).trim();
  if (Array.isArray(rec.importIssues) && rec.importIssues.length) payload.importIssues = rec.importIssues.slice(0, 20);
  return payload;
}

export function mergeRegistrationUpdatePayload(rec, existingData, handicapOn, handicapPercent) {
  const next = { ...(existingData || {}) };
  next.teamName = rec.teamName || next.teamName;
  next.captainName = rec.captainName || next.captainName;
  next.captainEmail = rec.captainEmail || next.captainEmail;
  next.captainPhone = rec.captainPhone || next.captainPhone;
  next.players = rec.players || next.players;
  next.playerDetails = rec.playerDetails || next.playerDetails;
  if (rec.notes) next.notes = [String(next.notes || "").trim(), rec.notes].filter(Boolean).join("\n");
  next.session = rec.session !== undefined ? rec.session : next.session;
  next.timeSlot = rec.timeSlot !== undefined ? rec.timeSlot : next.timeSlot;
  next.groupLabel = rec.groupLabel !== undefined ? rec.groupLabel : next.groupLabel;
  next.instructor = rec.instructor !== undefined ? rec.instructor : next.instructor;
  next.paidStatus = rec.paidStatus !== undefined ? rec.paidStatus : next.paidStatus;
  next.handicapEnabled = !!handicapOn;
  next.handicapPercent = handicapOn ? Number(handicapPercent || 100) : 0;
  if (String(rec.importStatus || "").trim() === "warning") next.importStatus = "warning";
  if (Array.isArray(rec.importIssues) && rec.importIssues.length) {
    const prev = Array.isArray(next.importIssues) ? next.importIssues : [];
    next.importIssues = Array.from(new Set([...prev, ...rec.importIssues])).slice(0, 30);
  }
  return next;
}

/** Preserve shotgun / tee assignment fields when updating golf imports. */
export function mergeGolfRegistrationUpdatePayload(rec, existingData, handicapOn, handicapPercent) {
  const next = mergeRegistrationUpdatePayload(rec, existingData, handicapOn, handicapPercent);
  next.assignedHole = existingData?.assignedHole || "";
  next.teeTime = existingData?.teeTime || "";
  if (existingData?.startingHole != null) next.startingHole = existingData.startingHole;
  next.status = existingData?.status || next.status || "registered";
  return next;
}

export function dedupeImportRecordsByEmail(records) {
  const seen = new Set();
  const out = [];
  records.forEach((r) => {
    const k = r.matchEmail || `__${out.length}`;
    if (r.matchEmail && seen.has(r.matchEmail)) return;
    if (r.matchEmail) seen.add(r.matchEmail);
    out.push(r);
  });
  return out;
}
