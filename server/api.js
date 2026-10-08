/* ============================================
   LIVRARIA TECH — API de dados do usuário
   Progresso de leitura, marcadores, notas e favoritos
   ============================================ */

const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

const newId = () => crypto.randomBytes(9).toString('base64url');
const str = (v, max = 500) => (v === undefined || v === null) ? null : String(v).slice(0, max);
const int = (v) => Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.trunc(Number(v)) : null;

function requireBookKey(req, res) {
  const key = str(req.body?.bookKey ?? req.query.bookKey, 400);
  if (!key) {
    res.status(400).json({ error: 'bookKey é obrigatório' });
    return null;
  }
  return key;
}

/* ------------------------------------------
   Mapeadores (snake_case -> camelCase)
   ------------------------------------------ */
const mapProgress = r => ({
  type: r.type, page: r.page, totalPages: r.total_pages,
  location: r.location, percent: r.percent, updatedAt: r.updated_at
});
const mapBookmark = r => ({
  id: r.id, name: r.name, label: r.label, page: r.page,
  cfi: r.cfi, note: r.note, createdAt: r.created_at
});
const mapNote = r => ({
  id: r.id, quote: r.quote, note: r.note, page: r.page, cfi: r.cfi,
  label: r.label, createdAt: r.created_at, updatedAt: r.updated_at
});

/* ------------------------------------------
   Prepared statements
   ------------------------------------------ */
const q = {
  allProgress: db.prepare(`SELECT * FROM reading_progress WHERE user_id = ?`),
  allFavorites: db.prepare(`SELECT book_key FROM favorites WHERE user_id = ? ORDER BY created_at`),
  allBookmarks: db.prepare(`SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at`),
  allNotes: db.prepare(`SELECT * FROM notes WHERE user_id = ? ORDER BY created_at`),

  upsertProgress: db.prepare(`
    INSERT INTO reading_progress (user_id, book_key, type, page, total_pages, location, percent, updated_at)
    VALUES (@user_id, @book_key, @type, @page, @total_pages, @location, @percent, datetime('now'))
    ON CONFLICT(user_id, book_key) DO UPDATE SET
      type = excluded.type, page = excluded.page, total_pages = excluded.total_pages,
      location = excluded.location, percent = excluded.percent, updated_at = datetime('now')
  `),
  deleteProgress: db.prepare(`DELETE FROM reading_progress WHERE user_id = ? AND book_key = ?`),

  addFavorite: db.prepare(`INSERT OR IGNORE INTO favorites (user_id, book_key) VALUES (?, ?)`),
  delFavorite: db.prepare(`DELETE FROM favorites WHERE user_id = ? AND book_key = ?`),

  addBookmark: db.prepare(`
    INSERT INTO bookmarks (id, user_id, book_key, name, label, page, cfi, note)
    VALUES (@id, @user_id, @book_key, @name, @label, @page, @cfi, @note)
  `),
  getBookmark: db.prepare(`SELECT * FROM bookmarks WHERE id = ? AND user_id = ?`),
  updBookmark: db.prepare(`UPDATE bookmarks SET name = COALESCE(@name, name), note = @note WHERE id = @id AND user_id = @user_id`),
  delBookmark: db.prepare(`DELETE FROM bookmarks WHERE id = ? AND user_id = ?`),

  addNote: db.prepare(`
    INSERT INTO notes (id, user_id, book_key, quote, note, page, cfi, label)
    VALUES (@id, @user_id, @book_key, @quote, @note, @page, @cfi, @label)
  `),
  getNote: db.prepare(`SELECT * FROM notes WHERE id = ? AND user_id = ?`),
  updNote: db.prepare(`UPDATE notes SET note = @note, updated_at = datetime('now') WHERE id = @id AND user_id = @user_id`),
  delNote: db.prepare(`DELETE FROM notes WHERE id = ? AND user_id = ?`)
};

/* ------------------------------------------
   GET /api/library — todos os dados do usuário de uma vez
   ------------------------------------------ */
router.get('/library', (req, res) => {
  const uid = req.user.id;
  const progress = {};
  q.allProgress.all(uid).forEach(r => { progress[r.book_key] = mapProgress(r); });

  const bookmarks = {};
  q.allBookmarks.all(uid).forEach(r => { (bookmarks[r.book_key] ||= []).push(mapBookmark(r)); });

  const notes = {};
  q.allNotes.all(uid).forEach(r => { (notes[r.book_key] ||= []).push(mapNote(r)); });

  const favorites = q.allFavorites.all(uid).map(r => r.book_key);

  res.json({ progress, bookmarks, notes, favorites });
});

/* ------------------------------------------
   Progresso
   ------------------------------------------ */
