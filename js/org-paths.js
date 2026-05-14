/**
 * Multi-tenant Firestore path helpers.
 * When orgId is empty, use legacy top-level tournaments/{tournamentId} (existing links).
 */
import {
  doc,
  collection,
  getDoc,
  getDocs,
  query,
  where,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAppBaseUrl } from "./base-url.js";

/**
 * Canonical org id from URL: `org` wins over `orgId` / `organizationId` / `o`
 * so internal links can use ?org= without being overridden by stale orgId.
 */
export function readOrgAliasFromSearchParams(searchParams) {
  if (!searchParams || typeof searchParams.get !== "function") return "";
  return (
    searchParams.get("org") ||
    searchParams.get("orgId") ||
    searchParams.get("organizationId") ||
    searchParams.get("o") ||
    ""
  ).trim();
}

export function parseOrgTournamentFromSearch(searchParams) {
  const tournamentId = (searchParams.get("id") || searchParams.get("t") || "").trim();
  const orgId = readOrgAliasFromSearchParams(searchParams);
  return { orgId, tournamentId };
}

function safeText(v) {
  return String(v || "").trim();
}

/**
 * Resolve the effective org for a tournament in strict multi-org mode.
 * - If URL orgId is provided, the tournament must exist in that org path.
 * - If URL orgId is missing, use tournament.orgId/organizationId if present.
 * - Legacy top-level tournaments with no orgId are allowed only when the owner
 *   maps to a Cypresswood organization.
 */
export async function resolveTournamentOrgIdStrict(db, requestedOrgId, tournamentId) {
  const tid = safeText(tournamentId);
  if (!tid) {
    return { ok: false, error: "Missing tournament id." };
  }
  const requested = safeText(requestedOrgId);

  if (requested) {
    const scoped = await getDoc(doc(db, "organizations", requested, "tournaments", tid));
    if (scoped.exists()) {
      return { ok: true, orgId: requested, source: "scoped" };
    }
    return {
      ok: false,
      error: "Invalid organization for this tournament. Open the link from the correct customer account.",
    };
  }

  const legacySnap = await getDoc(doc(db, "tournaments", tid));
  if (!legacySnap.exists()) {
    return { ok: false, error: "Tournament not found." };
  }
  const legacy = legacySnap.data() || {};
  const canonOrg = safeText(legacy.organizationId || legacy.orgId);
  if (canonOrg) {
    return { ok: true, orgId: canonOrg, source: "legacy-canonical-field" };
  }

  const ownerUid = safeText(legacy.ownerUid || legacy.createdByUid || legacy.organizerUid);
  if (!ownerUid) {
    return {
      ok: false,
      error: "Tournament orgId is missing. Ask the organizer to regenerate this link.",
    };
  }
  const qy = query(
    collection(db, "organizations"),
    where("ownerUid", "==", ownerUid),
    limit(20)
  );
  const ownerOrgs = await getDocs(qy);
  let cypressOrgId = "";
  ownerOrgs.forEach((d) => {
    if (cypressOrgId) return;
    const row = d.data() || {};
    const slug = safeText(row.slug).toLowerCase();
    const name = safeText(row.name).toLowerCase();
    if (slug.includes("cypresswood") || name.includes("cypresswood")) {
      cypressOrgId = d.id;
    }
  });
  if (cypressOrgId) {
    return { ok: true, orgId: cypressOrgId, source: "legacy-cypresswood-owner" };
  }
  return {
    ok: false,
    error: "Tournament orgId is missing and cannot be resolved safely for this account.",
  };
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
  const o = String(orgId || "").trim();
  if (o) {
    url.searchParams.set("org", o);
    url.searchParams.set("orgId", o);
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
  const safeBase =
    baseHref && String(baseHref).trim()
      ? String(baseHref).trim()
      : globalThis.location?.origin || getAppBaseUrl() || "https://elbsolutions.co";
  const url = new URL("./index.html", safeBase);
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

/**
 * Same org/tournament query params as {@link buildTournamentIndexJoinUrl}, but under
 * {@link getAppBaseUrl} (production vs local) for window.open / mailto / QR targets.
 *
 * @param {string} page - e.g. "leaderboard.html"
 * @param {string} orgId
 * @param {string} tournamentId
 * @param {Record<string, string>} [extraSearchParams] - merged after id/t/org params
 * @returns {string}
 */
export function buildTournamentAbsoluteUrl(page, orgId, tournamentId, extraSearchParams) {
  const tid = String(tournamentId || "").trim();
  if (!tid) return "";
  const base = getAppBaseUrl();
  const cleanPage = String(page || "index.html").replace(/^\.\//, "");
  const url = new URL(cleanPage, base.endsWith("/") ? base : `${base}/`);
  applyOrgTournamentParams(url, orgId, tid);
  const extra = extraSearchParams && typeof extraSearchParams === "object" ? extraSearchParams : {};
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      url.searchParams.set(k, String(v));
    }
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
