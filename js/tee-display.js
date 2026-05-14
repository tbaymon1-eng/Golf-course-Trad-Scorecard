/**
 * Tee box label for placards, scorecard, and roster display.
 * Source of truth: registration.playingTee (override) then tournament.defaultTee.
 * Legacy fields are read-only fallbacks for older data.
 */
export function resolveRegistrationTeeBoxDisplay(reg, tournamentMeta) {
  const ov = String(reg?.playingTee ?? "").trim();
  if (ov) return ov;
  const dt = String(tournamentMeta?.defaultTee ?? "").trim();
  if (dt) return dt;
  return String(
    reg?.teeName || reg?.tee || reg?.teeColor || reg?.mensTee || reg?.menTee || ""
  )
    .trim();
}
