/* ============================================
   LIVRARIA TECH — Main Application
   GitHub API integration + Dashboard
   ============================================ */

const App = {
  // State
  books: [],
  filteredBooks: [],
  viewMode: 'grid',
  isLoading: false,

  // GitHub API endpoint
  API_URL: 'https://api.github.com/repos/KAYOKG/BibliotecaDev/contents/LivrosDev',

  /**
   * Initialize the application
   */
  init() {
    // Apply saved theme
    const theme = Utils.getTheme();
    document.documentElement.setAttribute('data-theme', theme);
    this.updateThemeIcon(theme);

    // Apply saved view mode
    this.viewMode = Utils.getViewMode();
    this.updateViewButtons();

    // Bind events
    this.bindEvents();

    // Fetch books
    this.fetchBooks();
  },

  /**
   * Bind all event listeners
   */
  bindEvents() {
    // Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', Utils.debounce((e) => {
        this.filterBooks(e.target.value);
      }, 250));
    }

    // Theme toggle
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => this.toggleTheme());
    }

    // View toggle buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.currentTarget.dataset.view;
        this.setViewMode(mode);
      });
    });

    // Reader controls
    document.getElementById('reader-close')?.addEventListener('click', () => Reader.close());
    document.getElementById('reader-download')?.addEventListener('click', () => Reader.downloadBook());
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

    // Bookmark name input — Enter key
    document.getElementById('bookmark-name-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') Reader.confirmAddBookmark();
      if (e.key === 'Escape') Reader.closeBookmarkModal();
    });

    // Close bookmarks panel
    document.getElementById('bookmarks-close')?.addEventListener('click', () => Reader.closeBookmarks());

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.getElementById('bookmark-modal')?.classList.contains('active')) {
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

  /**
   * Fetch books from GitHub API
   */
  async fetchBooks() {
    this.isLoading = true;
    this.renderLoading();

    // Try cache first
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
          throw new Error('Limite da API do GitHub atingido. Aguarde alguns minutos e tente novamente.');
        }
        throw new Error(`Erro HTTP: ${response.status}`);
      }

      const data = await response.json();

      // Cache the raw data
      Utils.setCacheData('books', data, 30);

      this.books = this.processBooks(data);
      this.filteredBooks = [...this.books];
      this.isLoading = false;
      this.renderBooks();

    } catch (error) {
      console.error('Erro ao buscar livros:', error);
      this.isLoading = false;
      this.renderError(error.message);
    }
  },

  /**
   * Process raw API data into book objects
   */
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

  /**
   * Filter books by search query
   */
  filterBooks(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      this.filteredBooks = [...this.books];
    } else {
      this.filteredBooks = this.books.filter(book =>
        book.displayName.toLowerCase().includes(q) ||
        book.extension.toLowerCase().includes(q)
      );
    }
    this.renderBooks();
  },

  /**
   * Set view mode (grid/list)
   */
  setViewMode(mode) {
    this.viewMode = mode;
    Utils.setViewMode(mode);
    this.updateViewButtons();

    const grid = document.getElementById('books-grid');
    if (grid) {
      grid.classList.toggle('list-view', mode === 'list');
    }
  },

  /**
   * Update view toggle buttons
   */
  updateViewButtons() {
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === this.viewMode);
    });
  },

  /**
   * Toggle theme
   */
  toggleTheme() {
    const current = Utils.getTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    Utils.setTheme(next);
    this.updateThemeIcon(next);

    // Update epub theme if reader is open
    if (Reader.epubRendition && !Reader.nightMode) {
      Reader.applyEpubTheme(next);
    }
  },

  /**
   * Update theme icon
   */
  updateThemeIcon(theme) {
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
      btn.title = theme === 'dark' ? 'Tema claro' : 'Tema escuro';
    }
  },

  /* ==========================================
     Render Methods
     ========================================== */

  /**
   * Render loading state
   */
  renderLoading() {
    const container = document.getElementById('books-container');
    container.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <div class="loading-text">Carregando biblioteca...</div>
      </div>
    `;
  },

  /**
   * Render error state
   */
  renderError(message) {
    const container = document.getElementById('books-container');
    container.innerHTML = `
      <div class="error-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Erro ao carregar</div>
        <div class="empty-text">${message}</div>
        <button class="btn-retry" onclick="App.fetchBooks()">🔄 Tentar novamente</button>
      </div>
    `;
    document.getElementById('stats-count').textContent = '';
  },

  /**
   * Render books grid
   */
  renderBooks() {
    const container = document.getElementById('books-container');
    const statsCount = document.getElementById('stats-count');

    // Update stats
    statsCount.innerHTML = `<strong>${this.filteredBooks.length}</strong> de ${this.books.length} livros`;

    // Empty state
    if (this.filteredBooks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📚</div>
          <div class="empty-title">Nenhum livro encontrado</div>
          <div class="empty-text">Tente buscar com outro termo</div>
        </div>
      `;
      return;
    }

    // Build cards
    const listViewClass = this.viewMode === 'list' ? ' list-view' : '';
    const cardsHtml = this.filteredBooks.map(book => this.renderCard(book)).join('');

    container.innerHTML = `
      <div class="books-grid${listViewClass}" id="books-grid">
        ${cardsHtml}
      </div>
    `;
  },

  /**
   * Render a single book card
   */
  renderCard(book) {
    const isReadable = ['pdf', 'epub'].includes(book.extension);
    const badgeClass = book.extension === 'pdf' ? 'badge-pdf' :
                       book.extension === 'epub' ? 'badge-epub' : 'badge-other';

    const iconEmoji = book.extension === 'pdf' ? '📕' :
                      book.extension === 'epub' ? '📗' : '📘';

    // Check if has reading progress
    const progress = Utils.getProgress(book.name);
    const hasProgress = progress !== null;

    return `
      <div class="book-card" data-name="${book.name}">
        <div class="book-icon-container" onclick="${isReadable ? `App.openBook('${book.sha}')` : ''}">
          <div class="book-icon">${iconEmoji}</div>
          <span class="book-format-badge ${badgeClass}">${book.extension.toUpperCase()}</span>
        </div>
        <div class="book-info">
          <div class="book-title" title="${book.displayName}">${book.displayName}</div>
          <div class="book-meta">
            <span class="book-size">${book.formattedSize}</span>
            <span class="book-stars">${book.stars}</span>
          </div>
          ${hasProgress ? '<div style="font-size:0.65rem;color:var(--accent);margin-top:2px;">📖 Continuar leitura</div>' : ''}
        </div>
        <div class="book-actions">
          ${isReadable ? `<button class="btn-sm btn-read" onclick="App.openBook('${book.sha}')">📖 Ler</button>` : ''}
          <button class="btn-sm btn-download" onclick="App.downloadBook('${book.sha}')" title="Download">📥</button>
        </div>
      </div>
    `;
  },

  /**
   * Open a book by SHA
   */
  openBook(sha) {
    const book = this.books.find(b => b.sha === sha) || this.filteredBooks.find(b => b.sha === sha);
    if (book) {
      Reader.open(book);
    }
  },

  /**
   * Download a book by SHA
   */
  downloadBook(sha) {
    const book = this.books.find(b => b.sha === sha) || this.filteredBooks.find(b => b.sha === sha);
    if (book) {
      const a = document.createElement('a');
      a.href = book.download_url;
      a.download = book.name;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      Utils.showToast('📥 Download iniciado!');
    }
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
