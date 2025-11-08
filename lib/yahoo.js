// lib/yahoo.js
const YahooFinance = require("yahoo-finance2").default;
const { LRUCache } = require("lru-cache");
const Bottleneck = require("bottleneck");
const { request } = require("undici");

const yf = new YahooFinance();

// Rate-limit Yahoo search & optional verify-quote calls
const searchLimiter = new Bottleneck({ minTime: 300 });
const verifyLimiter = new Bottleneck({ minTime: 200 });

// 24h in-memory cache
const symbolMapCache = new LRUCache({ max: 2000, ttl: 24 * 60 * 60 * 1000 });

function isBO(sym) {
  return typeof sym === "string" && sym.toUpperCase().endsWith(".BO");
}

function scoreCandidate(q) {
  let s = 0;
  const sym = (q.symbol || "").toUpperCase();
  const ex = (
    q.exchange ||
    q.primaryExchange ||
    q.exchangeDisp ||
    ""
  ).toUpperCase();
  const reg = (q.region || "").toUpperCase();
  if (sym.endsWith(".BO")) s += 5;
  if (ex.includes("BSE")) s += 3;
  if (reg === "IN") s += 1;
  if (q.quoteType === "EQUITY") s += 1;
  return s;
}

async function yahooSearchOnce(query) {
  const result = await searchLimiter.schedule(() => yf.search(query));
  return Array.isArray(result?.quotes) ? result.quotes : [];
}

/* ----------------------- BSE Security ID helpers ----------------------- */

async function fetchText(url) {
  const { body } = await request(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome Safari",
      accept: "text/html,application/xhtml+xml",
    },
  });
  return body.text();
}

/**
 * Try to extract Security ID from the BSE MOBILE page
 *   https://m.bseindia.com/StockReach.aspx?scripcd=<code>
 */
async function tryMobileSecurityId(code) {
  const url = `https://m.bseindia.com/StockReach.aspx?scripcd=${encodeURIComponent(
    code
  )}`;
  const html = await fetchText(url);

  // Variants I've seen across devices/layouts
  const patterns = [
    /Security\s*ID\s*<\/?\w*>\s*([A-Z0-9.-]+)/i,
    /Security\s*ID\s*[:\s]*([A-Z0-9.-]+)/i,
    /Scrip\s*ID\s*[:\s]*([A-Z0-9.-]+)/i,
    // sometimes the "Security ID" appears next to "Security Code"
    /Security\s*Code\s*[:\s]*\d+\s*[\s\S]{0,120}?Security\s*ID\s*[:\s]*([A-Z0-9.-]+)/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].trim().toUpperCase();
  }
  return null;
}

/**
 * Try to extract Security ID from the BSE DESKTOP company info page
 *   https://www.bseindia.com/stock-share-price/stockreach_company_info.aspx?scripcode=<code>
 */
async function tryDesktopCompanyInfoSecurityId(code) {
  const url = `https://www.bseindia.com/stock-share-price/stockreach_company_info.aspx?scripcode=${encodeURIComponent(
    code
  )}`;
  const html = await fetchText(url);

  // On desktop pages, "Security Id" often appears in data tables
  const patterns = [
    /Security\s*Id\s*[:\s]*([A-Z0-9.-]+)/i,
    /Security\s*ID\s*[:\s]*([A-Z0-9.-]+)/i,
    /Scrip\s*ID\s*[:\s]*([A-Z0-9.-]+)/i,
    // Sometimes placed inside <td> blocks near 'Security Id'
    />(?:\s*Security\s*Id\s*)<\/?[^>]*>\s*<\/?[^>]*>\s*([A-Z0-9.-]{3,20})\s*</i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].trim().toUpperCase();
  }
  return null;
}

/**
 * Try to extract Security ID from the BSE DESKTOP financials page
 *   https://www.bseindia.com/stock-share-price/stockreach_financials.aspx?scripcode=<code>
 */
async function tryDesktopFinancialsSecurityId(code) {
  const url = `https://www.bseindia.com/stock-share-price/stockreach_financials.aspx?scripcode=${encodeURIComponent(
    code
  )}`;
  const html = await fetchText(url);

  const patterns = [
    /Security\s*Id\s*[:\s]*([A-Z0-9.-]+)/i,
    /Security\s*ID\s*[:\s]*([A-Z0-9.-]+)/i,
    /Scrip\s*ID\s*[:\s]*([A-Z0-9.-]+)/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].trim().toUpperCase();
  }
  return null;
}

/**
 * Try a sequence of BSE pages until we get a Security ID.
 * Returns uppercase string like "BAJAJHFL" or null.
 */
async function fetchBseSecurityId(code) {
  // 1) mobile
  let secId = await tryMobileSecurityId(code);
  if (secId) return secId;

  // 2) desktop company info
  secId = await tryDesktopCompanyInfoSecurityId(code);
  if (secId) return secId;

  // 3) desktop financials
  secId = await tryDesktopFinancialsSecurityId(code);
  if (secId) return secId;

  return null;
}

/* ----------------------- Optional Yahoo verify ----------------------- */

async function verifyYahooSymbol(sym) {
  try {
    const q = await verifyLimiter.schedule(() => yf.quote(sym));
    return !!(q && (q.symbol || q.regularMarketPrice != null));
  } catch {
    return false;
  }
}

/* ----------------------- Public resolver ----------------------- */
/**
 * Resolve a Yahoo symbol for a BSE numeric scrip code.
 * Steps:
 *   A) Cache
 *   B) Yahoo search (with “.BO” preference & hintName if provided)
 *   C) Multi-source BSE scrape → Security ID → <SECID>.BO (verify non-fatal)
 */
async function resolveBseNumericToYahooSymbol(numericCode, hintName) {
  const code = String(numericCode || "").trim();
  if (!/^\d+$/.test(code)) {
    throw new Error(`Not a numeric BSE code: ${code}`);
  }

  const cacheKey = `BSE:${code}:${(hintName || "").toUpperCase()}`;
  const cached = symbolMapCache.get(cacheKey);
  if (cached) return cached;

  // A) Yahoo search (code + variations)
  const queries = [code, `${code} BSE`, `${code} India`];
  if (hintName) {
    queries.push(
      `${hintName} BSE`,
      `${hintName} Bombay Stock Exchange`,
      `${hintName} .BO`
    );
  }

  let best = null;
  for (const q of queries) {
    try {
      const list = await yahooSearchOnce(q);
      for (const cand of list) {
        const sc = scoreCandidate(cand);
        if (!best || sc > best._score) best = { ...cand, _score: sc };
      }
      if (best && isBO(best.symbol) && best._score >= 7) break;
    } catch {
      // keep trying
    }
  }

  if (best && best.symbol && isBO(best.symbol)) {
    symbolMapCache.set(cacheKey, best.symbol);
    return best.symbol;
  }

  // B) Multi-source BSE scrape → Security ID → <SECID>.BO
  const secId = await fetchBseSecurityId(code);
  if (secId) {
    const yahooSym = `${secId}.BO`;
    // Optional non-fatal verification; we still return the symbol either way
    await verifyYahooSymbol(yahooSym);
    symbolMapCache.set(cacheKey, yahooSym);
    return yahooSym;
  }

  throw new Error(
    `Could not resolve BSE numeric ${code} to a Yahoo symbol${
      hintName ? ` (hint: ${hintName})` : ""
    }`
  );
}

module.exports = { resolveBseNumericToYahooSymbol };
