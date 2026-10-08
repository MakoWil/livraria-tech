/* ============================================
   LIVRARIA TECH — Utilities Module
   ============================================ */

const Utils = {
  /**
   * Format file size from bytes to human readable
   */
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  },

  /**
   * Format book name from filename
   * Removes extension, replaces separators, cleans up
   */
  formatBookName(filename) {
    if (!filename) return 'Sem título';
    return filename
      .replace(/\.(pdf|epub|mobi|djvu)$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  },

  /**
   * Get file extension
   */
  getExtension(filename) {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  },

  /**
   * Debounce function
   */
  debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /**
   * Escape HTML (para conteúdo gerado pelo usuário)
   */
  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /* ==========================================
     Progresso / Marcadores — agora persistidos no banco (via Store)
     ========================================== */
  saveProgress(bookName, data) {
    Store.saveProgress(bookName, data);
  },

  getProgress(bookName) {
    return Store.getProgress(bookName);
  },

  getBookmarks(bookName) {
    return Store.getBookmarks(bookName);
  },

  addBookmark(bookName, bookmark) {
    return Store.addBookmark(bookName, bookmark);
  },

  removeBookmark(bookName, bookmarkId) {
    return Store.removeBookmark(bookName, bookmarkId);
  },

  /**
   * Cache GitHub API data
   */
  setCacheData(key, data, ttlMinutes = 30) {
    try {
      const cacheEntry = {
        data,
        expiry: Date.now() + ttlMinutes * 60 * 1000
      };
      localStorage.setItem(`livraria_v2_cache_${key}`, JSON.stringify(cacheEntry));
    } catch (e) {
      console.warn('Erro ao salvar cache:', e);
    }
  },

  /**
   * Get cached data
   */
  getCacheData(key) {
    try {
      const raw = localStorage.getItem(`livraria_v2_cache_${key}`);
      if (!raw) return null;
      const cacheEntry = JSON.parse(raw);
      if (Date.now() > cacheEntry.expiry) {
        localStorage.removeItem(`livraria_v2_cache_${key}`);
        return null;
      }
      return cacheEntry.data;
    } catch (e) {
      return null;
    }
  },

  /**
   * Get/Set theme preference
   */
  getTheme() {
    return localStorage.getItem('livraria_theme') || 'light';
  },

  setTheme(theme) {
    localStorage.setItem('livraria_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  },

  /**
   * Get/Set view mode
   */
  getViewMode() {
    return localStorage.getItem('livraria_viewmode') || 'grid';
  },

  setViewMode(mode) {
    localStorage.setItem('livraria_viewmode', mode);
  },

  /**
   * Show toast notification
   */
  showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  },

  /**
   * Generate random star rating for display
   */
  generateStars() {
    const rating = Math.floor(Math.random() * 2) + 4; // 4 or 5 stars
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  },

  /* ==========================================
     Favorites Management (persistido no banco via Store)
     ========================================== */

  getFavorites() {
    return Store.getFavorites();
  },

  toggleFavorite(bookName) {
    return Store.toggleFavorite(bookName); // true se adicionou
  },

  isFavorite(bookName) {
    return Store.isFavorite(bookName);
  }
};
