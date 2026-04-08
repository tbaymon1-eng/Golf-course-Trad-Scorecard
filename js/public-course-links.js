/**
 * Build standalone everyday-play scorecard URL for a course.
 * Uses orgId + courseId query params consumed by index.html.
 */
export function buildPublicCourseScorecardUrl(orgId, courseId, baseHref = window.location.href) {
  const oid = String(orgId || "").trim();
  const cid = String(courseId || "").trim();
  if (!cid) return "";
  const base = new URL(baseHref);
  const dir = base.pathname.endsWith("/")
    ? base.pathname
    : base.pathname.slice(0, base.pathname.lastIndexOf("/") + 1);
  const u = new URL(`index.html`, `${base.origin}${dir}`);
  u.searchParams.set("courseId", cid);
  if (oid) u.searchParams.set("orgId", oid);
  return u.toString();
}
