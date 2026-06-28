/**
 * ai.js — Gemini 2.5-flash enrichment for Bookworm
 * One Gemini call covers: book description, author bio, fun facts.
 * Google Books used only for cover image (best-effort, silently skipped on failure).
 */

const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * Try to get a cover image from Google Books (best-effort).
 */
async function fetchCover(title, author) {
  try {
    const q = `intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}`;
    const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1&fields=items/volumeInfo/imageLinks`;
    const res = await fetch(url, { timeout: 8000 });
    if (!res.ok) return null;
    const data = await res.json();
    const links = data.items?.[0]?.volumeInfo?.imageLinks;
    if (!links) return null;
    const raw = links.extraLarge || links.large || links.medium || links.thumbnail || links.smallThumbnail || null;
    return raw ? raw.replace('http://', 'https://') : null;
  } catch {
    return null;
  }
}

/**
 * Use Gemini 2.5-flash to get book description, author bio, and fun facts.
 */
async function fetchGeminiEnrichment(title, author) {
  if (!GEMINI_API_KEY) {
    console.warn('[gemini] no GEMINI_API_KEY set');
    return { description: null, authorBio: null, funFact1: null, funFact2: null };
  }
  const prompt = `You are helping an 88-year-old book lover learn about a book she just read.
Book: "${title}" by ${author}

Please provide all four of the following. Use warm, friendly language she will enjoy.

Format your reply EXACTLY like this (one item per line, nothing else):
book_description: [2-3 sentences describing what this book is about and why readers love it]
author_bio: [2-3 sentences about ${author}'s life and writing style]
fun_fact_1: [a delightful fun fact about ${author} or this book]
fun_fact_2: [another delightful fun fact about ${author} or this book]`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 600, temperature: 0.7 },
      }),
      timeout: 25000,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn('[gemini] API error:', res.status, errText.substring(0, 200));
      return { description: null, authorBio: null, funFact1: null, funFact2: null };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const extract = (key) => {
      const m = text.match(new RegExp(`${key}:\\s*\\[?(.+?)\\]?\\s*(?=\\n[a-z_]+:|$)`, 'is'));
      return m ? m[1].trim() : null;
    };

    return {
      description: extract('book_description'),
      authorBio: extract('author_bio'),
      funFact1: extract('fun_fact_1'),
      funFact2: extract('fun_fact_2'),
    };
  } catch (err) {
    console.warn('[gemini] fetch failed:', err.message);
    return { description: null, authorBio: null, funFact1: null, funFact2: null };
  }
}

/**
 * Full enrichment: Gemini (text) + Google Books (cover, best-effort).
 */
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
