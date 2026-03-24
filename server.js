require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());

// Required for Codespaces / any reverse proxy (Heroku, Railway, etc.)
app.set('trust proxy', 1);

const {
  AUTH_URL,
  TOKEN_URL,
  CLIENT_ID,
  REDIRECT_URI,
  SCOPE = 'openid profile email',
  BASE_URL,
  SESSION_SECRET = 'dev-secret',
  PORT = 3000,
} = process.env;

// ── SESSION ──────────────────────────────────────────────────────────────────
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: 'auto',   // auto = true when behind HTTPS proxy, false for local HTTP
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000  // 8 hours
  }
}));

// ── PKCE HELPERS ─────────────────────────────────────────────────────────────
function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.accessToken) return next();
  // Save the original URL so we can redirect back after login
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

// ── AUTH ROUTES ───────────────────────────────────────────────────────────────

// Step 1: Redirect to authorization server
app.get('/login', (req, res) => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Store in session for use in callback
  req.session.codeVerifier = codeVerifier;
  req.session.oauthState = state;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  res.redirect(`${AUTH_URL}?${params.toString()}`);
});

// Step 2: Handle callback, exchange code for token
app.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.redirect(`/?auth_error=${encodeURIComponent(error_description || error)}`);
  }

  // Validate state
  if (!state || state !== req.session.oauthState) {
    return res.redirect('/?auth_error=Invalid+state+parameter');
  }

  const codeVerifier = req.session.codeVerifier;
  if (!codeVerifier) {
    return res.redirect('/?auth_error=Missing+code+verifier');
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: codeVerifier,
    });

    const tokenRes = await axios.post(TOKEN_URL, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const { access_token, expires_in, id_token } = tokenRes.data;

    // Store token in session
    req.session.accessToken = access_token;
    req.session.tokenExpiresAt = Date.now() + (expires_in || 3600) * 1000;

    // Try to extract user info from id_token if present
    if (id_token) {
      try {
        const payload = JSON.parse(
          Buffer.from(id_token.split('.')[1], 'base64url').toString()
        );
        req.session.user = {
          name: payload.name || payload.preferred_username || payload.email || 'User',
          email: payload.email || '',
          sub: payload.sub || '',
        };
      } catch (_) {}
    }

    // Clean up PKCE session values
    delete req.session.codeVerifier;
    delete req.session.oauthState;

    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(returnTo);

  } catch (err) {
    console.error('Token exchange error:', err?.response?.data || err.message);
    res.redirect('/?auth_error=Token+exchange+failed');
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ── AUTH STATUS API ───────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  if (!req.session.accessToken) {
    return res.json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    user: req.session.user || { name: 'User' },
    expiresAt: req.session.tokenExpiresAt,
  });
});

// ── CHAT API PROXY ────────────────────────────────────────────────────────────
app.post('/api/chat', requireAuth, async (req, res) => {
  const { prompt, conversationId } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Check token expiry
  if (req.session.tokenExpiresAt && Date.now() > req.session.tokenExpiresAt) {
    return res.status(401).json({ error: 'Session expired. Please log in again.', reauth: true });
  }

  try {
    const body = { prompt };
    if (conversationId) body.conversationId = conversationId;

    console.log('Calling:', `${BASE_URL}/chatconversation/v1/prompt`);
    console.log('Body:', JSON.stringify(body));
    console.log('Token (first 20 chars):', req.session.accessToken?.substring(0, 20));

    const response = await axios.post(
      `${BASE_URL}/chatconversation/v1/prompt`,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${req.session.accessToken}`,
        },
      }
    );

    res.json(response.data);
  } catch (err) {
    const status = err?.response?.status || 500;
    const message =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.response?.statusText ||
      err.message ||
      'Failed to get response from AI API';
    console.error('Chat API error:', status, message);

    // If 401 from upstream, token may be invalid
    if (status === 401) {
      return res.status(401).json({ error: 'Authentication failed. Please log in again.', reauth: true });
    }

    res.status(status).json({ error: message });
  }
});

// ── STATIC FILES (protected) ──────────────────────────────────────────────────
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(requireAuth, express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`✅ Fusion AI Chat (PKCE) running on http://localhost:${PORT}`);
});
