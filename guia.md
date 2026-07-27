Atue como um desenvolvedor Full Stack especialista em aplicações web responsivas e Docker.

Quero criar uma aplicação web moderna e leve para leitura de livros online, projetada para funcionar perfeitamente em telas de celular (mobile-first) e desktop.

### Requisitos Funcionais:
1. Mapeamento de Livros via GitHub API:
   - A aplicação deve fazer uma requisição para a API pública do GitHub para listar o conteúdo do repositório: 
     https://api.github.com/repos/KAYOKG/BibliotecaDev/contents/LivrosDev
   - Exibir os livros em uma dashboard com cards (mostrando nome do livro, tamanho e ícone conforme o formato).
   - Incluir uma barra de busca em tempo real para filtrar os livros por nome.

2. Leitor Moderno (Reader):
   - Ao clicar em um livro, abrir uma interface de leitura limpa e focada.
   - Suporte a PDF: Usar biblioteca moderna (ex: PDF.js) com suporte a scroll contínuo, controles de zoom, modo noturno/escuro e navegação por toque no mobile.
   - Suporte a EPUB: Usar biblioteca moderna (ex: ePub.js) com alteração de tamanho de fonte, alternância de tema (claro/escuro) e salvamento de progresso no localStorage.
   - Botão para voltar à biblioteca e botão para download direto do arquivo.

3. Interface e UX:
   - Design moderno, minimalista e fluido (Tailwind CSS ou CSS moderno).
   - Totalmente responsivo para navegadores mobile e desktop.

### Requisitos Técnicos e Arquivos Necessários:
Crie toda a estrutura de código do projeto. Preciso que você forneça:

1. Estrutura do Código-Fonte:
   - Arquivo principal de lógica/interface (ex: index.html + script.js, ou estrutura Single Page Application em React/HTML).
   - Integração com a API do GitHub utilizando os links `download_url` para carregar o livro diretamente sem gastar armazenamento local.

2. Arquivos para Git e Deploy em VPS (Coolify / ARM64):
   - `.gitignore`: Ignorando pastas desnecessárias (node_modules, logs, etc.).
   - `Dockerfile`: Multi-stage ou minimalista baseado em Alpine (compatível com arquitetura ARM64), usando Nginx ou Node para servir a aplicação de forma ultra leve.
   - `docker-compose.yml`: Arquivo para orquestração simples no Coolify/Docker.
   - `README.md`: Instruções passo a passo de como inicializar o repositório Git local, fazer o commit, enviar para o GitHub/GitLab e implantar no Coolify.

Por favor, forneça o código completo e legível de cada arquivo necessário para que eu possa apenas clonar/copiar para a minha pasta de projeto..