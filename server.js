require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const { sessionMiddleware, requireAuth, registerAuthRoutes } = require('./server/auth');
const userApi = require('./server/api');
const aiApi = require('./server/ai');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 80;
const ALT_PORT = PORT === 80 ? 3000 : (PORT === 3000 ? 80 : null);
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const TEMP_DIR = path.join(CACHE_DIR, 'temp');

// Garante a existência dos diretórios de cache e arquivos temporários
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Map para evitar conversões simultâneas do mesmo arquivo (concurrency lock)
const activeConversions = new Map();

// Atrás do proxy reverso do Coolify (Traefik/Caddy) — necessário para detectar HTTPS
app.set('trust proxy', true);
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(sessionMiddleware);

/**
 * Endpoint de Health Check (usado pelo Docker e Coolify)
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Autenticação Google (/login, /auth/logout, /api/me)
registerAuthRoutes(app);

// Assistente de IA
app.use('/api/ai', aiApi);

/**
 * Hosts permitidos para download/conversão (evita uso do servidor como proxy aberto)
 */
const ALLOWED_HOSTS = new Set([
  'raw.githubusercontent.com',
  'github.com',
  'objects.githubusercontent.com',
  'media.githubusercontent.com'
]);

function validateRemoteUrl(fileUrl) {
  if (!fileUrl) return { error: 'Parâmetro "url" é obrigatório.' };
  try {
    const parsed = new URL(fileUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { error: 'Protocolo de URL inválido. Apenas HTTP/HTTPS são permitidos.' };
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return { error: 'Host não permitido.' };
    }
    return { url: parsed };
  } catch (err) {
    return { error: 'URL inválida.' };
  }
}

function contentDisposition(type, filename) {
  const safe = filename.replace(/["\r\n]/g, '_');
  return `${type}; filename="${safe.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/**
 * Proxy de download do arquivo original (força "Salvar como" em vez de abrir no navegador)
 * Rota: GET /api/book-file?url=<URL>&filename=<nome>
 */
app.get('/api/book-file', requireAuth, async (req, res) => {
  const check = validateRemoteUrl(req.query.url);
  if (check.error) return res.status(400).json({ error: check.error });

  try {
    const upstream = await fetch(check.url.toString(), {
      headers: { 'User-Agent': 'LivrariaTech/1.4' }
    });
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: `Falha ao baixar arquivo (status ${upstream.status})` });
    }

    const filename = String(req.query.filename || path.basename(check.url.pathname) || 'livro');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    res.setHeader('Content-Disposition', contentDisposition('attachment', filename));

    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    console.error('[BOOK-FILE] Erro:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao baixar arquivo.' });
  }
});

/**
 * Endpoint para conversão dinâmica de PDF para EPUB com cache em disco
 * Rota: GET /api/book-epub?url=<URL_ENCODED_DO_PDF_GITHUB>
 */
app.get('/api/book-epub', requireAuth, async (req, res) => {
  const fileUrl = req.query.url;

  // Validação de URL + whitelist de hosts
  const check = validateRemoteUrl(fileUrl);
  if (check.error) {
    return res.status(400).json({ error: check.error });
  }

  // Gera hash único SHA-256 para o arquivo com base na URL
  const hash = crypto.createHash('sha256').update(fileUrl).digest('hex');
  const epubPath = path.join(CACHE_DIR, `${hash}.epub`);
  const tempPdfPath = path.join(TEMP_DIR, `${hash}.pdf`);

  // Helper para envio do arquivo EPUB com headers corretos de exibição ou download
  const sendEpubFile = (filePath, cacheStatus) => {
    const isDownload = req.query.download === '1' || req.query.download === 'true';
    let filename = req.query.filename;

    if (!filename) {
      filename = path.basename(filePath);
    }
    if (!filename.toLowerCase().endsWith('.epub')) {
      filename += '.epub';
    }

    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('X-Cache-Status', cacheStatus);
    res.setHeader('Content-Disposition', contentDisposition(isDownload ? 'attachment' : 'inline', filename));

    return res.sendFile(filePath);
  };

  // 1. Verifica se já está em cache
  if (fs.existsSync(epubPath)) {
    try {
      const stats = fs.statSync(epubPath);
      if (stats.size > 0) {
        console.log(`[CACHE HIT] ${hash}.epub servido direto do cache`);
        return sendEpubFile(epubPath, 'HIT');
      }
    } catch (e) {
      console.warn(`[WARN] Erro ao verificar arquivo de cache:`, e.message);
    }
  }

  // 2. Se uma conversão deste mesmo livro já estiver em andamento, aguarda o término
  if (activeConversions.has(hash)) {
    console.log(`[WAIT] Conversão já em andamento para o hash ${hash}. Aguardando término...`);
    try {
      await activeConversions.get(hash);
      if (fs.existsSync(epubPath)) {
        return sendEpubFile(epubPath, 'HIT-AFTER-WAIT');
      }
    } catch (err) {
      return res.status(500).json({
        error: 'Falha durante a conversão do livro em processo concorrente.',
        details: err.message
      });
    }
  }

  // 3. Inicia processo de download e conversão
  const conversionPromise = (async () => {
    console.log(`[CONVERT START] Baixando PDF remoto: ${fileUrl}`);

    // Download do PDF com streaming para arquivo temporário
    const response = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'LivrariaTech-EpubConverter/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Falha ao baixar arquivo remoto do GitHub (Status: ${response.status} ${response.statusText})`);
    }

    const fileStream = fs.createWriteStream(tempPdfPath);
    await pipeline(Readable.fromWeb(response.body), fileStream);
    console.log(`[DOWNLOAD COMPLETE] PDF salvo em: ${tempPdfPath}`);

    // Executa a conversão via Calibre CLI (ebook-convert)
    console.log(`[EBOOK-CONVERT] Iniciando Calibre para gerar: ${hash}.epub`);
    const calibreArgs = [
      tempPdfPath,
      epubPath,
      '--enable-heuristics'
    ];

    await new Promise((resolve, reject) => {
      // Timeout de 180 segundos (3 minutos) para conversão
      execFile('ebook-convert', calibreArgs, {
        timeout: 180000,
        env: {
          ...process.env,
          QT_QPA_PLATFORM: 'offscreen',
          CALIBRE_TEMP_DIR: '/tmp'
        }
      }, (error, stdout, stderr) => {
        if (error) {
          console.error(`[EBOOK-CONVERT ERROR] Código: ${error.code}, Sinal: ${error.signal}`);
          if (stderr) console.error(`[EBOOK-CONVERT STDERR]:`, stderr);
          return reject(new Error(error.message || 'Falha na execução do ebook-convert'));
        }
        resolve(stdout);
      });
    });

    console.log(`[CONVERT SUCCESS] EPUB gerado com sucesso: ${epubPath}`);
  })();

  activeConversions.set(hash, conversionPromise);

  try {
    await conversionPromise;

    return sendEpubFile(epubPath, 'MISS');
  } catch (error) {
    console.error(`[CONVERT FAILED] Erro ao converter ${fileUrl}:`, error.message);

    // Limpeza de arquivo parcial/corrompido em caso de falha
    if (fs.existsSync(epubPath)) {
      try { fs.unlinkSync(epubPath); } catch (_) {}
    }

    return res.status(500).json({
      error: 'Não foi possível converter este PDF para EPUB.',
      message: error.message
    });
  } finally {
    // Remove arquivo PDF temporário
    if (fs.existsSync(tempPdfPath)) {
      try {
        fs.unlinkSync(tempPdfPath);
      } catch (err) {
        console.warn(`[WARN] Não foi possível remover PDF temporário ${tempPdfPath}:`, err.message);
      }
    }
    activeConversions.delete(hash);
  }
});

