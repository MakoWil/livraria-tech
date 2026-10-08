/* ============================================
   LIVRARIA TECH — Módulo do Tutor de IA (Gemini)
   Chat interativo, streaming SSE, seleção de texto
   e contexto da página atual
   ============================================ */

const AIChat = {
  isOpen: false,
  messages: [],
  currentBook: null,
  activeSelection: null,
  isStreaming: false,
  abortController: null,

  // Atalhos rápidos para o leitor
  QUICK_PROMPTS: [
    { label: '💡 Explicar conceito', prompt: 'Explique de forma simples e didática o conceito principal deste trecho/página, com um exemplo prático.' },
    { label: '🎯 Gerar exercícios', prompt: 'Crie 2 exercícios práticos sobre o assunto abordado neste trecho/página para testar meu aprendizado, com gabarito comentado ao final.' },
    { label: '📋 Resumo em tópicos', prompt: 'Faça um resumo executivo em 3 a 5 tópicos destacados dos pontos mais importantes deste trecho/página.' },
    { label: '🛠️ Criar mini-projeto', prompt: 'Sugira uma ideia prática de mini-projeto ou código aplicando o que foi explicado neste conteúdo.' },
    { label: '🧠 Flashcards (Perguntas)', prompt: 'Crie 3 pares de Pergunta e Resposta no formato flashcard sobre este conteúdo.' }
  ],

  init() {
    this.bindEvents();
    this.renderQuickPrompts();
  },

  bindEvents() {
    const aiToggle = document.getElementById('reader-ai-toggle');
    const aiClose = document.getElementById('ai-close');
    const aiClear = document.getElementById('ai-clear');
    const aiForm = document.getElementById('ai-form');
    const aiInput = document.getElementById('ai-input');
    const chipRemove = document.getElementById('ai-selection-remove');
    const handle = document.getElementById('ai-panel-handle');

    aiToggle?.addEventListener('click', () => this.toggle());
    aiClose?.addEventListener('click', () => this.close());
    aiClear?.addEventListener('click', () => this.clearChat());

    aiForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.send();
    });

    chipRemove?.addEventListener('click', () => this.clearSelection());

    // Auto-expand textarea
    aiInput?.addEventListener('input', () => {
      aiInput.style.height = 'auto';
      aiInput.style.height = Math.min(aiInput.scrollHeight, 120) + 'px';
    });

    aiInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        // No celular, enter normal pode enviar ou pular linha; se não tiver shift e não for mobile keyboard complexo
        if (window.innerWidth > 768) {
          e.preventDefault();
          this.send();
        }
      }
    });

    // Touch handle para fechar ou arrastar no mobile
    if (handle) {
      let startY = 0;
      handle.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
      }, { passive: true });

      handle.addEventListener('touchmove', (e) => {
        const delta = e.touches[0].clientY - startY;
        if (delta > 80) {
          this.close();
        }
      }, { passive: true });
    }
  },

  setBook(book) {
    if (this.currentBook?.name !== book?.name) {
      this.currentBook = book;
      this.messages = [];
      this.clearSelection();
      this.renderMessages();
    }
    const bookLabel = document.getElementById('ai-panel-book');
    if (bookLabel) {
      bookLabel.textContent = book ? Utils.formatBookName(book.name) : 'Pergunte sobre o livro';
    }
  },

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  open() {
    this.isOpen = true;
    const panel = document.getElementById('ai-panel');
    const toggleBtn = document.getElementById('reader-ai-toggle');
    const readerView = document.getElementById('reader-view');
    panel?.classList.add('open');
    toggleBtn?.classList.add('active');
    readerView?.classList.add('ai-open');

    // Se estiver vazio, adiciona mensagem inicial de boas-vindas do tutor
    if (this.messages.length === 0) {
      const bookTitle = this.currentBook ? Utils.formatBookName(this.currentBook.name) : 'o livro';
      this.messages.push({
        role: 'model',
        text: `Olá! Sou seu **Tutor de IA** para a leitura de *${bookTitle}*.\n\nVocê pode me perguntar qualquer dúvida, selecionar um trecho no livro para que eu explique em detalhes, ou clicar nos atalhos rápidos abaixo para gerar resumos e exercícios práticos!`
      });
      this.renderMessages();
    }

    // Foca input se estiver em tela maior
    if (window.innerWidth > 768) {
      setTimeout(() => document.getElementById('ai-input')?.focus(), 200);
    }
  },

  close() {
    this.isOpen = false;
    const panel = document.getElementById('ai-panel');
    const toggleBtn = document.getElementById('reader-ai-toggle');
    const readerView = document.getElementById('reader-view');
    panel?.classList.remove('open');
    toggleBtn?.classList.remove('active');
    readerView?.classList.remove('ai-open');
  },

  clearChat() {
    if (this.isStreaming && this.abortController) {
      this.abortController.abort();
      this.isStreaming = false;
    }
    this.messages = [];
    this.clearSelection();
    this.renderMessages();
    Utils.showToast('✨ Conversa reiniciada');
  },

  setSelection(text) {
    if (!text || !text.trim()) return;
    this.activeSelection = text.trim();

    const chip = document.getElementById('ai-selection-chip');
    const chipText = document.getElementById('ai-selection-text');
    if (chip && chipText) {
      chipText.textContent = `"${this.activeSelection.slice(0, 160)}${this.activeSelection.length > 160 ? '...' : ''}"`;
      chip.hidden = false;
    }
    this.open();
  },

  clearSelection() {
    this.activeSelection = null;
    const chip = document.getElementById('ai-selection-chip');
    if (chip) chip.hidden = true;
  },

  renderQuickPrompts() {
    const container = document.getElementById('ai-quick');
    if (!container) return;
    container.innerHTML = this.QUICK_PROMPTS.map(p => `
      <button type="button" class="ai-quick-btn" data-prompt="${encodeURIComponent(p.prompt)}">
        ${p.label}
      </button>
    `).join('');

    container.querySelectorAll('.ai-quick-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const prompt = decodeURIComponent(e.currentTarget.dataset.prompt);
        this.sendPrompt(prompt);
      });
    });
  },

  renderMessages() {
    const container = document.getElementById('ai-messages');
    if (!container) return;

    if (this.messages.length === 0) {
      container.innerHTML = `
        <div class="ai-empty">
          <div class="ai-empty-icon">✨</div>
          <div>Como posso ajudar com a sua leitura hoje?</div>
        </div>
      `;
      return;
    }

    container.innerHTML = this.messages.map((m, idx) => {
      const isUser = m.role === 'user';
      let html = '';
      if (isUser) {
        html = Utils.escapeHtml(m.text).replace(/\n/g, '<br>');
      } else {
        // Renderiza Markdown para respostas da IA com sanitização DOMPurify
        if (window.marked && window.DOMPurify) {
          const raw = marked.parse(m.text || '');
          html = DOMPurify.sanitize(raw);
        } else {
          html = Utils.escapeHtml(m.text).replace(/\n/g, '<br>');
        }
      }

      const selectionSnippet = m.selection ? `
        <div class="ai-msg-quote">
          <span class="quote-label">📌 Trecho:</span> "${Utils.escapeHtml(m.selection.slice(0, 120))}${m.selection.length > 120 ? '...' : ''}"
        </div>
      ` : '';

      return `
        <div class="ai-msg ${isUser ? 'user' : 'model'}" data-idx="${idx}">
          <div class="ai-msg-bubble">
            ${selectionSnippet}
            <div class="ai-msg-text">${html}</div>
          </div>
        </div>
      `;
    }).join('');

    this.scrollToBottom();
  },

  scrollToBottom() {
    const container = document.getElementById('ai-messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  },

  async sendPrompt(text) {
    const input = document.getElementById('ai-input');
    if (input) input.value = text;
    await this.send();
  },

  async send() {
    if (this.isStreaming) return;

    const input = document.getElementById('ai-input');
    const text = input ? input.value.trim() : '';
    if (!text && !this.activeSelection) return;

    const userText = text || 'Explique o trecho selecionado acima e me dê dicas práticas.';
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }

    // Salva seleção atual para a mensagem
    const attachedSelection = this.activeSelection;
    this.clearSelection();

    // Contexto da página
    const useContext = document.getElementById('ai-use-context')?.checked ?? true;
    let pageContext = null;
    let pageLabel = null;

    if (useContext && typeof Reader?.getCurrentPageText === 'function') {
      try {
        const pageData = await Reader.getCurrentPageText();
        pageContext = pageData?.text || null;
        pageLabel = pageData?.label || null;
      } catch (err) {
        console.warn('Erro ao obter texto da página:', err);
      }
    }

    // Mensagem do usuário
    this.messages.push({
      role: 'user',
      text: userText,
      selection: attachedSelection
    });

    // Mensagem vazia do modelo para receber streaming
    const modelMsg = {
      role: 'model',
      text: '',
      loading: true
    };
    this.messages.push(modelMsg);
    this.renderMessages();

    this.isStreaming = true;
    const sendBtn = document.getElementById('ai-send');
    if (sendBtn) sendBtn.disabled = true;

    this.abortController = new AbortController();

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          bookTitle: this.currentBook ? Utils.formatBookName(this.currentBook.name) : 'Livro',
          messages: this.messages.slice(0, -1).map(m => ({ role: m.role, text: m.text })),
          selection: attachedSelection,
          pageContext,
          pageLabel
        }),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Erro ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const packet = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = packet.split(/\r?\n/);
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const jsonStr = line.slice(5).trim();
              if (!jsonStr) continue;
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.text) {
                  modelMsg.text += parsed.text;
                  modelMsg.loading = false;
                  this.updateLastModelMessage();
                }
                if (parsed.error) {
                  modelMsg.text = `⚠️ ${parsed.error}`;
                  modelMsg.loading = false;
                  this.updateLastModelMessage();
                }
                if (parsed.done) {
                  modelMsg.loading = false;
                  this.updateLastModelMessage();
                }
              } catch (_) {}
            }
          }
        }
      }

      modelMsg.loading = false;
      this.updateLastModelMessage();

    } catch (err) {
      if (err.name === 'AbortError') {
        modelMsg.text += '\n\n*(Geração interrompida)*';
      } else {
        modelMsg.text = `⚠️ Não foi possível obter resposta: ${err.message || 'Erro inesperado'}`;
      }
      this.updateLastModelMessage();
    } finally {
      this.isStreaming = false;
      this.abortController = null;
      if (sendBtn) sendBtn.disabled = false;
    }
  },

  updateLastModelMessage() {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    const lastMsgEl = container.querySelector('.ai-msg.model:last-child .ai-msg-text');
    if (!lastMsgEl) {
      this.renderMessages();
      return;
    }

    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg) {
      if (window.marked && window.DOMPurify) {
        const raw = marked.parse(lastMsg.text || 'Digitando...');
        lastMsgEl.innerHTML = DOMPurify.sanitize(raw);
      } else {
        lastMsgEl.innerHTML = Utils.escapeHtml(lastMsg.text || 'Digitando...').replace(/\n/g, '<br>');
      }
      this.scrollToBottom();
    }
  }
};

document.addEventListener('DOMContentLoaded', () => AIChat.init());
