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
export function rowToImportRecord(row, m, eventCategory) {
  const email = pickImportCell(row, m.email);
  const phone = pickImportCell(row, m.phone);
  const session = pickImportCell(row, m.session);
  const timeSlot = pickImportCell(row, m.timeSlot);
  const groupLabel = pickImportCell(row, m.group);
  const instructor = pickImportCell(row, m.instructor);
  const paidStatus = pickImportCell(row, m.paidStatus);
  const notes = pickImportCell(row, m.notes);
  const teamNameRaw = pickImportCell(row, m.teamName);
  const displayName = resolveDisplayName(row, m);
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
    mappedRows.forEach((row) => {
      const email = pickImportCell(row, mapping.email);
      const phone = pickImportCell(row, mapping.phone);
      const team = pickImportCell(row, mapping.teamName);
      const fn = pickImportCell(row, mapping.fullName);
      const has =
        email ||
        phone ||
        team ||
        fn ||
        pickImportCell(row, mapping.firstName) ||
        pickImportCell(row, mapping.lastName);
      if (!has) {
        ignoredBlankRows += 1;
        return;
      }
      const rec = rowToImportRecord(row, mapping, cat);
      if (!rec.captainName && !rec.teamName) {
        skippedRows += 1;
        return;
      }
      regs.push(rec);
    });
    return { regs, skippedRows, ignoredBlankRows };
  }

  const groupedMap = new Map();
  mappedRows.forEach((r) => {
    const team = pickImportCell(r, mapping.teamName);
    const first = pickImportCell(r, mapping.firstName);
    const last = pickImportCell(r, mapping.lastName);
    const email = pickImportCell(r, mapping.email);
    const phone = pickImportCell(r, mapping.phone);
    const full = pickImportCell(r, mapping.fullName);

    const isBlank = !team && !first && !last && !email && !phone && !full;
    if (isBlank) {
      ignoredBlankRows += 1;
      return;
    }
    if (!team) {
      skippedRows += 1;
      return;
    }

    const fullName = full || playerNameFromParts(first, last);
    if (!fullName) {
      skippedRows += 1;
      return;
    }

    if (!groupedMap.has(team)) {
      groupedMap.set(team, {
        teamKey: team,
        captainEmail: "",
        captainPhone: "",
        session: "",
        timeSlot: "",
        groupLabel: "",
        players: [],
      });
    }
    const group = groupedMap.get(team);
    if (!group.captainEmail && email) group.captainEmail = email;
    if (!group.captainPhone && phone) group.captainPhone = phone;
    const s = pickImportCell(r, mapping.session);
    const ts = pickImportCell(r, mapping.timeSlot);
    const g = pickImportCell(r, mapping.group);
    if (s) group.session = s;
    if (ts) group.timeSlot = ts;
    if (g) group.groupLabel = g;
    group.players.push(fullName);
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
  return {
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
}

/**
 * Non-golf create payload (client writes Firestore directly).
 */
export function buildNonGolfRegistrationWritePayload(rec, tournamentTemplate, handicapOn, handicapPercent) {
  const t = tournamentTemplate || {};
  const resolvedCourseId = (() => {
    const id = String(t.courseId || t.defaultCourse || "").trim();
    const l = id.toLowerCase();
    if (l === "tradition" || l === "cypress") return l;
    return id;
  })();
  return {
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
    assignedHole: "",
    teeTime: "",
    status: "registered",
    registrantSource: REGISTRANT_SOURCE_CSV_IMPORT,
    source: "csv_import",
  };
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
