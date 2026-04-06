/**
 * Auto theme from course logo: palette extraction + classic golf UI mapping.
 * Firestore shape: theme: { mode, primary, secondary, accent, surface, text, mutedText, border, buttonBg, buttonText }
 */

/** @type {Readonly<Record<string, string>>} */
export const DEFAULT_SCORECARD_CSS_VARS = {
  "--paper": "#e9e2d4",
  "--ink": "#111111",
  "--muted": "#5c5348",
  "--grid": "#2b2b2b",
  "--headerRow": "#d8d1c3",
  "--parRow": "#a85a13",
  "--parRowText": "#ffffff",
  "--hcpRow": "#f2e6b9",
  "--hcpLabel": "#e9dcaa",
  "--cellBg": "#f8f4ea",
  "--border": "#7a4a0b",
  "--card": "#efe7d7",
  "--chip": "#ffffff55",
  "--navy": "#0d2a55",
  "--navy2": "#0b2246",
  "--green": "#2f6b2f",
  "--danger": "#b6422d",
  "--labelCol": "#e1d8c8",
  "--courseSelectBg": "#e7ddcb",
  "--buttonSecondaryBg": "#e7ddcb",
  "--totalBg": "#f1eadb",
  "--parRowLabel": "#8f4b10",
  "--focusRing": "122, 74, 11",
  "--tickerAccent": "#5c4010",
  "--tickerMuted": "#7a6a4a",
  "--roundWarm": "61, 42, 9",
  "--legalLink": "#3d2a09",
};

function relLum([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const l = (max + min) / 2;
  let s = 0;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: h * 360, s, l };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) {
    rp = c;
    gp = x;
  } else if (h < 120) {
    rp = x;
    gp = c;
  } else if (h < 180) {
    gp = c;
    bp = x;
  } else if (h < 240) {
    gp = x;
    bp = c;
  } else if (h < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return [
    Math.round((rp + m) * 255),
    Math.round((gp + m) * 255),
    Math.round((bp + m) * 255),
  ];
}

function rgbToHex(r, g, b) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToRgb(hex) {
  const s = String(hex || "").replace("#", "").trim();
  if (s.length === 3) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    return [r, g, b];
  }
  if (s.length !== 6) return null;
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/** Favor country-club hues; down-rank neon / oversaturated midtones. */
function upscalePaletteScore(rgb) {
  const { h, s, l } = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (l > 0.97 || l < 0.03) return 0.05;
  let score = 1 - s * 0.9;
  if (h >= 80 && h <= 155) score *= 1.4;
  else if (h >= 25 && h <= 62) score *= 1.22;
  else if (h >= 195 && h <= 248) score *= 1.18;
  else if (h >= 265 && h <= 310) score *= 0.45;
  if (s > 0.62 && l > 0.32 && l < 0.68) score *= 0.15;
  if (s > 0.45 && (h < 20 || h > 330)) score *= 0.35;
  return Math.max(0.05, score);
}

function nudgeHueAwayFromNeon(h, s) {
  let nh = ((h % 360) + 360) % 360;
  if (s < 0.28) return nh;
  if (nh >= 285 && nh <= 330) return 118;
  if (nh >= 330 || nh < 18) return 44;
  if (nh >= 165 && nh < 188) return 122;
  if (nh >= 245 && nh < 265) return 218;
  return nh;
}

/**
 * Deep “club” primary: muted forest, sage, or charcoal-slate — never electric.
 * @param {number} maxS cap (~0.22–0.28)
 */
function refinePrimaryHsl(h, s, l, maxS = 0.26) {
  let nh = nudgeHueAwayFromNeon(h, s);
  let ns = Math.min(s * 0.62, maxS);
  if (nh >= 80 && nh <= 150) ns = Math.min(ns, maxS + 0.02);
  let nl = clamp01(l);
  if (nl > 0.48) nl = 0.26 + (nl - 0.48) * 0.35;
  nl = clamp01(Math.min(Math.max(nl, 0.12), 0.4));
  return { h: nh, s: ns, l: nl };
}

