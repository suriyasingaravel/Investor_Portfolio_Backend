// routes/fundamentals.js
const { Router } = require("express");
const { fundamentalsCache } = require("../lib/cache");
const { scrapeFundamentals } = require("../lib/scrape");
const {
  isNumericSymbol,
  normalizeItemSymbolExchange,
  cleanSym,
} = require("../lib/symbols");
const { resolveBseNumericToYahooSymbol } = require("../lib/yahoo");

const router = Router();

async function normalizeForGoogle(item) {
  const { symbol, exchange } = normalizeItemSymbolExchange(item);

  if (exchange === "BSE") {
    if (isNumericSymbol(symbol)) {
      try {
        const yahooSym = await resolveBseNumericToYahooSymbol(symbol);
        const secId = yahooSym.replace(/\.BO$/i, "");
        return { symbol: cleanSym(secId), exchange: "BOM" };
      } catch {
        return { symbol: cleanSym(symbol), exchange: "BOM" };
      }
    }
    return { symbol: cleanSym(symbol), exchange: "BOM" };
  }

  return { symbol: cleanSym(symbol), exchange: "NSE" };
}

router.post("/", async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items[] is required" });
    }

    const normalized = await Promise.all(items.map(normalizeForGoogle));
    const key = normalized
      .map((i) => `${i.symbol}:${i.exchange}`)
      .sort()
      .join(",");

    const cached = fundamentalsCache.get(key);
    if (cached) return res.json(cached);

    const results = await Promise.all(
      normalized.map(async (i) => {
        try {
          const f = await scrapeFundamentals(i.symbol, i.exchange);
          return { ok: true, ...f };
        } catch (err) {
          const msg = err?.message || String(err);
          console.error(`[fundamentals] ${i.symbol}:${i.exchange} ->`, msg);
          return {
            ok: false,
            symbol: i.symbol,
            exchange: i.exchange,
            pe: null,
            latestEarnings: null,
            error: msg,
            ts: Date.now(),
          };
        }
      })
    );

    const anyOk = results.some((r) => r.ok);
    if (!anyOk) {
      return res
        .status(502)
        .json({ error: "Failed to fetch fundamentals", details: results });
    }

    fundamentalsCache.set(key, results);
    res.json(results);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("fundamentals route fatal:", msg);
    res
      .status(502)
      .json({ error: "Failed to fetch fundamentals", details: msg });
  }
});

module.exports = router;
