const express = require('express');
const router = express.Router();
const manager = require('../scrapers/manager');
const cache = require('../utils/cache');

// Latest manhwa
router.get('/latest/:page', async (req, res) => {
  const key = `latest_${req.params.page}`;
  if (cache.has(key)) return res.json(cache.get(key));

  const data = await manager.getLatest(req.params.page);
  if (!data) return res.json({ error: 'Failed to fetch' });

  const result = { list: data, page: parseInt(req.params.page) };
  cache.set(key, result);
  res.json(result);
});

// All manhwa (same as latest)
router.get('/all/:page', async (req, res) => {
  const key = `all_${req.params.page}`;
  if (cache.has(key)) return res.json(cache.get(key));

  const data = await manager.getLatest(req.params.page);
  if (!data) return res.json({ error: 'Failed to fetch' });

  const result = { list: data, page: parseInt(req.params.page) };
  cache.set(key, result);
  res.json(result);
});

// Search
router.get('/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ error: 'No query' });

  const key = `search_${query}`;
  if (cache.has(key)) return res.json(cache.get(key));

  const data = await manager.search(query);
  const result = { list: data };
  cache.set(key, result);
  res.json(result);
});

// Manga info + chapters
router.get('/info/:slug', async (req, res) => {
  const key = `info_${req.params.slug}`;
  if (cache.has(key)) return res.json(cache.get(key));

  const data = await manager.getInfo(req.params.slug);
  if (!data) return res.json({ error: 'Not found' });

  cache.set(key, data);
  res.json(data);
});

// Chapter images
router.get('/chapter/:slug', async (req, res) => {
  const key = `chapter_${req.params.slug}`;
  if (cache.has(key)) return res.json(cache.get(key));

  const data = await manager.getChapter(req.params.slug);
  if (!data) return res.json({ error: 'Failed to load' });

  cache.set(key, data);
  res.json(data);
});

module.exports = router;
