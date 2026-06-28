/**
 * ai.js — Gemini 2.5-flash enrichment for Bookworm
 * Gemini handles book description, author bio, fun facts.
 * Google Books used only for cover image (best-effort).
 */

const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function fetchCover(title, author) {
  try {
    const q = `intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}`;
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1&fields=items/volumeInfo/imageLinks`,
      { timeout: 8000 }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const links = data.items?.[0]?.volumeInfo?.imageLinks;
    if (!links) return null;
    const raw = links.extraLarge || links.large || links.medium || links.thumbnail || links.smallThumbnail || null;
    return raw ? raw.replace('http://', 'https://') : null;
  } catch { return null; }
}

async function fetchGeminiEnrichment(title, author) {
  if (!GEMINI_API_KEY) return { description: null, authorBio: null, funFact1: null, funFact2: null };

  const prompt = `A sweet 88-year-old woman named Jean just finished reading "${title}" by ${author}. Tell her about the book and author in warm, friendly language.

Reply on exactly 4 lines, no extra text:
DESCRIPTION: Write 2-3 sentences about what this book is about and why readers love it.
AUTHOR_BIO: Write 2-3 sentences about ${author}'s life and writing style.
FUN_FACT_1: Share one delightful fun fact about ${author} or this book.
FUN_FACT_2: Share one more delightful fun fact about ${author} or this book.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
        }),
        timeout: 30000,
      }
    );
    if (!res.ok) {
      console.warn('[gemini] error:', res.status, await res.text().then(t => t.substring(0,150)));
      return { description: null, authorBio: null, funFact1: null, funFact2: null };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('[gemini] raw response length:', text.length);

    const line = (key) => {
      const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'im'));
      return m ? m[1].trim() : null;
    };

    return {
      description: line('DESCRIPTION'),
      authorBio: line('AUTHOR_BIO'),
      funFact1: line('FUN_FACT_1'),
      funFact2: line('FUN_FACT_2'),
    };
  } catch (err) {
    console.warn('[gemini] fetch failed:', err.message);
    return { description: null, authorBio: null, funFact1: null, funFact2: null };
  }
}

async function enrichBook(title, author) {
  const [gemini, coverUrl] = await Promise.all([
    fetchGeminiEnrichment(title, author),
    fetchCover(title, author),
  ]);
  return {
    description: gemini.description,
    coverUrl,
    authorBio: gemini.authorBio,
    funFact1: gemini.funFact1,
    funFact2: gemini.funFact2,
  };
}

module.exports = { enrichBook };
