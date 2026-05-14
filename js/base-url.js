/**
 * Canonical origin for generated links (scorecard, leaderboard, roster, registration, QR).
 * Local hostnames use the live window origin; production traffic always resolves to elbsolutions.co
 * so links stay correct even if the site is opened from a Firebase Hosting URL.
 */
export const PRODUCTION_SITE_ORIGIN = "https://elbsolutions.co";

/** When there is no `window` (or origin is unavailable), assume production. */
const LINK_ORIGIN_FALLBACK = PRODUCTION_SITE_ORIGIN;

function isLocalDevHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return (
    h.includes("localhost") ||
    h === "127.0.0.1" ||
    h.endsWith(".localhost")
  );
}

/**
 * @returns {string} Origin only, no trailing slash, never empty in the browser under normal hosts.
 */
export function getAppBaseUrl() {
  if (typeof window === "undefined" || typeof window.location === "undefined") {
    return LINK_ORIGIN_FALLBACK;
  }

  /**
   * Example (requirement parity):
   * const BASE_URL = window.location.hostname.includes("localhost")
   *   ? window.location.origin
   *   : "https://elbsolutions.co";
   */
  let BASE_URL = isLocalDevHost(window.location.hostname)
    ? window.location.origin
    : PRODUCTION_SITE_ORIGIN;

  BASE_URL = String(BASE_URL || "").trim().replace(/\/+$/, "") || "";

  return BASE_URL || LINK_ORIGIN_FALLBACK;
}

/** @deprecated Use {@link getAppBaseUrl} — same value. */
export function originForLinks() {
  return getAppBaseUrl();
}

/**
 * Tournament / roster / leaderboard / QR link builder — safe base URL, never `""`.
 * Strips a leading optional dot and slash from `path` before resolving under the origin.
 */
export function buildAbsoluteUrl(path, params = {}) {
  const base = getAppBaseUrl();
  const cleanPath = String(path || "index.html").replace(/^\.\?\//, "");
  const url = new URL(cleanPath, base.endsWith("/") ? base : base + "/");

  Object.entries(params || {}).forEach(([key, value]) => {
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

/** Full URL for the current pathname/search/hash (leaderboard Copy Link, scorecard share). */
export function canonicalSiteUrlHref() {
  if (typeof window === "undefined" || typeof window.location === "undefined") {
    return LINK_ORIGIN_FALLBACK;
  }
  const o = getAppBaseUrl();
  const ps = `${window.location.pathname}${window.location.search}${window.location.hash || ""}`;
  return `${String(o).replace(/\/$/, "")}${ps}`;
}
