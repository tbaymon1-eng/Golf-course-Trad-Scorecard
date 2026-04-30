/**
 * Derive tee row + header colors from a scorecard image (client-side canvas sampling).
 * Does not replace course identity — only suggests teeColors / scorecardRowColors / accents.
 */
import { extractPaletteFromImageData, imageToImageData } from "./course-theme.js";

export const CANONICAL_TEE_HEX = {
  Gold: "#c9a74a",
  Blue: "#1f4e8c",
  White: "#f0efe8",
  Red: "#b23a3a",
};

const DEFAULT_ROW = {
  header: "#111111",
  Par: "#3f6f57",
  Handicap: "#f2f0ea",
};

const DEFAULT_PRIMARY = "#12356f";
const DEFAULT_ACCENT = "#9a6217";
const COLOR_SAMPLE_WIDTH = 220;

function hexToRgb(hex) {
  const s = String(hex || "")
    .replace("#", "")
    .trim();
  if (s.length === 3) {
    return [
      parseInt(s[0] + s[0], 16),
      parseInt(s[1] + s[1], 16),
      parseInt(s[2] + s[2], 16),
    ];
  }
  if (s.length !== 6) return [17, 17, 17];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  const h = (n) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function relLum([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function pickContrastTextForBackground(bgHex) {
  const rgb = hexToRgb(bgHex);
  return relLum(rgb) > 0.45 ? "#1a1a1a" : "#f5f5f2";
}

function mixRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Map a user-facing tee label to a canonical family (Gold / Blue / White / Red).
 * @returns {keyof typeof CANONICAL_TEE_HEX | null}
 */
export function mapTeeLabelToFamily(label) {
  const t = String(label || "")
    .trim()
    .toLowerCase();
  if (!t) return null;
  if (/\bgold|gld|champ|championship|backs?|tan|copper|bronze|yellow/i.test(t)) return "Gold";
  if (/\bblue|navy|lakes?|member/i.test(t) || t === "b" || t === "blue" || t === "navy") return "Blue";
  if (/\bwhite|ladies|forward|stone|silver|pine|oak|regular|family|front nine|front\b/i.test(t) || t === "w")
    return "White";
  if (/\bred|executive|senior|orange|crimson/i.test(t) || t === "r" || t === "red") return "Red";
  if (/\bblack|tips?|tournament/i.test(t)) return "Blue";
  return null;
}

export function normalizeTeeColorKey(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function nearestFamilyHex(rgb) {
  let best = "Gold";
  let bestD = 1e9;
  for (const [k, hx] of Object.entries(CANONICAL_TEE_HEX)) {
    const t = hexToRgb(hx);
    const d = (rgb[0] - t[0]) ** 2 + (rgb[1] - t[1]) ** 2 + (rgb[2] - t[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return mixRgb(rgb, hexToRgb(CANONICAL_TEE_HEX[best]), 0.5);
}

function hslSaturation([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 510;
  const d = (max - min) / 255;
  return l > 0.5 ? d / (2 - 2 * l) : d / (2 * l);
}

function weightedColorForRow(imageData, y, x0, x1) {
  const { data, width, height } = imageData;
  const yy = Math.max(0, Math.min(height - 1, y));
  let wr = 0;
  let wg = 0;
  let wb = 0;
  let wsum = 0;
  for (let x = x0; x <= x1; x += 1) {
    const i = (yy * width + x) * 4;
    const a = data[i + 3] / 255;
    if (a < 0.9) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const sat = hslSaturation(rgb);
    const lum = relLum(rgb);
    if (sat < 0.12) continue;
    if (lum < 0.04 || lum > 0.96) continue;
    const weight = Math.max(0.05, sat * 1.5 + (1 - Math.abs(0.48 - lum)));
    wr += rgb[0] * weight;
    wg += rgb[1] * weight;
    wb += rgb[2] * weight;
    wsum += weight;
  }
  if (wsum <= 0.001) return null;
  return [wr / wsum, wg / wsum, wb / wsum];
}

function colorDistanceSq(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function extractRowBands(imageData, wantedRows) {
  const w = imageData.width;
  const h = imageData.height;
  if (!w || !h || wantedRows < 1) return [];
  const left = Math.max(0, Math.floor(w * 0.22));
  const right = Math.min(w - 1, Math.floor(w * 0.95));
  const sampled = [];
  for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.93); y += 1) {
    const c = weightedColorForRow(imageData, y, left, right);
    if (!c) continue;
    sampled.push({ y, rgb: c, sat: hslSaturation(c) });
  }
  if (!sampled.length) return [];

  const bands = [];
  let cur = { y0: sampled[0].y, y1: sampled[0].y, rgb: sampled[0].rgb, sat: sampled[0].sat, n: 1 };
  for (let i = 1; i < sampled.length; i += 1) {
    const p = sampled[i];
    const prevY = sampled[i - 1].y;
    const contig = p.y === prevY + 1;
    const similar = colorDistanceSq(cur.rgb, p.rgb) < 1500;
    if (contig && similar) {
      cur.y1 = p.y;
      cur.n += 1;
      const t = 1 / cur.n;
      cur.rgb = mixRgb(cur.rgb, p.rgb, t);
      cur.sat = cur.sat * (1 - t) + p.sat * t;
    } else {
      bands.push(cur);
      cur = { y0: p.y, y1: p.y, rgb: p.rgb, sat: p.sat, n: 1 };
    }
  }
  bands.push(cur);

  const ranked = bands
    .map((b) => {
      const height = b.y1 - b.y0 + 1;
      const lum = relLum(b.rgb);
      const score = height * (0.35 + b.sat) * (lum > 0.06 && lum < 0.94 ? 1.15 : 0.6);
      return { ...b, score };
    })
    .filter((b) => b.n >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(wantedRows + 4, 8))
    .sort((a, b) => a.y0 - b.y0);

  const merged = [];
  for (const b of ranked) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push(b);
      continue;
    }
    const gap = b.y0 - last.y1;
    const similar = colorDistanceSq(last.rgb, b.rgb) < 1400;
    if (gap <= 2 && similar) {
      last.y1 = b.y1;
      last.n += b.n;
      const t = b.n / last.n;
      last.rgb = mixRgb(last.rgb, b.rgb, t);
      last.score += b.score;
    } else {
      merged.push(b);
    }
  }

  return merged.slice(0, Math.max(wantedRows, 1));
}

function mapBandsToTeeNames(bands, teeNames) {
  const out = {};
  if (!Array.isArray(teeNames) || !teeNames.length || !bands.length) return out;
  const names = teeNames.map((x) => String(x || "").trim()).filter(Boolean);
  if (!names.length) return out;

  const picks = [];
  const step = bands.length / names.length;
  for (let i = 0; i < names.length; i += 1) {
    const idx = Math.min(bands.length - 1, Math.max(0, Math.floor(i * step)));
    picks.push(bands[idx]);
  }

  for (let i = 0; i < names.length; i += 1) {
    const label = names[i];
    const key = normalizeTeeColorKey(label) || label;
    const b = picks[i];
    const fam = mapTeeLabelToFamily(label);
    let rgb = b ? b.rgb : hexToRgb(fam ? CANONICAL_TEE_HEX[fam] : CANONICAL_TEE_HEX.Gold);
    if (fam) {
      rgb = mixRgb(rgb, hexToRgb(CANONICAL_TEE_HEX[fam]), 0.28);
    }
    out[key] = rgbToHex(rgb[0], rgb[1], rgb[2]);
  }
  return out;
}

/**
 * @param {ImageData} imageData
 * @param {string[]} teeSetNames
 * @returns {{ teeColors: Record<string,string>, scorecardRowColors: Record<string,string>, primaryColor: string, accentColor: string, confidence: number }}
 */
export function buildBrandingFromImageData(imageData, teeSetNames) {
  const names = Array.isArray(teeSetNames)
    ? teeSetNames.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const palette = extractPaletteFromImageData(imageData, 10);
  const L = (rgb) => relLum(rgb);

  const sortedDark = [...palette].filter((c) => L(c) < 0.42).sort((a, b) => L(a) - L(b));
  const sortedLight = [...palette].filter((c) => L(c) > 0.78).sort((a, b) => L(b) - L(a));
  const dark = sortedDark[0] || [18, 20, 24];
  const light = sortedLight[0] || [245, 244, 240];

  let confidence = 0.4;
  if (palette.length >= 4) confidence += 0.15;
  if (sortedDark.length && sortedLight.length) confidence += 0.2;
  if (names.length >= 1 && names.length <= 8) confidence += 0.1;
  confidence = Math.min(0.92, confidence);

  const rowBands = extractRowBands(imageData, Math.max(1, names.length));
  const teeColors = mapBandsToTeeNames(rowBands, names);
  if (!Object.keys(teeColors).length) {
    let pi = 0;
    for (const label of names) {
      const key = normalizeTeeColorKey(label) || label;
      const fam = mapTeeLabelToFamily(label);
      const sample = palette[pi % Math.max(1, palette.length)] || [90, 85, 75];
      pi++;
      let rgb;
      if (fam) {
        const target = hexToRgb(CANONICAL_TEE_HEX[fam]);
        rgb = confidence < 0.55 ? target : mixRgb(sample, target, fam === "White" ? 0.55 : 0.62);
      } else {
        rgb = nearestFamilyHex(sample);
      }
      if (confidence < 0.5) {
        const k = fam || "Gold";
        rgb = mixRgb(rgb, hexToRgb(CANONICAL_TEE_HEX[k] || CANONICAL_TEE_HEX.Gold), 0.45);
      }
      teeColors[key] = rgbToHex(rgb[0], rgb[1], rgb[2]);
    }
  }

  const headerRgb = mixRgb(dark, [10, 10, 12], 0.35);
  const headerHex = rgbToHex(headerRgb[0], headerRgb[1], headerRgb[2]);
  const parRgb = mixRgb(
    palette.find((c) => {
      const { h, s, l } = rgbToHsl(c[0], c[1], c[2]);
      return s > 0.08 && h >= 90 && h <= 160 && l > 0.15 && l < 0.55;
    }) || hexToRgb(DEFAULT_ROW.Par),
    hexToRgb(DEFAULT_ROW.Par),
    confidence < 0.5 ? 0.85 : 0.4
  );
  const parHex = rgbToHex(parRgb[0], parRgb[1], parRgb[2]);
  const hcpRgb = mixRgb(light, hexToRgb(DEFAULT_ROW.Handicap), 0.5);
  const hcpHex = rgbToHex(hcpRgb[0], hcpRgb[1], hcpRgb[2]);

  const scorecardRowColors = {
    ...DEFAULT_ROW,
    header: headerHex,
    Par: parHex,
    Handicap: hcpHex,
  };
  Object.assign(scorecardRowColors, teeColors);

  const primaryHex =
    confidence < 0.45 ? DEFAULT_PRIMARY : rgbToHex(mixRgb(dark, hexToRgb(DEFAULT_PRIMARY), 0.35));
  const warm = palette.find((c) => {
    const { h, s } = rgbToHsl(c[0], c[1], c[2]);
    return h >= 30 && h <= 55 && s > 0.12;
  });
  const accentHex =
    confidence < 0.45
      ? DEFAULT_ACCENT
      : rgbToHex(mixRgb(warm || hexToRgb(DEFAULT_ACCENT), hexToRgb(DEFAULT_ACCENT), 0.4));

  return {
    teeColors,
    scorecardRowColors,
    primaryColor: primaryHex,
    accentColor: accentHex,
    confidence,
  };
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

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!String(src).startsWith("blob:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}

/**
 * @param {File} file
 * @param {string[]} teeSetNames
 */
export async function suggestBrandingFromScorecardFile(file, teeSetNames) {
  if (!file || !String(file.type || "").startsWith("image/")) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const idata = imageToImageData(img, 160);
    if (!idata) return null;
    return buildBrandingFromImageData(idata, teeSetNames);
  } catch (e) {
    console.warn("[scorecard-extract-branding] file", e);
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {string} url
 * @param {string[]} teeSetNames
 */
export async function suggestBrandingFromScorecardUrl(url, teeSetNames) {
  const u = String(url || "").trim();
  if (!u) return null;
  try {
    const img = await loadImageElement(u);
    const idata = imageToImageData(img, 160);
    if (!idata) return null;
    return buildBrandingFromImageData(idata, teeSetNames);
  } catch (e) {
    console.warn("[scorecard-extract-branding] url", e);
    return null;
  }
}
