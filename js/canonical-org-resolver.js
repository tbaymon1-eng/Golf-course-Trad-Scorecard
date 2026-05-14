/**
 * Single canonical organization id resolver for URL params and user profile fields.
 * Firestore paths must use organizations/{canonicalOrgId}/... (document id), never display names.
 * Course lists belong under organizations/{canonicalOrgId}/courses — see admin loadDefaultCourseOptionsForOrg
 * and org-paths.js `orgCoursesFirestorePath`.
 */
import { doc, getDoc, collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const FUNCTIONS_REGION = "us-central1";

/** Match functions/index.js normalizeOrgSlug. */
export function normalizeOrgSlug(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeTrim(v) {
  return String(v || "").trim();
}

export function logOrgResolver(payload) {
  try {
    console.info("[org resolver]", payload);
  } catch (_e) {}
}

/**
 * Read org-related query segment (org wins over orgId / organizationId / o).
 * @param {URLSearchParams} searchParams
 */
export function readUrlOrgAliasFromSearchParams(searchParams) {
  if (!searchParams || typeof searchParams.get !== "function") return "";
  return (
    searchParams.get("org") ||
    searchParams.get("orgId") ||
    searchParams.get("organizationId") ||
    searchParams.get("o") ||
    ""
  ).trim();
}

/**
 * Resolve a URL or profile org token to organizations/{canonicalOrgId} document id.
 * Order: direct doc get → client slug query (when rules allow) → callable (Admin lookup).
 *
 * @param {import("firebase/firestore").Firestore} db
 * @param {import("firebase/app").FirebaseApp | null} app
 * @param {string} raw
 * @param {{ context?: string, skipCallable?: boolean }} [options]
 */
export async function resolveCanonicalOrgIdFromUrlParam(db, app, raw, options = {}) {
  const incoming = safeTrim(raw);
  const context = String(options.context || "");
  if (!incoming || !db) {
    if (incoming) {
      logOrgResolver({
        context: context || "resolveCanonicalOrgIdFromUrlParam",
        incomingUrlOrg: incoming,
        resolvedSlug: "(n/a)",
        canonicalOrgId: "",
        source: "no-db",
      });
    }
    return { ok: true, canonicalOrgId: "", source: "none", incoming: incoming || "" };
  }

  try {
    const directSnap = await getDoc(doc(db, "organizations", incoming));
    const exists = typeof directSnap.exists === "function" ? directSnap.exists() : directSnap.exists;
    if (exists) {
      const slugOnDoc = safeTrim((directSnap.data() || {}).slug);
      logOrgResolver({
        context,
        incomingUrlOrg: incoming,
        resolvedSlug: slugOnDoc || normalizeOrgSlug(incoming) || "(none)",
        canonicalOrgId: directSnap.id,
        source: "organizations-doc-id",
      });
      return {
        ok: true,
        canonicalOrgId: directSnap.id,
        source: "organizations-doc-id",
        resolvedSlug: slugOnDoc,
        incoming,
      };
    }
  } catch (_e) {
    // permission-denied / offline — try slug query or callable
  }

  const slugNorm = normalizeOrgSlug(incoming);
  const cands = new Set([slugNorm, incoming, incoming.toLowerCase()].filter(Boolean));
  if (slugNorm) {
    try {
      const alt = incoming
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (alt) cands.add(alt);
    } catch (_e) {}
  }

  try {
    for (const cand of cands) {
      const slugTry = safeTrim(cand);
      if (!slugTry) continue;
      const qy = query(collection(db, "organizations"), where("slug", "==", slugTry), limit(2));
      const snaps = await getDocs(qy);
      if (!snaps.empty) {
        if (snaps.size > 1) {
          logOrgResolver({
            context,
            incomingUrlOrg: incoming,
            resolvedSlug: slugTry,
            canonicalOrgId: "",
            source: "ambiguous-slug-query",
          });
          return { ok: false, canonicalOrgId: "", source: "ambiguous-slug-query", incoming };
        }
        const d = snaps.docs[0];
        logOrgResolver({
          context,
          incomingUrlOrg: incoming,
          resolvedSlug: slugTry,
          canonicalOrgId: d.id,
          source: "client-slug-query",
        });
        return {
          ok: true,
          canonicalOrgId: d.id,
          source: "client-slug-query",
          resolvedSlug: slugTry,
          incoming,
        };
      }
    }
  } catch (_e) {}

  if (!options.skipCallable && app) {
    try {
      const fn = getFunctions(app, FUNCTIONS_REGION);
      const resolveOrg = httpsCallable(fn, "resolveOrganizationCanonicalId");
      const result = await resolveOrg({ org: incoming });
      const data = result?.data || {};
      if (data.ok && safeTrim(data.canonicalOrgId)) {
        logOrgResolver({
          context,
          incomingUrlOrg: incoming,
          resolvedSlug: safeTrim(data.slug) || slugNorm || "(n/a)",
          canonicalOrgId: safeTrim(data.canonicalOrgId),
          source: `callable:${safeTrim(data.source) || "server"}`,
        });
        return {
          ok: true,
          canonicalOrgId: safeTrim(data.canonicalOrgId),
          source: "callable",
          resolvedSlug: safeTrim(data.slug),
          incoming,
        };
      }
    } catch (e) {
      logOrgResolver({
        context,
        incomingUrlOrg: incoming,
        canonicalOrgId: "",
        source: "callable-error",
        message: String(e?.message || e),
      });
    }
  }

  logOrgResolver({
    context,
    incomingUrlOrg: incoming,
    resolvedSlug: slugNorm || "(n/a)",
    canonicalOrgId: "",
    source: "unresolved",
  });
  return { ok: false, canonicalOrgId: "", source: "unresolved", incoming };
}

/** Prefer canonical id; if resolution fails, return original trimmed string (legacy / offline). */
export async function resolveCanonicalOrgIdOrSame(db, app, raw, options = {}) {
  const incoming = safeTrim(raw);
  if (!incoming) return "";
  const r = await resolveCanonicalOrgIdFromUrlParam(db, app, incoming, options);
  if (r.ok && r.canonicalOrgId) return r.canonicalOrgId;
  return incoming;
}

export async function resolveCanonicalOrgIdFromSearchParams(db, app, searchParams, options = {}) {
  const raw = readUrlOrgAliasFromSearchParams(searchParams);
  return resolveCanonicalOrgIdFromUrlParam(db, app, raw, {
    ...options,
    context: options.context || "searchParams",
  });
}

/**
 * Remap user doc org fields so orgIds, activeOrgId, orgId, organizationId, and roleByOrg keys
 * all refer to canonical organization document ids (in-memory only). Firestore rules still
 * evaluate the persisted `users/{uid}` document — use `logTournamentWriteAuthDebug` in
 * resolve-organizer-org.js before writes to compare path `orgId` to server `orgIds` / `roleByOrg`.
 */
export async function remapUserOrganizationIdsToCanonical(db, app, userData) {
  const d = userData || {};
  if (!db || !app || !d || typeof d !== "object") return d;

  const rbo =
    d.roleByOrg && typeof d.roleByOrg === "object" && !Array.isArray(d.roleByOrg) ? { ...d.roleByOrg } : {};

  const sourceIds = new Set();
  const add = (v) => {
    const s = safeTrim(v);
    if (s) sourceIds.add(s);
  };
  if (Array.isArray(d.orgIds)) {
    for (const x of d.orgIds) add(x);
  }
  add(d.activeOrgId);
  add(d.orgId);
  add(d.organizationId);
  for (const k of Object.keys(rbo)) add(k);

  const ids = [...sourceIds];
  if (!ids.length) return d;

  const cache = new Map();
  await Promise.all(
    ids.map(async (id) => {
      const c = await resolveCanonicalOrgIdOrSame(db, app, id, { context: "user-doc-org-remap" });
      cache.set(id, c || id);
    })
  );

  const newOrgIdsSet = new Set();
  for (const id of ids) {
    const c = cache.get(id) || id;
    if (c) newOrgIdsSet.add(c);
  }
  const newOrgIds = [...newOrgIdsSet];

  const newRoleByOrg = {};
  for (const [k, v] of Object.entries(rbo)) {
    const nk = cache.get(k) || k;
    newRoleByOrg[nk] = v;
  }

  const ao = safeTrim(d.activeOrgId);
  let active = ao ? cache.get(ao) || ao : "";
  if (active && newOrgIds.length && !newOrgIds.includes(active)) {
    active = newOrgIds[0] || "";
  }
  if (!active && newOrgIds.length) {
    active = newOrgIds[0];
  }

  const leg = safeTrim(d.orgId) || safeTrim(d.organizationId);
  const legacyCanon = leg ? cache.get(leg) || leg : "";

  const topOrg =
    active ||
    legacyCanon ||
    (newOrgIds.length ? newOrgIds[0] : "") ||
    safeTrim(d.orgId) ||
    safeTrim(d.organizationId) ||
    "";
  const finalOrgIds = [...new Set([...newOrgIds, ...(topOrg ? [topOrg] : [])])];

  logOrgResolver({
    context: "user-doc-remap-result",
    incomingFields: { activeOrgId: ao, orgIds: d.orgIds, roleByOrgKeys: Object.keys(rbo) },
    canonicalOrgId: topOrg || "(empty)",
    activeOrgId: topOrg || "",
    orgIds: finalOrgIds,
    roleByOrgKeys: Object.keys(newRoleByOrg),
  });

  return {
    ...d,
    orgIds: finalOrgIds,
    activeOrgId: topOrg,
    orgId: topOrg || d.orgId,
    organizationId: topOrg || d.organizationId,
    roleByOrg: newRoleByOrg,
  };
}
