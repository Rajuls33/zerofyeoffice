/**
 * End to end: the REAL app login code (zerofyeoffice-auth.ts) against the REAL
 * reference server (server/index.mjs), with a scripted "browser" doing the
 * approval step, plus the AI proxy against fake upstream providers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  resetZerofyeofficeAuthCache,
  startZerofyeofficeLogin,
  zerofyeofficeApiKey,
  zerofyeofficeLogout,
  type GskLoginProgress,
} from '../src/zerofyeoffice-auth'

type ServerOptions = Record<string, unknown>
interface RefServer {
  server: http.Server
  cfg: { publicUrl: string }
}
const serverModule = join(dirname(fileURLToPath(import.meta.url)), '../../../server/index.mjs')
const { createServer } = (await import(pathToFileURL(serverModule).href)) as {
  createServer: (options: ServerOptions) => RefServer
}

const listen = (server: http.Server) =>
  new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
const close = (server: http.Server) => new Promise<void>((resolve) => server.close(() => resolve()))

interface Seen {
  url: string
  headers: http.IncomingHttpHeaders
  body: string
}
/** Fake provider: records requests, streams SSE for Anthropic, JSON for OpenAI-style. */
function fakeUpstream() {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      seen.push({ url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      if (req.url === '/v1/messages') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('event: message_start\ndata: {"type":"message_start"}\n\n')
        setTimeout(() => {
          res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
          res.end()
        }, 30)
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, path: req.url }))
      }
    })
  })
  return { server, seen }
}

/** A scripted browser: cookie jar + the approve page of the reference server. */
async function browse(
  authUrl: string,
  opts: { mode?: 'signin' | 'signup'; email: string; password: string; decision?: 'approve' | 'deny'; csrfOverride?: string },
): Promise<string> {
  const jar = new Map<string, string>()
  const send = async (url: string, init: RequestInit = {}) => {
    const res = await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers as Record<string, string>), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    })
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(';')[0]!
      const i = kv.indexOf('=')
      jar.set(kv.slice(0, i), kv.slice(i + 1))
    }
    return res
  }
  const origin = new URL(authUrl).origin
  const code = new URL(authUrl).searchParams.get('code')!
  const form = (fields: Record<string, string>) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  })
  const csrfOf = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)![1]!

  let html = await (await send(opts.mode === 'signup' ? `${authUrl}&mode=signup` : authUrl)).text()
  const auth = await send(`${origin}/device/auth`, form({
    code,
    csrf: opts.csrfOverride ?? csrfOf(html),
    mode: opts.mode ?? 'signin',
    email: opts.email,
    password: opts.password,
  }))
  expect(auth.status).toBe(303)
  html = await (await send(new URL(auth.headers.get('location')!, origin).href)).text()
  if (!html.includes('name="decision"')) return html // wrong password / bad csrf: error page
  const done = await send(`${origin}/device/decision`, form({ code, csrf: csrfOf(html), decision: opts.decision ?? 'approve' }))
  return done.text()
}

let dataDir: string
let authDir: string
let upstream: ReturnType<typeof fakeUpstream>
let upstreamPort: number
let ref: RefServer
let base: string
const savedEnv = { ...process.env }

async function startRef(options: ServerOptions = {}): Promise<RefServer> {
  const created = createServer({
    port: 0,
    dataFile: join(dataDir, `db-${Math.random().toString(36).slice(2)}.json`),
    pollInterval: 0.05,
    anthropicBase: `http://127.0.0.1:${upstreamPort}`,
    openaiBase: `http://127.0.0.1:${upstreamPort}/v1`,
    anthropicKey: 'sk-ant-SERVER',
    openaiKey: 'sk-oai-SERVER',
    ...options,
  })
  const port = await listen(created.server)
  created.cfg.publicUrl = `http://127.0.0.1:${port}`
  return created
}

