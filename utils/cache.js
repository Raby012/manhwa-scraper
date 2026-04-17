const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

module.exports = {
  get: (key) => cache.get(key),
  set: (key, value) => cache.set(key, value),
  has: (key) => cache.has(key)
};
