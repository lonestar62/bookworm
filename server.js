/**
 * server.js — Bookworm Express app
 * Jean's Book Club — bookworm.deeptxai.com
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');
const { enrichBook } = require('./ai');

const app = express();
const PORT = process.env.PORT || 3025;
const SESSION_SECRET = process.env.SESSION_SECRET || 'fallback-dev-secret-change-in-prod';
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || 'jean@whiddon.net,rod@whiddon.net')
  .split(',')
  .map(e => e.trim().toLowerCase());

// ── Middleware ──────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,         // nginx handles TLS termination
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ─────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session && req.session.email) return next();
  res.redirect('/');
}

// ── Health check ────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), service: 'bookworm' });
});

// ── Auth routes ─────────────────────────────────────────────────────────────

// POST /auth/login — allowlist check, set session
app.post('/auth/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email) {
    return res.json({ success: false, error: 'Please enter your email address.' });
  }
  if (!ALLOWED_EMAILS.includes(email)) {
    return res.json({ success: false, error: "That email isn't on our list. Try jean@whiddon.net" });
  }
  req.session.email = email;
  req.session.name = email.split('@')[0] === 'jean' ? 'Jean' : 'Rod';
  res.json({ success: true });
});

// POST /auth/logout — destroy session
app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// GET /auth/status — check if logged in
app.get('/auth/status', (req, res) => {
  if (req.session && req.session.email) {
    res.json({ loggedIn: true, email: req.session.email, name: req.session.name });
  } else {
    res.json({ loggedIn: false });
  }
});

// ── Book lookup (wizard step 2) ─────────────────────────────────────────────

app.post('/api/books/lookup', requireAuth, async (req, res) => {
  const { title, author } = req.body;
  if (!title || !author) {
    return res.status(400).json({ error: 'Title and author are required.' });
  }
  try {
    const enriched = await enrichBook(title, author);
    res.json({
      title,
      author,
      description: enriched.description,
      coverUrl: enriched.coverUrl,
      authorBio: enriched.authorBio,
      funFact1: enriched.funFact1,
      funFact2: enriched.funFact2,
    });
  } catch (err) {
    console.error('[lookup] error:', err);
    res.status(500).json({ error: 'Something went wrong looking up that book. Please try again.' });
  }
});

// ── Save book (wizard step 3) ───────────────────────────────────────────────

app.post('/api/books/save', requireAuth, (req, res) => {
  const {
    title, author, coverUrl, bookDescription, authorBio,
    funFact1, funFact2, rating, finished, review,
  } = req.body;

  if (!title || !author) {
    return res.status(400).json({ error: 'Title and author are required.' });
  }
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Please choose a star rating before saving.' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO books (title, author, cover_url, book_description, author_bio, fun_fact_1, fun_fact_2, rating, finished, review)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      title,
      author,
      coverUrl || null,
      bookDescription || null,
      authorBio || null,
      funFact1 || null,
      funFact2 || null,
      parseInt(rating, 10),
      finished === 'true' || finished === true || finished === 1 ? 1 : 0,
      review || null,
    );
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('[save] error:', err);
    res.status(500).json({ error: 'Something went wrong saving your book. Please try again.' });
  }
});

// ── Library ─────────────────────────────────────────────────────────────────

app.get('/api/books', requireAuth, (req, res) => {
  try {
    const books = db.prepare(`
      SELECT * FROM books ORDER BY added_at DESC
    `).all();
    res.json(books);
  } catch (err) {
    console.error('[library] error:', err);
    res.status(500).json({ error: 'Could not load your library. Please refresh.' });
  }
});

// GET /api/books/:id — single book detail
app.get('/api/books/:id', requireAuth, (req, res) => {
  try {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found.' });
    res.json(book);
  } catch (err) {
    console.error('[book-detail] error:', err);
    res.status(500).json({ error: 'Could not load that book.' });
  }
});

// ── App HTML (protected) ────────────────────────────────────────────────────

app.get('/app', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[bookworm] listening on port ${PORT}`);
  console.log(`[bookworm] allowed emails: ${ALLOWED_EMAILS.join(', ')}`);
});
