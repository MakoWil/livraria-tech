/* ============================================
   LIVRARIA TECH — Main Application v2.0
   Login Google + Progresso no Banco + Download EPUB/PDF
   ============================================ */

const App = {
  // State
  user: null,
  books: [],
  filteredBooks: [],
  viewMode: 'grid',
  isLoading: false,
  showFavoritesOnly: false,
  coverCache: {},
  pendingDownloadBook: null,

  API_URL: 'https://api.github.com/repos/KAYOKG/BibliotecaDev/contents/LivrosDev',
  OPENLIBRARY_SEARCH: 'https://openlibrary.org/search.json',
  OPENLIBRARY_COVER: 'https://covers.openlibrary.org/b/id/',

  async init() {
    // 1. Aplica tema antes de renderizar para evitar flicker
    const theme = Utils.getTheme();
    document.documentElement.setAttribute('data-theme', theme);
    this.updateThemeIcon(theme);

    // 2. Verifica se houve erro de autenticação na URL (ex: ?auth_error=...)
    this.checkAuthUrlErrors();

    // 3. Checa autenticação do usuário
    const user = await Auth.check();
    document.body.classList.remove('is-booting');
    document.getElementById('splash')?.remove();

    if (!user) {
      this.showLoginScreen();
      return;
    }

    this.user = user;
    this.showAppShell();

    // 4. Carrega preferências e cache de capas
    this.viewMode = Utils.getViewMode();
    this.updateViewButtons();
    this.loadCoverCache();

    // 5. Carrega dados do usuário (banco de dados) e migra dados legados do localStorage
    try {
      await Store.load();
      const migrated = await Store.migrateLocalData();
      if (migrated > 0) {
        Utils.showToast(`✨ ${migrated} itens salvos sincronizados com sua conta!`);
      }
    } catch (e) {
      console.warn('Erro ao carregar dados do usuário:', e);
    }

    // 6. Atualiza UI do usuário
    this.renderUserProfile();

    // 7. Eventos e catálogo de livros
    this.bindEvents();
    this.fetchBooks();
  },

  checkAuthUrlErrors() {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('auth_error');
    if (err) {
      const errEl = document.getElementById('login-error');
      if (errEl) {
        let msg = 'Não foi possível concluir o login com o Google.';
        if (err === 'access_denied') msg = 'Acesso cancelado pelo usuário.';
        if (err === 'not_configured') msg = 'Credenciais do Google não configuradas no servidor.';
        errEl.textContent = msg;
        errEl.hidden = false;
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const loginSuccess = params.get('login');
    if (loginSuccess === 'ok') {
      window.history.replaceState({}, document.title, window.location.pathname);
      Utils.showToast('👋 Bem-vindo de volta!');
    }
  },

  showLoginScreen() {
    const loginScreen = document.getElementById('login-screen');
    const appShell = document.getElementById('app-shell');
    if (loginScreen) loginScreen.hidden = false;
    if (appShell) appShell.hidden = true;

    document.getElementById('btn-google-login')?.addEventListener('click', () => {
      Auth.login();
    });
  },

  showAppShell() {
    const loginScreen = document.getElementById('login-screen');
    const appShell = document.getElementById('app-shell');
    if (loginScreen) loginScreen.hidden = true;
    if (appShell) appShell.hidden = false;
  },

  renderUserProfile() {
    if (!this.user) return;

    const avatarImg = document.getElementById('user-avatar');
    const initialSpan = document.getElementById('user-initial');
    const nameEl = document.getElementById('user-name');
    const emailEl = document.getElementById('user-email');
    const greetingEl = document.getElementById('greeting');

    const firstName = (this.user.name || 'Leitor').split(' ')[0];
    if (greetingEl) {
      greetingEl.innerHTML = `Olá, <strong>${Utils.escapeHtml(firstName)}</strong> 👋 Boa leitura!`;
    }

    if (nameEl) nameEl.textContent = this.user.name || 'Leitor';
    if (emailEl) emailEl.textContent = this.user.email || '';

    if (this.user.picture && avatarImg) {
      avatarImg.src = this.user.picture;
      avatarImg.style.display = 'block';
      if (initialSpan) initialSpan.style.display = 'none';
    } else if (initialSpan) {
      initialSpan.textContent = (this.user.name || 'U').charAt(0).toUpperCase();
      initialSpan.style.display = 'flex';
      if (avatarImg) avatarImg.style.display = 'none';
    }

    this.updateUserStats();
  },

  updateUserStats() {
    const statsEl = document.getElementById('user-stats');
    if (!statsEl) return;
    const progressCount = Object.keys(Store.progress || {}).length;
    const favCount = Store.favorites.size;
    const notesCount = Store.getAllNotesCount();

    statsEl.innerHTML = `
      <div class="user-stat-item"><strong>${progressCount}</strong><span>Lendo</span></div>
      <div class="user-stat-item"><strong>${favCount}</strong><span>Favoritos</span></div>
      <div class="user-stat-item"><strong>${notesCount}</strong><span>Notas</span></div>
    `;
  },

  bindEvents() {
    // Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', Utils.debounce((e) => {
        this.filterBooks(e.target.value);
      }, 250));
    }

    // Theme toggle
    document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggleTheme());

    // User dropdown
    const avatarBtn = document.getElementById('user-avatar-btn');
    const dropdown = document.getElementById('user-dropdown');
    avatarBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = dropdown.classList.toggle('open');
      avatarBtn.setAttribute('aria-expanded', String(open));
      this.updateUserStats();
    });

    document.addEventListener('click', (e) => {
      if (dropdown && !dropdown.contains(e.target) && !avatarBtn?.contains(e.target)) {
        dropdown.classList.remove('open');
        avatarBtn?.setAttribute('aria-expanded', 'false');
      }
    });

    // Logout
    document.getElementById('btn-logout')?.addEventListener('click', () => Auth.logout());

    // View toggle buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.setViewMode(e.currentTarget.dataset.view);
      });
    });

    // Favorites filter button
    document.getElementById('favorites-filter-btn')?.addEventListener('click', () => {
      this.toggleFavoritesFilter();
    });

    // Carousel buttons (Continue Reading & Favorites)
    document.querySelectorAll('.carousel-nav-btn[data-scroll]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.currentTarget.dataset.scroll;
        const dir = parseInt(e.currentTarget.dataset.dir, 10) || 1;
        const carousel = document.getElementById(targetId);
        if (carousel) {
          carousel.scrollBy({ left: dir * 320, behavior: 'smooth' });
        }
      });
    });

    // Reader controls
    document.getElementById('reader-close')?.addEventListener('click', (e) => {
      if (Reader._isPinching || Reader._pinchJustEnded) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      Reader.close();
    });
    document.getElementById('reader-night')?.addEventListener('click', () => Reader.toggleNightMode());
    document.getElementById('reader-bookmark-add')?.addEventListener('click', () => Reader.showAddBookmarkModal());
    document.getElementById('reader-bookmarks-toggle')?.addEventListener('click', () => Reader.toggleBookmarks());

    // Zoom controls
    document.getElementById('zoom-in')?.addEventListener('click', () => Reader.zoomIn());
    document.getElementById('zoom-out')?.addEventListener('click', () => Reader.zoomOut());

    // Bookmark modal
    document.getElementById('bookmark-save')?.addEventListener('click', () => Reader.confirmAddBookmark());
    document.getElementById('bookmark-cancel')?.addEventListener('click', () => Reader.closeBookmarkModal());
    document.getElementById('bookmark-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'bookmark-modal') Reader.closeBookmarkModal();
    });
    document.getElementById('bookmark-name-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') Reader.confirmAddBookmark();
      if (e.key === 'Escape') Reader.closeBookmarkModal();
    });

    // Close bookmarks panel
    document.getElementById('bookmarks-close')?.addEventListener('click', () => Reader.closeBookmarks());

    // Download modal
    document.getElementById('download-cancel')?.addEventListener('click', () => this.closeDownloadModal());
    document.getElementById('download-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'download-modal') this.closeDownloadModal();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.getElementById('download-modal')?.classList.contains('active')) {
          this.closeDownloadModal();
        } else if (document.getElementById('note-modal')?.classList.contains('active')) {
          Reader.closeNoteModal();
        } else if (document.getElementById('bookmark-modal')?.classList.contains('active')) {
          Reader.closeBookmarkModal();
        } else if (document.getElementById('reader-view')?.classList.contains('active')) {
          Reader.close();
        }
      }
    });

    // EPUB font controls
    document.getElementById('font-increase')?.addEventListener('click', () => Reader.increaseFontSize());
    document.getElementById('font-decrease')?.addEventListener('click', () => Reader.decreaseFontSize());
  },

  async fetchBooks() {
    this.isLoading = true;
    this.renderLoading();

    const cached = Utils.getCacheData('books');
    if (cached) {
      this.books = this.processBooks(cached);
      this.filteredBooks = [...this.books];
      this.isLoading = false;
      this.renderBooks();
      return;
    }

    try {
      const response = await fetch(this.API_URL);

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Limite da API do GitHub atingido temporariamente. Aguarde alguns instantes.');
        }
        throw new Error(`Erro HTTP: ${response.status}`);
      }

      const data = await response.json();
      Utils.setCacheData('books', data, 30);

      this.books = this.processBooks(data);
      this.filteredBooks = [...this.books];
      this.isLoading = false;
      this.renderBooks();

      this.fetchAllCovers();
    } catch (error) {
      console.error('Erro ao buscar livros:', error);
      this.isLoading = false;
      this.renderError(error.message);
    }
  },

  processBooks(data) {
    if (!Array.isArray(data)) return [];

    const supportedExtensions = ['pdf', 'epub', 'mobi', 'djvu'];

    return data
      .filter(item => {
        if (item.type === 'dir') return false;
        const ext = Utils.getExtension(item.name);
        return supportedExtensions.includes(ext);
      })
      .map(item => ({
        name: item.name,
        displayName: Utils.formatBookName(item.name),
        size: item.size,
        formattedSize: Utils.formatFileSize(item.size),
        extension: Utils.getExtension(item.name),
        download_url: item.download_url,
        html_url: item.html_url,
        sha: item.sha,
        stars: Utils.generateStars()
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
  },

  filterBooks(query) {
    const q = (query || '').toLowerCase().trim();
    let result = [...this.books];

    if (q) {
      result = result.filter(book =>
        book.displayName.toLowerCase().includes(q) ||
        book.extension.toLowerCase().includes(q)
      );
    }

    if (this.showFavoritesOnly) {
      result = result.filter(book => Store.isFavorite(book.name));
    }

    result.sort((a, b) => {
      const aFav = Store.isFavorite(a.name);
      const bFav = Store.isFavorite(b.name);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return a.displayName.localeCompare(b.displayName, 'pt-BR');
    });

    this.filteredBooks = result;
    this.renderBooks();
  },

  toggleFavoritesFilter() {
    this.showFavoritesOnly = !this.showFavoritesOnly;
    const btn = document.getElementById('favorites-filter-btn');
    btn?.classList.toggle('active', this.showFavoritesOnly);

    const searchInput = document.getElementById('search-input');
    this.filterBooks(searchInput ? searchInput.value : '');
  },

  toggleFavorite(sha, event) {
    if (event) event.stopPropagation();
    const book = this.books.find(b => b.sha === sha);
    if (!book) return;

    const added = Store.toggleFavorite(book.name);
    Utils.showToast(added ? '⭐ Adicionado aos favoritos!' : '☆ Removido dos favoritos');

    const searchInput = document.getElementById('search-input');
    this.filterBooks(searchInput ? searchInput.value : '');
    this.updateUserStats();
  },

  setViewMode(mode) {
    this.viewMode = mode;
    Utils.setViewMode(mode);
    this.updateViewButtons();

    const grid = document.getElementById('books-grid');
    if (grid) grid.classList.toggle('list-view', mode === 'list');
  },

  updateViewButtons() {
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === this.viewMode);
    });
  },

  toggleTheme() {
    const current = Utils.getTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    Utils.setTheme(next);
    this.updateThemeIcon(next);

    if (Reader.epubRendition && !Reader.nightMode) {
      Reader.applyEpubTheme(next);
    }
  },

  updateThemeIcon(theme) {
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
      btn.title = theme === 'dark' ? 'Tema claro' : 'Tema escuro';
    }
  },

  renderLoading() {
    const container = document.getElementById('books-container');
    if (!container) return;
    container.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <div class="loading-text">Carregando biblioteca digital...</div>
      </div>
    `;
  },

  renderError(message) {
    const container = document.getElementById('books-container');
    if (!container) return;
    container.innerHTML = `
      <div class="error-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Erro ao carregar catálogo</div>
        <div class="empty-text">${Utils.escapeHtml(message)}</div>
        <button class="btn-retry" onclick="App.fetchBooks()">🔄 Tentar novamente</button>
      </div>
    `;
    const statsCount = document.getElementById('stats-count');
    if (statsCount) statsCount.textContent = '';
  },

  renderBooks() {
    const container = document.getElementById('books-container');
    const statsCount = document.getElementById('stats-count');
    if (!container) return;

    // Seções de topo
    this.renderContinueSection();
    this.renderFavoritesSection();

    // Stats
    const favCount = this.books.filter(b => Store.isFavorite(b.name)).length;
    if (statsCount) {
      statsCount.innerHTML = `<strong>${this.filteredBooks.length}</strong> de ${this.books.length} livros` +
        (favCount > 0 ? ` · <span style="color:var(--star-color)">⭐ ${favCount}</span>` : '');
    }

    // Empty state
    if (this.filteredBooks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${this.showFavoritesOnly ? '⭐' : '📚'}</div>
          <div class="empty-title">${this.showFavoritesOnly ? 'Nenhum favorito ainda' : 'Nenhum livro encontrado'}</div>
          <div class="empty-text">${this.showFavoritesOnly ? 'Clique na ⭐ de um livro para adicioná-lo aos favoritos' : 'Tente buscar com outro termo'}</div>
        </div>
      `;
      return;
    }

    const listViewClass = this.viewMode === 'list' ? ' list-view' : '';
    const cardsHtml = this.filteredBooks.map(book => this.renderCard(book)).join('');

    container.innerHTML = `
      <div class="books-grid${listViewClass}" id="books-grid">
        ${cardsHtml}
      </div>
    `;
  },

  /* ==========================================
     Carrossel: Continuar Lendo (Baseado no Banco)
     ========================================== */
  renderContinueSection() {
    const section = document.getElementById('continue-section');
    const carousel = document.getElementById('continue-carousel');
    if (!section || !carousel) return;

    // Filtra livros que possuem progresso salvo no banco
    const booksWithProgress = this.books
      .map(b => ({ book: b, progress: Store.getProgress(b.name) }))
      .filter(item => item.progress !== null)
      .sort((a, b) => new Date(b.progress.updatedAt || 0) - new Date(a.progress.updatedAt || 0));

    if (booksWithProgress.length === 0 || this.showFavoritesOnly) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';

    carousel.innerHTML = booksWithProgress.map(({ book, progress }) => {
      const coverUrl = this.coverCache[book.displayName];
      const iconEmoji = book.extension === 'pdf' ? '📕' : '📗';
      const percentVal = Math.round((progress.percent || 0) * 100);
      const posLabel = progress.type === 'pdf' && progress.page
        ? `Pág. ${progress.page}${progress.totalPages ? ` de ${progress.totalPages}` : ''}`
        : `${percentVal}% lido`;

      const coverHtml = coverUrl
        ? `<img src="${coverUrl}" alt="Capa" class="continue-cover" onerror="this.outerHTML='<div class=&quot;continue-cover&quot;>${iconEmoji}</div>'">`
        : `<div class="continue-cover">${iconEmoji}</div>`;

      return `
        <div class="continue-card" onclick="App.openBook('${book.sha}')">
          ${coverHtml}
          <div class="continue-info">
            <div class="continue-title" title="${Utils.escapeHtml(book.displayName)}">${Utils.escapeHtml(book.displayName)}</div>
            <div class="continue-progress-wrap">
              <div class="continue-progress-bar" style="width: ${percentVal}%"></div>
            </div>
            <div class="continue-meta">
              <span>${posLabel}</span>
              <button class="continue-btn" onclick="event.stopPropagation(); App.openBook('${book.sha}')">Continuar ›</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  /* ==========================================
     Carrossel: Meus Favoritos
     ========================================== */
  renderFavoritesSection() {
    const section = document.getElementById('favorites-section');
    const carousel = document.getElementById('favorites-carousel');
    if (!section || !carousel) return;

    const favoriteBooks = this.books.filter(b => Store.isFavorite(b.name));

    if (favoriteBooks.length === 0 || this.showFavoritesOnly) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';

    carousel.innerHTML = favoriteBooks.map(book => {
      const isReadable = ['pdf', 'epub'].includes(book.extension);
      const coverUrl = this.coverCache[book.displayName];
      const iconEmoji = book.extension === 'pdf' ? '📕' : '📗';

      const coverHtml = coverUrl
        ? `<img src="${coverUrl}" alt="Capa" class="fav-card-cover" onerror="this.outerHTML='<div class=&quot;fav-card-cover&quot;>${iconEmoji}</div>'">`
        : `<div class="fav-card-cover">${iconEmoji}</div>`;

      return `
        <div class="fav-card" data-name="${book.name}" onclick="${isReadable ? `App.openBook('${book.sha}')` : ''}">
          ${coverHtml}
          <div class="fav-card-info">
            <div>
              <div class="fav-card-title" title="${Utils.escapeHtml(book.displayName)}">${Utils.escapeHtml(book.displayName)}</div>
              <div class="fav-card-stars">${book.stars}</div>
            </div>
            <div class="fav-card-actions">
              ${isReadable ? `<button class="fav-card-btn" onclick="event.stopPropagation(); App.openBook('${book.sha}')">📖 Ler</button>` : ''}
              <button class="fav-card-remove" onclick="App.toggleFavorite('${book.sha}', event)" title="Remover dos favoritos">⭐</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderCard(book) {
    const isReadable = ['pdf', 'epub'].includes(book.extension);
    const badgeClass = book.extension === 'pdf' ? 'badge-pdf' :
                       book.extension === 'epub' ? 'badge-epub' : 'badge-other';

    const iconEmoji = book.extension === 'pdf' ? '📕' :
                      book.extension === 'epub' ? '📗' : '📘';

    const progress = Store.getProgress(book.name);
    const hasProgress = progress !== null;
    const progressPercent = hasProgress ? Math.round((progress.percent || 0) * 100) : 0;

    const isFav = Store.isFavorite(book.name);
    const favIcon = isFav ? '⭐' : '☆';
    const favClass = isFav ? ' is-favorite' : '';
    const favTitle = isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos';

    const coverUrl = this.coverCache[book.displayName];
    const coverContent = coverUrl
      ? `<img src="${coverUrl}" alt="Capa" class="book-cover-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <div class="book-icon" style="display:none">${iconEmoji}</div>`
      : `<div class="book-icon">${iconEmoji}</div>`;

    return `
      <div class="book-card" data-name="${book.name}">
        <button class="btn-favorite${favClass}" onclick="App.toggleFavorite('${book.sha}', event)" title="${favTitle}">${favIcon}</button>
        <div class="book-icon-container" onclick="${isReadable ? `App.openBook('${book.sha}')` : ''}">
          ${coverContent}
          <span class="book-format-badge ${badgeClass}">${book.extension.toUpperCase()}</span>
          ${hasProgress ? `<div class="card-progress-bar" style="width:${progressPercent}%"></div>` : ''}
        </div>
        <div class="book-info">
          <div class="book-title" title="${Utils.escapeHtml(book.displayName)}">${Utils.escapeHtml(book.displayName)}</div>
          <div class="book-meta">
            <span class="book-size">${book.formattedSize}</span>
            <span class="book-stars">${book.stars}</span>
          </div>
          ${hasProgress ? `<div class="continue-chip">📖 ${progressPercent}% lido</div>` : ''}
        </div>
        <div class="book-actions">
          ${isReadable ? `<button class="btn-sm btn-read" onclick="App.openBook('${book.sha}')">📖 Ler</button>` : ''}
          <button class="btn-sm btn-download" onclick="App.openDownloadModalBySha('${book.sha}')" title="Opções de Download">📥 Baixar</button>
        </div>
      </div>
    `;
  },

  openBook(sha) {
    const book = this.books.find(b => b.sha === sha) || this.filteredBooks.find(b => b.sha === sha);
    if (book) {
      Reader.open(book);
    }
  },

  openDownloadModalBySha(sha) {
    const book = this.books.find(b => b.sha === sha) || this.filteredBooks.find(b => b.sha === sha);
    if (book) this.openDownloadModal(book);
  },

  /* ==========================================
     Modal / Sheet de Escolha de Formato de Download
     ========================================== */
  openDownloadModal(book) {
    this.pendingDownloadBook = book;
    const modal = document.getElementById('download-modal');
    const bookNameEl = document.getElementById('download-book-name');
    const optionsContainer = document.getElementById('download-options');

    if (!modal || !optionsContainer) return;

    bookNameEl.textContent = book.displayName;

    const baseName = book.name.replace(/\.[^/.]+$/, '');
    const isPdf = book.extension === 'pdf';

    optionsContainer.innerHTML = `
      <button type="button" class="download-option-btn primary" onclick="App.executeDownload('epub')">
        <div class="opt-icon">📗</div>
        <div class="opt-info">
          <strong>Baixar em .EPUB ${isPdf ? '(Otimizado para Leitor Digital)' : ''}</strong>
          <small>Ideal para Kindle, Kobo, celulares e tablets com texto refluível e fonte ajustável.</small>
        </div>
        <span class="opt-arrow">⬇️</span>
      </button>

      <button type="button" class="download-option-btn" onclick="App.executeDownload('pdf')">
        <div class="opt-icon">📕</div>
        <div class="opt-info">
          <strong>Baixar em .PDF (Arquivo Original)</strong>
          <small>Layout idêntico ao impresso original do livro.</small>
        </div>
        <span class="opt-arrow">⬇️</span>
      </button>
    `;

    modal.classList.add('active');
  },

  closeDownloadModal() {
    document.getElementById('download-modal')?.classList.remove('active');
    this.pendingDownloadBook = null;
  },

  executeDownload(format) {
    const book = this.pendingDownloadBook;
    this.closeDownloadModal();
    if (!book) return;

    const baseName = book.name.replace(/\.[^/.]+$/, '');

    if (format === 'epub') {
      if (book.extension === 'epub') {
        // Já é epub nativo
        this.triggerDirectDownload(book.download_url, `${baseName}.epub`);
      } else {
        // PDF convertido dinamicamente para EPUB
        const epubFileName = `${baseName}.epub`;
        const downloadUrl = `/api/book-epub?url=${encodeURIComponent(book.download_url)}&download=1&filename=${encodeURIComponent(epubFileName)}`;
        Utils.showToast('⏳ Preparando conversão para .EPUB... O download iniciará em instantes.');
        this.triggerDirectDownload(downloadUrl, epubFileName);
      }
    } else {
      // PDF original (força download direto pelo proxy de anexos do servidor)
      const pdfFileName = `${baseName}.${book.extension}`;
      const downloadUrl = `/api/book-file?url=${encodeURIComponent(book.download_url)}&filename=${encodeURIComponent(pdfFileName)}`;
      Utils.showToast('⏳ Iniciando download do .PDF original...');
      this.triggerDirectDownload(downloadUrl, pdfFileName);
    }
  },

  triggerDirectDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    if (filename) a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  /* ==========================================
     Capas dos Livros (Google Books + Open Library)
     ========================================== */
  loadCoverCache() {
    try {
      this.coverCache = JSON.parse(localStorage.getItem('livraria_covers') || '{}');
    } catch (e) {
      this.coverCache = {};
    }
  },

  saveCoverCache() {
    try {
      localStorage.setItem('livraria_covers', JSON.stringify(this.coverCache));
    } catch (e) {
      console.warn('Erro ao salvar cache de capas:', e);
    }
  },

  async fetchAllCovers() {
    const booksToFetch = this.books.filter(b => !(b.displayName in this.coverCache));
    if (booksToFetch.length === 0) return;

    const batchSize = 5;
    for (let i = 0; i < booksToFetch.length; i += batchSize) {
      const batch = booksToFetch.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(book => this.fetchCover(book)));
      this.saveCoverCache();
      if (i + batchSize < booksToFetch.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  },

  async fetchCover(book) {
    try {
      let cleanQuery = book.displayName
        .replace(/\d{1,2}(st|nd|rd|th)\s*edition/gi, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .trim();

      cleanQuery = cleanQuery.split(/[:\-–—]/)[0].trim();

      if (!cleanQuery || cleanQuery.length < 2) {
        this.coverCache[book.displayName] = null;
        return;
      }

      // 1. Google Books API
      const gbUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(cleanQuery)}&maxResults=1`;
      const response = await fetch(gbUrl);

      if (response.ok) {
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          const imageLinks = data.items[0].volumeInfo?.imageLinks;
          let imgUrl = imageLinks?.thumbnail || imageLinks?.smallThumbnail;
          if (imgUrl) {
            imgUrl = imgUrl.replace(/^http:/i, 'https:');
            this.coverCache[book.displayName] = imgUrl;
            this.updateCardCover(book);
            return;
          }
        }
      }

      // 2. Open Library Fallback
      const olUrl = `${this.OPENLIBRARY_SEARCH}?title=${encodeURIComponent(cleanQuery)}&limit=1&fields=cover_i`;
      const olResponse = await fetch(olUrl);
      if (olResponse.ok) {
        const olData = await olResponse.json();
        if (olData.docs && olData.docs.length > 0 && olData.docs[0].cover_i) {
          const coverId = olData.docs[0].cover_i;
          const coverUrl = `${this.OPENLIBRARY_COVER}${coverId}-M.jpg`;
          this.coverCache[book.displayName] = coverUrl;
          this.updateCardCover(book);
          return;
        }
      }

      this.coverCache[book.displayName] = null;
    } catch (e) {
      this.coverCache[book.displayName] = null;
    }
  },

  updateCardCover(book) {
    const coverUrl = this.coverCache[book.displayName];
    if (!coverUrl) return;

    // Grid Card
    const card = document.querySelector(`.book-card[data-name="${book.name}"]`);
    if (card) {
      const container = card.querySelector('.book-icon-container');
      if (container && !container.querySelector('.book-cover-img')) {
        const iconDiv = container.querySelector('.book-icon');
        const img = document.createElement('img');
        img.src = coverUrl;
        img.alt = 'Capa';
        img.className = 'book-cover-img';
        img.onerror = () => { img.style.display = 'none'; if (iconDiv) iconDiv.style.display = 'flex'; };
        img.onload = () => { if (iconDiv) iconDiv.style.display = 'none'; };
        container.insertBefore(img, iconDiv);
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
