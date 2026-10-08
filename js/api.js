/* ============================================
   LIVRARIA TECH — Camada de dados do cliente
   Api (fetch) · Auth (Google) · Store (dados do usuário com sync no servidor)
   ============================================ */

const Api = {
  async request(method, url, body, opts = {}) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      keepalive: !!opts.keepalive
    });
    if (res.status === 401) {
      Auth.handleUnauthorized();
      throw new Error('Sessão expirada');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body, opts) { return this.request('POST', url, body, opts); },
  put(url, body, opts) { return this.request('PUT', url, body, opts); },
  patch(url, body) { return this.request('PATCH', url, body); },
  del(url, body) { return this.request('DELETE', url, body); }
};

/* ==========================================
   Auth
   ========================================== */
const Auth = {
  user: null,

  async check() {
    try {
      const res = await fetch('/api/me', { credentials: 'same-origin' });
      if (!res.ok) return null;
      const data = await res.json();
      this.user = data.user || null;
      return this.user;
    } catch (e) {
      return null;
    }
  },

  login() {
    window.location.href = '/login';
  },

  async logout() {
    try { await Store.flush(); } catch (_) {}
    try { await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (_) {}
    this.user = null;
    window.location.href = '/';
  },

  handleUnauthorized() {
    if (this._redirecting) return;
    this._redirecting = true;
    Utils.showToast('🔒 Sua sessão expirou. Entre novamente.');
    setTimeout(() => window.location.reload(), 1200);
  }
};

/* ==========================================
   Store — cache em memória + persistência no servidor
   ========================================== */
const Store = {
  progress: {},
  bookmarks: {},
  notes: {},
  favorites: new Set(),
  _pendingProgress: {},
  _progressTimers: {},

  async load() {
    const data = await Api.get('/api/library');
    this.progress = data.progress || {};
    this.bookmarks = data.bookmarks || {};
    this.notes = data.notes || {};
    this.favorites = new Set(data.favorites || []);
  },

  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  },

  /**
   * Migra dados antigos (localStorage) para a conta, uma única vez
   */
  async migrateLocalData() {
    try {
      const progress = JSON.parse(localStorage.getItem('livraria_progress') || '{}');
      const bookmarks = JSON.parse(localStorage.getItem('livraria_bookmarks') || '{}');
      const favorites = JSON.parse(localStorage.getItem('livraria_favorites') || '[]');
      const hasData = Object.keys(progress).length || Object.keys(bookmarks).length || favorites.length;
      if (!hasData) return 0;

      const result = await Api.post('/api/import', { progress, bookmarks, favorites });
      ['livraria_progress', 'livraria_bookmarks', 'livraria_favorites'].forEach(k => localStorage.removeItem(k));
      await this.load();
      return result.imported || 0;
    } catch (e) {
      console.warn('Falha ao migrar dados locais:', e);
      return 0;
    }
  },

  /* ---------- Progresso ---------- */
  getProgress(bookKey) {
    return this.progress[bookKey] || null;
  },

  saveProgress(bookKey, data) {
    let percent = data.percent;
    if ((percent === undefined || percent === null) && data.page && data.totalPages) {
      percent = data.totalPages > 1 ? (data.page - 1) / (data.totalPages - 1) : 1;
    }
    const entry = {
      ...(this.progress[bookKey] || {}),
      ...data,
      percent: Math.max(0, Math.min(1, Number(percent) || 0)),
      updatedAt: new Date().toISOString()
    };
    this.progress[bookKey] = entry;
    this._pendingProgress[bookKey] = entry;

    // Debounce por livro para não martelar o servidor durante o scroll
    clearTimeout(this._progressTimers[bookKey]);
    this._progressTimers[bookKey] = setTimeout(() => this._sendProgress(bookKey), 1500);
  },

  _sendProgress(bookKey, keepalive = false) {
    const entry = this._pendingProgress[bookKey];
    if (!entry) return Promise.resolve();
    delete this._pendingProgress[bookKey];
    clearTimeout(this._progressTimers[bookKey]);
    return Api.put('/api/progress', { bookKey, ...entry }, { keepalive })
      .catch(e => console.warn('Falha ao salvar progresso:', e.message));
  },

  /** Envia imediatamente todo progresso pendente (ao fechar livro / sair da aba) */
  flush(keepalive = false) {
    return Promise.all(Object.keys(this._pendingProgress).map(k => this._sendProgress(k, keepalive)));
  },

  /* ---------- Favoritos ---------- */
  isFavorite(bookKey) {
    return this.favorites.has(bookKey);
  },

  getFavorites() {
    return [...this.favorites];
  },

  toggleFavorite(bookKey) {
    const adding = !this.favorites.has(bookKey);
    if (adding) this.favorites.add(bookKey); else this.favorites.delete(bookKey);
    const req = adding ? Api.post('/api/favorites', { bookKey }) : Api.del('/api/favorites', { bookKey });
    req.catch(e => {
      // Reverte em caso de erro
      if (adding) this.favorites.delete(bookKey); else this.favorites.add(bookKey);
      Utils.showToast('⚠️ Não foi possível salvar o favorito');
      console.warn(e);
    });
    return adding;
  },

  /* ---------- Marcadores ---------- */
  getBookmarks(bookKey) {
    return this.bookmarks[bookKey] || [];
  },

  addBookmark(bookKey, bookmark) {
    const item = { ...bookmark, id: this.uid(), createdAt: new Date().toISOString() };
    (this.bookmarks[bookKey] ||= []).push(item);
    Api.post('/api/bookmarks', { bookKey, ...item }).catch(e => {
      Utils.showToast('⚠️ Falha ao salvar marcador no servidor');
      console.warn(e);
    });
    return item;
  },

  updateBookmark(bookKey, id, patch) {
    const list = this.bookmarks[bookKey] || [];
    const item = list.find(b => b.id === id);
    if (item) Object.assign(item, patch);
    Api.patch(`/api/bookmarks/${encodeURIComponent(id)}`, patch).catch(e => console.warn(e));
    return item;
  },

  removeBookmark(bookKey, id) {
    this.bookmarks[bookKey] = (this.bookmarks[bookKey] || []).filter(b => b.id !== id);
    Api.del(`/api/bookmarks/${encodeURIComponent(id)}`).catch(e => console.warn(e));
    return this.bookmarks[bookKey];
  },

  /* ---------- Notas ---------- */
  getNotes(bookKey) {
    return this.notes[bookKey] || [];
  },

  getAllNotesCount() {
    return Object.values(this.notes).reduce((n, list) => n + list.length, 0);
  },

  addNote(bookKey, note) {
    const now = new Date().toISOString();
    const item = { ...note, id: this.uid(), createdAt: now, updatedAt: now };
    (this.notes[bookKey] ||= []).push(item);
    Api.post('/api/notes', { bookKey, ...item }).catch(e => {
      Utils.showToast('⚠️ Falha ao salvar nota no servidor');
      console.warn(e);
    });
    return item;
  },

  updateNote(bookKey, id, noteText) {
    const item = (this.notes[bookKey] || []).find(n => n.id === id);
    if (item) { item.note = noteText; item.updatedAt = new Date().toISOString(); }
    Api.patch(`/api/notes/${encodeURIComponent(id)}`, { note: noteText }).catch(e => console.warn(e));
    return item;
  },

  removeNote(bookKey, id) {
    this.notes[bookKey] = (this.notes[bookKey] || []).filter(n => n.id !== id);
    Api.del(`/api/notes/${encodeURIComponent(id)}`).catch(e => console.warn(e));
  }
};

// Garante que o progresso seja salvo ao sair/minimizar o app (essencial no mobile)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') Store.flush(true);
});
window.addEventListener('pagehide', () => Store.flush(true));
