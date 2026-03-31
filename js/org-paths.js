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

/** Firestore organizations/{id} document id from tournament doc (not display/slug names). */
export function canonicalOrgIdFromTournament(data) {
  const d = data || {};
  return String(d.organizationId || d.orgId || "").trim();
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
