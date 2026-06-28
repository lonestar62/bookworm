/**
 * ai.js — Google Books API + OpenAI enrichment for Bookworm
 */

const fetch = require('node-fetch');

const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Fetch book info from Google Books API.
 * Returns { description, coverUrl } or nulls on failure.
 */
async function fetchGoogleBooks(title, author) {
  try {
    const query = `intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}`;
    const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&key=${GOOGLE_BOOKS_API_KEY}&maxResults=1`;
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
      // Prefer larger images; upgrade to https
      coverUrl = (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || null);
      if (coverUrl) coverUrl = coverUrl.replace('http://', 'https://');
    }
    return { description, coverUrl };
  } catch (err) {
    console.warn('[google-books] fetch failed:', err.message);
    return { description: null, coverUrl: null };
  }
}

/**
 * Fetch author bio and fun facts from OpenAI.
 * Returns { authorBio, funFact1, funFact2 } or fallback strings.
 */
async function fetchAuthorInfo(author) {
  if (!OPENAI_API_KEY) {
    return { authorBio: null, funFact1: null, funFact2: null };
  }
  try {
    const prompt = `In 2-3 friendly sentences, tell me about the author ${author} and their writing style. Then give me 2 fun facts about ${author} that a book lover would enjoy. Format: author_bio: [text] | fun_facts: [fact1] | [fact2]`;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.7,
      }),
      timeout: 20000,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn('[openai] API error:', res.status, errText.substring(0, 200));
      return { authorBio: null, funFact1: null, funFact2: null };
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    // Parse: author_bio: [...] | fun_facts: [...] | [...]
    const bioMatch = text.match(/author_bio:\s*\[?(.+?)\]?\s*\|/i);
    const factsMatch = text.match(/fun_facts:\s*\[?(.+?)\]?\s*\|\s*\[?(.+?)\]?\s*$/is);
    const authorBio = bioMatch ? bioMatch[1].trim() : text.substring(0, 300);
    const funFact1 = factsMatch ? factsMatch[1].trim() : null;
    const funFact2 = factsMatch ? factsMatch[2].trim() : null;
    return { authorBio, funFact1, funFact2 };
  } catch (err) {
    console.warn('[openai] fetch failed:', err.message);
    return { authorBio: null, funFact1: null, funFact2: null };
  }
}

/**
 * Full enrichment: Google Books + OpenAI author info.
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
