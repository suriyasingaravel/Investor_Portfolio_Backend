const { Router } = require("express");
const YahooFinance = require("yahoo-finance2").default;
const Bottleneck = require("Bottleneck".toLowerCase()); 
const { quotesCache } = require("../lib/cache");
const {
  normalizeItemSymbolExchange,
  toYahoo,
  isNumericSymbol,
} = require("../lib/symbols");
const { fetchGoogleCmp } = require("../lib/google_price");

const router = Router();
const yahooFinance = new YahooFinance();
const limiter = new Bottleneck({ minTime: 200 }); 

async function getQuoteWithRetry(sym, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const q = await limiter.schedule(() => yahooFinance.quote(sym));
      if (!q || (!q.symbol && q.regularMarketPrice == null)) {
        throw new Error("Empty/invalid quote payload from Yahoo");
      }
      return q;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

function decideSource(item) {
  const { symbol, exchange } = normalizeItemSymbolExchange(item);
  if (exchange === "BSE" && isNumericSymbol(symbol)) {
    return { source: "google", symbol, exchange };
  }
  return { source: "yahoo", symbol, exchange };
}

router.post("/", async (req, res) => {
  try {
    const { symbols, items } = req.body || {};

    let jobs = [];

    if (Array.isArray(items) && items.length) {
      jobs = items.map((i) => {
        const { symbol, exchange } = normalizeItemSymbolExchange(i);
        const pick = decideSource({ symbol, exchange });
        return { ...pick, raw: i };
      });
    } else if (Array.isArray(symbols) && symbols.length) {
      jobs = symbols.map((s) => {
        const exchange = isNumericSymbol(s) ? "BSE" : "NSE";
        const pick = decideSource({ symbol: s, exchange });
        return { ...pick, raw: { symbol: s, exchange } };
      });
    } else {
      return res.status(400).json({ error: "Provide symbols[] or items[]" });
    }

    const googleJobs = jobs.filter((j) => j.source === "google");
    const yahooJobs = jobs.filter((j) => j.source === "yahoo");

    const googleResultsPromise = Promise.all(
      googleJobs.map(async (j) => {
        try {
          const r = await fetchGoogleCmp(j.symbol, j.exchange);
          if (r.ok) return r;
          return {
            ok: false,
            symbol: `${j.symbol}:BOM`,
            price: null,
            currency: null,
            source: "google",
            error: "Google returned no price (page mismatch or no data)",
            ts: Date.now(),
          };
        } catch (err) {
          const msg = err && (err.message || String(err));
          return {
            ok: false,
            symbol: `${j.symbol}:BOM`,
            price: null,
            currency: null,
            source: "google",
            error: msg,
            ts: Date.now(),
          };
        }
      })
    );

    const yahooSymbols = yahooJobs.map((j) => toYahoo(j.symbol, j.exchange));

    let yahooResultsPromise = Promise.resolve([]);
    if (yahooSymbols.length) {
      const key = yahooSymbols.slice().sort().join(",");
      const cached = quotesCache.get(key);
      if (cached) {
        yahooResultsPromise = Promise.resolve(cached);
      } else {
        yahooResultsPromise = Promise.all(
          yahooSymbols.map(async (s) => {
            try {
              const q = await getQuoteWithRetry(s, 3);
              return {
                ok: true,
                symbol: q.symbol || s,
                price:
                  q.regularMarketPrice ??
                  q.postMarketPrice ??
                  q.preMarketPrice ??
                  null,
                currency: q.currency ?? null,
                source: "yahoo",
                ts: Date.now(),
              };
            } catch (err) {
              const msg = err && (err.message || String(err));
              return {
                ok: false,
                symbol: s,
                error: msg,
                source: "yahoo",
                ts: Date.now(),
              };
            }
          })
        ).then((arr) => {
          quotesCache.set(key, arr);
          return arr;
        });
      }
    }

    // Merge results
    const [gRes, yRes] = await Promise.all([
      googleResultsPromise,
      yahooResultsPromise,
    ]);
    const full = [...yRes, ...gRes];

    const anyOk = full.some((r) => r.ok);
    if (!anyOk) {
      return res
        .status(502)
        .json({ error: "Failed to fetch prices", details: full });
    }

    return res.json(full);
  } catch (err) {
    const msg = err && (err.message || String(err));
    console.error("prices route fatal:", msg);
    res.status(502).json({ error: "Failed to fetch prices", details: msg });
  }
});

module.exports = router;
