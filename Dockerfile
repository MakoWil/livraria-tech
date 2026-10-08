# ==============================================================================
# Livraria Tech — Dockerfile Único (Node.js 22 LTS + Calibre CLI)
# Compatível com ARM64 / AMD64 (Oracle Cloud VPS / Coolify)
# ==============================================================================
FROM node:22-slim

# Evita prompts interativos durante a instalação de pacotes e configura Calibre/Qt para modo headless
ENV DEBIAN_FRONTEND=noninteractive \
    QT_QPA_PLATFORM=offscreen \
    CALIBRE_TEMP_DIR=/tmp \
    NODE_ENV=production \
    PORT=80 \
    CACHE_DIR=/app/cache

# Instala Calibre (para o binário ebook-convert), fontes do sistema, curl para o healthcheck
# e toolchain de build (fallback caso o better-sqlite3 precise compilar para a arquitetura)
RUN apt-get update && apt-get install -y --no-install-recommends \
    calibre \
    fonts-liberation \
    curl \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia manifests de pacotes primeiro para otimizar cache de camadas Docker
COPY package*.json ./

# Instala dependências de produção do Node.js
RUN npm install --omit=dev

# Valida no próprio build que o módulo nativo SQLite funciona perfeitamente
RUN node -e "require('better-sqlite3'); console.log('✓ better-sqlite3 validado com sucesso!')"

# Copia todos os arquivos do projeto (server.js, index.html, js, css, etc.)
COPY . .

# Cria pasta de cache persistente (mapeada como volume no Coolify) — também guarda o banco SQLite
RUN mkdir -p /app/cache

# Expõe as portas 80 e 3000 para compatibilidade universal no Coolify
EXPOSE 80 3000

# Verificação de integridade do container (checa IPv4 127.0.0.1 na porta 80 ou 3000 com fallback para Node fetch)
HEALTHCHECK --interval=20s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS http://127.0.0.1:80/health || curl -fsS http://127.0.0.1:3000/health || node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 80) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]

