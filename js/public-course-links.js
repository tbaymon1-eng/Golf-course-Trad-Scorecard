import { buildAbsoluteUrl } from "./base-url.js";

/**
 * Permanent public everyday-play scorecard URL (course mode).
 * Scores persist in localStorage on the visitor device only — no casualRounds writes.
 *
 * Consumed by index.html with ?mode=course&course=...&org=...
 */
export function buildPublicCourseScorecardUrl(orgId, courseId, _baseHref) {
  const oid = String(orgId || "").trim();
  const cid = String(courseId || "").trim();
  if (!cid) return "";
  const params = {
    mode: "course",
    course: cid,
    courseId: cid,
  };
  if (oid) {
    params.org = oid;
    params.orgId = oid;
  }
  return buildAbsoluteUrl("index.html", params);
}

/**
 * Organization-wide scorecard: default course first, course toggle for all active org courses.
 * Consumed by index.html with ?mode=org-scorecard&org=...
 */
export function buildOrganizationScorecardUrl(orgId) {
  const oid = String(orgId || "").trim();
  if (!oid) return "";
  return buildAbsoluteUrl("index.html", {
    mode: "org-scorecard",
    org: oid,
    orgId: oid,
  });
}
