const { LRUCache } = require("lru-cache");

const quotesCache = new LRUCache({ max: 500, ttl: 20_000 });
const fundamentalsCache = new LRUCache({ max: 500, ttl: 60_000 });

const fundamentalsBySymbol = new LRUCache({
  max: 2000,
  ttl: 10 * 60_000,
  allowStale: true,
  updateAgeOnGet: true,
});

const symbolResolveCache = new LRUCache({
  max: 5000,
  ttl: 24 * 60 * 60_000,
});

module.exports = {
  quotesCache,
  fundamentalsCache,
  fundamentalsBySymbol,
  symbolResolveCache,
};
