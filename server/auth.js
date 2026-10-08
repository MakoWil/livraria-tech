/* ============================================
   LIVRARIA TECH — Autenticação (Google OAuth 2.0)
   Fluxo "authorization code" no servidor + sessão em cookie HttpOnly
   ============================================ */

const crypto = require('crypto');
const db = require('./db');

const SESSION_COOKIE = 'lt_session';
const STATE_COOKIE = 'lt_oauth_state';
const SESSION_DAYS = 60;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/* ------------------------------------------
   Helpers de cookie
   ------------------------------------------ */
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(val); } catch (_) { out[key] = val; }
  });
  return out;
}

function isSecure(req) {
  return req.secure || (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function setCookie(req, res, name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isSecure(req)) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
  res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
}

function clearCookie(req, res, name) {
  setCookie(req, res, name, '', 0);
}

/* ------------------------------------------
   URL base pública (respeita proxy reverso do Coolify)
   ------------------------------------------ */
function getBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = isSecure(req) ? 'https' : 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

function getRedirectUri(req) {
  return `${getBaseUrl(req)}/login`;
}

/* ------------------------------------------
   Sessões
   ------------------------------------------ */
const stmtGetSession = db.prepare(`
  SELECT u.id, u.email, u.name, u.picture, s.expires_at
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token = ? AND s.expires_at > datetime('now')
`);
const stmtCreateSession = db.prepare(`
  INSERT INTO sessions (token, user_id, expires_at, user_agent)
  VALUES (?, ?, datetime('now', ?), ?)
`);
const stmtDeleteSession = db.prepare(`DELETE FROM sessions WHERE token = ?`);
const stmtUpsertUser = db.prepare(`
  INSERT INTO users (google_id, email, name, picture)
  VALUES (@google_id, @email, @name, @picture)
  ON CONFLICT(google_id) DO UPDATE SET
    email = excluded.email,
    name = excluded.name,
    picture = excluded.picture,
    last_login = datetime('now')
  RETURNING id
`);

function hashToken(token) {
  // Guarda apenas o hash do token no banco (vazamento do DB não expõe sessões)
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  stmtCreateSession.run(hashToken(token), userId, `+${SESSION_DAYS} days`, (req.headers['user-agent'] || '').slice(0, 255));
  setCookie(req, res, SESSION_COOKIE, token, SESSION_DAYS * 24 * 60 * 60);
}

/**
 * Middleware: popula req.user se houver sessão válida
 */
function sessionMiddleware(req, res, next) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) {
    const row = stmtGetSession.get(hashToken(token));
    if (row) {
      req.user = { id: row.id, email: row.email, name: row.name, picture: row.picture };
    }
  }
  next();
}

/**
 * Middleware: exige usuário autenticado
 */
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  next();
}

/* ------------------------------------------
   Rotas de autenticação
   ------------------------------------------ */
function registerAuthRoutes(app) {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn('[AUTH] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET não configurados — login indisponível.');
  }

  /**
   * GET /login
   *  - sem "code": inicia o fluxo e redireciona ao Google
   *  - com "code": callback do Google (troca code -> tokens, cria sessão)
   */
  app.get('/login', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`/?auth_error=${encodeURIComponent(error)}`);
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return res.redirect('/?auth_error=not_configured');
    }

    // 1) Início do fluxo
    if (!code) {
      const newState = crypto.randomBytes(16).toString('hex');
      setCookie(req, res, STATE_COOKIE, newState, 10 * 60);

      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: getRedirectUri(req),
        response_type: 'code',
        scope: 'openid email profile',
        state: newState,
        prompt: 'select_account',
        access_type: 'online'
      });
      return res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
    }

    // 2) Callback
    const savedState = parseCookies(req)[STATE_COOKIE];
    clearCookie(req, res, STATE_COOKIE);
    if (!savedState || savedState !== state) {
      return res.redirect('/?auth_error=invalid_state');
    }

    try {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: getRedirectUri(req),
          grant_type: 'authorization_code'
        })
      });
      const tokens = await tokenRes.json();
      if (!tokenRes.ok || !tokens.access_token) {
        console.error('[AUTH] Falha ao trocar code:', tokens);
        return res.redirect('/?auth_error=token_exchange');
      }

      const infoRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const info = await infoRes.json();
      if (!infoRes.ok || !info.sub) {
        console.error('[AUTH] Falha ao obter userinfo:', info);
        return res.redirect('/?auth_error=userinfo');
      }

      const { id: userId } = stmtUpsertUser.get({
        google_id: info.sub,
        email: info.email || null,
        name: info.name || info.email || 'Leitor',
        picture: info.picture || null
      });

      createSession(req, res, userId);
      console.log(`[AUTH] Login: ${info.email} (user #${userId})`);
      return res.redirect('/?login=ok');
    } catch (err) {
      console.error('[AUTH] Erro no callback:', err);
      return res.redirect('/?auth_error=server');
    }
  });

  app.post('/auth/logout', (req, res) => {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) stmtDeleteSession.run(hashToken(token));
    clearCookie(req, res, SESSION_COOKIE);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ authenticated: false });
    res.json({ authenticated: true, user: req.user });
  });
}

module.exports = { sessionMiddleware, requireAuth, registerAuthRoutes };
