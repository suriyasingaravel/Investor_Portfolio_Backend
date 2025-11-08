// lib/xlsx-portfolio.js
const XLSX = require("xlsx");
const { normalizeItemSymbolExchange, isNumericSymbol } = require("./symbols");

/* ---------- header helpers ---------- */
function normalizeHeader(raw) {
  const h = String(raw || "")
    .trim()
    .toLowerCase();

  if (["particulars", "stock name", "scrip", "name"].includes(h))
    return "particulars";
  if (h === "purchase price" || /purchase.*price/.test(h))
    return "purchasePrice";
  if (h === "qty" || h === "quantity") return "qty";
  if (
    h.includes("nse/bse") ||
    h.includes("nse") ||
    h.includes("bse") ||
    h.includes("exchange")
  )
    return "nseBse";

  if (h === "cmp") return "cmp";
  if (h === "present value") return "presentValue";
  if (h.startsWith("gain/loss")) return "gainLoss";
  if (h.includes("p/e")) return "pe";
  if (h.includes("latest earnings") || h.includes("eps"))
    return "latestEarnings";

  return null;
}

function findHeaderRow(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r] || [];
    const map = {};
    row.forEach((cell, idx) => {
      const k = normalizeHeader(cell);
      if (k) map[k] = idx;
    });
    if (
      map.particulars != null &&
      map.purchasePrice != null &&
      map.qty != null
    ) {
      return { headerIndex: r, headerMap: map };
    }
  }
  return null;
}

/* ---------- section detection (strict) ---------- */

// exact/whole-word sector names we accept
const KNOWN_SECTORS = [
  "Financial Sector",
  "Financial",
  "Tech Sector",
  "Tech",
  "Consumer Sector",
  "Consumer",
  "Power Sector",
  "Power",
  "Pipe Sector",
  "Pipes Sector",
  "Pipes",
  "Pipe",
  "Others",
  "Other",
];

// map variants to canonical labels
function normalizeSectorName(name) {
  if (!name) return "Others";
  const t = String(name).trim();

  const low = t.toLowerCase();
  if (/(^others?$|^misc)/i.test(t)) return "Others";

  // canonicalize common variants
  if (/^financial( sector)?$/i.test(t)) return "Financial Sector";
  if (/^tech( sector)?$/i.test(t)) return "Tech Sector";
  if (/^consumer( sector)?$/i.test(t)) return "Consumer Sector";
  if (/^power( sector)?$/i.test(t)) return "Power Sector";
  if (/^(pipe(s)?( sector)?)$/i.test(t)) return "Pipe Sector";

  // if it literally ends with "Sector", accept as-is
  if (/\bSector$/i.test(t)) return t;

  // fallback
  return "Others";
}

function isBlank(v) {
  return v == null || String(v).trim() === "";
}

// “whole title” match (not substring). Also allow things that end with “Sector”.
function isSectorTitle(text) {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (!t || t.length > 60) return false;

  // exact match against list
  if (KNOWN_SECTORS.some((s) => s.toLowerCase() === t.toLowerCase()))
    return true;

  // or ends with the word "Sector"
  if (/\bSector$/i.test(t)) return true;

  return false;
}

function looksLikeSectionRow(row, headerMap) {
  const pIdx = headerMap.particulars;
  if (pIdx == null) return false;

  const title = row[pIdx];
  if (!isSectorTitle(title)) return false;

  // must have key numeric columns empty to qualify as a header row
  const priceEmpty = isBlank(row[headerMap.purchasePrice]);
  const qtyEmpty = isBlank(row[headerMap.qty]);
  const exEmpty =
    headerMap.nseBse == null ? true : isBlank(row[headerMap.nseBse]);

  return priceEmpty && qtyEmpty && exEmpty;
}

/* ---------- numeric ---------- */
function toNumber(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- main parse ---------- */
function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
    if (!rows.length) continue;

    const found = findHeaderRow(rows);
    if (!found) continue;

    const { headerIndex, headerMap } = found;
    const dataRows = rows.slice(headerIndex + 1);

    const parsed = [];
    let currentSector = "Others"; // default bucket

    for (const r of dataRows) {
      if (!r || r.length === 0) continue;

      // 1) Sector header detection (STRICT)
      if (looksLikeSectionRow(r, headerMap)) {
        currentSector = normalizeSectorName(r[headerMap.particulars]);
        continue;
      }

      const get = (k) => (headerMap[k] != null ? r[headerMap[k]] : undefined);

      const particulars = get("particulars");
      const price = get("purchasePrice");
      const qty = get("qty");
      const nseBseCell = get("nseBse");

      // Skip totals/separators/empty
      if (
        isBlank(particulars) ||
        /^total/i.test(String(particulars)) ||
        (isBlank(price) && isBlank(qty))
      ) {
        continue;
      }

      // 2) Build symbol/exchange
      const rawSymbol = !isBlank(nseBseCell)
        ? String(nseBseCell).trim()
        : String(particulars).trim();

      const exchangeGuess = isNumericSymbol(rawSymbol) ? "BSE" : "NSE";
      const { symbol, exchange } = normalizeItemSymbolExchange({
        symbol: rawSymbol,
        exchange: exchangeGuess,
      });

      parsed.push({
        particulars: String(particulars).trim(),
        symbol,
        exchange,
        purchasePrice: toNumber(price),
        qty: toNumber(qty),
        sector: normalizeSectorName(currentSector),
      });
    }

    return {
      rows: parsed,
      meta: { sheetName, headerIndex, headerMap },
    };
  }

  return { rows: [], meta: { reason: "no_sheet_with_valid_header" } };
}

/* ---------- portfolio transform ---------- */
function transformRows(rows) {
  const cleaned = rows.map((r) => {
    const investment = (r.purchasePrice || 0) * (r.qty || 0);
    // ensure sector safety
    const sector = normalizeSectorName(r.sector);
    return { ...r, sector, investment };
  });

  const totalInvestment = cleaned.reduce(
    (acc, x) => acc + (x.investment || 0),
    0
  );

  cleaned.forEach((x) => {
    x.portfolioPct = totalInvestment
      ? (x.investment / totalInvestment) * 100
      : 0;
  });

  const sectors = {};
  for (const h of cleaned) {
    const key = normalizeSectorName(h.sector);
    if (!sectors[key]) {
      sectors[key] = { sector: key, totalInvestment: 0, holdings: [] };
    }
    sectors[key].holdings.push(h);
    sectors[key].totalInvestment += h.investment;
  }

  return {
    totalInvestment,
    holdings: cleaned,
    sectors: Object.values(sectors),
    ts: Date.now(),
  };
}

module.exports = { parseExcel, transformRows };
