/**
 * Operational play groups (tee times, pairings, clinic blocks) — separate from
 * registration bundles, scoring teams, and registrationStructure / scoringStructure.
 *
 * Participant identity: `${registrationId}::${playerIndex}` where playerIndex is
 * the index in the registration’s ordered name list (same order as roster players column).
 */

export const PARTICIPANT_KEY_SEP = "::";

export const PLAY_GROUP_TYPE_TEE_TIME = "tee_time";
export const PLAY_GROUP_TYPE_PAIRING = "pairing";
export const PLAY_GROUP_TYPE_CLINIC_GROUP = "clinic_group";
export const PLAY_GROUP_TYPE_GENERAL = "general";

export const PLAY_GROUP_TYPES = [
  PLAY_GROUP_TYPE_TEE_TIME,
  PLAY_GROUP_TYPE_PAIRING,
  PLAY_GROUP_TYPE_CLINIC_GROUP,
  PLAY_GROUP_TYPE_GENERAL,
];

/**
 * @param {string} registrationId
 * @param {number} playerIndex
 */
export function makeParticipantKey(registrationId, playerIndex) {
  const rid = String(registrationId || "").trim();
  const idx = Math.max(0, Math.floor(Number(playerIndex)) || 0);
  return `${rid}${PARTICIPANT_KEY_SEP}${idx}`;
}

/**
 * @param {string} key
 * @returns {{ registrationId: string, playerIndex: number }}
 */
export function parseParticipantKey(key) {
  const s = String(key || "");
  const i = s.lastIndexOf(PARTICIPANT_KEY_SEP);
  if (i <= 0) return { registrationId: "", playerIndex: 0 };
  return {
    registrationId: s.slice(0, i).trim(),
    playerIndex: Math.max(0, parseInt(s.slice(i + PARTICIPANT_KEY_SEP.length), 10) || 0),
  };
}

function normName(v) {
  return String(v || "").trim().replace(/\s+/g, " ");
}

/** Ordered unique display names for play-group participant slots (max 20). */
export function uniquePlayerNamesForPlayGroup(reg) {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const n = normName(raw);
    if (!n) return;
    const k = n.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(n);
  };
  (Array.isArray(reg?.players) ? reg.players : []).forEach((p) => add(p));
  if (!out.length) add(reg?.captainName);
  return out.slice(0, 20);
}

/**
 * @param {object} reg roster registration row (not submission rows)
 * @returns {Array<{ participantKey: string, registrationId: string, playerIndex: number, displayName: string, registration: object }>}
 */
export function expandRegistrationParticipants(reg) {
  if (!reg || reg.isSubmission) return [];
  if (String(reg.status || "").toLowerCase() === "cancelled") return [];
  const rid = String(reg.id || "").trim();
  if (!rid) return [];
  const names = uniquePlayerNamesForPlayGroup(reg);
  return names.map((displayName, playerIndex) => ({
    participantKey: makeParticipantKey(rid, playerIndex),
    registrationId: rid,
    playerIndex,
    displayName,
    registration: reg,
  }));
}

/**
 * @param {Array<object>} registrations
 */
export function expandAllParticipants(registrations) {
  const list = [];
  for (const r of registrations || []) {
    list.push(...expandRegistrationParticipants(r));
  }
  return list;
}

/**
 * @param {Array<object>} playGroups Firestore docs data + id
 * @returns {Map<string, object>} participantKey -> group row (includes id)
 */
export function computeParticipantToGroupMap(playGroups) {
  const m = new Map();
  for (const g of playGroups || []) {
    const gid = String(g.id || "").trim();
    if (!gid) continue;
    for (const pid of Array.isArray(g.participantIds) ? g.participantIds : []) {
      const k = String(pid || "").trim();
      if (k) m.set(k, g);
    }
  }
  return m;
}

/**
 * @param {"off"|"all"|"unassigned"|"grouped"|"by_group"} mode
 * @param {ReturnType<typeof expandAllParticipants>} participants
 * @param {Map<string, object>} participantToGroup
 */
export function filterParticipantsByViewMode(mode, participants, participantToGroup) {
  const list = participants || [];
  if (mode === "all" || mode === "off" || !mode) return list.slice();
  if (mode === "unassigned") return list.filter((p) => !participantToGroup.has(p.participantKey));
  if (mode === "grouped") return list.filter((p) => participantToGroup.has(p.participantKey));
  if (mode === "by_group") return list.slice();
  return list.slice();
}

/**
 * Sort for roster “grouped” / “by group” views: unassigned last, then tee/group time, number, name.
 * @param {Array<{ participantKey: string }>} list
 * @param {Map<string, object>} participantToGroup
 */
export function sortParticipantsForPlayGroupDisplay(list, participantToGroup) {
  const map = participantToGroup || new Map();
  return [...(list || [])].sort((a, b) => {
    const ga = map.get(a.participantKey);
    const gb = map.get(b.participantKey);
    const unA = ga ? 0 : 1;
    const unB = gb ? 0 : 1;
    if (unA !== unB) return unA - unB;
    const ta = String(ga?.teeTime || "").trim();
    const tb = String(gb?.teeTime || "").trim();
    if (ta !== tb) return ta.localeCompare(tb);
    const na = Number(ga?.groupNumber);
    const nb = Number(gb?.groupNumber);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    if (Number.isFinite(na) && !Number.isFinite(nb)) return -1;
    if (!Number.isFinite(na) && Number.isFinite(nb)) return 1;
    return String(ga?.groupName || "").localeCompare(String(gb?.groupName || ""));
  });
}

