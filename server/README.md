# Zerofye reference server

The small server ZerofyeOffice signs in to and sends its AI requests through. It is a
**reference implementation**: it does exactly what the desktop app calls, with no dependencies
(Node 18+), and stores everything in one JSON file.

What it provides:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/office_addin_auth/device_code` | starts a sign-in, returns the browser URL |
| `GET /device?code=…` | the page where the user creates an account / signs in and approves |
| `GET /api/office_addin_auth/token` | the app polls this until the user approves |
| `POST /api/office_addin_auth/session`, `POST /api/api_tokens/create`, `POST /api/api_tokens/revoke` | session, API-key create and revoke |
| `GET /api/tool_cli/me` | the email shown in Settings → Account |
| `POST /api/anthropic/v1/*` | Claude models, streamed through to Anthropic |
| `/api/llm_proxy/v1/*` | all other models, streamed through to an OpenAI-compatible provider |

## Run it locally

```
cd server
set ANTHROPIC_API_KEY=sk-ant-...        (PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-...")
set OPENAI_API_KEY=sk-...
node index.mjs
```

Then start the desktop app pointed at it (PowerShell):

```
$env:ZEROFYE_BASE_URL = "http://localhost:8787"
npm run dev
```

Open Settings → Account → sign in. The browser opens a Zerofye page: create an account, press
**Approve**, and the app is signed in. Plain `http://` is only accepted for `localhost` /
`127.0.0.1`; anything public must be `https://`.

## Configuration (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | listen port |
| `PUBLIC_URL` | `http://localhost:PORT` | the address users reach the server at (used in the sign-in link). Set to `https://zerofye.com` in production |
| `DATA_FILE` | `server/data/db.json` | accounts, sessions, key hashes |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | – / `https://api.anthropic.com` | upstream for Claude models |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | – / `https://api.openai.com/v1` | upstream for all other models. Point this at any OpenAI-compatible gateway (OpenRouter, Gemini's compatibility endpoint, …) to offer more models |
| `SIGNUP` | `open` | `closed` disables new accounts |

## Going to production on zerofye.com

Put it behind HTTPS (Caddy, nginx or a platform like Fly/Render/Railway), set `PUBLIC_URL=https://zerofye.com`
and the two provider keys, and keep `DATA_FILE` on persistent storage. The desktop app already
defaults to `https://zerofye.com`, so no app change is needed.

**Not production-ready out of the box** — you still need to add:

- **Email verification and password reset.** Anyone can create an account with any email address.
- **Limits and billing.** Every signed-in user can spend *your* provider credits without a cap. Add per-user quotas or a payment system before opening sign-ups (`SIGNUP=closed` while you test).
- **Stronger abuse protection.** There is only a basic per-IP limit on sign-in attempts.
- **A real database**, backups, and secrets management instead of a JSON file and environment variables.
- **Genspark-hosted tools.** Hosted web search, image generation and similar tools that the app used to get from Genspark are not provided; the app falls back to its other search providers (Serper, Tavily, DuckDuckGo, or your own keys).
