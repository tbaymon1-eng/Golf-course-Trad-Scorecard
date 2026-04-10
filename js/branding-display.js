/**
 * Neutral display defaults for venue branding (no Firestore I/O).
 * Callers pass already-loaded tournament/course/org fields.
 */
import { PLACEHOLDER_COURSE_HEADER_IMAGE } from "./course-theme.js";

export const NEUTRAL_ORG_LABEL = "Golf Club";
export const NEUTRAL_SCORECARD_TITLE = "Scorecard";

/** Pick first non-empty trimmed string, else neutral org label. */
export function resolveDisplayOrgName(...candidates) {
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s) return s;
  }
  return NEUTRAL_ORG_LABEL;
}

/** Placard / print: course or venue line from tournament meta only. */
export function resolvePlacardCourseBrand(tournamentMeta) {
  const m = tournamentMeta;
  if (!m) return NEUTRAL_ORG_LABEL;
  const b = String(
    m.courseName ||
      m.defaultCourse ||
      m.course ||
      m.organizationName ||
      m.orgName ||
      m.clubName ||
      m.courseBrand ||
      m.venueName ||
      m.golfCourseName ||
      ""
  ).trim();
  return b || NEUTRAL_ORG_LABEL;
}

export { PLACEHOLDER_COURSE_HEADER_IMAGE };
