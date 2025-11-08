// lib/bse.js
const { request } = require("undici");

async function fetchBseSecurityId(numericCode) {
  const code = String(numericCode || "").trim();
  if (!/^\d+$/.test(code)) return null;

  const url = `https://m.bseindia.com/StockReach.aspx?scripcd=${encodeURIComponent(
    code
  )}`;
  const { body } = await request(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await body.text();

  const patterns = [
    /Security\s*ID\s*<\/?\w*>\s*([A-Z0-9.-]+)/i,
    /Security\s*ID\s*[:\s]*([A-Z0-9.-]+)/i,
    /Scrip\s*ID\s*[:\s]*([A-Z0-9.-]+)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].trim().toUpperCase();
  }
  return null;
}

module.exports = { fetchBseSecurityId };
