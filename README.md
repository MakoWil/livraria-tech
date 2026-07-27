# 📚 Livraria Tech

Biblioteca digital moderna para leitura de livros de programação e tecnologia online.

## ✨ Funcionalidades

- 📖 **Leitura de PDFs** com zoom, scroll contínuo e modo noturno
- 📗 **Leitura de EPUBs** com ajuste de fonte e temas
- 🔍 **Busca em tempo real** por nome do livro
- 📑 **Marcadores de página** com nomes customizáveis
- 🌙 **Modo escuro/claro** com alternância rápida
- 📥 **Download direto** de qualquer livro
- 💾 **Progresso salvo** automaticamente no navegador
- 📱 **100% responsivo** — mobile, tablet e desktop

## 🚀 Como usar localmente

Basta abrir o `index.html` no navegador:

```bash
# Clone o repositório
git clone https://github.com/SEU_USUARIO/livraria-tech.git
cd livraria-tech

# Abra no navegador (pode ser direto ou com um servidor simples)
# Opção 1: Abrir direto
start index.html   # Windows
open index.html     # macOS
xdg-open index.html # Linux

# Opção 2: Servidor local com Python
python -m http.server 8080
# Acesse: http://localhost:8080

# Opção 3: Servidor local com Node.js
npx serve .
# Acesse: http://localhost:3000
```

## 🐳 Deploy com Docker

### Build e execução local:

```bash
docker-compose up --build -d
# Acesse: http://localhost:8080
```

### Deploy no Coolify (VPS ARM64):

1. **Crie um repositório Git** (GitHub/GitLab) e faça push do projeto:

```bash
git init
git add .
git commit -m "feat: livraria tech v1.0"
git remote add origin https://github.com/SEU_USUARIO/livraria-tech.git
git push -u origin main
```

2. **No Coolify**, crie um novo recurso:
   - Tipo: **Docker Compose**
   - Repositório: URL do seu repositório Git
   - Branch: `main`
   - O Coolify detectará automaticamente o `docker-compose.yml`

3. **Configure a porta**: Mapeie a porta `8080` para o domínio desejado

4. **Deploy!** O Coolify fará o build e deploy automaticamente

## 📁 Estrutura do Projeto

```
livraria/
├── index.html          # Página principal (SPA)
├── css/
│   └── style.css       # Design system completo
├── js/
│   ├── app.js          # Lógica principal + GitHub API
│   ├── reader.js       # Leitor PDF/EPUB + Marcadores
│   └── utils.js        # Utilitários e localStorage
├── Dockerfile          # Nginx Alpine (ARM64)
├── docker-compose.yml  # Orquestração Docker
├── nginx.conf          # Config do Nginx
├── .gitignore          # Arquivos ignorados
└── README.md           # Este arquivo
```

## 📡 API

Os livros são carregados da API pública do GitHub:
- Endpoint: `https://api.github.com/repos/KAYOKG/BibliotecaDev/contents/LivrosDev`
- Rate limit: 60 req/hora (sem token)
- Os dados são cacheados por 30 minutos no `localStorage`

## 📄 Licença

MIT — Use como quiser!
