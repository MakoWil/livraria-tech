/* ============================================
   LIVRARIA TECH — Banco de Dados (SQLite)
   Usuários, sessões, progresso, marcadores, notas e favoritos
   ============================================ */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || process.env.CACHE_DIR || path.join(__dirname, '..', 'cache');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'livraria.db');
const db = new Database(DB_PATH);

// Performance e integridade
try {
  db.pragma('journal_mode = WAL');
} catch (e) {
  console.warn('[DB WARN] Modo WAL indisponível no volume/filesystem, utilizando DELETE:', e.message);
  try { db.pragma('journal_mode = DELETE'); } catch (_) {}
}
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

/* ------------------------------------------
   Schema
   ------------------------------------------ */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id   TEXT    NOT NULL UNIQUE,
    email       TEXT,
    name        TEXT,
    picture     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT    NOT NULL,
    user_agent  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS reading_progress (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_key    TEXT    NOT NULL,
    type        TEXT,
    page        INTEGER,
    total_pages INTEGER,
    location    TEXT,
    percent     REAL    DEFAULT 0,
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, book_key)
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id          TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_key    TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    label       TEXT,
    page        INTEGER,
    cfi         TEXT,
    note        TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bookmarks_user_book ON bookmarks(user_id, book_key);

  CREATE TABLE IF NOT EXISTS notes (
    id          TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_key    TEXT    NOT NULL,
    quote       TEXT,
    note        TEXT,
    page        INTEGER,
    cfi         TEXT,
    label       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notes_user_book ON notes(user_id, book_key);

  CREATE TABLE IF NOT EXISTS favorites (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_key    TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, book_key)
  );
`);

// Limpeza periódica de sessões expiradas
function cleanupSessions() {
  try {
    db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
  } catch (e) {
    console.warn('[DB] Falha ao limpar sessões:', e.message);
  }
}
cleanupSessions();
setInterval(cleanupSessions, 6 * 60 * 60 * 1000).unref();

console.log(`[DB] SQLite pronto em: ${DB_PATH}`);

module.exports = db;