export function nextPlayGroupNumber(playGroups) {
  let max = 0;
  for (const g of playGroups || []) {
    const n = Number(g.groupNumber);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * Returns participantIds with any of keysToRemove stripped (stable order).
 * @param {unknown} participantIds
 * @param {string[]} keysToRemove
 * @returns {string[]}
 */
export function participantIdsAfterRemovingKeys(participantIds, keysToRemove) {
  const keySet = new Set(
    (keysToRemove || []).map((k) => String(k || "").trim()).filter(Boolean)
  );
  const before = Array.isArray(participantIds) ? participantIds : [];
  return before.map((id) => String(id || "").trim()).filter((id) => id && !keySet.has(id));
}

/**
 * Union of current participant id strings and keysToAdd (deduped).
 * @param {unknown} participantIds
 * @param {string[]} keysToAdd
 * @returns {string[]}
 */
export function mergeParticipantKeysUnique(participantIds, keysToAdd) {
  const base = Array.isArray(participantIds)
    ? participantIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const add = (keysToAdd || []).map((k) => String(k || "").trim()).filter(Boolean);
  return [...new Set([...base, ...add])];
}

/**
 * Plain object for a new play group Firestore document (caller adds createdAt/updatedAt timestamps).
 * Does not write to registration or scoring collections.
 */
export function buildPlayGroupCreatePayload({
  tournamentId,
  organizationId,
  orgId,
  groupName,
  groupNumber,
  groupType,
  teeTime,
  startingHole,
  notes,
  participantIds,
  createdBy,
}) {
  const oid = String(orgId || organizationId || "").trim();
  const tid = String(tournamentId || "").trim();
  const gn = Math.max(1, parseInt(String(groupNumber != null ? groupNumber : 1), 10) || 1);
  const ids = Array.isArray(participantIds)
    ? participantIds.map((k) => String(k || "").trim()).filter(Boolean)
    : [];
  return {
    tournamentId: tid,
    organizationId: oid,
    orgId: oid,
    groupName: String(groupName || "").trim().replace(/\s+/g, " "),
    groupNumber: gn,
    groupType: String(groupType || "general").trim() || "general",
    teeTime: String(teeTime || "").trim().replace(/\s+/g, " "),
    startingHole: String(startingHole || "").trim().replace(/\s+/g, " "),
    notes: String(notes || "").trim(),
    participantIds: ids,
    createdBy: String(createdBy || "").trim(),
  };
}

/**
 * Labels: follow roster entity wording (Players vs Participants) and golf vs clinic/camp/general.
 * @param {{ entityLabel?: string, playersColumnLabel?: string }} rosterUi from getRosterPageUiConfigForTournament
 * @param {boolean} [isGolf] default true when unknown (backward compatible)
 */
export function getRosterPlayGroupUiConfig(rosterUi, isGolf = true) {
  const ui = rosterUi || {};
  const el = String(ui.entityLabel || "").trim();
  const lower = el.toLowerCase();
  const isParticipantWord =
    lower.includes("participant") || lower.includes("attendee") || lower === "attendees";
  const plural = isParticipantWord ? "Participants" : "Players";
  const singular = isParticipantWord ? "Participant" : "Player";
  const golf = !!isGolf;
  const bulkHint = golf
    ? `Select ${plural.toLowerCase()} to organize tee times or pairings on the roster only. This does not change sign-ups or how scores are grouped.`
    : `Select ${plural.toLowerCase()} to organize sessions, stations, or on-site groups on the roster only. This does not change sign-ups or scoring.`;
  return {
    entityPlural: plural,
    entitySingular: singular,
    unassignedLabel: isParticipantWord ? "Unassigned Participants" : "Unassigned Players",
    groupedLabel: isParticipantWord ? "Grouped Participants" : "Grouped Players",
    toolbarTitle: golf ? "Tee times & pairings (optional)" : "Operational groups (optional)",
    groupTimeColumnHeader: golf ? "Group tee time" : "Group time",
    groupStartColumnHeader: golf ? "Group start" : "Location / detail",
    registrationAssignmentHeader: "Sign-up assignment",
    assignTimeButtonLabel: golf ? "Assign Tee Time" : "Assign Group Time",
    clearTimeButtonLabel: golf ? "Clear Tee Time" : "Clear Group Time",
    assignGroupTimeModalTitle: golf ? "Assign Tee Time / Starting Hole" : "Assign Group Time / Details",
    assignGroupTimeModalSub: golf
      ? "Updates this play group only. Selected people must already be in the same play group."
      : "Updates this group only. Selected people must already be in the same play group.",
    teeTimeFieldLabel: golf ? "Tee time" : "Group time (optional)",
    startingHoleFieldLabel: golf ? "Starting hole" : "Location or detail (optional)",
    startingHolePlaceholder: golf ? "e.g. 1A" : "e.g. Range station 2, Room B",
    bulkHint,
  };
}
