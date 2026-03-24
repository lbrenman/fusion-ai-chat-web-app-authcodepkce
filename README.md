# Fusion AI Chat UI (PKCE)

A Claude-inspired AI chat interface with OAuth 2.0 Authorization Code + PKCE authentication. Users must log in before accessing the chat. Built on Node.js/Express and connects to the [Fusion AI Conversation API](https://github.com/lbrenman/fusion-ai-chat-conversation-api).

## Features

- 🔐 OAuth 2.0 Authorization Code + PKCE flow (no client secret needed in browser)
- 👤 Displays logged-in user name and email in the sidebar
- 🚪 Logout button with session cleanup
- 💬 Full conversation history with sidebar navigation
- ✦ New Conversation button to start fresh
- ⏳ "Thinking..." indicator while the API responds
- 🔄 Automatic redirect to login on session expiry
- 💾 Conversations persisted in browser `localStorage`
- 🎨 Markdown rendering for rich AI responses
- 📱 Runs on GitHub Codespaces

## How PKCE Works

```
1. User visits app → server redirects to Authorization URL
         ↓
2. User logs in at the auth server
         ↓
3. Auth server redirects back to /callback with auth code
         ↓
4. Server exchanges code + code_verifier for access token
         ↓
5. Access token stored in server-side session
         ↓
6. All API calls use the session token — browser never sees it
```

The `code_verifier` and `code_challenge` are generated server-side using Node's `crypto` module (SHA-256). The state parameter is validated on callback to prevent CSRF attacks.

## Project Structure

```
chat-app-pkce/
├── server.js          # Express server — PKCE flow, session management, API proxy
├── public/
│   └── index.html     # Chat UI with user panel and logout
├── .env               # Your environment variables (gitignored)
├── .env.example       # Template
└── package.json
```

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd chat-app-pkce
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
AUTH_URL=https://your-auth-server.com/oauth/authorize
TOKEN_URL=https://your-auth-server.com/oauth/token
CLIENT_ID=your_client_id
REDIRECT_URI=http://localhost:3000/callback
SCOPE=openid profile email

BASE_URL=https://your-api-base-url.com

SESSION_SECRET=a-long-random-string-change-this
PORT=3000
```

### 3. Register your redirect URI

In your OAuth provider (Okta, Keycloak, etc.), register the callback URL:
```
http://localhost:3000/callback
```

For Codespaces, also register:
```
https://<your-codespace-name>-3000.app.github.dev/callback
```

### 4. Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) — you will be redirected to the login page automatically.

## Auth Routes

| Route | Description |
|---|---|
| `GET /login` | Initiates PKCE flow, redirects to auth server |
| `GET /callback` | Handles auth server redirect, exchanges code for token |
| `GET /logout` | Destroys session, redirects to home |
| `GET /api/me` | Returns current user info from session |

## Environment Variables

| Variable | Description |
|---|---|
| `AUTH_URL` | OAuth 2.0 authorization endpoint |
| `TOKEN_URL` | OAuth 2.0 token endpoint |
| `CLIENT_ID` | Your OAuth client ID |
| `REDIRECT_URI` | Callback URL registered with your auth provider |
| `SCOPE` | OAuth scopes (default: `openid profile email`) |
| `BASE_URL` | Base URL of the Fusion AI Conversation API |
| `SESSION_SECRET` | Secret for signing Express sessions — use a long random string |
| `PORT` | Port to run the server on (default: `3000`) |

## GitHub Codespaces

Set environment variables as **Codespace secrets** in your GitHub repository settings. Update `REDIRECT_URI` to your Codespace forwarded URL:

```env
REDIRECT_URI=https://<your-codespace>-3000.app.github.dev/callback
```

Make sure this URI is also registered with your OAuth provider.
