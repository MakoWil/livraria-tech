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
  showFavoritesOnly: false,
  coverCache: {},

  // GitHub API endpoint
  API_URL: 'https://api.github.com/repos/KAYOKG/BibliotecaDev/contents/LivrosDev',

  // Open Library search API
  OPENLIBRARY_SEARCH: 'https://openlibrary.org/search.json',
  OPENLIBRARY_COVER: 'https://covers.openlibrary.org/b/id/',

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

    // Load cover cache from localStorage
    this.loadCoverCache();

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

      // Fetch covers in background
      this.fetchAllCovers();

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
    const q = (query || '').toLowerCase().trim();
    let result = [...this.books];

    if (q) {
      result = result.filter(book =>
        book.displayName.toLowerCase().includes(q) ||
        book.extension.toLowerCase().includes(q)
      );
    }

    if (this.showFavoritesOnly) {
      result = result.filter(book => Utils.isFavorite(book.name));
    }

    // Sort: favorites first, then alphabetically
    result.sort((a, b) => {
      const aFav = Utils.isFavorite(a.name);
      const bFav = Utils.isFavorite(b.name);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return a.displayName.localeCompare(b.displayName, 'pt-BR');
    });

    this.filteredBooks = result;
    this.renderBooks();
  },

  /**
   * Toggle favorites filter
   */
  toggleFavoritesFilter() {
    this.showFavoritesOnly = !this.showFavoritesOnly;
    const btn = document.getElementById('favorites-filter-btn');
    if (btn) {
      btn.classList.toggle('active', this.showFavoritesOnly);
    }
    const searchInput = document.getElementById('search-input');
    this.filterBooks(searchInput ? searchInput.value : '');
  },

  /**
   * Toggle favorite for a book
   */
  toggleFavorite(sha, event) {
    if (event) event.stopPropagation();
    const book = this.books.find(b => b.sha === sha);
    if (!book) return;

    const added = Utils.toggleFavorite(book.name);
    Utils.showToast(added ? '⭐ Adicionado aos favoritos!' : '☆ Removido dos favoritos');

    // Re-filter and re-render so favorited books rise to top automatically
    const searchInput = document.getElementById('search-input');
    this.filterBooks(searchInput ? searchInput.value : '');
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

    // Also render top favorites section carousel
    this.renderFavoritesSection();

    // Update stats
    const favCount = this.books.filter(b => Utils.isFavorite(b.name)).length;
    statsCount.innerHTML = `<strong>${this.filteredBooks.length}</strong> de ${this.books.length} livros` +
      (favCount > 0 ? ` · <span style="color:var(--star-color)">⭐ ${favCount}</span>` : '');

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
   * Render top favorites carousel section (Image 2 style)
   */
  renderFavoritesSection() {
    const section = document.getElementById('favorites-section');
    const carousel = document.getElementById('favorites-carousel');
    if (!section || !carousel) return;

    const favoriteBooks = this.books.filter(b => Utils.isFavorite(b.name));

    // Hide if no favorites or if user is filtering by search/favorites-only
    if (favoriteBooks.length === 0 || this.showFavoritesOnly) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';

    const cardsHtml = favoriteBooks.map(book => {
      const isReadable = ['pdf', 'epub'].includes(book.extension);
      const coverUrl = this.coverCache[book.displayName];
      const iconEmoji = book.extension === 'pdf' ? '📕' : book.extension === 'epub' ? '📗' : '📘';

      const coverHtml = coverUrl
        ? `<img src="${coverUrl}" alt="Capa" class="fav-card-cover" onerror="this.outerHTML='<div class=&quot;fav-card-cover&quot;>${iconEmoji}</div>'">`
        : `<div class="fav-card-cover">${iconEmoji}</div>`;

      return `
        <div class="fav-card" data-name="${book.name}" onclick="${isReadable ? `App.openBook('${book.sha}')` : ''}">
          ${coverHtml}
          <div class="fav-card-info">
            <div>
              <div class="fav-card-title" title="${book.displayName}">${book.displayName}</div>
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

    carousel.innerHTML = cardsHtml;
  },

  /**
   * Scroll favorites carousel left/right
   */
  scrollFavorites(offset) {
    const carousel = document.getElementById('favorites-carousel');
    if (carousel) {
      carousel.scrollBy({ left: offset, behavior: 'smooth' });
    }
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

    // Check favorite state
    const isFav = Utils.isFavorite(book.name);
    const favIcon = isFav ? '⭐' : '☆';
    const favClass = isFav ? ' is-favorite' : '';
    const favTitle = isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos';

    // Check for cover image
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
          <button class="btn-sm btn-download" onclick="App.downloadBook('${book.sha}')" title="${book.extension === 'pdf' ? 'Baixar convertido em EPUB' : 'Download'}">📥 ${book.extension === 'pdf' ? 'EPUB' : ''}</button>
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
   * Download a book by SHA (com conversão dinâmica para EPUB para arquivos PDF)
   */
  downloadBook(sha) {
    const book = this.books.find(b => b.sha === sha) || this.filteredBooks.find(b => b.sha === sha);
    if (!book) return;

    if (book.extension === 'pdf') {
      const baseName = book.name.replace(/\.[^/.]+$/, '');
      const epubFileName = `${baseName}.epub`;
      const downloadUrl = `/api/book-epub?url=${encodeURIComponent(book.download_url)}&download=1&filename=${encodeURIComponent(epubFileName)}`;

      Utils.showToast('⏳ Preparando e convertendo para EPUB... O download iniciará em instantes.');

      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = epubFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      const a = document.createElement('a');
      a.href = book.download_url;
      a.download = book.name;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      Utils.showToast('📥 Download iniciado!');
    }
  },

  /* ==========================================
     Book Cover Fetching (Open Library)
     ========================================== */

  /**
   * Load cover cache from localStorage
   */
  loadCoverCache() {
    try {
      this.coverCache = JSON.parse(localStorage.getItem('livraria_covers') || '{}');
    } catch (e) {
      this.coverCache = {};
    }
  },

  /**
   * Save cover cache to localStorage
   */
  saveCoverCache() {
    try {
      localStorage.setItem('livraria_covers', JSON.stringify(this.coverCache));
    } catch (e) {
      console.warn('Erro ao salvar cache de capas:', e);
    }
  },

  /**
   * Fetch covers for all books in background
   */
  async fetchAllCovers() {
    const booksToFetch = this.books.filter(b => !(b.displayName in this.coverCache));
    if (booksToFetch.length === 0) return;

    // Process in small batches to avoid overwhelming the API
    const batchSize = 5;
    for (let i = 0; i < booksToFetch.length; i += batchSize) {
      const batch = booksToFetch.slice(i, i + batchSize);
      const promises = batch.map(book => this.fetchCover(book));
      await Promise.allSettled(promises);

      // Save cache periodically
      this.saveCoverCache();

      // Small delay between batches
      if (i + batchSize < booksToFetch.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  },

  /**
   * Fetch cover for a single book using Google Books API + Open Library fallback
   */
  async fetchCover(book) {
    try {
      // Clean title for search (strip common Portuguese subtitles and edition info)
      let cleanQuery = book.displayName
        .replace(/\d{1,2}(st|nd|rd|th)\s*edition/gi, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .trim();

      // Split at hyphen/colon/dash to get core title
      cleanQuery = cleanQuery.split(/[:\-–—]/)[0].trim();

      if (!cleanQuery || cleanQuery.length < 2) {
        this.coverCache[book.displayName] = null;
        return;
      }

      // 1. Primary: Google Books API (high accuracy for PT-BR & tech titles)
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

      // 2. Secondary Fallback: Open Library API
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

  /**
   * Update a single card's cover image in the DOM (Main Grid + Carousel)
   */
  updateCardCover(book) {
    const coverUrl = this.coverCache[book.displayName];
    if (!coverUrl) return;

    // 1. Main Grid Card
    const card = document.querySelector(`.book-card[data-name="${book.name}"]`);
    if (card) {
      const container = card.querySelector('.book-icon-container');
      if (container) {
        const iconDiv = container.querySelector('.book-icon');
        if (iconDiv && !container.querySelector('.book-cover-img')) {
          const img = document.createElement('img');
          img.src = coverUrl;
          img.alt = 'Capa';
          img.className = 'book-cover-img';
          img.onerror = () => {
            img.style.display = 'none';
            iconDiv.style.display = 'flex';
          };
          img.onload = () => {
            iconDiv.style.display = 'none';
          };
          container.insertBefore(img, iconDiv);
        }
      }
    }

    // 2. Favorites Carousel Card
    const favCard = document.querySelector(`.fav-card[data-name="${book.name}"]`);
    if (favCard) {
      const coverElem = favCard.querySelector('.fav-card-cover');
      if (coverElem && coverElem.tagName !== 'IMG') {
        const img = document.createElement('img');
        img.src = coverUrl;
        img.alt = 'Capa';
        img.className = 'fav-card-cover';
        img.onerror = () => {
          // Keep div icon
        };
        img.onload = () => {
          favCard.replaceChild(img, coverElem);
        };
      }
    }
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