router.put('/progress', (req, res) => {
  const bookKey = requireBookKey(req, res);
  if (!bookKey) return;
  const b = req.body || {};
  let percent = Number(b.percent);
  if (!Number.isFinite(percent)) percent = 0;
  percent = Math.max(0, Math.min(1, percent));

  q.upsertProgress.run({
    user_id: req.user.id,
    book_key: bookKey,
    type: str(b.type, 10),
    page: int(b.page),
    total_pages: int(b.totalPages),
    location: str(b.location, 1000),
    percent
  });
  res.json({ ok: true });
});

router.delete('/progress', (req, res) => {
  const bookKey = requireBookKey(req, res);
  if (!bookKey) return;
  q.deleteProgress.run(req.user.id, bookKey);
  res.json({ ok: true });
});

/* ------------------------------------------
   Favoritos
   ------------------------------------------ */
router.post('/favorites', (req, res) => {
  const bookKey = requireBookKey(req, res);
  if (!bookKey) return;
  q.addFavorite.run(req.user.id, bookKey);
  res.json({ ok: true });
});

router.delete('/favorites', (req, res) => {
  const bookKey = requireBookKey(req, res);
  if (!bookKey) return;
  q.delFavorite.run(req.user.id, bookKey);
  res.json({ ok: true });
});

/* ------------------------------------------
   Marcadores
   ------------------------------------------ */
router.post('/bookmarks', (req, res) => {
  const bookKey = requireBookKey(req, res);
  if (!bookKey) return;
  const b = req.body || {};
  const id = str(b.id, 40) || newId();
  q.addBookmark.run({
    id, user_id: req.user.id, book_key: bookKey,
    name: str(b.name, 200) || 'Sem nome',
    label: str(b.label, 200),
    page: int(b.page),
    cfi: str(b.cfi, 1000),
    note: str(b.note, 5000)
  });
  res.json(mapBookmark(q.getBookmark.get(id, req.user.id)));
});

router.patch('/bookmarks/:id', (req, res) => {
  const b = req.body || {};
  q.updBookmark.run({ id: req.params.id, user_id: req.user.id, name: str(b.name, 200), note: str(b.note, 5000) });
  const row = q.getBookmark.get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Marcador não encontrado' });
  res.json(mapBookmark(row));
});

router.delete('/bookmarks/:id', (req, res) => {
  q.delBookmark.run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* ------------------------------------------
   Notas (trecho destacado + observação)
   ------------------------------------------ */
router.post('/notes', (req, res) => {
  const bookKey = requireBookKey(req, res);
  if (!bookKey) return;
  const b = req.body || {};
  if (!b.quote && !b.note) return res.status(400).json({ error: 'Nota vazia' });
  const id = str(b.id, 40) || newId();
  q.addNote.run({
    id, user_id: req.user.id, book_key: bookKey,
    quote: str(b.quote, 5000),
    note: str(b.note, 10000),
    page: int(b.page),
    cfi: str(b.cfi, 1000),
    label: str(b.label, 200)
  });
  res.json(mapNote(q.getNote.get(id, req.user.id)));
});

router.patch('/notes/:id', (req, res) => {
  q.updNote.run({ id: req.params.id, user_id: req.user.id, note: str(req.body?.note, 10000) });
  const row = q.getNote.get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Nota não encontrada' });
  res.json(mapNote(row));
});

router.delete('/notes/:id', (req, res) => {
  q.delNote.run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* ------------------------------------------
   POST /api/import — migra dados antigos do localStorage
   ------------------------------------------ */
router.post('/import', (req, res) => {
  const uid = req.user.id;
  const { progress = {}, bookmarks = {}, favorites = [] } = req.body || {};
  let count = 0;

  const tx = db.transaction(() => {
    for (const [bookKey, p] of Object.entries(progress)) {
      if (!bookKey || !p) continue;
      const percent = p.percent != null ? Number(p.percent)
        : (p.page && p.totalPages ? p.page / p.totalPages : 0);
      q.upsertProgress.run({
        user_id: uid, book_key: str(bookKey, 400), type: str(p.type, 10),
        page: int(p.page), total_pages: int(p.totalPages),
        location: str(p.location, 1000),
        percent: Number.isFinite(percent) ? Math.max(0, Math.min(1, percent)) : 0
      });
      count++;
    }
    for (const [bookKey, list] of Object.entries(bookmarks)) {
      if (!Array.isArray(list)) continue;
      for (const b of list) {
        try {
          q.addBookmark.run({
            id: newId(), user_id: uid, book_key: str(bookKey, 400),
            name: str(b.name, 200) || 'Sem nome', label: str(b.label, 200),
            page: int(b.page), cfi: str(b.cfi, 1000), note: str(b.note, 5000)
          });
          count++;
        } catch (_) { /* ignora duplicados */ }
      }
    }
    if (Array.isArray(favorites)) {
      favorites.forEach(k => { if (k) { q.addFavorite.run(uid, str(k, 400)); count++; } });
    }
  });

  try {
    tx();
    res.json({ ok: true, imported: count });
  } catch (err) {
    console.error('[IMPORT] Falha:', err);
    res.status(500).json({ error: 'Falha ao importar dados' });
  }
});

module.exports = router;
