#!/usr/bin/env node
// Zerofye reference server: sign-in (device-code flow) + AI proxy for ZerofyeOffice.
//
// Zero dependencies (Node >= 18). Storage is one JSON file. This is a REFERENCE
// implementation of exactly what the desktop app calls — read README.md for what
// it does NOT do (email verification, rate limits beyond the basics, billing...)
// before putting it on the public internet.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const env = process.env

export function createServer(options = {}) {
  const cfg = {
    port: Number(options.port ?? env.PORT ?? 8787),
    publicUrl: String(options.publicUrl ?? env.PUBLIC_URL ?? '').replace(/\/$/, ''),
    dataFile: options.dataFile ?? env.DATA_FILE ?? path.join(here, 'data', 'db.json'),
    anthropicKey: options.anthropicKey ?? env.ANTHROPIC_API_KEY ?? '',
    anthropicBase: String(options.anthropicBase ?? env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, ''),
    openaiKey: options.openaiKey ?? env.OPENAI_API_KEY ?? '',
    openaiBase: String(options.openaiBase ?? env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    signup: String(options.signup ?? env.SIGNUP ?? 'open'), // open | closed
    freshMs: Number(options.freshMs ?? 10 * 60 * 1000), // a key may be minted only from a session this young
    deviceTtlMs: Number(options.deviceTtlMs ?? 10 * 60 * 1000),
    pollInterval: Number(options.pollInterval ?? 2), // seconds the app waits between polls
    maxBody: 25 * 1024 * 1024,
  }
  const publicUrl = () => cfg.publicUrl || `http://localhost:${cfg.port}`
  const secureCookies = () => publicUrl().startsWith('https://')

  // ── storage ────────────────────────────────────────────────────────
  let db = { users: {}, access: {}, sessions: {}, web: {}, keys: {} }
  try {
    db = { ...db, ...JSON.parse(fs.readFileSync(cfg.dataFile, 'utf8')) }
  } catch {
    /* first run */
  }
  const devices = new Map() // device_code -> { status, userId, expiresAt }
  const csrfTokens = new Map() // csrf cookie value -> expiresAt
  function save() {
    fs.mkdirSync(path.dirname(cfg.dataFile), { recursive: true })
    const tmp = `${cfg.dataFile}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 })
    fs.renameSync(tmp, cfg.dataFile)
  }

  // ── small helpers ──────────────────────────────────────────────────
  const rand = (bytes = 32) => crypto.randomBytes(bytes).toString('hex')
  const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
  const now = () => Date.now()
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  function hashPassword(password) {
    const salt = crypto.randomBytes(16)
    const hash = crypto.scryptSync(password, salt, 64)
    return `${salt.toString('hex')}:${hash.toString('hex')}`
  }
  function verifyPassword(password, stored) {
    const [saltHex, hashHex] = String(stored).split(':')
    if (!saltHex || !hashHex) return false
    const expected = Buffer.from(hashHex, 'hex')
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
    return crypto.timingSafeEqual(actual, expected)
  }

  function sendJson(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
    res.end(JSON.stringify(body))
  }
  function sendHtml(res, status, html, headers = {}) {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'",
      ...headers,
    })
    res.end(html)
  }
  async function readBody(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > cfg.maxBody) throw Object.assign(new Error('body too large'), { status: 413 })
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }
  const parseCookies = (req) =>
    Object.fromEntries(
      String(req.headers.cookie ?? '')
        .split(';')
        .map((part) => part.trim().split('='))
        .filter(([name]) => name)
        .map(([name, ...rest]) => [name, decodeURIComponent(rest.join('='))]),
    )
  const cookie = (name, value, maxAgeSec) =>
    `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}${secureCookies() ? '; Secure' : ''}`

  // crude fixed-window limiter for the credential endpoints
  const hits = new Map()
  function limited(req, bucket, max, windowMs) {
    const key = `${bucket}:${req.socket.remoteAddress}`
    const entry = hits.get(key)
    if (!entry || entry.reset < now()) {
      hits.set(key, { count: 1, reset: now() + windowMs })
      return false
    }
    entry.count += 1
    return entry.count > max
  }

  function bearer(req) {
    const header = String(req.headers.authorization ?? '')
    return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  }
  function userFromKey(req) {
    const key = bearer(req) || String(req.headers['x-api-key'] ?? '').trim()
    if (!key) return null
    const record = Object.values(db.keys).find((k) => k.hash === sha(key))
    return record ? { user: db.users[record.userId], key: record } : null
  }

  // ── device-code sign-in (what packages/ai-search/src/zerofyeoffice-auth.ts calls) ─
  function deviceCode(req, res, url) {
    if (url.searchParams.get('app_type') !== 'zerofyeoffice') {
      return sendJson(res, 400, { message: 'unknown app_type' })
    }
    const code = rand(24)
    devices.set(code, { status: 'pending', userId: null, expiresAt: now() + cfg.deviceTtlMs })
    return sendJson(res, 200, {
      device_code: code,
      auth_url: `${publicUrl()}/device?code=${code}`,
      expires_in: Math.floor(cfg.deviceTtlMs / 1000),
      poll_interval: cfg.pollInterval,
    })
  }
  function pollToken(req, res, url) {
    const code = url.searchParams.get('code') ?? ''
    const device = devices.get(code)
    if (!device || device.expiresAt < now()) {
      devices.delete(code)
      return sendJson(res, 200, { status: 'expired' })
    }
    if (device.status === 'pending') return sendJson(res, 200, { status: 'pending' })
    devices.delete(code)
    if (device.status !== 'approved') return sendJson(res, 200, { status: 'denied' })
    const token = `zat-${rand(32)}`
    db.access[sha(token)] = { userId: device.userId, createdAt: now() }
    save()
    return sendJson(res, 200, { status: 'approved', access_token: token })
  }
  function openSession(req, res) {
    const entry = db.access[sha(bearer(req))]
    if (!entry || !db.users[entry.userId]) return sendJson(res, 401, { message: 'invalid token' })
    const id = rand(32)
    db.sessions[sha(id)] = { userId: entry.userId, createdAt: now() }
    save()
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie('zf_session', id, 30 * 24 * 3600) })
  }
  function sessionOf(req) {
    const id = parseCookies(req).zf_session
    return id ? db.sessions[sha(id)] : undefined
  }
  async function createKey(req, res) {
    const session = sessionOf(req)
    if (!session) return sendJson(res, 401, { message: 'not signed in' })
    if (now() - session.createdAt > cfg.freshMs) {
      return sendJson(res, 403, { detail: 'fresh_browser_authentication_required' })
    }
    let name = ''
    try {
      name = String(JSON.parse((await readBody(req)).toString('utf8') || '{}').key_name ?? '')
    } catch {
      /* ignore */
    }
    const token = `zf-${rand(24)}`
    const keyId = `key_${rand(8)}`
    db.keys[keyId] = { userId: session.userId, hash: sha(token), name: name.slice(0, 80), createdAt: now() }
    save()
    return sendJson(res, 200, { data: { token, key_id: keyId } })
  }
  async function revokeKey(req, res) {
    const session = sessionOf(req)
    if (!session) return sendJson(res, 401, { message: 'not signed in' })
    let keyId = ''
    try {
      keyId = String(JSON.parse((await readBody(req)).toString('utf8') || '{}').key_id ?? '')
    } catch {
      /* ignore */
    }
    if (db.keys[keyId]?.userId === session.userId) {
      delete db.keys[keyId]
      save()
    }
    return sendJson(res, 200, { ok: true })
  }
  // `gsk login-info` (what Settings > Account shows): the CLI calls GET /api/tool_cli/me
  function me(req, res) {
    const auth = userFromKey(req)
    if (!auth) return sendJson(res, 401, { message: 'invalid api key' })
    return sendJson(res, 200, { email: auth.user.email, plan: 'free' })
  }

  // ── the browser page the user approves the sign-in on ──────────────
  const MARK = `<svg width="44" height="44" viewBox="0 0 1024 1024" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1B2A5E"/><stop offset="1" stop-color="#080D20"/></linearGradient><mask id="m"><rect width="1024" height="1024" fill="#fff"/><circle cx="512" cy="512" r="108" fill="#000"/></mask></defs><rect width="1024" height="1024" rx="228" fill="url(#g)"/><path d="M276 300H748L276 724H748" fill="none" stroke="#fff" stroke-width="92" stroke-linecap="round" stroke-linejoin="round" mask="url(#m)"/><circle cx="512" cy="512" r="60" fill="#22D3EE"/></svg>`
  const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Zerofye</title><style>
:root{color-scheme:light dark;--bg:#f6f7fb;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#1B2A5E}
@media(prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#121a33;--text:#f3f4f6;--muted:#9aa3b8;--line:#243056;--accent:#22d3ee}}
body{margin:0;font:16px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
header{display:flex;gap:12px;align-items:center;margin-bottom:18px}h1{font-size:20px;margin:0}p{color:var(--muted);margin:6px 0 16px}
label{display:block;font-size:13px;margin:12px 0 4px}input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;font:inherit}
button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
@media(prefers-color-scheme:dark){button{color:#041014}}button.secondary{background:transparent;color:var(--muted);border:1px solid var(--line);margin-top:8px}
.tabs{display:flex;gap:8px;margin-bottom:4px}.tabs a{flex:1;text-align:center;padding:8px;border-radius:8px;border:1px solid var(--line);color:var(--muted);text-decoration:none;font-size:14px}.tabs a.on{color:var(--text);border-color:var(--accent)}
.err{background:#fee2e2;color:#991b1b;padding:10px 12px;border-radius:10px;font-size:14px;margin-bottom:8px}</style></head><body><main><header>${MARK}<h1>${esc(title)}</h1></header>${body}</main></body></html>`

  function csrfFor(res, req) {
    let token = parseCookies(req).zf_csrf
    if (!token || !csrfTokens.has(token)) {
      token = rand(16)
      csrfTokens.set(token, now() + 3600_000)
      res.setHeader('Set-Cookie', cookie('zf_csrf', token, 3600))
    }
    return token
  }
  const csrfOk = (req, form) => {
    const cookieToken = parseCookies(req).zf_csrf
    return !!cookieToken && csrfTokens.has(cookieToken) && form.get('csrf') === cookieToken
  }
  function webUser(req) {
    const id = parseCookies(req).zf_web
    const entry = id ? db.web[sha(id)] : undefined
    return entry && entry.expiresAt > now() ? db.users[entry.userId] : undefined
  }

  function devicePage(req, res, url) {
    const code = url.searchParams.get('code') ?? ''
    const device = devices.get(code)
    if (!device || device.expiresAt < now() || device.status !== 'pending') {
      return sendHtml(res, 200, page('Link expired', `<p>This sign-in link is no longer valid. Go back to ZerofyeOffice and start the sign-in again.</p>`))
    }
    const csrf = csrfFor(res, req)
    const user = webUser(req)
    const error = url.searchParams.get('error')
    const errBox = error ? `<div class="err" role="alert">${esc(error)}</div>` : ''
    if (user) {
      return sendHtml(res, 200, page('Approve sign-in', `${errBox}<p>Signed in as <b>${esc(user.email)}</b>. Allow ZerofyeOffice on your computer to use this account?</p>
<form method="post" action="/device/decision"><input type="hidden" name="code" value="${esc(code)}"><input type="hidden" name="csrf" value="${esc(csrf)}">
<button name="decision" value="approve">Approve</button><button class="secondary" name="decision" value="deny">Deny</button></form>`))
    }
    const mode = url.searchParams.get('mode') === 'signup' && cfg.signup === 'open' ? 'signup' : 'signin'
    const tab = (m, label) => `<a class="${mode === m ? 'on' : ''}" href="/device?code=${esc(code)}&mode=${m}">${label}</a>`
    const tabs = cfg.signup === 'open' ? `<div class="tabs">${tab('signin', 'Sign in')}${tab('signup', 'Create account')}</div>` : ''
    return sendHtml(res, 200, page(mode === 'signup' ? 'Create your account' : 'Sign in', `${errBox}${tabs}
<form method="post" action="/device/auth"><input type="hidden" name="code" value="${esc(code)}"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="mode" value="${mode}">
<label for="e">Email</label><input id="e" name="email" type="email" autocomplete="email" required>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="${mode === 'signup' ? 10 : 1}" required>
<button>${mode === 'signup' ? 'Create account' : 'Sign in'}</button></form>`))
  }
  const back = (res, code, message) =>
    res.writeHead(303, { Location: `/device?code=${encodeURIComponent(code)}&error=${encodeURIComponent(message)}` }).end()

  async function deviceAuth(req, res) {
    const form = new URLSearchParams((await readBody(req)).toString('utf8'))
    const code = form.get('code') ?? ''
    if (!csrfOk(req, form)) return back(res, code, 'Session expired, please try again.')
    if (limited(req, 'auth', 10, 10 * 60_000)) return back(res, code, 'Too many attempts. Wait a few minutes.')
    const email = String(form.get('email') ?? '').trim().toLowerCase()
    const password = String(form.get('password') ?? '')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return back(res, code, 'Enter a valid email address.')
    let user = Object.values(db.users).find((u) => u.email === email)
    if (form.get('mode') === 'signup') {
      if (cfg.signup !== 'open') return back(res, code, 'Sign-ups are closed.')
      if (password.length < 10) return back(res, code, 'Use a password of at least 10 characters.')
      if (user) return back(res, code, 'That email already has an account. Sign in instead.')
      const id = `u_${rand(8)}`
      user = db.users[id] = { id, email, password: hashPassword(password), createdAt: now() }
    } else if (!user || !verifyPassword(password, user.password)) {
      return back(res, code, 'Wrong email or password.')
    }
    const web = rand(32)
    db.web[sha(web)] = { userId: user.id, expiresAt: now() + 7 * 24 * 3600_000 }
    save()
    res.writeHead(303, {
      Location: `/device?code=${encodeURIComponent(code)}`,
      'Set-Cookie': cookie('zf_web', web, 7 * 24 * 3600),
    })
    res.end()
  }
  async function deviceDecision(req, res) {
    const form = new URLSearchParams((await readBody(req)).toString('utf8'))
    const code = form.get('code') ?? ''
    const user = webUser(req)
    const device = devices.get(code)
    if (!csrfOk(req, form) || !user || !device || device.expiresAt < now()) {
      return sendHtml(res, 400, page('Link expired', '<p>This sign-in link is no longer valid. Start the sign-in again from ZerofyeOffice.</p>'))
    }
    const approve = form.get('decision') === 'approve'
    device.status = approve ? 'approved' : 'denied'
    device.userId = user.id
    return sendHtml(res, 200, page(approve ? 'You’re signed in' : 'Sign-in denied', approve
      ? '<p>You can close this tab and return to ZerofyeOffice.</p>'
      : '<p>No access was granted. You can close this tab.</p>'))
  }

  // ── LLM proxy (streaming pass-through) ─────────────────────────────
  const SKIP_UP = new Set(['host', 'connection', 'content-length', 'authorization', 'x-api-key', 'cookie', 'accept-encoding', 'transfer-encoding'])
  const KEEP_DOWN = new Set(['content-type', 'cache-control', 'retry-after', 'request-id', 'x-request-id', 'anthropic-ratelimit-requests-remaining'])
  async function proxy(req, res, upstreamUrl, authHeaders, missingName) {
    if (!userFromKey(req)) {
      return sendJson(res, 401, { error: { type: 'authentication_error', message: 'Invalid or revoked API key' } })
    }
    if (!Object.values(authHeaders).every(Boolean)) {
      return sendJson(res, 503, { error: { type: 'api_error', message: `${missingName} is not configured on this server` } })
    }
    const headers = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (!SKIP_UP.has(name) && typeof value === 'string') headers[name] = value
    }
    Object.assign(headers, authHeaders)
    const method = req.method ?? 'GET'
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
    const abort = new AbortController()
    res.on('close', () => abort.abort())
    let upstream
    try {
      upstream = await fetch(upstreamUrl, { method, headers, body, signal: abort.signal })
    } catch (error) {
      if (abort.signal.aborted) return
      return sendJson(res, 502, { error: { type: 'api_error', message: `Upstream unreachable: ${error.cause?.code ?? error.message}` } })
    }
    const down = {}
    upstream.headers.forEach((value, name) => {
      if (KEEP_DOWN.has(name)) down[name] = value
    })
    res.writeHead(upstream.status, { 'Cache-Control': 'no-store', ...down })
    try {
      for await (const chunk of upstream.body ?? []) res.write(chunk)
    } catch {
      /* client went away or upstream cut the stream */
    }
    res.end()
  }

  // ── routing ────────────────────────────────────────────────────────
  async function handle(req, res) {
    const url = new URL(req.url ?? '/', publicUrl())
    const route = `${req.method} ${url.pathname}`
    if (route === 'GET /' || route === 'GET /healthz') {
      return sendJson(res, 200, { service: 'zerofye-reference-server', ok: true })
    }
    if (route === 'POST /api/office_addin_auth/device_code') return deviceCode(req, res, url)
    if (route === 'GET /api/office_addin_auth/token') return pollToken(req, res, url)
    if (route === 'POST /api/office_addin_auth/session') return openSession(req, res)
    if (route === 'POST /api/api_tokens/create') return createKey(req, res)
    if (route === 'POST /api/api_tokens/revoke') return revokeKey(req, res)
    if (route === 'GET /api/tool_cli/me') return me(req, res)
    if (route === 'GET /device') return devicePage(req, res, url)
    if (route === 'POST /device/auth') return deviceAuth(req, res)
    if (route === 'POST /device/decision') return deviceDecision(req, res)
    if (url.pathname.startsWith('/api/anthropic/')) {
      const rest = url.pathname.slice('/api/anthropic'.length)
      return proxy(req, res, `${cfg.anthropicBase}${rest}${url.search}`, {
        'x-api-key': cfg.anthropicKey,
        'anthropic-version': req.headers['anthropic-version'] ?? '2023-06-01',
      }, 'ANTHROPIC_API_KEY')
    }
    if (url.pathname.startsWith('/api/llm_proxy/v1/')) {
      const rest = url.pathname.slice('/api/llm_proxy/v1'.length)
      return proxy(req, res, `${cfg.openaiBase}${rest}${url.search}`, {
        authorization: cfg.openaiKey ? `Bearer ${cfg.openaiKey}` : '',
      }, 'OPENAI_API_KEY')
    }
    if (url.pathname.startsWith('/api/')) {
      // Genspark-hosted tool endpoints (hosted web search, image generation, ...) are not part of this server
      return sendJson(res, 404, { status: 'error', message: 'This endpoint is not provided by this server' })
    }
    return sendJson(res, 404, { message: 'not found' })
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.headersSent) return res.end()
      sendJson(res, error?.status ?? 500, { message: error?.status ? error.message : 'internal error' })
    })
  })
  const sweep = setInterval(() => {
    for (const [code, device] of devices) if (device.expiresAt < now()) devices.delete(code)
    for (const [token, expiresAt] of csrfTokens) if (expiresAt < now()) csrfTokens.delete(token)
    for (const [key, entry] of hits) if (entry.reset < now()) hits.delete(key)
  }, 60_000)
  sweep.unref()
  return { server, cfg }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { server, cfg } = createServer()
  server.listen(cfg.port, () => {
    console.log(`Zerofye server listening on :${cfg.port}`)
    console.log(`  public URL     ${cfg.publicUrl || `http://localhost:${cfg.port}`}`)
    console.log(`  anthropic key  ${cfg.anthropicKey ? 'set' : 'NOT SET (Claude models will return 503)'}`)
    console.log(`  openai key     ${cfg.openaiKey ? 'set' : 'NOT SET (other models will return 503)'}`)
  })
}
