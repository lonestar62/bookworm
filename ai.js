/**
 * ai.js — Open Library + Gemini 2.5-flash enrichment for Bookworm
 */

const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * Fetch book info from Open Library (free, no key, no rate limit).
 */
async function fetchOpenLibrary(title, author) {
  try {
    const q = encodeURIComponent(`${title} ${author}`);
    const url = `https://openlibrary.org/search.json?q=${q}&limit=1&fields=title,author_name,first_sentence,subject,cover_i,description`;
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) {
      console.warn('[openlibrary] error:', res.status);
      return { description: null, coverUrl: null };
    }
    const data = await res.json();
    const doc = (data.docs || [])[0];
    if (!doc) return { description: null, coverUrl: null };

    // Cover via cover_i
    const coverId = doc.cover_i;
    const coverUrl = coverId
      ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
      : null;

    // Description: first_sentence or subject list as a fallback teaser
    let description = null;
    if (doc.first_sentence) {
      description = Array.isArray(doc.first_sentence)
        ? doc.first_sentence[0]
        : doc.first_sentence;
    }
    if (!description && doc.subject && doc.subject.length > 0) {
      description = 'Topics: ' + doc.subject.slice(0, 6).join(', ') + '.';
    }

    return { description, coverUrl };
  } catch (err) {
    console.warn('[openlibrary] fetch failed:', err.message);
    return { description: null, coverUrl: null };
  }
}

/**
 * Fetch author bio and fun facts from Gemini 2.5-flash.
 */
async function fetchAuthorInfo(author, title) {
  if (!GEMINI_API_KEY) {
    console.warn('[gemini] no GEMINI_API_KEY set');
    return { authorBio: null, funFact1: null, funFact2: null };
  }
  try {
    const prompt = `You are helping an 88-year-old book lover learn about books she has read.
She just finished reading "${title}" by ${author}.
Please give her:
1. A warm, friendly 2-3 sentence introduction to ${author} and their writing style
2. Two delightful fun facts about ${author} that a book lover would enjoy

Format your reply EXACTLY like this (no other text):
author_bio: [your bio text]
fun_fact_1: [first fun fact]
fun_fact_2: [second fun fact]`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
      }),
      timeout: 25000,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn('[gemini] API error:', res.status, errText.substring(0, 200));
      return { authorBio: null, funFact1: null, funFact2: null };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const bioMatch = text.match(/author_bio:\s*\[?(.+?)\]?(?:\n|$)/i);
    const fact1Match = text.match(/fun_fact_1:\s*\[?(.+?)\]?(?:\n|$)/i);
    const fact2Match = text.match(/fun_fact_2:\s*\[?(.+?)\]?(?:\n|$)/is);
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
 * Full enrichment: Open Library + Gemini author info.
 */
async function enrichBook(title, author) {
  const [bookInfo, authorInfo] = await Promise.all([
    fetchOpenLibrary(title, author),
    fetchAuthorInfo(author, title),
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
