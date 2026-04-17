const mangadex = require('./mangadex');
const mangakakalot = require('./mangakakalot');

// Try each source in order, return first success
async function tryAll(fn, ...args) {
  const sources = [mangakakalot, mangadex];
  
  for (const source of sources) {
    try {
      const result = await source[fn](...args);
      if (result && (Array.isArray(result) ? result.length > 0 : true)) {
        return result;
      }
    } catch (e) {
      console.error(`Source failed:`, e.message);
    }
  }
  return null;
}

async function getLatest(page) {
  return await tryAll('getLatest', page);
}

async function getInfo(slug) {
  return await tryAll('getInfo', slug);
}

async function getChapter(slug) {
  return await tryAll('getChapter', slug);
}

async function search(query) {
  try {
    const axios = require('axios');
    const res = await axios.get('https://api.mangadex.org/manga', {
      params: {
        title: query,
        limit: 20,
        'contentRating[]': ['safe', 'suggestive'],
        'includes[]': ['cover_art'],
        'originalLanguage[]': ['ko']
      }
    });

    const COVER = 'https://uploads.mangadex.org/covers';
    return res.data.data.map(manga => {
      const t = manga.attributes?.title;
      const title = t?.en || t?.['ja-ro'] || Object.values(t || {})[0] || 'Unknown';
      const cover = manga.relationships?.find(r => r.type === 'cover_art');
      const fileName = cover?.attributes?.fileName;
      const image = fileName ? `${COVER}/${manga.id}/${fileName}.256.jpg` : null;
      return { title, image, slug: manga.id, source: 'mangadex' };
    });
  } catch (e) {
    return [];
  }
}

module.exports = { getLatest, getInfo, getChapter, search };
