/**
 * Parse CSV / Excel matrices for roster & admin import flows.
 * Excel path expects global `window.XLSX` (SheetJS) loaded before use.
 */

/**
 * @param {string} csvText
 * @returns {string[][]}
 */
export function parseCsvText(csvText) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const text = String(csvText || "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell.trim());
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && next === "\n") i += 1;
        row.push(cell.trim());
        cell = "";
        if (row.some((v) => String(v || "").trim() !== "")) rows.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
  }
  row.push(cell.trim());
  if (row.some((v) => String(v || "").trim() !== "")) rows.push(row);
  return rows;
}

/**
 * @param {unknown[][]} matrix
 * @returns {{ headers: string[], rows: Record<string, string>[] }}
 */
export function buildHeadersAndRowsFromMatrix(matrix) {
  const headerRow = Array.isArray(matrix?.[0]) ? matrix[0] : [];
  const headerMeta = [];
  const used = new Set();

  headerRow.forEach((rawHeader, idx) => {
    let header = String(rawHeader || "").trim();
    if (!header) header = `Column ${idx + 1}`;
    let uniqueHeader = header;
    let suffix = 2;
    while (used.has(uniqueHeader.toLowerCase())) {
      uniqueHeader = `${header} (${suffix})`;
      suffix += 1;
    }
    used.add(uniqueHeader.toLowerCase());
    headerMeta.push({ index: idx, key: uniqueHeader });
  });

  const headers = headerMeta.map((h) => h.key);
  const rows = matrix
    .slice(1)
    .map((arr) => {
      const row = {};
      headerMeta.forEach(({ index, key }) => {
        row[key] = String(arr?.[index] ?? "").trim();
      });
      return row;
    })
    .filter((r) => Object.values(r).some((v) => String(v || "").trim()));

  return { headers, rows };
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {unknown[][]}
 */
export function parseSpreadsheetFromArrayBuffer(buffer) {
  if (!globalThis.window?.XLSX) throw new Error("Spreadsheet parser not loaded.");
  const wb = globalThis.window.XLSX.read(buffer, { type: "array" });
  const firstSheetName = Array.isArray(wb.SheetNames) ? wb.SheetNames[0] : "";
  if (!firstSheetName) return [];
  const ws = wb.Sheets[firstSheetName];
  const matrix = globalThis.window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  return Array.isArray(matrix) ? matrix : [];
}

function parseCsvFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read CSV file"));
    reader.readAsText(file);
  });
}

function parseExcelFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read Excel file"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * @param {File} file
 * @returns {Promise<unknown[][]>}
 */
export async function parseImportMatrixFromFile(file) {
  const lower = String(file?.name || "").toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = await parseCsvFromFile(file);
    return parseCsvText(text);
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const buffer = await parseExcelFromFile(file);
    return parseSpreadsheetFromArrayBuffer(buffer);
  }
  throw new Error("Unsupported file type. Please upload .csv, .xlsx, or .xls.");
}
