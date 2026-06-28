/**
 * ai.js — Gemini 2.5-flash enrichment for Bookworm (JSON mode)
 */

const fetch = require('node-fetch');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function fetchCover(title, author) {
  try {
    const q = `title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=1&fields=cover_i`;
    const res = await fetch(`https://openlibrary.org/search.json?${q}`, { timeout: 10000 });
    if (!res.ok) return null;
    const data = await res.json();
    const coverId = data.docs?.[0]?.cover_i;
    if (!coverId) return null;
    return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
  } catch { return null; }
}

async function fetchGeminiEnrichment(title, author) {
  if (!GEMINI_API_KEY) return { description: null, authorBio: null, funFact1: null, funFact2: null };

  const prompt = `You are helping an 88-year-old book lover learn about a book she just read.
Book: "${title}" by ${author}

Respond with a JSON object with exactly these four keys:
- "description": 2-3 warm, friendly sentences about what this book is about and why readers love it
- "author_bio": 2-3 warm sentences about ${author}'s life and writing style  
- "fun_fact_1": one delightful fun fact about ${author} or this book
- "fun_fact_2": another delightful fun fact about ${author} or this book`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.7,
            responseMimeType: 'application/json',
          },
        }),
        timeout: 30000,
      }
    );
    if (!res.ok) {
      console.warn('[gemini] error:', res.status);
      return { description: null, authorBio: null, funFact1: null, funFact2: null };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(text);
    return {
      description: parsed.description || null,
      authorBio: parsed.author_bio || null,
      funFact1: parsed.fun_fact_1 || null,
      funFact2: parsed.fun_fact_2 || null,
    };
  } catch (err) {
    console.warn('[gemini] failed:', err.message);
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
