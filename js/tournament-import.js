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

export const IMPORT_FIELD_KEYS = [
  { id: "fullName", label: "Full name" },
  { id: "firstName", label: "First name" },
  { id: "lastName", label: "Last name" },
  { id: "teamName", label: "Team / group name" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "playerNames", label: "Player names (comma-separated)" },
  { id: "player2", label: "Player 2 name" },
  { id: "player3", label: "Player 3 name" },
  { id: "player4", label: "Player 4 name" },
  { id: "player5", label: "Player 5 name" },
  { id: "player6", label: "Player 6 name" },
  { id: "handicap", label: "Handicap" },
  { id: "session", label: "Session" },
  { id: "timeSlot", label: "Time slot" },
  { id: "group", label: "Group" },
  { id: "instructor", label: "Instructor" },
  { id: "paidStatus", label: "Paid status" },
  { id: "notes", label: "Notes" },
];

export const DUPLICATE_MODE_ADD_ONLY = "add_only";
export const DUPLICATE_MODE_UPDATE = "update_matching";
export const DUPLICATE_MODE_SKIP = "skip_duplicates";

const IMPORT_FIELD_LABELS = Object.fromEntries(IMPORT_FIELD_KEYS.map((f) => [f.id, f.label]));
const NAME_FIELD_IDS = ["fullName", "firstName", "lastName"];

function headerLooksLike(header, regex) {
  return regex.test(String(header || "").trim().toLowerCase());
}

function getHeaderIntentLabel(header) {
  if (!header) return "";
  if (headerLooksLike(header, /e-?mail|email\s*address/)) return "Email";
  if (headerLooksLike(header, /(team|group|foursome|squad|company)/)) return "TeamName";
  if (headerLooksLike(header, /(full\s*name|display\s*name|participant|first\s*name|last\s*name|surname|given|name)/))
    return "PlayerName";
  if (headerLooksLike(header, /(phone|mobile|cell|tel)/)) return "Phone";
  return "";
}

function pushUniqueIssue(bucket, text) {
  if (!text) return;
  if (!bucket.includes(text)) bucket.push(text);
}

function rowHasReadableData(row) {
  return Object.values(row || {}).some((v) => String(v || "").trim());
}

