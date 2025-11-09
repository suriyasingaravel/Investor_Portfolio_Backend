const { Router } = require("express");
const { fundamentalsBySymbol, symbolResolveCache } = require("../lib/cache");
const { scrapeFundamentals } = require("../lib/scrape");
const {
  isNumericSymbol,
  normalizeItemSymbolExchange,
  cleanSym,
} = require("../lib/symbols");
const { resolveBseNumericToYahooSymbol } = require("../lib/yahoo");

const router = Router();

const withTimeout = (p, ms, onTimeoutMsg = "timeout") =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(onTimeoutMsg)), ms)),
  ]);

async function normalizeForGoogle(item) {
  const { symbol, exchange } = normalizeItemSymbolExchange(item);

  if (exchange === "BSE") {
    const raw = cleanSym(symbol);
    if (isNumericSymbol(raw)) {
      const cached = symbolResolveCache.get(raw);
      if (cached) return cached;
      try {
        const yahooSym = await withTimeout(
          resolveBseNumericToYahooSymbol(raw),
          3000,
          "resolve timeout"
        );
        const secId = yahooSym.replace(/\.BO$/i, "");
        const out = { symbol: cleanSym(secId), exchange: "BOM" };
        symbolResolveCache.set(raw, out);
        return out;
      } catch {
        const out = { symbol: cleanSym(raw), exchange: "BOM" };
        symbolResolveCache.set(raw, out);
        return out;
      }
    }
    return { symbol: cleanSym(raw), exchange: "BOM" };
  }
  return { symbol: cleanSym(symbol), exchange: "NSE" };
}

router.post("/", async (req, res) => {
  try {
    const { items } = req.body || {};
    const deadlineMs = Math.min(Number(req.query.deadlineMs || 7000), 15000);
    const perSymbolTimeout = Math.min(
      Number(req.query.symbolTimeoutMs || 6000),
      deadlineMs
    );

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items[] is required" });
    }

    const normalized = (await Promise.all(items.map(normalizeForGoogle)))
      .map((i) => ({ key: `${i.symbol}:${i.exchange}`, ...i }))
      .reduce((m, i) => m.set(i.key, i), new Map());
    const uniq = Array.from(normalized.values());

    const hits = [];
    const misses = [];
    for (const i of uniq) {
      const c = fundamentalsBySymbol.get(i.key);
      if (c) {
        hits.push({ ok: true, ...c, cache: "hit" });
        const ttl = fundamentalsBySymbol.getRemainingTTL(i.key);
        if (ttl !== undefined && ttl <= 0) {
          scrapeFundamentals(i.symbol, i.exchange)
            .then((f) => fundamentalsBySymbol.set(i.key, f))
            .catch(() => {});
        }
      } else {
        misses.push(i);
      }
    }

    if (misses.length === 0) return res.json(hits);

    const startedAt = Date.now();
    const tasks = misses.map((i) =>
      withTimeout(
        scrapeFundamentals(i.symbol, i.exchange),
        perSymbolTimeout,
        "scrape timeout"
      )
        .then((f) => {
          fundamentalsBySymbol.set(i.key, f);
          return { ok: true, ...f };
        })
        .catch((err) => ({
          ok: false,
          symbol: i.symbol,
          exchange: i.exchange,
          pe: null,
          latestEarnings: null,
          error: err?.message || String(err),
          ts: Date.now(),
        }))
    );

    const results = await Promise.race([
      Promise.allSettled(tasks).then((all) =>
        all.map((x) => (x.status === "fulfilled" ? x.value : x.reason))
      ),
      new Promise((resolve) =>
        setTimeout(
          () => resolve(null),
          Math.max(0, deadlineMs - (Date.now() - startedAt))
        )
      ),
    ]);

    if (results === null) {
      const settled = (await Promise.allSettled(tasks))
        .filter((x) => x.status === "fulfilled")
        .map((x) => x.value);

      const partial = [...hits, ...settled];
      if (!partial.some((r) => r.ok)) {
        return res
          .status(502)
          .json({ error: "Timed out fetching fundamentals", details: partial });
      }
      return res.json(partial);
    }

    const final = [...hits, ...results];
    if (!final.some((r) => r.ok)) {
      return res
        .status(502)
        .json({ error: "Failed to fetch fundamentals", details: final });
    }
    res.json(final);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("fundamentals route fatal:", msg);
    res
      .status(502)
      .json({ error: "Failed to fetch fundamentals", details: msg });
  }
});

module.exports = router;
