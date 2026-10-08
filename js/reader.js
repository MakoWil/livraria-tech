/* ============================================
   LIVRARIA TECH — Reader Module
   PDF.js (com Camada de Texto Selecionável) +
   ePub.js + Marcadores & Notas + Toolbar de Seleção
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
  activeBlobUrl: null,
  currentTab: 'bookmarks', // 'bookmarks' | 'notes'
  selectedText: '',
  selectedRangeInfo: null,

  /**
   * Open a book in the reader
   */
  async open(book) {
    this.currentBook = book;
    this.currentType = Utils.getExtension(book.name);

    const readerView = document.getElementById('reader-view');
    const readerTitle = document.getElementById('reader-title');
    const readerSubtitle = document.getElementById('reader-subtitle');
    const readerContent = document.getElementById('reader-content');

    // Informa ao assistente de IA qual livro está ativo
    AIChat.setBook(book);

    // Set title
    readerTitle.textContent = Utils.formatBookName(book.name);
    if (readerSubtitle) {
      readerSubtitle.textContent = book.extension.toUpperCase();
    }

    // Show reader
    readerView.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Clear previous content
    readerContent.innerHTML = '';

    // Renderiza abas de marcadores e notas
    this.renderBookmarksList();
    this.renderNotesList();

    // Load based on type
    try {
      if (this.currentType === 'pdf') {
        await this.loadPDF(book.download_url, readerContent);
      } else if (this.currentType === 'epub') {
        await this.loadEPUB(book.download_url, readerContent);
      } else {
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
          <div class="empty-text">${error.message || 'Não foi possível carregar este arquivo.'}</div>
          <button class="btn-retry" onclick="Reader.showDownloadModal()">📥 Opções de Download</button>
        </div>
      `;
    }
  },

  /**
   * Tenta carregar o PDF convertido em EPUB com feedback visual amigável e fallback automático
   */
  async loadConvertedEPUB(book, readerContent) {
    readerContent.innerHTML = `
      <div class="loading-container" style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:320px; text-align:center; padding:2rem 1.5rem;">
        <div class="loading-spinner"></div>
        <div class="loading-text" style="font-weight:600; font-size:1.1rem; margin-top:1.25rem; color:var(--text-primary); max-width:460px;">
          Preparando livro para sua tela...
        </div>
        <div style="font-size:0.875rem; color:var(--text-secondary); margin-top:0.5rem; max-width:440px; line-height:1.45;">
          Convertendo para leitura com texto dinâmico e suporte ao Tutor de IA.
        </div>
      </div>
    `;

    try {
      const apiUrl = `/api/book-epub?url=${encodeURIComponent(book.download_url)}`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`Servidor de conversão retornou status ${response.status}`);
      }

      const blob = await response.blob();

      if (this.activeBlobUrl) {
        URL.revokeObjectURL(this.activeBlobUrl);
      }

      this.activeBlobUrl = URL.createObjectURL(blob);
      this.currentType = 'epub';

      await this.loadEPUB(this.activeBlobUrl, readerContent);
      Utils.showToast('📖 Livro pronto! Selecione trechos para perguntar ao Tutor.');
    } catch (conversionError) {
      console.warn('Conversão para EPUB falhou. Abrindo no leitor de PDF com camada de texto interativo:', conversionError);
      Utils.showToast('ℹ️ Abrindo no leitor PDF com seleção de texto habilitada...');

      this.currentType = 'pdf';
      await this.loadPDF(book.download_url, readerContent);
    }
  },

  /**
   * Close the reader
   */
  close() {
    // Força salvamento de qualquer progresso pendente no banco
    Store.flush();

    const readerView = document.getElementById('reader-view');
    readerView.classList.remove('active');
    readerView.classList.remove('night-mode');
    document.body.style.overflow = '';

    if (this.activeBlobUrl) {
      URL.revokeObjectURL(this.activeBlobUrl);
      this.activeBlobUrl = null;
    }

    if (this._wheelZoomHandler) {
      readerView.removeEventListener('wheel', this._wheelZoomHandler);
      this._wheelZoomHandler = null;
    }

    if (this._zoomTimeout) {
      clearTimeout(this._zoomTimeout);
      this._zoomTimeout = null;
    }

    this.pdfDoc = null;
    this.pdfPages = [];
    this.nightMode = false;
    this.pdfScale = 1.2;

    if (this.epubBook) {
      this.epubBook.destroy();
      this.epubBook = null;
      this.epubRendition = null;
    }

    this.closeBookmarks();
    this.hideSelectionBar();
    AIChat.close();

    document.getElementById('zoom-controls').style.display = 'none';

    this.currentBook = null;
    this.currentType = null;
  },

  /* ==========================================
     PDF Reader (PDF.js com TextLayer Selecionável)
     ========================================== */
  async loadPDF(url, container) {
    container.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <div class="loading-text">Carregando PDF com seleção de texto...</div>
      </div>
    `;

    document.getElementById('zoom-controls').style.display = 'flex';
    this.pdfScale = 1.15;

    const loadingTask = pdfjsLib.getDocument({
      url,
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true
    });
    this.pdfDoc = await loadingTask.promise;

    const totalPages = this.pdfDoc.numPages;

    // Obtém dimensões da primeira página para estruturar os wrappers
    let sampleWidth = 620;
    let sampleHeight = 880;
    try {
      const firstPage = await this.pdfDoc.getPage(1);
      const sampleVp = firstPage.getViewport({ scale: this.pdfScale });
      sampleWidth = Math.round(sampleVp.width);
      sampleHeight = Math.round(sampleVp.height);
    } catch (e) {
      console.warn('Aviso ao obter dimensões da página 1:', e);
    }

    container.innerHTML = `<div class="pdf-container" id="pdf-pages"></div>`;
    const pagesContainer = document.getElementById('pdf-pages');

    const progress = Store.getProgress(this.currentBook.name);
    let scrollToPage = progress && progress.page ? Math.min(Math.max(progress.page, 1), totalPages) : 1;

    this.pdfPages = [];

    // Cria as cascas (wrappers) de cada página com dimensões pré-estabelecidas
    for (let i = 1; i <= totalPages; i++) {
      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'pdf-page-wrapper';
      pageWrapper.dataset.page = i;
      pageWrapper.style.width = `${sampleWidth}px`;
      pageWrapper.style.minHeight = `${sampleHeight}px`;

      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';

      const textLayer = document.createElement('div');
      textLayer.className = 'textLayer';

      pageWrapper.appendChild(canvas);
      pageWrapper.appendChild(textLayer);
      pagesContainer.appendChild(pageWrapper);

      this.pdfPages.push({
        pageNumber: i,
        wrapper: pageWrapper,
        canvas,
        textLayer,
        page: null,
        rendered: false,
        rendering: false
      });
    }

    // Observer de interseção para renderizar páginas conforme o scroll
    this.setupPDFIntersectionObserver();

    // Renderiza a página inicial e as adjacentes imediatamente
    await this.renderPDFPage(scrollToPage);
    if (scrollToPage + 1 <= totalPages) {
      this.renderPDFPage(scrollToPage + 1);
    }
    if (scrollToPage > 1) {
      this.renderPDFPage(1);
    }

    // Scroll para a última posição salva
    if (scrollToPage > 1) {
      setTimeout(() => {
        const target = pagesContainer.querySelector(`[data-page="${scrollToPage}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
      }, 60);
    }

    // Scroll progress tracker
    const readerContent = document.getElementById('reader-content');
    readerContent.addEventListener('scroll', Utils.debounce(() => {
      this.updatePDFProgress(readerContent, totalPages);
    }, 300));

    // Captura seleção de texto dentro do PDF para exibir toolbar flutuante
    this.setupPDFTextSelection(pagesContainer);

    // Ctrl + Scroll Wheel zoom
    const readerView = document.getElementById('reader-view');
    this._wheelZoomHandler = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) this.zoomIn();
        else if (e.deltaY > 0) this.zoomOut();
      }
    };
    readerView.addEventListener('wheel', this._wheelZoomHandler, { passive: false });

    this.updateProgressBar(scrollToPage, totalPages);
    this.updateZoomLevel();
  },

  setupPDFIntersectionObserver() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.dataset.page, 10);
          this.renderPDFPage(pageNum);
        }
      });
    }, {
      root: document.getElementById('reader-content'),
      rootMargin: '600px 0px 600px 0px' // Pré-renderiza com margem ampla
    });

    this.pdfPages.forEach(p => observer.observe(p.wrapper));
  },

  async renderPDFPage(pageNum) {
    const item = this.pdfPages[pageNum - 1];
    if (!item || item.rendered || item.rendering) return;
    item.rendering = true;

    try {
      if (!item.page) {
        item.page = await this.pdfDoc.getPage(pageNum);
      }

      const viewport = item.page.getViewport({ scale: this.pdfScale });
      const outputScale = window.devicePixelRatio || 1;

      item.wrapper.style.width = `${viewport.width}px`;
      item.wrapper.style.height = `${viewport.height}px`;
      item.wrapper.style.minHeight = `${viewport.height}px`;

      item.canvas.width = Math.floor(viewport.width * outputScale);
      item.canvas.height = Math.floor(viewport.height * outputScale);
      item.canvas.style.width = `${viewport.width}px`;
      item.canvas.style.height = `${viewport.height}px`;

      const ctx = item.canvas.getContext('2d');
      ctx.scale(outputScale, outputScale);

      const renderContext = {
        canvasContext: ctx,
        viewport
      };
      await item.page.render(renderContext).promise;
      item.rendered = true;

      // Renderiza Camada de Texto para SELEÇÃO DE TEXTO
      try {
        item.textLayer.innerHTML = '';
        item.textLayer.style.width = `${viewport.width}px`;
        item.textLayer.style.height = `${viewport.height}px`;

        const textContent = await item.page.getTextContent();
        if (pdfjsLib.renderTextLayer) {
          await pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: item.textLayer,
            viewport: viewport,
            textDivs: []
          }).promise;
        }
      } catch (textErr) {
        console.warn(`[PDF] Camada de texto da página ${pageNum} ignorada:`, textErr);
      }
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') {
        console.warn(`Erro ao renderizar página PDF ${pageNum}:`, err);
      }
    } finally {
      item.rendering = false;
    }
  },

  setupPDFTextSelection(container) {
    const handleSelection = () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';

      if (!text || text.length < 2) {
        this.hideSelectionBar();
        return;
      }

      // Garante que a seleção pertence ao container de páginas
      if (!container.contains(sel.anchorNode)) return;

      this.selectedText = text;
      this.selectedRangeInfo = {
        page: this.getCurrentPDFPage(),
        label: `Página ${this.getCurrentPDFPage()}`
      };

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      this.showSelectionBar(rect);
    };

    container.addEventListener('mouseup', handleSelection);
    container.addEventListener('touchend', () => setTimeout(handleSelection, 150));
  },

  updatePDFProgress(scrollContainer, totalPages) {
    if (!this.currentBook || this.currentType !== 'pdf') return;

    const wrappers = scrollContainer.querySelectorAll('.pdf-page-wrapper');
    let currentPage = 1;

    wrappers.forEach((w, idx) => {
      const rect = w.getBoundingClientRect();
      if (rect.top < window.innerHeight / 2) {
        currentPage = idx + 1;
      }
    });

    Store.saveProgress(this.currentBook.name, {
      type: 'pdf',
      page: currentPage,
      totalPages,
      percent: totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 1
    });

    this.updateProgressBar(currentPage, totalPages);
  },

  zoomIn() {
    if (this.currentType !== 'pdf' || !this.pdfDoc) return;
    this.pdfScale = Math.min(+(this.pdfScale + 0.15).toFixed(2), 3.0);
    this.reRenderAllPDF();
  },

  zoomOut() {
    if (this.currentType !== 'pdf' || !this.pdfDoc) return;
    this.pdfScale = Math.max(+(this.pdfScale - 0.15).toFixed(2), 0.5);
    this.reRenderAllPDF();
  },

  fitWidth() {
    if (this.currentType !== 'pdf' || !this.pdfDoc) return;
    const content = document.getElementById('reader-content');
    const availableWidth = (content?.clientWidth || window.innerWidth) - 32;
    if (availableWidth > 200 && this.pdfPages[0]?.page) {
      const vp = this.pdfPages[0].page.getViewport({ scale: 1.0 });
      this.pdfScale = +(availableWidth / vp.width).toFixed(2);
      this.reRenderAllPDF();
    }
  },

  reRenderAllPDF() {
    this.updateZoomLevel();
    this.pdfPages.forEach(p => { p.rendered = false; });
    const cur = this.getCurrentPDFPage();
    this.renderPDFPage(cur);
    if (cur > 1) this.renderPDFPage(cur - 1);
    if (cur < this.pdfPages.length) this.renderPDFPage(cur + 1);
  },

  updateZoomLevel() {
    const el = document.getElementById('zoom-level');
    if (el) el.textContent = `${Math.round(this.pdfScale * 100)}%`;
  },

  /* ==========================================
     EPUB Reader (ePub.js com Seleção Nativa)
     ========================================== */
  async loadEPUB(url, container) {
    container.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <div class="loading-text">Carregando livro dinâmico...</div>
      </div>
    `;

    document.getElementById('zoom-controls').style.display = 'none';
    container.innerHTML = `<div class="epub-container" id="epub-viewer"></div>`;

    this.epubBook = ePub(url);
    this.epubRendition = this.epubBook.renderTo('epub-viewer', {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'scrolled-doc'
    });

    const theme = Utils.getTheme();
    this.applyEpubTheme(theme);

    const progress = Store.getProgress(this.currentBook.name);
    if (progress && progress.location) {
      this.epubRendition.display(progress.location);
    } else {
      this.epubRendition.display();
    }

    this.epubRendition.on('relocated', (location) => {
      if (!this.currentBook) return;

      const percent = this.epubBook.locations ?
        this.epubBook.locations.percentageFromCfi(location.start.cfi) : 0;

      Store.saveProgress(this.currentBook.name, {
        type: 'epub',
        location: location.start.cfi,
        percent: percent || 0
      });

      this.updateProgressBar(Math.round((percent || 0) * 100), 100);
    });

    this.epubBook.ready.then(() => {
      return this.epubBook.locations.generate(1024);
    });

    // Captura evento de seleção de texto dentro do iframe do ePub
    this.epubRendition.on('selected', (cfiRange, contents) => {
      this.epubBook.getRange(cfiRange).then(range => {
        if (!range) return;
        const text = range.toString().trim();
        if (!text || text.length < 2) {
          this.hideSelectionBar();
          return;
        }

        this.selectedText = text;
        this.selectedRangeInfo = {
          cfi: cfiRange,
          label: 'Trecho do EPUB'
        };

        const rect = range.getBoundingClientRect();
        // Converte coordenadas do iframe para a tela principal
        const iframe = document.querySelector('#epub-viewer iframe');
        const iframeRect = iframe ? iframe.getBoundingClientRect() : { top: 0, left: 0 };
        this.showSelectionBar({
          top: rect.top + iframeRect.top,
          bottom: rect.bottom + iframeRect.top,
          left: rect.left + iframeRect.left,
          right: rect.right + iframeRect.left,
          width: rect.width,
          height: rect.height
        });
      });
    });

    // Fecha a barra se clicar fora
    this.epubRendition.on('click', () => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || !sel.toString().trim()) {
          this.hideSelectionBar();
        }
      }, 100);
    });

    this.epubRendition.on('keyup', (e) => {
      if (e.key === 'ArrowLeft') this.epubRendition.prev();
      if (e.key === 'ArrowRight') this.epubRendition.next();
    });
  },

  applyEpubTheme(theme) {
    if (!this.epubRendition) return;

    if (theme === 'dark' || this.nightMode) {
      this.epubRendition.themes.default({
        body: {
          color: '#e8eaf0 !important',
          background: '#141620 !important',
          'font-family': 'Inter, system-ui, sans-serif !important',
          'line-height': '1.7 !important',
          'padding': '16px !important'
        },
        'p, div, span, li': {
          color: '#e8eaf0 !important'
        },
        'a, a:link, a:visited': {
          color: '#6b8aff !important'
        },
        'pre, code': {
          background: '#1e2130 !important',
          color: '#8be9fd !important',
          'border-radius': '6px !important'
        }
      });
    } else {
      this.epubRendition.themes.default({
        body: {
          color: '#1a1d29 !important',
          background: '#ffffff !important',
          'font-family': 'Inter, system-ui, sans-serif !important',
          'line-height': '1.7 !important',
          'padding': '16px !important'
        },
        'pre, code': {
          background: '#f1f3f9 !important',
          color: '#d63384 !important'
        }
      });
    }
  },

  increaseFontSize() {
    if (this.currentType === 'pdf') {
      this.zoomIn();
      return;
    }
    if (!this.epubRendition) return;
    const current = parseInt(this.epubRendition.themes._overrides?.fontSize || '100', 10);
    const newSize = Math.min(current + 10, 220);
    this.epubRendition.themes.fontSize(`${newSize}%`);
    Utils.showToast(`Fonte: ${newSize}%`);
  },

  decreaseFontSize() {
    if (this.currentType === 'pdf') {
      this.zoomOut();
      return;
    }
    if (!this.epubRendition) return;
    const current = parseInt(this.epubRendition.themes._overrides?.fontSize || '100', 10);
    const newSize = Math.max(current - 10, 60);
    this.epubRendition.themes.fontSize(`${newSize}%`);
    Utils.showToast(`Fonte: ${newSize}%`);
  },

  toggleNightMode() {
    const readerView = document.getElementById('reader-view');
    this.nightMode = !this.nightMode;

    if (this.nightMode) {
      readerView.classList.add('night-mode');
      if (this.epubRendition) this.applyEpubTheme('dark');
      Utils.showToast('🌙 Modo noturno ativado');
    } else {
      readerView.classList.remove('night-mode');
      if (this.epubRendition) this.applyEpubTheme(Utils.getTheme());
      Utils.showToast('☀️ Modo diurno ativado');
    }
  },

  /* ==========================================
     Toolbar Flutuante de Seleção
     ========================================== */
  showSelectionBar(rect) {
    const bar = document.getElementById('selection-bar');
    if (!bar || !rect) return;

    bar.classList.add('active');

    // Centraliza sobre o trecho com margem de segurança na tela
    const barWidth = 280;
    const barHeight = 44;
    let top = rect.top - barHeight - 10;
    let left = rect.left + (rect.width / 2) - (barWidth / 2);

    if (top < 64) {
      top = rect.bottom + 12; // Posiciona abaixo se não couber no topo
    }
    if (left < 10) left = 10;
    if (left + barWidth > window.innerWidth - 10) {
      left = window.innerWidth - barWidth - 10;
    }

    bar.style.top = `${top}px`;
    bar.style.left = `${left}px`;
  },

  hideSelectionBar() {
    const bar = document.getElementById('selection-bar');
    if (bar) bar.classList.remove('active');
  },

  setupSelectionBarActions() {
    const bar = document.getElementById('selection-bar');
    if (!bar) return;

    bar.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        const text = this.selectedText;
        this.hideSelectionBar();

        if (!text) return;

        if (action === 'ask') {
          AIChat.setSelection(text);
        } else if (action === 'explain') {
          AIChat.setSelection(text);
          AIChat.sendPrompt(`Explique detalhadamente este trecho do livro, seu significado e aplicação prática:\n"${text}"`);
        } else if (action === 'note') {
          this.showAddNoteModal(text, this.selectedRangeInfo);
        } else if (action === 'copy') {
          navigator.clipboard.writeText(text).then(() => {
            Utils.showToast('📋 Trecho copiado!');
          }).catch(() => {
            Utils.showToast('Não foi possível copiar');
          });
        }
      });
    });
  },

  /* ==========================================
     Contexto da Página Atual (para a IA)
     ========================================== */
  async getCurrentPageText() {
    if (this.currentType === 'pdf') {
      const pageNum = this.getCurrentPDFPage();
      const item = this.pdfPages[pageNum - 1];
      if (item) {
        if (!item.page) item.page = await this.pdfDoc.getPage(pageNum);
        const textContent = await item.page.getTextContent();
        const text = textContent.items.map(i => i.str).join(' ');
        return { text, label: `Página ${pageNum}` };
      }
    } else if (this.currentType === 'epub' && this.epubRendition) {
      const location = this.epubRendition.currentLocation();
      if (location && location.start) {
        // Extrai texto visível do iframe do epub
        const iframe = document.querySelector('#epub-viewer iframe');
        if (iframe && iframe.contentDocument) {
          const bodyText = iframe.contentDocument.body.innerText || '';
          return { text: bodyText.slice(0, 8000), label: 'Seção atual do EPUB' };
        }
      }
    }
    return null;
  },

  /* ==========================================
     Marcadores & Observações
     ========================================== */
  toggleBookmarks() {
    const panel = document.getElementById('bookmarks-panel');
    this.bookmarksOpen = !this.bookmarksOpen;

    if (this.bookmarksOpen) {
      panel.classList.add('open');
      this.renderBookmarksList();
      this.renderNotesList();
    } else {
      panel.classList.remove('open');
    }
  },

  closeBookmarks() {
    const panel = document.getElementById('bookmarks-panel');
    if (panel) panel.classList.remove('open');
    this.bookmarksOpen = false;
  },

  switchPanelTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.panel-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    const bList = document.getElementById('bookmarks-list');
    const nList = document.getElementById('notes-list');
    if (tab === 'bookmarks') {
      bList.hidden = false;
      nList.hidden = true;
    } else {
      bList.hidden = true;
      nList.hidden = false;
    }
  },

  showAddBookmarkModal() {
    const modal = document.getElementById('bookmark-modal');
    const nameInput = document.getElementById('bookmark-name-input');
    const noteInput = document.getElementById('bookmark-note-input');

    let defaultName = '';
    if (this.currentType === 'pdf') {
      const currentPage = this.getCurrentPDFPage();
      defaultName = `Página ${currentPage}`;
    } else if (this.currentType === 'epub') {
      defaultName = `Posição atual`;
    }

    nameInput.value = defaultName;
    noteInput.value = '';
    modal.classList.add('active');
    nameInput.focus();
    nameInput.select();
  },

  confirmAddBookmark() {
    if (!this.currentBook) return;

    const nameInput = document.getElementById('bookmark-name-input');
    const noteInput = document.getElementById('bookmark-note-input');
    const name = nameInput.value.trim() || 'Sem nome';
    const note = noteInput.value.trim() || null;

    let bookmark = { name, note };

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

    Store.addBookmark(this.currentBook.name, bookmark);
    this.closeBookmarkModal();
    this.renderBookmarksList();
    Utils.showToast('📑 Marcador salvo no seu banco!');
  },

  closeBookmarkModal() {
    document.getElementById('bookmark-modal')?.classList.remove('active');
  },

  goToBookmark(bookmark) {
    if (this.currentType === 'pdf' && bookmark.page) {
      const target = document.querySelector(`.pdf-page-wrapper[data-page="${bookmark.page}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        Utils.showToast(`📑 Indo para: ${bookmark.name}`);
      }
    } else if (this.currentType === 'epub' && bookmark.cfi && this.epubRendition) {
      this.epubRendition.display(bookmark.cfi);
      Utils.showToast(`📑 Indo para: ${bookmark.name}`);
    }
  },

  deleteBookmark(id) {
    if (!this.currentBook) return;
    Store.removeBookmark(this.currentBook.name, id);
    this.renderBookmarksList();
    Utils.showToast('Marcador removido');
  },

  renderBookmarksList() {
    const list = document.getElementById('bookmarks-list');
    const countEl = document.getElementById('count-bookmarks');
    if (!list || !this.currentBook) return;

    const bookmarks = Store.getBookmarks(this.currentBook.name);
    if (countEl) countEl.textContent = bookmarks.length;

    if (bookmarks.length === 0) {
      list.innerHTML = `
        <div class="bookmarks-empty">
          <div class="bookmarks-empty-icon">📑</div>
          <div>Nenhum marcador ainda</div>
          <div style="font-size: 0.75rem;">Clique em "Marcar" para guardar páginas importantes com anotações.</div>
        </div>
      `;
      return;
    }

    list.innerHTML = bookmarks.map(b => `
      <div class="bookmark-item" onclick="Reader.goToBookmark(${JSON.stringify(b).replace(/"/g, '&quot;')})">
        <div class="bookmark-icon">📑</div>
        <div class="bookmark-details">
          <div class="bookmark-name">${Utils.escapeHtml(b.name)}</div>
          <div class="bookmark-page">${b.label || ''} · ${this.formatDate(b.createdAt)}</div>
          ${b.note ? `<div class="bookmark-note-preview">💬 ${Utils.escapeHtml(b.note)}</div>` : ''}
        </div>
        <button class="bookmark-delete" onclick="event.stopPropagation(); Reader.deleteBookmark('${b.id}')" title="Remover">✕</button>
      </div>
    `).join('');
  },

  /* ==========================================
     Notas (Anotações com Trecho Citado)
     ========================================== */
  showAddNoteModal(quoteText, rangeInfo) {
    const modal = document.getElementById('note-modal');
    const quoteEl = document.getElementById('note-quote');
    const textInput = document.getElementById('note-text-input');

    quoteEl.textContent = `"${quoteText}"`;
    textInput.value = '';
    this._pendingNoteQuote = quoteText;
    this._pendingNoteRange = rangeInfo;

    modal.classList.add('active');
    textInput.focus();
  },

  confirmAddNote() {
    if (!this.currentBook) return;

    const textInput = document.getElementById('note-text-input');
    const noteText = textInput.value.trim();

    if (!noteText && !this._pendingNoteQuote) return;

    const note = {
      quote: this._pendingNoteQuote,
      note: noteText,
      page: this._pendingNoteRange?.page || null,
      cfi: this._pendingNoteRange?.cfi || null,
      label: this._pendingNoteRange?.label || null
    };

    Store.addNote(this.currentBook.name, note);
    this.closeNoteModal();
    this.renderNotesList();
    Utils.showToast('📝 Anotação salva no seu banco!');
  },

  closeNoteModal() {
    document.getElementById('note-modal')?.classList.remove('active');
    this._pendingNoteQuote = null;
    this._pendingNoteRange = null;
  },

  deleteNote(id) {
    if (!this.currentBook) return;
    Store.removeNote(this.currentBook.name, id);
    this.renderNotesList();
    Utils.showToast('Nota removida');
  },

  renderNotesList() {
    const list = document.getElementById('notes-list');
    const countEl = document.getElementById('count-notes');
    if (!list || !this.currentBook) return;

    const notes = Store.getNotes(this.currentBook.name);
    if (countEl) countEl.textContent = notes.length;

    if (notes.length === 0) {
      list.innerHTML = `
        <div class="bookmarks-empty">
          <div class="bookmarks-empty-icon">📝</div>
          <div>Nenhuma anotação neste livro</div>
          <div style="font-size: 0.75rem;">Selecione um trecho do livro e clique em "Anotar" para guardar suas ideias.</div>
        </div>
      `;
      return;
    }

    list.innerHTML = notes.map(n => `
      <div class="bookmark-item note-card">
        <div class="bookmark-icon">📝</div>
        <div class="bookmark-details">
          ${n.quote ? `<blockquote class="note-item-quote">"${Utils.escapeHtml(n.quote.slice(0, 160))}${n.quote.length > 160 ? '...' : ''}"</blockquote>` : ''}
          <div class="note-item-text">${Utils.escapeHtml(n.note || '(Sem texto)')}</div>
          <div class="bookmark-page">${n.label || ''} · ${this.formatDate(n.createdAt)}</div>
        </div>
        <button class="bookmark-delete" onclick="event.stopPropagation(); Reader.deleteNote('${n.id}')" title="Remover">✕</button>
      </div>
    `).join('');
  },

  /* ==========================================
     Modal / Sheet de Escolha de Download (PDF ou EPUB)
     ========================================== */
  showDownloadModal() {
    if (!this.currentBook) return;
    App.openDownloadModal(this.currentBook);
  },

  /* ==========================================
     Helpers
     ========================================== */
  getCurrentPDFPage() {
    const wrappers = document.querySelectorAll('.pdf-page-wrapper');
    let currentPage = 1;
    wrappers.forEach((w, idx) => {
      const rect = w.getBoundingClientRect();
      if (rect.top < window.innerHeight / 2) {
        currentPage = idx + 1;
      }
    });
    return currentPage;
  },

  updateProgressBar(current, total) {
    const bar = document.getElementById('reader-progress-bar');
    if (!bar || !total) return;
    const percent = Math.min((current / total) * 100, 100);
    bar.style.width = `${percent}%`;
  },

  formatDate(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
};

// Eventos de inicialização do leitor
document.addEventListener('DOMContentLoaded', () => {
  Reader.setupSelectionBarActions();

  // Abas de marcadores vs notas
  document.querySelectorAll('.panel-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', (e) => {
      Reader.switchPanelTab(e.currentTarget.dataset.tab);
    });
  });

  // Modais
  document.getElementById('note-save')?.addEventListener('click', () => Reader.confirmAddNote());
  document.getElementById('note-cancel')?.addEventListener('click', () => Reader.closeNoteModal());
  document.getElementById('note-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'note-modal') Reader.closeNoteModal();
  });

  // Download do leitor abre a escolha
  document.getElementById('reader-download')?.addEventListener('click', () => Reader.showDownloadModal());

  // Botão de zoom fit
  document.getElementById('zoom-fit')?.addEventListener('click', () => Reader.fitWidth());

  // Menu de overflow no mobile
  const readerMore = document.getElementById('reader-more');
  const readerTools = document.getElementById('reader-tools');
  readerMore?.addEventListener('click', () => {
    readerTools?.classList.toggle('mobile-open');
  });

  // Fecha toolbar de seleção ao clicar fora
  document.addEventListener('mousedown', (e) => {
    const bar = document.getElementById('selection-bar');
    if (bar && !bar.contains(e.target) && !e.target.closest('#reader-content')) {
      Reader.hideSelectionBar();
    }
  });
});