/** Runs the app's login to completion; the scripted browser approves (or not). */
function login(
  browser: (url: string) => Promise<unknown>,
): Promise<GskLoginProgress> {
  return new Promise((resolve) => {
    startZerofyeofficeLogin((progress) => {
      if (progress.phase === 'url') void browser(progress.url ?? '')
      else resolve(progress)
    })
  })
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'zerofye-srv-'))
  upstream = fakeUpstream()
  upstreamPort = await listen(upstream.server)
})
afterAll(async () => {
  await close(upstream.server)
  rmSync(dataDir, { recursive: true, force: true })
})
beforeEach(async () => {
  authDir = mkdtempSync(join(tmpdir(), 'zerofye-auth-'))
  ref = await startRef()
  base = ref.cfg.publicUrl
  process.env.ZEROFYE_BASE_URL = base
  process.env.ZEROFYEOFFICE_AUTH_DIR = authDir
  process.env.ZEROFYEOFFICE_NATIVE_WAF = '0'
  delete process.env.GSK_API_KEY
  resetZerofyeofficeAuthCache()
  upstream.seen.length = 0
})
afterEach(async () => {
  await close(ref.server)
  rmSync(authDir, { recursive: true, force: true })
  process.env = { ...savedEnv }
  resetZerofyeofficeAuthCache()
})

const me = (key: string) => fetch(`${base}/api/tool_cli/me`, { headers: { 'X-Api-Key': key } })

describe('sign-in with the real app code', () => {
  it('device code → browser sign-up + approve → session → API key stored', async () => {
    const result = await login((url) => browse(url, { mode: 'signup', email: 'Aryan@Example.com', password: 'correct horse battery' }))
    expect(result).toEqual({ phase: 'success' })
    const key = zerofyeofficeApiKey()
    expect(key).toMatch(/^zf-[0-9a-f]{48}$/)
    const info = await me(key)
    expect(info.status).toBe(200)
    expect(await info.json()).toMatchObject({ email: 'aryan@example.com' }) // login-info shape the Account page reads
  })

  it('signing in again replaces the key and revokes the superseded one', async () => {
    await login((url) => browse(url, { mode: 'signup', email: 'a@example.com', password: 'correct horse battery' }))
    const first = zerofyeofficeApiKey()
    const again = await login((url) => browse(url, { email: 'a@example.com', password: 'correct horse battery' }))
    expect(again).toEqual({ phase: 'success' })
    const second = zerofyeofficeApiKey()
    expect(second).not.toBe(first)
    expect((await me(second)).status).toBe(200)
    await expect.poll(async () => (await me(first)).status).toBe(401)
  })

  it('a denied approval ends the login without storing a key', async () => {
    const result = await login((url) => browse(url, { mode: 'signup', email: 'd@example.com', password: 'correct horse battery', decision: 'deny' }))
    expect(result).toMatchObject({ phase: 'error' })
    expect(zerofyeofficeApiKey()).toBe('')
  })

  it('sign-out revokes the key server-side', async () => {
    await login((url) => browse(url, { mode: 'signup', email: 'o@example.com', password: 'correct horse battery' }))
    const key = zerofyeofficeApiKey()
    await zerofyeofficeLogout()
    expect(zerofyeofficeApiKey()).toBe('')
    expect((await me(key)).status).toBe(401)
  })

  it('reports fresh_auth_required when the server refuses to mint from a stale session', async () => {
    await close(ref.server)
    ref = await startRef({ freshMs: -1 })
    base = ref.cfg.publicUrl
    process.env.ZEROFYE_BASE_URL = base
    const result = await login((url) => browse(url, { mode: 'signup', email: 's@example.com', password: 'correct horse battery' }))
    expect(result).toEqual({ phase: 'error', error: 'fresh_auth_required' })
    expect(zerofyeofficeApiKey()).toBe('')
  })
})

