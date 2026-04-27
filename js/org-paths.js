/**
 * Multi-tenant Firestore path helpers.
 * When orgId is empty, use legacy top-level tournaments/{tournamentId} (existing links).
 */
import { doc, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function parseOrgTournamentFromSearch(searchParams) {
  const tournamentId = (searchParams.get("id") || searchParams.get("t") || "").trim();
  const orgId = (searchParams.get("org") || searchParams.get("o") || "").trim();
  return { orgId, tournamentId };
}

export function tournamentDocRef(db, orgId, tournamentId) {
  if (orgId) {
    return doc(db, "organizations", orgId, "tournaments", tournamentId);
  }
  return doc(db, "tournaments", tournamentId);
}

export function tournamentRegistrationsCollection(db, orgId, tournamentId) {
  if (orgId) {
    return collection(db, "organizations", orgId, "tournaments", tournamentId, "registrations");
  }
  return collection(db, "tournaments", tournamentId, "registrations");
}

export function tournamentRegistrationDoc(db, orgId, tournamentId, registrationId) {
  if (orgId) {
    return doc(
      db,
      "organizations",
      orgId,
      "tournaments",
      tournamentId,
      "registrations",
      registrationId
    );
  }
  return doc(db, "tournaments", tournamentId, "registrations", registrationId);
}

/** Operational play groups (tee times / pairings) — separate from registrations and scoring. */
export function tournamentPlayGroupsCollection(db, orgId, tournamentId) {
  if (orgId) {
    return collection(db, "organizations", orgId, "tournaments", tournamentId, "playGroups");
  }
  return collection(db, "tournaments", tournamentId, "playGroups");
}

export function tournamentPlayGroupDoc(db, orgId, tournamentId, playGroupId) {
  if (orgId) {
    return doc(db, "organizations", orgId, "tournaments", tournamentId, "playGroups", playGroupId);
  }
  return doc(db, "tournaments", tournamentId, "playGroups", playGroupId);
}

export function tournamentSubmissionsDoc(db, orgId, tournamentId, deviceId) {
  if (orgId) {
    return doc(db, "organizations", orgId, "tournaments", tournamentId, "submissions", deviceId);
  }
  return doc(db, "tournaments", tournamentId, "submissions", deviceId);
}

export function tournamentSubmissionsCollection(db, orgId, tournamentId) {
  if (orgId) {
    return collection(db, "organizations", orgId, "tournaments", tournamentId, "submissions");
  }
  return collection(db, "tournaments", tournamentId, "submissions");
}

export function tournamentAlertsLiveRef(db, orgId, tournamentId) {
  if (orgId) {
    return doc(db, "organizations", orgId, "tournaments", tournamentId, "alerts", "live");
  }
  return doc(db, "tournaments", tournamentId, "alerts", "live");
}

export function organizationsCollection(db) {
  return collection(db, "organizations");
}

export function orgTournamentsCollection(db, orgId) {
  return collection(db, "organizations", orgId, "tournaments");
}

/** Append org + id query params to a URL object (player / public links). */
export function applyOrgTournamentParams(url, orgId, tournamentId) {
  if (tournamentId) {
    url.searchParams.set("id", tournamentId);
    url.searchParams.set("t", tournamentId);
  }
  if (orgId) {
    url.searchParams.set("org", orgId);
  }
}

/**
 * Public tournament scorecard / join entry (index.html). Always uses URL + URLSearchParams.
 * Optional registration = team / player context for the scorecard. Never concatenate query strings.
 *
 * @param {string} baseHref - e.g. window.location.href (resolves index.html in the same directory)
 * @param {string} orgId
 * @param {string} tournamentId
 * @param {string} [registrationId] - if set, adds `registration` param
 * @param {{ log?: boolean }} [options] - pass `{ log: false }` to skip console (e.g. per-row links)
 * @returns {string}
 */
export function buildTournamentIndexJoinUrl(
  baseHref,
  orgId,
  tournamentId,
  registrationId,
  options
) {
  const tid = String(tournamentId || "").trim();
  if (!tid) return "";
  const url = new URL("./index.html", baseHref);
  applyOrgTournamentParams(url, orgId, tid);
  const rid = String(registrationId || "").trim();
  if (rid) {
    url.searchParams.set("registration", rid);
  }
  if (options?.log !== false) {
    console.log("Generated join URL:", url.toString());
  }
  return url.toString();
}

export function publicLinkDocRef(db, token) {
  return doc(db, "publicLinks", token);
}

export function orgCoursesCollection(db, orgId) {
  return collection(db, "organizations", orgId, "courses");
}

export function courseDocRef(db, orgId, courseId) {
  return doc(db, "organizations", orgId, "courses", courseId);
}

export function casualRoundDocRef(db, orgId, roundId) {
  return doc(db, "organizations", orgId, "casualRounds", roundId);
}
