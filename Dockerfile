# ==============================================================================
# Livraria Tech — Dockerfile Único (Node.js 20 + Calibre CLI)
# Compatível com ARM64 / AMD64 (Oracle Cloud VPS / Coolify)
# ==============================================================================
FROM node:20-slim

# Evita prompts interativos durante a instalação de pacotes e configura Calibre/Qt para modo headless
ENV DEBIAN_FRONTEND=noninteractive \
    QT_QPA_PLATFORM=offscreen \
    CALIBRE_TEMP_DIR=/tmp \
    NODE_ENV=production \
    PORT=3000 \
    CACHE_DIR=/app/cache

# Instala Calibre (para o binário ebook-convert), fontes do sistema e curl para o healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    calibre \
    fonts-liberation \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia manifests de pacotes primeiro para otimizar cache de camadas Docker
COPY package*.json ./

# Instala dependências de produção do Node.js
RUN npm install --omit=dev

# Copia todos os arquivos do projeto (server.js, index.html, js, css, etc.)
COPY . .

# Cria pasta de cache persistente (mapeada como volume no Coolify)
RUN mkdir -p /app/cache

EXPOSE 3000

# Verificação de integridade do container
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
