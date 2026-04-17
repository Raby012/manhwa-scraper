const axios = require('axios');
const cheerio = require('cheerio');

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://www.mangakakalot.com/',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

async function getLatest(page = 1) {
  try {
    const res = await axios.get(
      `https://www.mangakakalot.com/manga_list?type=newest&category=all&state=all&page=${page}`,
      { headers, timeout: 10000 }
    );
    const $ = cheerio.load(res.data);
    const list = [];

    $('.list-truyen-item-wrap').each((i, el) => {
      const title = $(el).find('h3 a').text().trim();
      const url = $(el).find('h3 a').attr('href');
      const image = $(el).find('img').attr('src');
      const slug = url?.split('/').pop();
      if (title) list.push({ title, image, slug, url, source: 'mangakakalot' });
    });

    return list.length > 0 ? list : null;
  } catch (e) {
    console.error('Mangakakalot latest error:', e.message);
    return null;
  }
}

async function getInfo(slug) {
  try {
    const url = slug.startsWith('http')
      ? slug
      : `https://www.mangakakalot.com/manga/${slug}`;

    const res = await axios.get(url, { headers, timeout: 10000 });
    const $ = cheerio.load(res.data);

    const title = $('.manga-info-text h1').text().trim();
    const poster = $('.manga-info-pic img').attr('src');
    const description = $('#noidungm').text().trim();
    const status = $('.manga-info-text li:contains("Status")')
      .text().replace('Status :', '').trim();
    const author = $('.manga-info-text li:contains("Author") a').text().trim();

    const genres = [];
    $('.manga-info-text li:contains("Genres") a').each((i, el) => {
      genres.push($(el).text().trim());
    });

    const chapters = [];
    $('.chapter-list .row').each((i, el) => {
      const chTitle = $(el).find('a').first().text().trim();
      const chUrl = $(el).find('a').first().attr('href');
      const date = $(el).find('span').last().text().trim();
      if (chTitle) chapters.push({ title: chTitle, slug: chUrl, date });
    });

    return title
      ? { title, poster, description, status, author, genres, chapters, source: 'mangakakalot' }
      : null;
  } catch (e) {
    console.error('Mangakakalot info error:', e.message);
    return null;
  }
}

async function getChapter(slug) {
  try {
    const url = slug.startsWith('http') ? slug : `https://www.mangakakalot.com/chapter/${slug}`;
    const res = await axios.get(url, { headers, timeout: 10000 });
    const $ = cheerio.load(res.data);

    const images = [];
    $('.container-chapter-reader img, #vungdoc img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src) images.push(src.trim());
    });

    return images.length > 0 ? { images, source: 'mangakakalot' } : null;
  } catch (e) {
    console.error('Mangakakalot chapter error:', e.message);
    return null;
  }
}

module.exports = { getLatest, getInfo, getChapter };
