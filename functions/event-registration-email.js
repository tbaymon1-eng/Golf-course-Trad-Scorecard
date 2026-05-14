/**
 * Multi-tenant registration confirmation email (Resend).
 * From/reply: verified custom domain when configured; otherwise platform
 * registrations@elbsolutions.co with optional Reply-To to the course contact.
 */

"use strict";

const { Resend } = require("resend");

const DEFAULT_PUBLIC_ORIGIN = "https://elbsolutions.co";
const PLATFORM_REGISTRATIONS_FROM_EMAIL = "registrations@elbsolutions.co";

function safeText(value, fallback = "") {
  return String(value != null ? value : fallback || "").trim();
}

/** Sources that must never trigger a customer confirmation email (organizer/import flows). */
const REGISTRANT_SOURCE_DENYLIST = new Set([
  "csv_import",
  "admin_manual",
  "roster_import",
  "admin",
]);

/**
 * Minimal check that the string looks like an email (not full RFC validation).
 * @param {string} raw
 * @returns {boolean}
 */
function looksLikeRealEmail(raw) {
  const s = safeText(raw);
  if (!s || /\s/.test(s)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Send confirmation when there is a plausible registrant email and the source is not
 * an explicit import/admin path. Empty or missing registrantSource is treated as public
 * (legacy clients omit it).
 *
 * @param {unknown} registrantSource - raw from request; may be undefined
 * @param {string} recipientEmail - captainEmail || email || registrantEmail combined by caller
 * @returns {{ send: true, reason: string } | { send: false, reason: string }}
 */
function shouldSendRegistrationConfirmationEmail(registrantSource, recipientEmail) {
  const sourceNorm = safeText(registrantSource).toLowerCase();
  if (sourceNorm && REGISTRANT_SOURCE_DENYLIST.has(sourceNorm)) {
    return { send: false, reason: `blocked_registrant_source:${sourceNorm}` };
  }
  const email = safeText(recipientEmail);
  if (!looksLikeRealEmail(email)) {
    return { send: false, reason: "no_valid_email" };
  }
  return {
    send: true,
    reason: sourceNorm
      ? `allowed_source:${sourceNorm}`
      : "allowed_missing_or_empty_source",
  };
}

/**
 * Merge organization doc + nested emailSettings for sending logic.
 * @param {object|null|undefined} organization
 */
function mergeOrgEmailSettings(organization) {
  const o = organization && typeof organization === "object" ? organization : {};
  const nested =
    o.emailSettings && typeof o.emailSettings === "object" ? o.emailSettings : {};
  return {
    emailSenderName: safeText(nested.emailSenderName) || safeText(o.emailSenderName),
    senderEmail: safeText(nested.senderEmail) || safeText(o.senderEmail),
    replyToEmail: safeText(nested.replyToEmail) || safeText(o.replyToEmail),
    senderDomain: safeText(nested.senderDomain) || safeText(o.senderDomain),
    verifiedSenderEmail: safeText(nested.verifiedSenderEmail) || safeText(o.verifiedSenderEmail),
    emailSenderStatus: safeText(nested.emailSenderStatus || o.emailSenderStatus).toLowerCase(),
    emailDomainVerified: !!(nested.emailDomainVerified || o.emailDomainVerified),
    emailProvider: safeText(nested.emailProvider || o.emailProvider, "resend"),
  };
}

/**
 * Registration confirmations: unverified orgs always send from the platform mailbox;
 * Reply-To is the course contact when set and valid.
 * @returns {{ from: string, replyTo?: string }}
 */
function buildFromAndReply(emailSettings, organization) {
  const orgName = safeText(organization?.name);
  const status = safeText(emailSettings.emailSenderStatus).toLowerCase();
  const verifiedAddr = safeText(emailSettings.verifiedSenderEmail);
  const replyPrimary = safeText(emailSettings.replyToEmail);
  const replyLegacy = safeText(emailSettings.senderEmail);
  const replyTo = looksLikeRealEmail(replyPrimary)
    ? replyPrimary
    : looksLikeRealEmail(replyLegacy)
      ? replyLegacy
      : "";
  const hasValidReply = !!replyTo;

  if (status === "verified_sender" && verifiedAddr && looksLikeRealEmail(verifiedAddr)) {
    const display =
      safeText(emailSettings.emailSenderName) || orgName || "ELB Solutions";
    return {
      from: `${display} <${verifiedAddr}>`,
      replyTo: hasValidReply ? replyTo : undefined,
    };
  }

  if (hasValidReply) {
    const display =
      safeText(emailSettings.emailSenderName) || orgName || "ELB Solutions";
    return {
      from: `${display} <${PLATFORM_REGISTRATIONS_FROM_EMAIL}>`,
      replyTo,
    };
  }

  return {
    from: `ELB Solutions <${PLATFORM_REGISTRATIONS_FROM_EMAIL}>`,
    replyTo: undefined,
  };
}

function buildAbsoluteAppUrl(path, params) {
  const u = new URL(String(path || "").replace(/^\//, ""), DEFAULT_PUBLIC_ORIGIN);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v == null) return;
    const s = String(v).trim();
    if (s) u.searchParams.set(k, s);
  });
  return u.toString();
}

/**
 * Public app links for registration emails and share surfaces.
 */
function buildPlayerInfoUrl(orgId, tournamentId) {
  const tid = safeText(tournamentId);
  const oid = safeText(orgId);
  if (!tid) return "";
  const params = { id: tid, t: tid };
  if (oid) {
    params.org = oid;
    params.orgId = oid;
  }
  return buildAbsoluteAppUrl("faq.html", params);
}

function buildEventLinks(orgId, tournamentId, registrationId) {
  const tid = safeText(tournamentId);
  const oid = safeText(orgId);
  const rid = safeText(registrationId);
  if (!tid) {
    return { scorecardUrl: "", leaderboardUrl: "", playerInfoUrl: "" };
  }
  const base = { id: tid, t: tid };
  if (oid) {
    base.org = oid;
    base.orgId = oid;
  }
  const scoreParams = { ...base };
  if (rid) scoreParams.registration = rid;
  return {
    scorecardUrl: buildAbsoluteAppUrl("index.html", scoreParams),
    leaderboardUrl: buildAbsoluteAppUrl("leaderboard.html", base),
    playerInfoUrl: buildPlayerInfoUrl(oid, tid),
  };
}

/** Align with registerTeam server helper resolveEventCategory. */
function resolveEventCategory(tournament) {
  const c = safeText(tournament?.eventCategory).toLowerCase();
  if (c === "clinic" || c === "camp" || c === "general") return c;
  if (c === "golf_tournament" || c === "golf") return "golf_tournament";
  const et = safeText(tournament?.eventType).toLowerCase();
  if (et === "clinic" || et === "camp" || et === "general") return et;
  return "golf_tournament";
}

function subjectForRegistration(tournament) {
  const eventName = safeText(tournament?.tournamentName || tournament?.name);
  if (eventName) return `${eventName} Registration Confirmed`;
  return "Registration Confirmed";
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatEventWhen(tournament) {
  const dateStr = safeText(tournament?.eventDate || tournament?.date);
  const firstTee = safeText(tournament?.firstTeeTime);
  const parts = [];
  if (dateStr) parts.push(dateStr);
  if (firstTee) parts.push(`First tee / schedule start: ${firstTee}`);
  return parts.join(" · ");
}

function buildDetailRows({ organizationName, tournament, registration, links }) {
  const rows = [];
  const tName = safeText(tournament?.tournamentName || tournament?.name);
  if (tName) rows.push({ label: "Event", value: tName });

  const cat = resolveEventCategory(tournament);
  const typeLabel =
    cat === "golf_tournament"
      ? "Tournament"
      : cat === "clinic"
        ? "Clinic"
        : cat === "camp"
          ? "Camp"
          : cat === "general"
            ? "Event"
            : safeText(tournament?.registrationUiEventType) || cat || "";
  if (typeLabel) rows.push({ label: "Event type", value: typeLabel });

  if (organizationName) {
    rows.push({ label: "Organization / course", value: organizationName });
  }

  const venue = safeText(tournament?.venueName || tournament?.venue || tournament?.courseLabel);
  if (venue) rows.push({ label: "Venue", value: venue });

  const captain = safeText(registration?.captainName);
  if (captain) rows.push({ label: "Registrant", value: captain });

  const team = safeText(registration?.teamName);
  if (team) rows.push({ label: "Team / group name", value: team });

  const players = Array.isArray(registration?.players)
    ? registration.players.map((x) => safeText(x)).filter(Boolean)
    : [];
  if (players.length) rows.push({ label: "Participants", value: players.join(", ") });
  else if (
    Array.isArray(registration?.playerDetails) &&
    registration.playerDetails.length
  ) {
    const names = registration.playerDetails.map((p) => safeText(p?.name)).filter(Boolean);
    if (names.length) rows.push({ label: "Participants", value: names.join(", ") });
  }

  const when = formatEventWhen(tournament);
  if (when) rows.push({ label: "Date / time", value: when });

  const session = safeText(registration?.session);
  const slot = safeText(registration?.timeSlot || registration?.groupLabel);
  if (session || slot) {
    rows.push({
      label: "Session / time slot",
      value: [session, slot].filter(Boolean).join(" · "),
    });
  }

  const instructor = safeText(registration?.instructor);
  if (instructor) rows.push({ label: "Instructor", value: instructor });

  if (cat === "golf_tournament") {
    const tt = safeText(registration?.teeTime);
    if (tt) rows.push({ label: "Tee time", value: tt });
    const hole =
      safeText(registration?.assignedHole) ||
      (registration?.startingHoleLabel
        ? safeText(registration.startingHoleLabel)
        : registration?.startingHole != null
          ? String(registration.startingHole)
          : "");
    if (hole) rows.push({ label: "Starting hole", value: hole });
  }

  const note = safeText(registration?.notes);
  if (note) rows.push({ label: "Notes on file", value: note });

  if (cat === "golf_tournament" && safeText(links?.leaderboardUrl)) {
    rows.push({ label: "Live leaderboard link", value: links.leaderboardUrl });
  }

  return rows;
}

function buildTextEmail({ subject, rows, replyHint }) {
  const lines = [subject, "", "Thank you for registering.", ""];
  rows.forEach((r) => {
    lines.push(`${r.label}: ${r.value}`);
  });
  if (safeText(replyHint)) {
    lines.push("", `Reply to: ${replyHint}`);
  }
  lines.push("", `— ${DEFAULT_PUBLIC_ORIGIN}`);
  return lines.join("\n");
}

function buildHtmlEmail({ subject, rows, organization, tournament, links, accentHex }) {
  const orgName = safeText(organization?.name);
  const logo =
    safeText(organization?.logoUrl) ||
    safeText(tournament?.heroImageUrl || tournament?.sponsorHeroUrl);
  const accent = /^#[0-9a-fA-F]{6}$/.test(accentHex || "") ? accentHex : "#9a6217";

  const backgroundUrl =
    safeText(tournament?.leaderboardBackgroundUrl) ||
    safeText(tournament?.backgroundImageUrl) ||
    safeText(organization?.leaderboardBackgroundUrl) ||
    safeText(organization?.backgroundImageUrl) ||
    ""; // course.backgroundImageUrl is already merged into organization by enrichment when available

  const backgroundStyles = backgroundUrl
    ? `background-color:#061a2f;background-image:url("${escapeHtml(backgroundUrl)}");background-size:cover;background-position:center;`
    : "background-color:#061a2f;";

  const logoBlock = /^https?:\/\//i.test(logo)
    ? `<div style="margin:0 0 18px 0;text-align:center;">
        <img src="${escapeHtml(logo)}" alt="" width="220" style="width:220px;max-width:220px;height:auto;display:block;margin:0 auto;" />
      </div>`
    : "";

  const faqUrl = safeText(links?.playerInfoUrl);
  const showFaqCta = tournament?.playerInfoEnabled === true && !!faqUrl;

  const detailRowsHtml = (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const label = escapeHtml(r.label);
      const value = escapeHtml(r.value);
      return `
        <div style="padding:16px 16px;border-bottom:1px solid rgba(255,255,255,.10);">
          <div style="font-weight:900;font-size:14px;letter-spacing:.06em;color:rgba(191,199,209,.95);text-transform:uppercase;margin-bottom:8px;">${label}</div>
          <div style="font-weight:700;font-size:20px;line-height:1.35;color:#ffffff;">${value}</div>
        </div>
      `.trim();
    })
    .join("");

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8"/>
    <title>${escapeHtml(subject)}</title>
    <style>
      .headline{ font-size:40px !important; line-height:1.15; font-weight:800; color:#ffffff; margin:0 0 14px 0; }
      .orgName{ font-size:24px !important; font-weight:600; color:#ffffff; margin-bottom:10px; }
      .bodyText{ font-size:18px !important; line-height:1.65; color:rgba(255,255,255,.92); margin:0 0 18px 0; }
      .detailsTitle{ font-weight:900; letter-spacing:.08em; text-transform:uppercase; font-size:14px; color:rgba(191,199,209,.95); margin:18px 0 10px 0; }
      .detailsStack{ background:rgba(6,26,47,.58); border-radius:18px; overflow:hidden; border:1px solid rgba(255,255,255,.14); box-shadow:0 8px 26px rgba(0,0,0,.22); }
      .cta{ background:${escapeHtml(accent)}; color:#ffffff; text-decoration:none; display:inline-block; width:auto; border-radius:18px; padding:18px 18px; font-size:20px; font-weight:700; text-align:center; line-height:1.2; box-shadow:0 6px 18px rgba(0,0,0,.25); }
      .footer{ font-size:12px; color:rgba(191,199,209,.9); margin-top:14px; }
      @media only screen and (max-width: 480px){
        body{ padding:16px !important; }
        .headline{ font-size:32px !important; }
        .bodyText{ font-size:22px !important; }
        .cta{ display:block !important; width:100% !important; padding:18px 16px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.45;color:#222;background:#061a2f;">
    <div style="max-width:560px;margin:0 auto; ${backgroundStyles} position:relative; overflow:hidden; border-radius:18px;">
      <div style="position:absolute;inset:0;background-color:rgba(0,0,0,.55);"></div>
      <div style="position:relative;">
        <div style="height:8px;background:${escapeHtml(accent)};"></div>
        <div class="cardInner" style="padding:28px 24px 22px;background:rgba(6,26,47,.78);border:1px solid rgba(255,255,255,.14);border-top:0;border-radius:0 0 18px 18px;">
          <div class="orgName">${escapeHtml(orgName || "Golf event")}</div>
          ${logoBlock}
          <h1 class="headline">${escapeHtml(subject)}</h1>
          <p class="bodyText">Thank you for registering. Here are your details:</p>

          <div class="detailsTitle">Event Details</div>
          <div class="detailsStack">${detailRowsHtml}</div>

          <p style="margin:16px 0 0 0;font-size:16px;color:rgba(191,199,209,.95);line-height:1.55;">
            If you have questions, reply to this message or use the contact information on the event&apos;s Player Info page when available.
          </p>

          ${
            showFaqCta
              ? `<div style="margin-top:16px;">
                  <a class="cta" href="${escapeHtml(faqUrl)}" target="_blank" rel="noopener noreferrer">View Event FAQ / Player Info</a>
                </div>`
              : ""
          }

          <div class="footer">Presented by ELB Solutions</div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

/**
 * Optional: first course logo + theme accent when tournament references a course.
 * @param {FirebaseFirestore.Firestore} db
 */
async function enrichOrganizationWithCourseBranding(db, orgId, organization, tournament) {
  const o = organization && typeof organization === "object" ? { ...organization } : {};
  const hasLogo = !!safeText(o.logoUrl);
  const hasAnyBackground = !!(safeText(o.leaderboardBackgroundUrl) || safeText(o.backgroundImageUrl));
  if (hasLogo && hasAnyBackground) return o;
  const cid = safeText(tournament?.courseId || tournament?.defaultCourse);
  if (!db || !safeText(orgId) || !cid) return o;
  try {
    const cRef = db
      .collection("organizations")
      .doc(orgId)
      .collection("courses")
      .doc(cid);
    const snap = await cRef.get();
    if (snap.exists) {
      const c = snap.data() || {};
      if (!o.logoUrl && safeText(c.logoUrl)) o.logoUrl = c.logoUrl;
      if (!safeText(o.leaderboardBackgroundUrl) && safeText(c.leaderboardBackgroundUrl)) {
        o.leaderboardBackgroundUrl = c.leaderboardBackgroundUrl;
      }
      if (!safeText(o.backgroundImageUrl) && safeText(c.backgroundImageUrl)) {
        o.backgroundImageUrl = c.backgroundImageUrl;
      }
      if (c.theme && typeof c.theme === "object" && c.theme.primary) {
        o.theme = { ...(o.theme || {}), primary: c.theme.primary };
      }
    }
  } catch (e) {
    console.warn("[enrichOrganizationWithCourseBranding]", e && e.message ? e.message : e);
  }
  return o;
}

/**
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} [opts.orgId]
 * @param {object} [opts.organization] - full org doc; merged with Firestore when omitted
 * @param {object} opts.event - tournament / event document fields
 * @param {object} opts.registration - registration payload (same shape as registerTeam response)
 * @param {object} [opts.links] - { scorecardUrl, leaderboardUrl, playerInfoUrl }
 * @param {string} opts.tournamentId
 * @param {string} opts.registrationId
 * @param {string} [opts.resendApiKey] - RESEND_API_KEY.value() from caller
 * @param {FirebaseFirestore.Firestore} [opts.db]
 */
async function sendEventRegistrationConfirmationEmail({
  to,
  orgId,
  organization,
  event,
  registration,
  links: linksIn,
  tournamentId,
  registrationId,
  resendApiKey,
  db,
}) {
  const recipient = safeText(to);
  if (!recipient) {
    return { ok: false, skipped: true, reason: "no recipient email" };
  }

  if (!resendApiKey) {
    console.warn("[sendEventRegistrationConfirmationEmail] skipped: RESEND_API_KEY not set");
    return { ok: false, skipped: true, reason: "no RESEND_API_KEY" };
  }

  let org = organization;
  const oid = safeText(orgId);
  if ((!org || typeof org !== "object") && oid && db) {
    try {
      const snap = await db.collection("organizations").doc(oid).get();
      org = snap.exists ? snap.data() || {} : {};
    } catch (e) {
      console.error("[sendEventRegistrationConfirmationEmail] org read failed", e);
      org = {};
    }
  } else if (!org || typeof org !== "object") {
    org = {};
  }

  org = await enrichOrganizationWithCourseBranding(db, oid, org, event || {});

  const emailSettings = mergeOrgEmailSettings(org);
  const { from, replyTo } = buildFromAndReply(emailSettings, org);
  const subject = subjectForRegistration(event || {});
  const orgName = safeText(org.name);

  let links =
    linksIn && typeof linksIn === "object"
      ? { ...linksIn }
      : buildEventLinks(oid, tournamentId, registrationId);
  const built = buildEventLinks(oid, tournamentId, registrationId);
  if (!safeText(links.scorecardUrl)) links.scorecardUrl = built.scorecardUrl;
  if (!safeText(links.leaderboardUrl)) links.leaderboardUrl = built.leaderboardUrl;
  if (!safeText(links.playerInfoUrl)) links.playerInfoUrl = built.playerInfoUrl;

  const rows = buildDetailRows({
    organizationName: orgName,
    tournament: event || {},
    registration: registration || {},
    links,
  });

  const themePrimary =
    org.theme && typeof org.theme === "object"
      ? org.theme.primary
      : event && event.theme && typeof event.theme === "object"
        ? event.theme.primary
        : "";
  const accent = safeText(themePrimary);

  const text = buildTextEmail({
    subject,
    rows,
    replyHint: replyTo,
  });
  const html = buildHtmlEmail({
    subject,
    rows,
    organization: org,
    tournament: event || {},
    links,
    accentHex: accent,
  });

  try {
    const resend = new Resend(resendApiKey);
    const payload = {
      from,
      to: recipient,
      subject,
      html,
      text,
    };
    if (replyTo) payload.replyTo = replyTo;

    console.log("attempting confirmation email send");
    console.log("[sendEventRegistrationConfirmationEmail] resend send attempt", {
      to: recipient,
      subject,
      from,
      replyTo: replyTo || null,
    });

    const { data, error } = await resend.emails.send(payload);
    if (error) {
      const errMsg = error && error.message ? error.message : error;
      console.error("[sendEventRegistrationConfirmationEmail] resend failure", errMsg);
      return { ok: false, error: error.message || String(error) };
    }
    console.log("confirmation email sent");
    console.log(
      JSON.stringify({
        fn: "sendEventRegistrationConfirmationEmail",
        ok: true,
        resendId: data && data.id ? data.id : null,
        to: recipient,
        orgId: oid || null,
      })
    );
    console.log("[sendEventRegistrationConfirmationEmail] resend success", {
      resendId: data && data.id ? data.id : null,
      to: recipient,
    });
    return { ok: true, id: data && data.id ? data.id : null };
  } catch (e) {
    console.error(
      "[sendEventRegistrationConfirmationEmail] resend failure",
      e && e.message ? e.message : e
    );
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

module.exports = {
  sendEventRegistrationConfirmationEmail,
  shouldSendRegistrationConfirmationEmail,
  looksLikeRealEmail,
  buildEventLinks,
  buildPlayerInfoUrl,
  mergeOrgEmailSettings,
  buildFromAndReply,
};
