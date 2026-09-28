const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 80;
const ALT_PORT = PORT === 80 ? 3000 : 80;
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const TEMP_DIR = path.join(CACHE_DIR, 'temp');

// Garante a existência dos diretórios de cache e arquivos temporários
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Map para evitar conversões simultâneas do mesmo arquivo (concurrency lock)
const activeConversions = new Map();

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

/**
 * Endpoint para conversão dinâmica de PDF para EPUB com cache em disco
 * Rota: GET /api/book-epub?url=<URL_ENCODED_DO_PDF_GITHUB>
 */
app.get('/api/book-epub', async (req, res) => {
  const fileUrl = req.query.url;

  if (!fileUrl) {
    return res.status(400).json({ error: 'Parâmetro "url" é obrigatório.' });
  }

  // Validação básica de URL
  let parsedUrl;
  try {
    parsedUrl = new URL(fileUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Protocolo de URL inválido. Apenas HTTP/HTTPS são permitidos.' });
    }
  } catch (err) {
    return res.status(400).json({ error: 'URL inválida.' });
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

    const safeFilename = filename.replace(/["\r\n]/g, '_');
    const encodedFilename = encodeURIComponent(safeFilename);

    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('X-Cache-Status', cacheStatus);

    if (isDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`);
    }

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

// Servir os arquivos estáticos da pasta raiz
app.use(express.static(__dirname, {
  index: 'index.html',
  maxAge: '1h'
}));

// Fallback para qualquer rota não mapeada entregar a interface da biblioteca
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Inicialização do servidor na porta principal
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  Livraria Tech - Servidor Node.js em execução`);
  console.log(`  Porta Principal: ${PORT}`);
  console.log(`  Diretório de Cache: ${CACHE_DIR}`);
  console.log(`  Ambiente: ${process.env.NODE_ENV || 'production'}`);
  console.log(`====================================================`);
});

// Inicialização opcional na porta alternativa para garantir compatibilidade com Coolify
try {
  app.listen(ALT_PORT, '0.0.0.0', () => {
    console.log(`  Porta Secundária ativa: ${ALT_PORT}`);
  });
} catch (err) {
  // Ignora se não puder fazer bind na porta alternativa
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
