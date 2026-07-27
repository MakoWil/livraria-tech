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
   * Save reading progress for a book
   */
  saveProgress(bookName, data) {
    try {
      const allProgress = JSON.parse(localStorage.getItem('livraria_progress') || '{}');
      allProgress[bookName] = {
        ...data,
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem('livraria_progress', JSON.stringify(allProgress));
    } catch (e) {
      console.warn('Erro ao salvar progresso:', e);
    }
  },

  /**
   * Get reading progress for a book
   */
  getProgress(bookName) {
    try {
      const allProgress = JSON.parse(localStorage.getItem('livraria_progress') || '{}');
      return allProgress[bookName] || null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Save bookmarks for a book
   */
  saveBookmarks(bookName, bookmarks) {
    try {
      const allBookmarks = JSON.parse(localStorage.getItem('livraria_bookmarks') || '{}');
      allBookmarks[bookName] = bookmarks;
      localStorage.setItem('livraria_bookmarks', JSON.stringify(allBookmarks));
    } catch (e) {
      console.warn('Erro ao salvar marcadores:', e);
    }
  },

  /**
   * Get bookmarks for a book
   */
  getBookmarks(bookName) {
    try {
      const allBookmarks = JSON.parse(localStorage.getItem('livraria_bookmarks') || '{}');
      return allBookmarks[bookName] || [];
    } catch (e) {
      return [];
    }
  },

  /**
   * Add a bookmark
   */
  addBookmark(bookName, bookmark) {
    const bookmarks = this.getBookmarks(bookName);
    bookmark.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    bookmark.createdAt = new Date().toISOString();
    bookmarks.push(bookmark);
    this.saveBookmarks(bookName, bookmarks);
    return bookmark;
  },

  /**
   * Remove a bookmark
   */
  removeBookmark(bookName, bookmarkId) {
    const bookmarks = this.getBookmarks(bookName).filter(b => b.id !== bookmarkId);
    this.saveBookmarks(bookName, bookmarks);
    return bookmarks;
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
      localStorage.setItem(`livraria_cache_${key}`, JSON.stringify(cacheEntry));
    } catch (e) {
      console.warn('Erro ao salvar cache:', e);
    }
  },

  /**
   * Get cached data
   */
  getCacheData(key) {
    try {
      const raw = localStorage.getItem(`livraria_cache_${key}`);
      if (!raw) return null;
      const cacheEntry = JSON.parse(raw);
      if (Date.now() > cacheEntry.expiry) {
        localStorage.removeItem(`livraria_cache_${key}`);
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
  }
};
