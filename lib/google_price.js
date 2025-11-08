// lib/google_price.js
const { LRUCache } = require("lru-cache");
const { request } = require("undici");
const { toGooglePath, normalizeItemSymbolExchange } = require("./symbols");

// Cache Google results briefly to reduce rate/variance (20s)
const gCache = new LRUCache({ max: 500, ttl: 20_000 });

// Common price patterns seen on Google Finance
// Example DOMs observed:
//   <div class="YMlKec fxKbKc">₹2,345.00</div>
//   <div class="YMlKec ... " data-last-price="2,345.00">₹2,345.00</div>
//   Sometimes the currency symbol or spacing differs.
const RX_PRICE_BY_CLASS =
  /<div[^>]+class="[^"]*\bYMlKec\b[^"]*"[^>]*>\s*([^<]+?)\s*<\/div>/i;
const RX_PRICE_BY_ATTR =
  /(?:data-last-price|data-last-price-hist)\s*=\s*"([^"]+)"/i;

// Ticker hints on page (not always both present)
const RX_TICKER_META =
  /itemprop="tickerSymbol"\s+content="([A-Z0-9.-]+:[A-Z]{2,3})"/i;
const RX_TICKER_TITLE =
  /<title>\s*([A-Z0-9.-]+:[A-Z]{2,3})\s*-\s*Google Finance\s*<\/title>/i;

function normNum(str) {
  if (!str) return null;
  // Remove commas, spaces, and currency marks commonly seen in INR contexts.
  const cleaned = String(str)
    .replace(/[, ]/g, "")
    .replace(/[₹]|INR/gi, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function tickersRoughlyMatch(requested, observed) {
  // Accept exact, or BOM↔BSE swap for Indian BSE pages.
  // e.g. requested="544252:BOM", observed="544252:BSE"
  if (!requested || !observed) return false;
  const req = requested.toUpperCase();
  const obs = observed.toUpperCase();
  if (req === obs) return true;
  if (
    req.endsWith(":BOM") &&
    obs.endsWith(":BSE") &&
    req.split(":")[0] === obs.split(":")[0]
  ) {
    return true;
  }
  return false;
}

async function fetchHtml(url) {
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
 * Fetch CMP from Google Finance.
 * Returns { ok, symbol, price, currency: 'INR' | null, source: 'google', url }
 */
async function fetchGoogleCmp(symbolOrItem, exchangeMaybe) {
  let symbol, exchange;

  if (typeof symbolOrItem === "object" && symbolOrItem != null) {
    const n = normalizeItemSymbolExchange(symbolOrItem);
    symbol = n.symbol;
    exchange = n.exchange;
  } else {
    symbol = String(symbolOrItem || "");
    exchange = exchangeMaybe;
  }

  // Build path Google expects (BSE → BOM)
  const path = toGooglePath(symbol, exchange); // e.g., "544252:BOM" or "HDFCBANK:NSE"
  const url = `https://www.google.com/finance/quote/${encodeURIComponent(
    path
  )}`;

  const cached = gCache.get(path);
  if (cached) return cached;

  const html = await fetchHtml(url);

  // Try to determine the observed page ticker
  const observedTicker =
    html.match(RX_TICKER_META)?.[1] || html.match(RX_TICKER_TITLE)?.[1] || ""; // sometimes absent; we'll be lenient

  // If observed ticker present, ensure it roughly matches requested (accept BOM↔BSE)
  if (observedTicker && !tickersRoughlyMatch(path, observedTicker)) {
    const res = {
      ok: false,
      symbol: path.toUpperCase(),
      price: null,
      currency: null,
      source: "google",
      url,
      error: `Ticker mismatch: requested ${path} but page shows ${observedTicker}`,
    };
    gCache.set(path, res);
    return res;
  }

  // Extract price via multiple fallbacks
  let raw =
    html.match(RX_PRICE_BY_ATTR)?.[1] ||
    html.match(RX_PRICE_BY_CLASS)?.[1] ||
    null;

  // Occasionally Google renders the price with non-breaking spaces or thin spaces
  if (raw) raw = raw.replace(/\u00A0|\u2009|\u202F/g, "");

  const price = normNum(raw);

  const res = {
    ok: price != null,
    symbol: (observedTicker || path).toUpperCase(),
    price: price ?? null,
    currency: price != null ? "INR" : null, // GF INR pages for Indian scrips
    source: "google",
    url,
  };

  gCache.set(path, res);
  return res;
}

module.exports = { fetchGoogleCmp };