// Dados do usuário (progresso, marcadores, notas, favoritos)
app.use('/api', userApi);

// Qualquer outra rota /api inexistente responde 404 em JSON
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

// Servir APENAS os arquivos públicos (nunca a raiz do projeto — protege .db, server/, .env)
const staticOpts = { maxAge: '1h' };
app.use('/css', express.static(path.join(__dirname, 'css'), staticOpts));
app.use('/js', express.static(path.join(__dirname, 'js'), staticOpts));
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d' }));
app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(__dirname, 'manifest.webmanifest'));
});

// Fallback para qualquer rota não mapeada entregar a interface da biblioteca
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Inicialização do servidor na porta principal
const mainServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  Livraria Tech - Servidor Node.js em execução`);
  console.log(`  Porta Principal: ${PORT}  →  http://localhost:${PORT}`);
  console.log(`  Diretório de Cache: ${CACHE_DIR}`);
  console.log(`  Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`====================================================`);
});
mainServer.on('error', (err) => {
  console.error(`[FATAL] Não foi possível usar a porta ${PORT}:`, err.message);
  process.exit(1);
});

// Inicialização opcional na porta alternativa para garantir compatibilidade com Coolify
if (ALT_PORT) {
  const altServer = app.listen(ALT_PORT, '0.0.0.0', () => {
    console.log(`  Porta Secundária ativa: ${ALT_PORT}`);
  });
  // Ignora se não puder fazer bind na porta alternativa (sem derrubar o processo)
  altServer.on('error', () => {});
}

// Tratamento de sinais para desligamento gracioso (Docker)
process.on('SIGTERM', () => {
  console.log('Recebido SIGTERM, finalizando aplicação graciosamente...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Recebido SIGINT, finalizando aplicação graciosamente...');
  process.exit(0);
});