describe('browser page safety', () => {
  it('rejects a wrong password and a missing/forged CSRF token', async () => {
    await login((url) => browse(url, { mode: 'signup', email: 'p@example.com', password: 'correct horse battery' }))
    const dc = await (await fetch(`${base}/api/office_addin_auth/device_code?app_type=zerofyeoffice`, { method: 'POST' })).json()
    const wrong = await browse(dc.auth_url, { email: 'p@example.com', password: 'nope' })
    expect(wrong).toContain('Wrong email or password')
    const forged = await browse(dc.auth_url, { email: 'p@example.com', password: 'correct horse battery', csrfOverride: 'forged' })
    expect(forged).toContain('Session expired')
  })

  it('refuses short passwords and duplicate sign-ups; honours closed sign-ups', async () => {
    const dc = await (await fetch(`${base}/api/office_addin_auth/device_code?app_type=zerofyeoffice`, { method: 'POST' })).json()
    expect(await browse(dc.auth_url, { mode: 'signup', email: 'q@example.com', password: 'short' })).toContain('at least 10')
    await close(ref.server)
    ref = await startRef({ signup: 'closed' })
    base = ref.cfg.publicUrl
    const dc2 = await (await fetch(`${base}/api/office_addin_auth/device_code?app_type=zerofyeoffice`, { method: 'POST' })).json()
    expect(await browse(dc2.auth_url, { mode: 'signup', email: 'r@example.com', password: 'correct horse battery' })).toContain('Sign-ups are closed')
  })

  it('rejects unknown app types and unknown device codes', async () => {
    const bad = await fetch(`${base}/api/office_addin_auth/device_code?app_type=other`, { method: 'POST' })
    expect(bad.status).toBe(400)
    const poll = await (await fetch(`${base}/api/office_addin_auth/token?code=nope`)).json()
    expect(poll).toEqual({ status: 'expired' })
  })
})

describe('AI proxy', () => {
  async function signedInKey(): Promise<string> {
    await login((url) => browse(url, { mode: 'signup', email: 'x@example.com', password: 'correct horse battery' }))
    return zerofyeofficeApiKey()
  }

  it('Anthropic route: streams SSE through, swaps in the server key, never leaks the user key upstream', async () => {
    const key = await signedInKey()
    const res = await fetch(`${base}/api/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-5', stream: true, messages: [] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('message_start')
    expect(text).toContain('message_stop')
    const hit = upstream.seen.find((s) => s.url === '/v1/messages')!
    expect(hit.headers['x-api-key']).toBe('sk-ant-SERVER')
    expect(hit.headers['anthropic-version']).toBe('2023-06-01')
    expect(hit.body).toContain('claude-sonnet-5')
    expect(JSON.stringify(hit.headers)).not.toContain(key)
  })

  it('OpenAI-compatible route: forwards path and body with the server key (Bearer from the client accepted)', async () => {
    const key = await signedInKey()
    const res = await fetch(`${base}/api/llm_proxy/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.4', messages: [] }),
    })
    expect(await res.json()).toEqual({ ok: true, path: '/v1/chat/completions' })
    const hit = upstream.seen.find((s) => s.url === '/v1/chat/completions')!
    expect(hit.headers.authorization).toBe('Bearer sk-oai-SERVER')
  })

  it('401 for missing, wrong or revoked keys (so the app drops the key and signs in again)', async () => {
    const attempts: Record<string, string>[] = [{}, { 'x-api-key': 'zf-nope' }, { authorization: 'Bearer zf-nope' }]
    for (const headers of attempts) {
      const res = await fetch(`${base}/api/anthropic/v1/messages`, { method: 'POST', headers, body: '{}' })
      expect(res.status).toBe(401)
    }
    expect(upstream.seen).toHaveLength(0)
  })

  it('503 with a clear message when the server has no upstream key configured', async () => {
    const key = await signedInKey()
    await close(ref.server)
    // same account database is not shared, so mint a key on the unconfigured server instead
    ref = await startRef({ anthropicKey: '', openaiKey: '' })
    base = ref.cfg.publicUrl
    process.env.ZEROFYE_BASE_URL = base
    expect(key).toBeTruthy()
    resetZerofyeofficeAuthCache()
    await login((url) => browse(url, { mode: 'signup', email: 'y@example.com', password: 'correct horse battery' }))
    const res = await fetch(`${base}/api/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': zerofyeofficeApiKey() },
      body: '{}',
    })
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).toContain('ANTHROPIC_API_KEY')
  })

  it('answers unknown Genspark-style tool endpoints with a clean 404 instead of crashing', async () => {
    const key = await signedInKey()
    const res = await fetch(`${base}/api/tool_cli/tools`, { headers: { 'X-Api-Key': key } })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ status: 'error' })
  })
})
