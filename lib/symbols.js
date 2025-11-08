// lib/symbols.js
function isNumericSymbol(s) {
  return /^\d+$/.test(String(s || "").trim());
}

function cleanSym(v) {
  return String(v || "")
    .trim()
    .toUpperCase();
}

function normalizeItemSymbolExchange(input = {}) {
  const symbolRaw = input.symbol ?? input.code ?? input.ticker ?? "";
  const symbol = cleanSym(symbolRaw);

  let exchange = cleanSym(input.exchange);
  if (exchange !== "NSE" && exchange !== "BSE") {
    exchange = isNumericSymbol(symbol) ? "BSE" : "NSE";
  }
  return { symbol, exchange };
}

function toYahoo(symbol, exchange) {
  const { symbol: s0, exchange: ex } = normalizeItemSymbolExchange({
    symbol,
    exchange,
  });
  return ex === "BSE" ? `${s0}.BO` : `${s0}.NS`;
}

/** Google wants NSE or BOM (not BSE) */
function toGooglePath(symbol, exchange) {
  const { symbol: s0, exchange: ex } = normalizeItemSymbolExchange({
    symbol,
    exchange,
  });
  const gex = ex === "BSE" ? "BOM" : "NSE";
  return `${s0}:${gex}`;
}

module.exports = {
  isNumericSymbol,
  cleanSym,
  normalizeItemSymbolExchange,
  toYahoo,
  toGooglePath,
};
