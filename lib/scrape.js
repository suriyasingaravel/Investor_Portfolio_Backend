const { request, setGlobalDispatcher, Agent } = require("undici");
const cheerio = require("cheerio");
const Bottleneck = require("bottleneck");

setGlobalDispatcher(
  new Agent({
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 60_000,
  })
);

const limiter = new Bottleneck({ minTime: 120, maxConcurrent: 8 });

const NUM = /-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/;

function gfUrl(symbol, exchange) {
  return `https://www.google.com/finance/quote/${encodeURIComponent(
    `${symbol}:${exchange}`
  )}?hl=en&gl=US`;
}
async function fetchHtml(url, { timeoutMs = 6000, signal } = {}) {
  const ac = new AbortController();
  const link = signal ? AbortSignal.any([signal, ac.signal]) : ac.signal;
  const t = setTimeout(() => ac.abort(new Error("fetch timeout")), timeoutMs);
  try {
    const { body } = await request(url, {
      signal: link,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome Safari",
        "accept-language": "en-US,en;q=0.9",
        accept: "text/html,application/xhtml+xml",
      },
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    return body.text();
  } finally {
    clearTimeout(t);
  }
}
function extractFirstNumber(text) {
  if (!text) return null;
  const m = text.replace(/\s+/g, " ").match(NUM);
  return m ? m[0] : null;
}

function getMetric($, labels) {
  const wanted = new Set(labels.map((s) => s.toLowerCase()));
  const nodes = $("span,div,td");
  const texts = nodes.map((_i, n) => $(n).text().trim()).get();

  const isWanted = (t) =>
    wanted.has(
      String(t || "")
        .trim()
        .toLowerCase()
    );

  for (let i = 0; i < texts.length; i++) {
    if (!isWanted(texts[i])) continue;
    for (let j = i + 1; j < Math.min(i + 10, texts.length); j++) {
      const t = texts[j];
      if (!t || t.length > 60) continue;
      const val = extractFirstNumber(t);
      if (val) return val;
    }
  }

  const labelNodes = nodes.filter((_i, el) => isWanted($(el).text()));
  for (const el of labelNodes) {
    let cur = $(el).next();
    for (let k = 0; k < 8 && cur && cur.length; k++) {
      const val = extractFirstNumber(cur.text().trim());
      if (val) return val;
      cur = cur.next();
    }
  }
  return null;
}

async function fetchHtml(url, { timeoutMs = 8000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error("fetch timeout")), timeoutMs);

  try {
    const { body } = await request(url, {
      signal: ac.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome Safari",
        "accept-language": "en-US,en;q=0.9",
      },

      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    return body.text();
  } finally {
    clearTimeout(t);
  }
}

async function scrapeFundamentalsOnce(symbol, exchange) {
  const url = gfUrl(symbol, exchange);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const PE_LABELS = [
    "P/E ratio",
    "P/E ratio (TTM)",
    "Price to earnings ratio",
    "Price-to-earnings ratio",
  ];
  const EPS_LABELS = [
    "Earnings per share",
    "EPS (TTM)",
    "Diluted EPS (TTM)",
    "EPS",
  ];

  const pe = getMetric($, PE_LABELS);
  const eps = getMetric($, EPS_LABELS);

  return {
    symbol,
    exchange,
    pe,
    latestEarnings: eps,
    source: url,
    ts: Date.now(),
  };
}

async function scrapeFundamentals(symbol, exchange, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await limiter.schedule(() =>
        scrapeFundamentalsOnce(symbol, exchange)
      );
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
}

module.exports = { scrapeFundamentals };
