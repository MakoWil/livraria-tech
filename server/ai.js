/* ============================================
   LIVRARIA TECH — Assistente de Leitura (Gemini)
   Streaming via Server-Sent Events. A chave fica só no servidor.
   ============================================ */

const express = require('express');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_HISTORY = 20;          // mensagens anteriores enviadas ao modelo
const MAX_CONTEXT_CHARS = 14000; // texto da página atual
const MAX_SELECTION_CHARS = 6000;

/* ------------------------------------------
   Rate limit simples em memória (por usuário)
   ------------------------------------------ */
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 40;
const rateMap = new Map();

function rateLimited(userId) {
  const now = Date.now();
  const list = (rateMap.get(userId) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) {
    rateMap.set(userId, list);
    return true;
  }
  list.push(now);
  rateMap.set(userId, list);
  return false;
}

function getApiKey() {
  return (process.env.GEMINI_API_KEY || '').trim();
}

function buildSystemPrompt(bookTitle, userName) {
  return [
    'Você é o "Tutor Livraria Tech", um assistente de leitura especialista em programação e tecnologia.',
    `O usuário${userName ? ` (${userName})` : ''} está lendo o livro "${bookTitle || 'desconhecido'}".`,
    'Seu papel:',
    '1. Ajudar a ENTENDER o conteúdo: explicar conceitos, termos, trechos de código e o raciocínio do autor com clareza e exemplos.',
    '2. Ajudar a CRIAR em cima do livro: exercícios, resumos, mapas mentais, flashcards, projetos práticos, código de exemplo e variações.',
    'Regras:',
    '- Responda sempre em português do Brasil, a menos que o usuário peça outro idioma.',
    '- Use Markdown (títulos curtos, listas, **negrito**, blocos de código com a linguagem indicada).',
    '- Seja didático e direto; o usuário costuma ler no celular/tablet, então prefira respostas objetivas e bem estruturadas.',
    '- Quando houver "TRECHO SELECIONADO" ou "CONTEXTO DA PÁGINA", baseie-se nele e cite-o quando útil.',
    '- Se algo não estiver no trecho, deixe claro que é conhecimento complementar.'
  ].join('\n');
}

/**
 * Faz a chamada streaming ao Gemini com timeout e retorna a Response (ou lança erro)
 */
async function callGemini(model, payload, signal) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY não configurada no servidor.');
    err.status = 503;
    throw err;
  }

  // Timeout de 35s por chamada
  const timeoutSignal = AbortSignal.timeout(35000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const res = await fetch(`${API_BASE}/${model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(payload),
    signal: combinedSignal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Gemini ${model} respondeu ${res.status}`);
    err.status = res.status;
    err.details = text.slice(0, 500);
    throw err;
  }
  return res;
}

/**
 * POST /api/ai/chat
 * body: { bookTitle, messages:[{role:'user'|'model', text}], selection?, pageContext?, pageLabel? }
 */
router.post('/chat', async (req, res) => {
  if (!getApiKey()) {
    return res.status(503).json({ error: 'Assistente de IA não configurado no servidor (chave GEMINI_API_KEY ausente).' });
  }
  if (rateLimited(req.user.id)) {
    return res.status(429).json({ error: 'Muitas perguntas em pouco tempo. Aguarde alguns instantes.' });
  }

  const { bookTitle, messages, selection, pageContext, pageLabel } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Nenhuma mensagem enviada.' });
  }

  // Inicia SSE imediatamente para o cliente para evitar timeout 524 no Cloudflare / proxy
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(': connected\n\n');

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Monta histórico garantindo que comece com 'user' e respeite as regras da API Gemini
  let history = messages.map(m => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(m.text || '').slice(0, 8000) }]
  })).filter(m => m.parts[0].text && m.parts[0].text.trim());

  // A API Gemini exige que a primeira mensagem seja sempre 'user'
  while (history.length > 0 && history[0].role !== 'user') {
    history.shift();
  }

  // Mescla mensagens consecutivas do mesmo autor para manter alternância estrita
  const cleanedHistory = [];
  for (const item of history) {
    if (cleanedHistory.length > 0 && cleanedHistory[cleanedHistory.length - 1].role === item.role) {
      cleanedHistory[cleanedHistory.length - 1].parts[0].text += '\n\n' + item.parts[0].text;
    } else {
      cleanedHistory.push(item);
    }
  }
  history = cleanedHistory.slice(-MAX_HISTORY);

  if (history.length === 0) {
    send({ error: 'Nenhuma mensagem válida para enviar à IA.' });
    return res.end();
  }

  // Anexa contexto à última mensagem do usuário
  const last = history[history.length - 1];
  if (last && last.role === 'user') {
    const extras = [];
    if (pageContext) {
      extras.push(`CONTEXTO DA PÁGINA${pageLabel ? ` (${pageLabel})` : ''}:\n"""\n${String(pageContext).slice(0, MAX_CONTEXT_CHARS)}\n"""`);
    }
    if (selection) {
      extras.push(`TRECHO SELECIONADO:\n"""\n${String(selection).slice(0, MAX_SELECTION_CHARS)}\n"""`);
    }
    if (extras.length) {
      last.parts[0].text = `${extras.join('\n\n')}\n\nPERGUNTA:\n${last.parts[0].text}`;
    }
  }

  const payload = {
    systemInstruction: { parts: [{ text: buildSystemPrompt(bookTitle, req.user.name) }] },
    contents: history,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  const controller = new AbortController();
  // Aborta apenas se o cliente fechar a resposta antes de terminar (não no req.close)
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  const CANDIDATE_MODELS = Array.from(new Set([
    'gemini-2.5-flash',
    process.env.GEMINI_MODEL,
    'gemini-2.5-pro',
    'gemini-2.5-flash-lite'
  ].filter(Boolean)));

  let upstream = null;
  let lastErr = null;

  for (const model of CANDIDATE_MODELS) {
    try {
      console.log(`[AI] Tentando modelo Gemini: ${model}`);
      upstream = await callGemini(model, payload, controller.signal);
      if (upstream && upstream.ok) {
        console.log(`[AI] Sucesso com modelo Gemini: ${model}`);
        break;
      }
    } catch (err) {
      if (controller.signal.aborted) return res.end();
      lastErr = err;
      console.warn(`[AI] Falha com modelo ${model}: ${err.message}`, err.details || '');
    }
  }

  if (!upstream || !upstream.body) {
    console.error('[AI] Todos os modelos falharam:', lastErr?.message, lastErr?.details || '');
    send({ error: lastErr?.details || lastErr?.message || 'Falha ao conectar com o assistente Gemini.' });
    return res.end();
  }

  try {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let eventEnd;
      while ((eventEnd = buffer.indexOf('\n\n')) >= 0) {
        const eventBlock = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);

        const dataLines = eventBlock
          .split(/\r?\n/)
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).trim())
          .join('\n');

        if (!dataLines) continue;

        try {
          const data = JSON.parse(dataLines);
          const parts = data?.candidates?.[0]?.content?.parts || [];
          const text = parts.filter(p => !p.thought && p.text).map(p => p.text).join('');
          if (text) {
            send({ text });
          }
          const finish = data?.candidates?.[0]?.finishReason;
          if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
            send({ warning: `Resposta interrompida (${finish}).` });
          }
        } catch (_) { /* continua */ }
      }
    }
    send({ done: true });
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error('[AI] Erro no streaming:', err.message);
      send({ error: 'A conexão com a IA foi interrompida.' });
    }
  } finally {
    res.end();
  }
});

module.exports = router;
