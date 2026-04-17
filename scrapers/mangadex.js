const axios = require('axios');

const BASE = 'https://api.mangadex.org';
const COVER = 'https://uploads.mangadex.org/covers';

const headers = {
  'User-Agent': 'ManhwaScraper/1.0',
  'Accept': 'application/json'
};

function getTitle(manga) {
  const t = manga.attributes?.title;
  return t?.en || t?.['ja-ro'] || Object.values(t || {})[0] || 'Unknown';
}

function getCover(manga) {
  const cover = manga.relationships?.find(r => r.type === 'cover_art');
  const fileName = cover?.attributes?.fileName;
  return fileName ? `${COVER}/${manga.id}/${fileName}.512.jpg` : null;
}

async function getLatest(page = 1) {
  try {
    const offset = (page - 1) * 20;
    const res = await axios.get(`${BASE}/manga`, {
      headers,
      params: {
        limit: 20,
        offset,
        'contentRating[]': ['safe', 'suggestive'],
        'includes[]': ['cover_art'],
        'order[latestUploadedChapter]': 'desc',
        'originalLanguage[]': ['ko']
      }
    });

    return res.data.data.map(manga => ({
      title: getTitle(manga),
      image: getCover(manga),
      slug: manga.id,
      url: `https://mangadex.org/title/${manga.id}`,
      source: 'mangadex'
    }));
  } catch (e) {
    console.error('MangaDex latest error:', e.message);
    return null;
  }
}

async function getInfo(slug) {
  try {
    const res = await axios.get(`${BASE}/manga/${slug}`, {
      headers,
      params: { 'includes[]': ['cover_art', 'author'] }
    });

    const manga = res.data.data;
    const title = getTitle(manga);
    const poster = getCover(manga);
    const description = manga.attributes?.description?.en || '';
    const status = manga.attributes?.status || '';
    const author = manga.relationships
      ?.find(r => r.type === 'author')?.attributes?.name || '';
    const genres = manga.attributes?.tags
      ?.filter(t => t.attributes?.group === 'genre')
      ?.map(t => t.attributes?.name?.en) || [];

    let chapters = [];
    let offset = 0;

    while (true) {
      const chRes = await axios.get(`${BASE}/manga/${slug}/feed`, {
        headers,
        params: {
          limit: 100,
          offset,
          'translatedLanguage[]': ['en'],
          'order[chapter]': 'desc',
          'contentRating[]': ['safe', 'suggestive']
        }
      });

      const data = chRes.data.data || [];
      if (data.length === 0) break;

      data.forEach(ch => {
        if (ch.attributes?.pages > 0) {
          chapters.push({
            title: `Chapter ${ch.attributes?.chapter || '?'}`,
            slug: ch.id,
            date: ch.attributes?.publishAt?.split('T')[0] || ''
          });
        }
      });

      if (chapters.length >= chRes.data.total) break;
      offset += 100;
    }

    return { title, poster, description, status, author, genres, chapters, source: 'mangadex' };
  } catch (e) {
    console.error('MangaDex info error:', e.message);
    return null;
  }
}

async function getChapter(slug) {
  try {
    const res = await axios.get(`${BASE}/at-home/server/${slug}`, { headers });
    const { baseUrl, chapter } = res.data;
    const { hash, data: pages, dataSaver } = chapter;

    const usePages = pages?.length > 0 ? pages : dataSaver;
    const quality = pages?.length > 0 ? 'data' : 'data-saver';

    return {
      images: usePages.map(f => `${baseUrl}/${quality}/${hash}/${f}`),
      source: 'mangadex'
    };
  } catch (e) {
    console.error('MangaDex chapter error:', e.message);
    return null;
  }
}

module.exports = { getLatest, getInfo, getChapter };
