/**
 * server.js — Bookworm
 * Jean's Book Club — bookworm.deeptxai.com
 */
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const db = require('./db');
const { enrichBook } = require('./ai');

const app = express();
const PORT = process.env.PORT || 3024;
const DATA_DIR = process.env.DATA_DIR || '/var/lib/bookworm';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || 'jean@whiddon.net,rod@whiddon.net')
  .split(',').map(e => e.trim().toLowerCase());

// Behind nginx proxy
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 },
}));
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth ────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.email) return next();
  res.redirect('/');
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/auth/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email) return res.json({ success: false, error: 'Please enter your email.' });
  if (!ALLOWED_EMAILS.includes(email)) return res.json({ success: false, error: "That email isn't on our list." });
  req.session.email = email;
  req.session.name = email.startsWith('jean') ? 'Jean' : 'Rod';
  req.session.save(err => {
    if (err) return res.status(500).json({ success: false, error: 'Session error.' });
    res.json({ success: true });
  });
});

app.post('/auth/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

app.get('/auth/status', (req, res) => {
  if (req.session && req.session.email)
    res.json({ loggedIn: true, email: req.session.email, name: req.session.name });
  else
    res.json({ loggedIn: false });
});

// ── Book lookup (AI enrichment) ─────────────────────────────────
app.post('/api/lookup', requireAuth, async (req, res) => {
  const { title, author } = req.body;
  if (!title || !author) return res.status(400).json({ error: 'Title and author required.' });
  try {
    const data = await enrichBook(title, author);
    res.json({ title, author, ...data });
  } catch (e) {
    console.error('[lookup]', e.message);
    res.status(500).json({ error: 'Lookup failed. Please try again.' });
  }
});

// ── Suggestions ─────────────────────────────────────────────────
app.get('/api/suggest', requireAuth, async (req, res) => {
  const { title, author } = req.query;
  const fetch = require('node-fetch');
  try {
    let url;
    if (title && !author) url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=6&fields=title,author_name,first_publish_year`;
    else if (author && !title) url = `https://openlibrary.org/search.json?author=${encodeURIComponent(author)}&sort=editions&limit=8&fields=title,author_name,first_publish_year`;
    else return res.json([]);
    const r = await fetch(url, { timeout: 8000 });
    const data = await r.json();
    const results = (data.docs || [])
      .map(d => ({ title: d.title || '', author: (d.author_name || [])[0] || '', year: d.first_publish_year || '' }))
      .filter(d => d.title && d.author);
    res.json(results);
  } catch { res.json([]); }
});

// ── Books CRUD ──────────────────────────────────────────────────
app.get('/api/books', requireAuth, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM books ORDER BY added_at DESC').all()); }
  catch (e) { res.status(500).json({ error: 'Could not load books.' }); }
});

app.post('/api/books', requireAuth, (req, res) => {
  const { title, author, coverUrl, bookDescription, authorBio, funFact1, funFact2, rating, review, genre, readOn } = req.body;
  if (!title || !author) return res.status(400).json({ error: 'Title and author required.' });
  try {
    const r = db.prepare(`INSERT INTO books (title,author,cover_url,book_description,author_bio,fun_fact_1,fun_fact_2,rating,review,genre,read_on)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(title, author, coverUrl||null, bookDescription||null, authorBio||null, funFact1||null, funFact2||null, rating ? parseInt(rating) : null, review||null, genre||null, readOn||null);
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: 'Could not save.' }); }
});

app.put('/api/books/:id', requireAuth, (req, res) => {
  const { title, author, genre, rating, review, readOn } = req.body;
  if (!title || !author) return res.status(400).json({ error: 'Title and author required.' });
  try {
    db.prepare('UPDATE books SET title=?,author=?,genre=?,rating=?,review=?,read_on=? WHERE id=?')
      .run(title, author, genre||null, rating ? parseInt(rating) : null, review||null, readOn||null, req.params.id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Could not update.' }); }
});

app.delete('/api/books/:id', requireAuth, (req, res) => {
  try { db.prepare('DELETE FROM books WHERE id=?').run(req.params.id); res.json({ success: true }); }
  catch { res.status(500).json({ error: 'Could not delete.' }); }
});

app.get('/api/books/:id', requireAuth, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
  book ? res.json(book) : res.status(404).json({ error: 'Not found.' });
});

// ── App page ────────────────────────────────────────────────────
app.get('/app', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.listen(PORT, () => {
  console.log(`[bookworm] port ${PORT} | emails: ${ALLOWED_EMAILS.join(', ')}`);
});