function refineAccentHsl(h, s, l) {
  let nh = nudgeHueAwayFromNeon(h, s);
  if (nh < 22 || nh > 70) nh = 42;
  const ns = Math.min(s * 0.55, 0.28);
  let nl = clamp01(l);
  nl = clamp01(Math.min(Math.max(nl, 0.34), 0.52));
  return { h: nh, s: ns, l: nl };
}

function creamSurfaceFromHue(hPrimary) {
  const warm = hslToRgb(hPrimary, 0.07, 0.94);
  return mixRgb(warm, [252, 250, 244], 0.55);
}

function charcoalText(rgbPrimary) {
  const base = [42, 40, 38];
  return mixRgb(base, rgbPrimary, 0.06);
}

/**
 * Pick dominant colors from ImageData (quantized buckets).
 * @param {ImageData} imageData
 * @returns {Array<[number, number, number]>}
 */
export function extractPaletteFromImageData(imageData, maxColors = 8) {
  const { data, width, height } = imageData;
  const buckets = new Map();
  const step = Math.max(1, Math.floor(Math.min(width, height) / 48));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (Math.floor(y) * width + Math.floor(x)) * 4;
      const a = data[i + 3];
      if (a < 96) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const qr = Math.round(r / 20) * 20;
      const qg = Math.round(g / 20) * 20;
      const qb = Math.round(b / 20) * 20;
      const key = `${qr},${qg},${qb}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
  }

  const sorted = [...buckets.entries()]
    .map(([k, count]) => {
      const [r, g, b] = k.split(",").map(Number);
      const w = count * upscalePaletteScore([r, g, b]);
      return { k, count, r, g, b, w };
    })
    .sort((a, b) => b.w - a.w);

  const out = [];
  const seen = new Set();
  for (const row of sorted) {
    const { r, g, b } = row;
    const lum = relLum([r, g, b]);
    if (lum > 0.97 || lum < 0.03) continue;
    const { s } = rgbToHsl(r, g, b);
    if (s < 0.04 && lum > 0.85) continue;
    const rgb = [r, g, b];
    const sig = rgbToHex(r, g, b);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(rgb);
    if (out.length >= maxColors) break;
  }

  if (out.length < 2) {
    return [
      [52, 72, 58],
      [118, 98, 72],
      [240, 236, 228],
    ];
  }
  return out;
}

/**
 * Build semantic theme object from palette (classic / country-club: muted, readable).
 * @param {Array<[number, number, number]>} palette
 */
export function buildThemeFromPalette(palette) {
  if (!palette || palette.length < 1) {
    return {
      mode: "auto",
      primary: "#3d4f42",
      secondary: "#c9c0b2",
      accent: "#8a7348",
      surface: "#f4f1ea",
      text: "#2a2825",
      mutedText: "#6b645c",
      border: "#6e5e48",
      buttonBg: "#3d5244",
      buttonText: "#f7f6f2",
    };
  }

  const scored = palette.map((rgb) => {
    const { h, s, l } = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    const club =
      upscalePaletteScore(rgb) * (1 - Math.abs(l - 0.38) * 0.35) * (1 - s * 0.25);
    return { rgb, h, s, l, club };
  });

  scored.sort((a, b) => b.club - a.club);

  const pickPrimary = scored.find((x) => x.l < 0.62) || scored[0];
  let ph = rgbToHsl(pickPrimary.rgb[0], pickPrimary.rgb[1], pickPrimary.rgb[2]);
  ph = refinePrimaryHsl(ph.h, ph.s, ph.l, 0.26);
  let primaryRgb = hslToRgb(ph.h, ph.s, ph.l);

  const warmCandidate = scored.find((x) => {
    const { h, s, l } = x;
    return h >= 26 && h <= 68 && s > 0.06 && s < 0.55 && l > 0.22 && l < 0.72;
  });
  let accentRgb;
  if (warmCandidate) {
    const ah = rgbToHsl(warmCandidate.rgb[0], warmCandidate.rgb[1], warmCandidate.rgb[2]);
    const rh = refineAccentHsl(ah.h, ah.s, ah.l);
    accentRgb = hslToRgb(rh.h, rh.s, rh.l);
  } else {
    accentRgb = hslToRgb(42, 0.22, 0.46);
  }
  accentRgb = mixRgb(accentRgb, [118, 108, 88], 0.22);

  let surfaceRgb = creamSurfaceFromHue(ph.h);
  surfaceRgb = mixRgb(surfaceRgb, [255, 254, 250], 0.25);
  const surfLum = relLum(surfaceRgb);
  if (surfLum < 0.88) surfaceRgb = mixRgb(surfaceRgb, [255, 255, 255], 0.4);

  const secondaryRgb = mixRgb(primaryRgb, surfaceRgb, 0.42);

  let textRgb = charcoalText(primaryRgb);
  const mutedRgb = mixRgb(textRgb, surfaceRgb, 0.38);

  let borderRgb = mixRgb(accentRgb, primaryRgb, 0.35);
  borderRgb = mixRgb(borderRgb, [72, 68, 62], 0.35);
  borderRgb = mixRgb(borderRgb, [110, 98, 82], 0.2);

  let buttonBg = mixRgb(primaryRgb, [38, 44, 40], 0.28);
  let bh = rgbToHsl(buttonBg[0], buttonBg[1], buttonBg[2]);
  buttonBg = hslToRgb(bh.h, Math.min(bh.s, 0.24), clamp01(bh.l > 0.42 ? 0.34 : bh.l));

  let buttonText = [247, 246, 242];
  if (contrastRatio(relLum(buttonBg), relLum(buttonText)) < 3.2) {
    buttonText = [34, 32, 30];
  }

  let textFinal = textRgb;
  for (let i = 0; i < 6; i++) {
    const ratio = contrastRatio(relLum(surfaceRgb), relLum(textFinal));
    if (ratio >= 4.2) break;
    textFinal = textFinal.map((c) => Math.max(0, c - 10));
  }

  const primaryHex = rgbToHex(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  const secondaryHex = rgbToHex(secondaryRgb[0], secondaryRgb[1], secondaryRgb[2]);
  const accentHex = rgbToHex(accentRgb[0], accentRgb[1], accentRgb[2]);
  const surfaceHex = rgbToHex(surfaceRgb[0], surfaceRgb[1], surfaceRgb[2]);
  const textHex = rgbToHex(textFinal[0], textFinal[1], textFinal[2]);
  const mutedHex = rgbToHex(
    Math.min(255, mutedRgb[0]),
    Math.min(255, mutedRgb[1]),
    Math.min(255, mutedRgb[2])
  );
  const borderHex = rgbToHex(
    Math.min(255, borderRgb[0]),
    Math.min(255, borderRgb[1]),
    Math.min(255, borderRgb[2])
  );
  const buttonBgHex = rgbToHex(buttonBg[0], buttonBg[1], buttonBg[2]);
  const buttonTextHex = rgbToHex(buttonText[0], buttonText[1], buttonText[2]);

  return {
    mode: "auto",
    primary: primaryHex,
    secondary: secondaryHex,
    accent: accentHex,
    surface: surfaceHex,
    text: textHex,
    mutedText: mutedHex,
    border: borderHex,
    buttonBg: buttonBgHex,
    buttonText: buttonTextHex,
  };
}

function contrastRatio(lumA, lumB) {
  const L1 = Math.max(lumA, lumB);
  const L2 = Math.min(lumA, lumB);
  return (L1 + 0.05) / (L2 + 0.05);
}

/**
 * Map Firestore semantic theme → scorecard CSS variables (readable, golf-card layout).
 * @param {Record<string, string> | null | undefined} theme
 * @returns {Record<string, string>}
 */
export function semanticThemeToScorecardVars(theme) {
  if (!theme || typeof theme !== "object" || !theme.primary) return { ...DEFAULT_SCORECARD_CSS_VARS };

  const P0 = hexToRgb(theme.primary) || [61, 79, 66];
  const S0 = hexToRgb(theme.secondary) || P0;
  const A0 = hexToRgb(theme.accent) || [138, 115, 72];
  const P = (() => {
    const { h, s, l } = rgbToHsl(P0[0], P0[1], P0[2]);
    return hslToRgb(h, Math.min(s, 0.28), l);
  })();
  const S = (() => {
    const { h, s, l } = rgbToHsl(S0[0], S0[1], S0[2]);
    return hslToRgb(h, Math.min(s, 0.2), l);
  })();
  const A = (() => {
    const { h, s, l } = rgbToHsl(A0[0], A0[1], A0[2]);
    return hslToRgb(h, Math.min(s, 0.26), l);
  })();
  const surf = hexToRgb(theme.surface) || [244, 241, 234];
  const ink = hexToRgb(theme.text) || [42, 40, 38];
  const muted = hexToRgb(theme.mutedText) || mixRgb(ink, surf, 0.35);
  const border = hexToRgb(theme.border) || A;
  const btnBg = hexToRgb(theme.buttonBg) || mixRgb(P, [40, 50, 60], 0.25);
  const btnTx = hexToRgb(theme.buttonText) || [255, 255, 255];

  const card = mixRgb(surf, [255, 255, 255], 0.08);
  const headerRow = mixRgb(S, surf, 0.5);
  const parRow = mixRgb(A, P, 0.38);
  const parRowHsl = rgbToHsl(parRow[0], parRow[1], parRow[2]);
  const parRowFinal = hslToRgb(
    parRowHsl.h,
    Math.min(parRowHsl.s, 0.28),
    clamp01(parRowHsl.l > 0.52 ? 0.4 : parRowHsl.l)
  );
  const parText =
    contrastRatio(relLum(parRowFinal), relLum(btnTx)) >= 3 ? btnTx : [255, 255, 255];

  const parRowLabel = mixRgb(parRowFinal, [0, 0, 0], 0.12);

  const hcpRow = mixRgb(mixRgb(A, surf, 0.2), [255, 248, 230], 0.55);
  const cellBg = mixRgb(surf, [255, 255, 255], 0.35);
  const navy = mixRgb(P, [10, 20, 40], 0.15);
  const navy2 = mixRgb(navy, [0, 0, 0], 0.12);
  const grid = mixRgb(ink, surf, 0.78);
  const labelCol = mixRgb(headerRow, surf, 0.35);
  const greenFair = mixRgb(mixRgb(P, [52, 72, 58], 0.5), [56, 68, 58], 0.45);

  const focusRgb = mixRgb(border, A, 0.5);

  const out = {
    ...DEFAULT_SCORECARD_CSS_VARS,
    "--paper": theme.surface || DEFAULT_SCORECARD_CSS_VARS["--paper"],
    "--ink": rgbToHex(ink[0], ink[1], ink[2]),
    "--muted": rgbToHex(muted[0], muted[1], muted[2]),
    "--grid": rgbToHex(grid[0], grid[1], grid[2]),
    "--headerRow": rgbToHex(headerRow[0], headerRow[1], headerRow[2]),
    "--parRow": rgbToHex(parRowFinal[0], parRowFinal[1], parRowFinal[2]),
    "--parRowLabel": rgbToHex(parRowLabel[0], parRowLabel[1], parRowLabel[2]),
    "--parRowText": rgbToHex(parText[0], parText[1], parText[2]),
    "--hcpRow": rgbToHex(
      Math.min(255, hcpRow[0]),
      Math.min(255, hcpRow[1]),
      Math.min(255, hcpRow[2])
    ),
    "--hcpLabel": rgbToHex(
      Math.min(255, mixRgb(hcpRow, border, 0.15)[0]),
      Math.min(255, mixRgb(hcpRow, border, 0.15)[1]),
      Math.min(255, mixRgb(hcpRow, border, 0.15)[2])
    ),
    "--cellBg": rgbToHex(
      Math.min(255, cellBg[0]),
      Math.min(255, cellBg[1]),
      Math.min(255, cellBg[2])
    ),
    "--border": theme.border || DEFAULT_SCORECARD_CSS_VARS["--border"],
    "--card": rgbToHex(card[0], card[1], card[2]),
    "--navy": rgbToHex(navy[0], navy[1], navy[2]),
    "--navy2": rgbToHex(navy2[0], navy2[1], navy2[2]),
    "--green": rgbToHex(
      Math.min(255, greenFair[0]),
      Math.min(255, greenFair[1]),
      Math.min(255, greenFair[2])
    ),
    "--labelCol": rgbToHex(labelCol[0], labelCol[1], labelCol[2]),
    "--courseSelectBg": rgbToHex(
      mixRgb(headerRow, surf, 0.35)[0],
      mixRgb(headerRow, surf, 0.35)[1],
      mixRgb(headerRow, surf, 0.35)[2]
    ),
    "--buttonSecondaryBg": rgbToHex(
      mixRgb(card, border, 0.12)[0],
      mixRgb(card, border, 0.12)[1],
      mixRgb(card, border, 0.12)[2]
    ),
    "--totalBg": rgbToHex(
      mixRgb(cellBg, surf, 0.4)[0],
      mixRgb(cellBg, surf, 0.4)[1],
      mixRgb(cellBg, surf, 0.4)[2]
    ),
    "--focusRing": `${focusRgb[0]}, ${focusRgb[1]}, ${focusRgb[2]}`,
    "--tickerAccent": rgbToHex(
      mixRgb(ink, A, 0.25)[0],
      mixRgb(ink, A, 0.25)[1],
      mixRgb(ink, A, 0.25)[2]
    ),
    "--tickerMuted": rgbToHex(muted[0], muted[1], muted[2]),
    "--roundWarm": `${Math.round(mixRgb(ink, A, 0.2)[0])}, ${Math.round(mixRgb(ink, A, 0.2)[1])}, ${Math.round(mixRgb(ink, A, 0.2)[2])}`,
    "--legalLink": rgbToHex(
      mixRgb(ink, border, 0.22)[0],
      mixRgb(ink, border, 0.22)[1],
      mixRgb(ink, border, 0.22)[2]
    ),
  };

  return out;
}

/**
 * Apply theme to document root (scorecard page). Pass null/undefined to reset to defaults.
 * @param {Record<string, string> | null | undefined} themeFirestore
 */
export function applyScorecardTheme(themeFirestore) {
  const root = document.documentElement;
  const vars = semanticThemeToScorecardVars(themeFirestore);
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  const border = vars["--border"] || "#7a4a0b";
  if (meta) meta.setAttribute("content", border);
}

/** Alias — same as {@link applyScorecardTheme}. */
export const applyTheme = applyScorecardTheme;

function loadImageSrc(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!String(url).startsWith("blob:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = url;
  });
}

/**
 * Draw image to canvas and return ImageData.
 * @param {HTMLImageElement} img
 */
export function imageToImageData(img, maxSide = 128) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const scale = maxSide / Math.max(w, h);
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, cw, ch);
  return ctx.getImageData(0, 0, cw, ch);
}

/**
 * @param {string} url
 * @returns {Promise<Record<string, string>>}
 */
export async function generateThemeFromLogoUrl(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  try {
    const img = await loadImageSrc(u);
    const idata = imageToImageData(img);
    if (!idata) return null;
    const palette = extractPaletteFromImageData(idata);
    return buildThemeFromPalette(palette);
  } catch (e) {
    console.warn("[course-theme] generateThemeFromLogoUrl", e);
    return null;
  }
}

/**
 * @param {File} file
 * @returns {Promise<Record<string, string>>}
 */
export async function generateThemeFromLogoFile(file) {
  if (!file || !file.type.startsWith("image/")) return null;
  const objUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageSrc(objUrl);
    const idata = imageToImageData(img);
    if (!idata) return null;
    const palette = extractPaletteFromImageData(idata);
    return buildThemeFromPalette(palette);
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}
