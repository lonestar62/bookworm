/**
 * db.js — SQLite setup for Bookworm
 * Uses better-sqlite3 for synchronous access.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'bookworm.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    cover_url TEXT,
    book_description TEXT,
    author_bio TEXT,
    fun_fact_1 TEXT,
    fun_fact_2 TEXT,
    rating INTEGER,
    finished INTEGER DEFAULT 1,
    review TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = db;
