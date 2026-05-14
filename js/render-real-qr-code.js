/**
 * Single entry point for scannable QR codes (qrcodejs).
 * Loads global QRCode from a page script tag:
 * https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js
 *
 * Never draws decorative / fake QR patterns. On failure, shows plain text fallback.
 */

/**
 * @param {HTMLElement|null|undefined|string} container
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.qrType] Logical name for debugging (e.g. "admin-registration")
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {number|string} [options.correctLevel] QRCode.CorrectLevel.* or L|M|Q|H
 */
export function renderRealQrCode(container, url, options = {}) {
  const el =
    typeof container === "string"
      ? document.getElementById(container)
      : container;
  if (!el) return false;

  el.innerHTML = "";

  const u = String(url || "").trim();
  const qrType = String(options.qrType || "qr").trim();

  console.log("QR encode", { type: qrType, url: u });

  if (!u) {
    showQrPlainFallback(el, "", "missing-url");
    return false;
  }

  if (!/^https?:\/\//i.test(u)) {
    showQrPlainFallback(el, "", "missing-url");
    return false;
  }

  const QR = typeof globalThis !== "undefined" ? globalThis.QRCode : undefined;
  if (!QR) {
    console.warn("[renderRealQrCode] QRCode missing (include qrcodejs before module)", {
      qrType,
    });
    showQrPlainFallback(el, u, "missing-library");
    return false;
  }

  const width = Number(options.width) > 0 ? Number(options.width) : 220;
  const height = Number(options.height) > 0 ? Number(options.height) : 220;
  let correctLevel =
    QR.CorrectLevel != null ? QR.CorrectLevel.H : undefined;
  if (QR.CorrectLevel != null && options.correctLevel != null) {
    const cl = options.correctLevel;
    if (typeof cl === "number") {
      correctLevel = cl;
    } else {
      const map = QR.CorrectLevel;
      const key = String(cl).trim().toUpperCase();
      if (key === "L") correctLevel = map.L;
      else if (key === "M") correctLevel = map.M;
      else if (key === "Q") correctLevel = map.Q;
      else if (key === "H") correctLevel = map.H;
    }
  }

  try {
    new QR(el, {
      text: u,
      width,
      height,
      correctLevel: correctLevel ?? QR.CorrectLevel.H,
    });
    return true;
  } catch (e) {
    console.error("[renderRealQrCode] generation failed", { qrType, error: e });
    showQrPlainFallback(el, u, "generation-error");
    return false;
  }
}

/** @param {"missing-url"|"missing-library"|"generation-error"|""} kind */
function showQrPlainFallback(el, url, kind) {
  const wrap = document.createElement("div");
  wrap.className = "real-qr-fallback-text";
  wrap.style.whiteSpace = "pre-wrap";
  wrap.style.wordBreak = "break-all";
  wrap.style.fontSize = "12px";
  wrap.style.lineHeight = "1.35";
  wrap.style.padding = "10px";
  wrap.style.border = "1px dashed #cfcfcf";
  wrap.style.borderRadius = "8px";
  wrap.style.background = "#fafafa";
  wrap.style.color = "#333";
  wrap.style.margin = "0 auto";
  wrap.style.boxSizing = "border-box";

  const u = String(url || "").trim();
  if (!u) {
    if (kind === "missing-library") {
      wrap.textContent =
        "QR library did not load. Refresh the page, or copy the link beside this card.";
    } else {
      wrap.textContent = "No link URL is configured for this QR code yet.";
    }
    el.appendChild(wrap);
    return;
  }

  if (kind === "missing-library") {
    wrap.textContent =
      "QR could not render (library missing). Use this URL instead:\n\n" + u;
  } else {
    wrap.textContent =
      "QR could not be generated. Scan is not available from this preview. Use this URL instead:\n\n" +
      u;
  }
  el.appendChild(wrap);
}