function firstReadableRowValue(row) {
  const vals = Object.values(row || {});
  for (const v of vals) {
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
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
    const hasFullName = uniq.includes("fullName");
    const hasFirst = uniq.includes("firstName");
    const hasLast = uniq.includes("lastName");
    const hasPlayerName = NAME_FIELD_IDS.some((id) => uniq.includes(id));

    if (hasPlayerName && hasTeam) {
      pushUniqueIssue(issues, "A player name column is mapped to the same column as the team name");
    }
    if (hasTeam && hasEmail) {
      pushUniqueIssue(issues, "The team name column is mapped to the same column as email");
    }
    if (hasFirst && hasLast) {
      pushUniqueIssue(issues, "First name and last name are currently matched to the same spreadsheet column");
    }
    if (hasFullName && (hasFirst || hasLast)) {
      pushUniqueIssue(issues, "Full name is currently matched to the same column as first or last name");
    }

    if (issues.length === issueCountBefore) {
      const labels = uniq.map((id) => IMPORT_FIELD_LABELS[id] || id).join(", ");
      pushUniqueIssue(issues, `These fields are using the same spreadsheet column: ${labels}`);
    }
  });

  NAME_FIELD_IDS.forEach((nameFieldId) => {
    const header = m[nameFieldId];
    const intent = getHeaderIntentLabel(header);
    if (intent === "TeamName") {
      pushUniqueIssue(issues, "Player name is currently matched to TeamName");
    }
  });

  if (getHeaderIntentLabel(m.teamName) === "Email") {
    pushUniqueIssue(issues, "Team name is currently matched to Email");
  }
  if (getHeaderIntentLabel(m.email) === "TeamName") {
    pushUniqueIssue(issues, "Email is currently matched to TeamName");
  }

  const cat = normalizeEventCategory({ eventCategory });
  const isGolf = cat === EVENT_CATEGORY_GOLF;
  if (isGolf && !m.teamName) {
    pushUniqueIssue(issues, "Team name is required for tournament imports");
  }
  if (isGolf && !m.fullName && (!m.firstName || !m.lastName)) {
    pushUniqueIssue(issues, "Player name is required (Full name or First + Last)");
  }
  if (!isGolf && !m.fullName && !m.email && (!m.firstName || !m.lastName)) {
    pushUniqueIssue(issues, "Add at least one participant identifier (Full name, Email, or First + Last)");
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

export function normalizeNameSessionKey(fullName, session, timeSlot) {
  const n = String(fullName || "")
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

function resolveDisplayName(row, m) {
  const full = pickImportCell(row, m.fullName);
  if (full) return full.trim();
  return playerNameFromParts(pickImportCell(row, m.firstName), pickImportCell(row, m.lastName));
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

/**
 * One logical import record (one roster row target).
 */
export function rowToImportRecord(row, m, eventCategory, sourceRowNumber = null) {
  const importIssues = [];
  const email = pickImportCell(row, m.email);
  const phone = pickImportCell(row, m.phone);
  const session = pickImportCell(row, m.session);
  const timeSlot = pickImportCell(row, m.timeSlot);
  const groupLabel = pickImportCell(row, m.group);
  const instructor = pickImportCell(row, m.instructor);
  const paidStatus = pickImportCell(row, m.paidStatus);
  const notes = pickImportCell(row, m.notes);
  const fallbackCell = firstReadableRowValue(row);
  let teamNameRaw = pickImportCell(row, m.teamName);
  let displayName = resolveDisplayName(row, m);
  if (!displayName && fallbackCell) {
    displayName = fallbackCell;
    importIssues.push("Player name was missing, so we used the first filled spreadsheet value");
  }
  if (!displayName) {
    displayName = `Player ${sourceRowNumber || 1}`;
    importIssues.push("Player name was missing, so we generated one");
  }
  if (!teamNameRaw) {
    teamNameRaw = displayName || fallbackCell || `Imported Team ${sourceRowNumber || 1}`;
    importIssues.push("Team name was missing, so we generated one");
  }
  const hc = pickImportCell(row, m.handicap);
  const handicapNum = Number(hc);
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
        captainEmail: "",
        captainPhone: "",
        session: "",
        timeSlot: "",
        groupLabel: "",
        players: [],
        sourceRows: [],
        importIssues: [],
      });
    }
    const group = groupedMap.get(teamKey);
    if (!group.captainEmail && rec.captainEmail) group.captainEmail = rec.captainEmail;
    if (!group.captainPhone && rec.captainPhone) group.captainPhone = rec.captainPhone;
    if (rec.session) group.session = rec.session;
    if (rec.timeSlot) group.timeSlot = rec.timeSlot;
    if (rec.groupLabel) group.groupLabel = rec.groupLabel;
    rec.players.forEach((name) => group.players.push(name));
    (rec._sourceRows || []).forEach((n) => group.sourceRows.push(n));
    (rec._importIssues || []).forEach((issue) => {
      if (issue && !group.importIssues.includes(issue)) group.importIssues.push(issue);
    });
  });

  const regs = [];
  for (const team of groupedMap.values()) {
    const seen = new Set();
    const uniquePlayers = [];
    team.players.forEach((p) => {
      const key = String(p || "").trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      uniquePlayers.push(String(p).trim());
    });
    if (!uniquePlayers.length) continue;
    const captainName = uniquePlayers[0] || "";
    const playerDetails = uniquePlayers.map((name, idx) => ({ name, isCaptain: idx === 0 }));
    const matchEmail = normalizeEmailKey(team.captainEmail);
    const matchPhone = normalizePhoneKey(team.captainPhone);
    const matchNameSession = normalizeNameSessionKey(captainName, team.session, team.timeSlot);
    regs.push({
      eventCategory: EVENT_CATEGORY_GOLF,
      teamKey: team.teamKey,
      teamName: team.teamKey,
      captainName,
      captainEmail: team.captainEmail || "",
      captainPhone: team.captainPhone || "",
      players: uniquePlayers,
      playerDetails,
      session: team.session || "",
      timeSlot: team.timeSlot || "",
      groupLabel: team.groupLabel || "",
      instructor: "",
      paidStatus: "",
      notes: "",
      matchEmail,
      matchPhone,
      matchNameSession,
      _sourceRows: team.sourceRows.slice(),
      _importIssues: team.importIssues.slice(),
    });
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
