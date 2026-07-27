/* ============================================
   LIVRARIA TECH — Reader Module
   PDF.js + ePub.js integration with bookmarks
   ============================================ */

const Reader = {
  // State
  currentBook: null,
  currentType: null, // 'pdf' or 'epub'
  pdfDoc: null,
  pdfPages: [],
  pdfScale: 1.2,
  epubBook: null,
  epubRendition: null,
  nightMode: false,
  bookmarksOpen: false,

  /**
   * Open a book in the reader
   */
  async open(book) {
    this.currentBook = book;
    this.currentType = Utils.getExtension(book.name);

    const readerView = document.getElementById('reader-view');
    const readerTitle = document.getElementById('reader-title');
    const readerContent = document.getElementById('reader-content');

    // Set title
    readerTitle.textContent = Utils.formatBookName(book.name);

    // Show reader
    readerView.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Clear previous content
    readerContent.innerHTML = '';

    // Update bookmark button
    this.renderBookmarksList();

    // Load based on type
    try {
      if (this.currentType === 'pdf') {
        await this.loadPDF(book.download_url, readerContent);
      } else if (this.currentType === 'epub') {
        await this.loadEPUB(book.download_url, readerContent);
      } else {
        // For other formats, redirect to download
        window.open(book.download_url, '_blank');
        this.close();
        return;
      }
    } catch (error) {
      console.error('Erro ao abrir livro:', error);
      readerContent.innerHTML = `
        <div class="error-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-title">Erro ao carregar o livro</div>
          <div class="empty-text">${error.message || 'Não foi possível carregar este arquivo. Tente fazer o download direto.'}</div>
          <a href="${book.download_url}" target="_blank" class="btn-retry" download>📥 Download Direto</a>
        </div>
      `;
    }
  },

  /**
   * Close the reader
   */
  close() {
    const readerView = document.getElementById('reader-view');
    readerView.classList.remove('active');
    readerView.classList.remove('night-mode');
    document.body.style.overflow = '';

    // Remove Ctrl+Scroll handler
    if (this._wheelZoomHandler) {
      readerView.removeEventListener('wheel', this._wheelZoomHandler);
      this._wheelZoomHandler = null;
    }

    // Clear zoom timeout
    if (this._zoomTimeout) {
      clearTimeout(this._zoomTimeout);
      this._zoomTimeout = null;
    }

    // Cleanup
    this.pdfDoc = null;
    this.pdfPages = [];
    this.nightMode = false;
    this.pdfScale = 1.2;

    if (this.epubBook) {
      this.epubBook.destroy();
      this.epubBook = null;
      this.epubRendition = null;
    }

    // Close bookmarks
    this.closeBookmarks();

    // Hide zoom controls
    document.getElementById('zoom-controls').style.display = 'none';

    this.currentBook = null;
    this.currentType = null;
  },

  /* ==========================================
     PDF Reader (PDF.js)
     ========================================== */
  async loadPDF(url, container) {
    container.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <div class="loading-text">Carregando PDF...</div>
      </div>
    `;

    // Show zoom controls
    document.getElementById('zoom-controls').style.display = 'flex';

    // Reset zoom scale default
    this.pdfScale = 1.2;

    // Use CORS proxy for GitHub raw content
    const proxyUrl = url;

    const loadingTask = pdfjsLib.getDocument(proxyUrl);
    this.pdfDoc = await loadingTask.promise;

    const totalPages = this.pdfDoc.numPages;

    // Create PDF container
    container.innerHTML = `<div class="pdf-container" id="pdf-pages"></div>`;
    const pagesContainer = document.getElementById('pdf-pages');

    // Restore progress
    const progress = Utils.getProgress(this.currentBook.name);
    let scrollToPage = progress ? progress.page : 1;

    // Render all pages
    this.pdfPages = [];
    for (let i = 1; i <= totalPages; i++) {
      const page = await this.pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: this.pdfScale });

      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.dataset.page = i;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';

      pagesContainer.appendChild(canvas);
      const pageItem = { page, canvas, renderTask: null };
      this.pdfPages.push(pageItem);

      const context = canvas.getContext('2d');
      try {
        pageItem.renderTask = page.render({ canvasContext: context, viewport });
        await pageItem.renderTask.promise;
      } catch (e) {
        // Ignore cancelled render
      }
    }

    // Scroll to saved position
    if (scrollToPage > 1) {
      const targetCanvas = pagesContainer.querySelector(`[data-page="${scrollToPage}"]`);
      if (targetCanvas) {
        targetCanvas.scrollIntoView({ behavior: 'instant' });
      }
    }

    // Track scroll for progress
    const readerContent = document.getElementById('reader-content');
    readerContent.addEventListener('scroll', Utils.debounce(() => {
      this.updatePDFProgress(readerContent, totalPages);
    }, 500));

    // Ctrl + Scroll Wheel zoom attached to full reader view
    const readerView = document.getElementById('reader-view');
    this._wheelZoomHandler = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          this.zoomIn();
        } else if (e.deltaY > 0) {
          this.zoomOut();
        }
      }
    };
    readerView.addEventListener('wheel', this._wheelZoomHandler, { passive: false });

    // Update progress bar & zoom level display
    this.updateProgressBar(0, totalPages);
    this.updateZoomLevel();
  },

  /**
   * Update PDF reading progress based on scroll
   */
  updatePDFProgress(scrollContainer, totalPages) {
    if (!this.currentBook || this.currentType !== 'pdf') return;

    const canvases = scrollContainer.querySelectorAll('.pdf-page-canvas');
    let currentPage = 1;

    canvases.forEach((canvas, idx) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.top < window.innerHeight / 2) {
        currentPage = idx + 1;
      }
    });

    // Save progress
    Utils.saveProgress(this.currentBook.name, {
      type: 'pdf',
      page: currentPage,
      totalPages
    });

    this.updateProgressBar(currentPage, totalPages);
  },

  /**
   * PDF Zoom
   */
  zoomIn() {
    if (this.currentType !== 'pdf' || !this.pdfDoc) return;
    this.pdfScale = Math.min(+(this.pdfScale + 0.2).toFixed(1), 3.0);
    this.applyZoom();
  },

  zoomOut() {
    if (this.currentType !== 'pdf' || !this.pdfDoc) return;
    this.pdfScale = Math.max(+(this.pdfScale - 0.2).toFixed(1), 0.5);
    this.applyZoom();
  },

  applyZoom() {
    // 1. Instant CSS scaling
    this.pdfPages.forEach(({ canvas, page }) => {
      const vp = page.getViewport({ scale: this.pdfScale });
      canvas.style.width = vp.width + 'px';
      canvas.style.height = vp.height + 'px';
    });

    // 2. Update zoom indicator text
    this.updateZoomLevel();

    // 3. Debounced high-res re-render
    if (this._zoomTimeout) clearTimeout(this._zoomTimeout);
    this._zoomTimeout = setTimeout(() => {
      this.reRenderPDF();
    }, 150);
  },

  async reRenderPDF() {
    for (const item of this.pdfPages) {
      if (item.renderTask) {
        try {
          item.renderTask.cancel();
        } catch (e) {}
      }

      const viewport = item.page.getViewport({ scale: this.pdfScale });
      item.canvas.width = viewport.width;
      item.canvas.height = viewport.height;
      item.canvas.style.width = viewport.width + 'px';
      item.canvas.style.height = viewport.height + 'px';

      const context = item.canvas.getContext('2d');
      try {
        item.renderTask = item.page.render({ canvasContext: context, viewport });
        await item.renderTask.promise;
      } catch (e) {
        // Render task cancelled or replaced
      }
    }
  },

  /**
   * Update zoom level indicator
   */
  updateZoomLevel() {
    const el = document.getElementById('zoom-level');
    if (el) {
      el.textContent = `${Math.round(this.pdfScale * 100)}%`;
    }
  },

  /* ==========================================
     EPUB Reader (ePub.js)
     ========================================== */
  async loadEPUB(url, container) {
    container.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <div class="loading-text">Carregando EPUB...</div>
      </div>
    `;

    // Hide zoom controls (epub has font size)
    document.getElementById('zoom-controls').style.display = 'none';

    // Create epub container
    container.innerHTML = `<div class="epub-container" id="epub-viewer"></div>`;

    this.epubBook = ePub(url);
    this.epubRendition = this.epubBook.renderTo('epub-viewer', {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'scrolled-doc'
    });

    // Apply theme
    const theme = Utils.getTheme();
    this.applyEpubTheme(theme);

    // Restore progress
    const progress = Utils.getProgress(this.currentBook.name);
    if (progress && progress.location) {
      this.epubRendition.display(progress.location);
    } else {
      this.epubRendition.display();
    }

    // Track location changes for progress
    this.epubRendition.on('relocated', (location) => {
      if (!this.currentBook) return;

      const percent = this.epubBook.locations ?
        this.epubBook.locations.percentageFromCfi(location.start.cfi) : 0;

      Utils.saveProgress(this.currentBook.name, {
        type: 'epub',
        location: location.start.cfi,
        percent: percent
      });

      this.updateProgressBar(Math.round(percent * 100), 100);
    });

    // Generate locations for percentage tracking
    this.epubBook.ready.then(() => {
      return this.epubBook.locations.generate(1024);
    });

    // Touch navigation
    this.epubRendition.on('keyup', (e) => {
      if (e.key === 'ArrowLeft') this.epubRendition.prev();
      if (e.key === 'ArrowRight') this.epubRendition.next();
    });
  },

  /**
   * Apply theme to EPUB
   */
  applyEpubTheme(theme) {
    if (!this.epubRendition) return;

    if (theme === 'dark') {
      this.epubRendition.themes.default({
        body: {
          color: '#e8eaf0',
          background: '#141620'
        },
        'a, a:link, a:visited': {
          color: '#6b8aff'
        }
      });
    } else {
      this.epubRendition.themes.default({
        body: {
          color: '#1a1d29',
          background: '#ffffff'
        }
      });
    }
  },

  /**
   * EPUB Font Size & PDF Zoom Header buttons
   */
  increaseFontSize() {
    if (this.currentType === 'pdf') {
      this.zoomIn();
      return;
    }
    if (!this.epubRendition) return;
    const current = parseInt(this.epubRendition.themes._overrides?.fontSize || '100');
    const newSize = Math.min(current + 10, 200);
    this.epubRendition.themes.fontSize(`${newSize}%`);
    Utils.showToast(`Fonte: ${newSize}%`);
  },

  decreaseFontSize() {
    if (this.currentType === 'pdf') {
      this.zoomOut();
      return;
    }
    if (!this.epubRendition) return;
    const current = parseInt(this.epubRendition.themes._overrides?.fontSize || '100');
    const newSize = Math.max(current - 10, 60);
    this.epubRendition.themes.fontSize(`${newSize}%`);
    Utils.showToast(`Fonte: ${newSize}%`);
  },

  /* ==========================================
     Night Mode
     ========================================== */
  toggleNightMode() {
    const readerView = document.getElementById('reader-view');
    this.nightMode = !this.nightMode;

    if (this.nightMode) {
      readerView.classList.add('night-mode');
      if (this.epubRendition) this.applyEpubTheme('dark');
      Utils.showToast('Modo noturno ativado');
    } else {
      readerView.classList.remove('night-mode');
      if (this.epubRendition) this.applyEpubTheme(Utils.getTheme());
      Utils.showToast('Modo noturno desativado');
    }
  },

  /* ==========================================
     Bookmarks
     ========================================== */
  toggleBookmarks() {
    const panel = document.getElementById('bookmarks-panel');
    this.bookmarksOpen = !this.bookmarksOpen;

    if (this.bookmarksOpen) {
      panel.classList.add('open');
      this.renderBookmarksList();
    } else {
      panel.classList.remove('open');
    }
  },

  closeBookmarks() {
    const panel = document.getElementById('bookmarks-panel');
    if (panel) panel.classList.remove('open');
    this.bookmarksOpen = false;
  },

  /**
   * Show modal to add bookmark
   */
  showAddBookmarkModal() {
    const modal = document.getElementById('bookmark-modal');
    const input = document.getElementById('bookmark-name-input');

    // Default name
    let defaultName = '';
    if (this.currentType === 'pdf') {
      const currentPage = this.getCurrentPDFPage();
      defaultName = `Página ${currentPage}`;
    } else if (this.currentType === 'epub') {
      defaultName = `Posição atual`;
    }

    input.value = defaultName;
    modal.classList.add('active');
    input.focus();
    input.select();
  },

  /**
   * Confirm adding bookmark
   */
  confirmAddBookmark() {
    if (!this.currentBook) return;

    const input = document.getElementById('bookmark-name-input');
    const name = input.value.trim() || 'Sem nome';

    let bookmark = { name };

    if (this.currentType === 'pdf') {
      bookmark.page = this.getCurrentPDFPage();
      bookmark.label = `Página ${bookmark.page}`;
    } else if (this.currentType === 'epub' && this.epubRendition) {
      const location = this.epubRendition.currentLocation();
      if (location && location.start) {
        bookmark.cfi = location.start.cfi;
        bookmark.label = `Posição EPUB`;
      }
    }

    Utils.addBookmark(this.currentBook.name, bookmark);
    this.closeBookmarkModal();
    this.renderBookmarksList();
    Utils.showToast('📑 Marcador adicionado!');
  },

  /**
   * Close bookmark modal
   */
  closeBookmarkModal() {
    const modal = document.getElementById('bookmark-modal');
    modal.classList.remove('active');
  },

  /**
   * Navigate to bookmark
   */
  goToBookmark(bookmark) {
    if (this.currentType === 'pdf' && bookmark.page) {
      const canvas = document.querySelector(`.pdf-page-canvas[data-page="${bookmark.page}"]`);
      if (canvas) {
        canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
        Utils.showToast(`📑 Indo para: ${bookmark.name}`);
      }
    } else if (this.currentType === 'epub' && bookmark.cfi && this.epubRendition) {
      this.epubRendition.display(bookmark.cfi);
      Utils.showToast(`📑 Indo para: ${bookmark.name}`);
    }
  },

  /**
   * Delete a bookmark
   */
  deleteBookmark(bookmarkId) {
    if (!this.currentBook) return;
    Utils.removeBookmark(this.currentBook.name, bookmarkId);
    this.renderBookmarksList();
    Utils.showToast('Marcador removido');
  },

  /**
   * Render bookmarks list in panel
   */
  renderBookmarksList() {
    const list = document.getElementById('bookmarks-list');
    if (!list || !this.currentBook) return;

    const bookmarks = Utils.getBookmarks(this.currentBook.name);

    if (bookmarks.length === 0) {
      list.innerHTML = `
        <div class="bookmarks-empty">
          <div class="bookmarks-empty-icon">📑</div>
          <div>Nenhum marcador</div>
          <div style="font-size: 0.7rem;">Adicione marcadores para salvar suas posições favoritas</div>
        </div>
      `;
      return;
    }

    list.innerHTML = bookmarks.map(b => `
      <div class="bookmark-item" onclick="Reader.goToBookmark(${JSON.stringify(b).replace(/"/g, '&quot;')})">
        <div class="bookmark-icon">📑</div>
        <div class="bookmark-details">
          <div class="bookmark-name">${this.escapeHtml(b.name)}</div>
          <div class="bookmark-page">${b.label || ''} · ${this.formatDate(b.createdAt)}</div>
        </div>
        <button class="bookmark-delete" onclick="event.stopPropagation(); Reader.deleteBookmark('${b.id}')" title="Remover">✕</button>
      </div>
    `).join('');
  },

  /* ==========================================
     Helpers
     ========================================== */

  /**
   * Get current visible PDF page
   */
  getCurrentPDFPage() {
    const canvases = document.querySelectorAll('.pdf-page-canvas');
    let currentPage = 1;
    canvases.forEach((canvas, idx) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.top < window.innerHeight / 2) {
        currentPage = idx + 1;
      }
    });
    return currentPage;
  },

  /**
   * Update progress bar
   */
  updateProgressBar(current, total) {
    const bar = document.getElementById('reader-progress-bar');
    if (!bar || !total) return;
    const percent = Math.min((current / total) * 100, 100);
    bar.style.width = `${percent}%`;
  },

  /**
   * Download current book
   */
  downloadBook() {
    if (!this.currentBook) return;
    const a = document.createElement('a');
    a.href = this.currentBook.download_url;
    a.download = this.currentBook.name;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    Utils.showToast('📥 Download iniciado!');
  },

  /**
   * Escape HTML
   */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * Format date
   */
  formatDate(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
};
