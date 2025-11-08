const { LRUCache } = require("lru-cache");

const quotesCache = new LRUCache({ max: 500, ttl: 20_000 });
const fundamentalsCache = new LRUCache({ max: 500, ttl: 60_000 });

module.exports = { quotesCache, fundamentalsCache };
