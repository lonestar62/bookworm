/**
 * ai.js — Google Books API + Gemini enrichment for Bookworm
 */

const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * Fetch book info from Google Books API (no key needed for basic search).
 */
async function fetchGoogleBooks(title, author) {
  try {
    const query = `intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}`;
    const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`;
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) {
      console.warn('[google-books] API error:', res.status);
      return { description: null, coverUrl: null };
    }
    const data = await res.json();
    if (!data.items || data.items.length === 0) {
      return { description: null, coverUrl: null };
    }
    const info = data.items[0].volumeInfo || {};
    const description = info.description || null;
    let coverUrl = null;
    if (info.imageLinks) {
      coverUrl = info.imageLinks.extraLarge
        || info.imageLinks.large
        || info.imageLinks.medium
        || info.imageLinks.thumbnail
        || info.imageLinks.smallThumbnail
        || null;
      if (coverUrl) coverUrl = coverUrl.replace('http://', 'https://');
    }
    return { description, coverUrl };
  } catch (err) {
    console.warn('[google-books] fetch failed:', err.message);
    return { description: null, coverUrl: null };
  }
}

/**
 * Fetch author bio and fun facts from Gemini.
 */
async function fetchAuthorInfo(author) {
  if (!GEMINI_API_KEY) {
    console.warn('[gemini] no GEMINI_API_KEY set');
    return { authorBio: null, funFact1: null, funFact2: null };
  }
  try {
    const prompt = `In 2-3 warm, friendly sentences for a book lover, tell me about the author ${author} and their writing style. Then share 2 delightful fun facts about ${author} that any book lover would enjoy knowing. Reply in this exact format:\nauthor_bio: [your bio text here]\nfun_fact_1: [first fun fact]\nfun_fact_2: [second fun fact]`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
      }),
      timeout: 20000,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn('[gemini] API error:', res.status, errText.substring(0, 200));
      return { authorBio: null, funFact1: null, funFact2: null };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const bioMatch = text.match(/author_bio:\s*\[?(.+?)\]?\s*\n/i);
    const fact1Match = text.match(/fun_fact_1:\s*\[?(.+?)\]?\s*\n/i);
    const fact2Match = text.match(/fun_fact_2:\s*\[?(.+?)\]?\s*/i);
    return {
      authorBio: bioMatch ? bioMatch[1].trim() : null,
      funFact1: fact1Match ? fact1Match[1].trim() : null,
      funFact2: fact2Match ? fact2Match[1].trim() : null,
    };
  } catch (err) {
    console.warn('[gemini] fetch failed:', err.message);
    return { authorBio: null, funFact1: null, funFact2: null };
  }
}

/**
 * Full enrichment: Google Books + Gemini author info.
 */
async function enrichBook(title, author) {
  const [bookInfo, authorInfo] = await Promise.all([
    fetchGoogleBooks(title, author),
    fetchAuthorInfo(author),
  ]);
  return {
    description: bookInfo.description,
    coverUrl: bookInfo.coverUrl,
    authorBio: authorInfo.authorBio,
    funFact1: authorInfo.funFact1,
    funFact2: authorInfo.funFact2,
  };
}

module.exports = { enrichBook };
