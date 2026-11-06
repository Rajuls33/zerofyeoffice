/**
 * The one place that knows where the Zerofye service (sign-in, LLM proxy,
 * tool API) lives. Every host check that decides "is this our server, may it
 * receive the account key" goes through here.
 *
 * Default: https://zerofye.com. Override with ZEROFYE_BASE_URL (GSK_BASE_URL is
 * kept as a backward-compatible alias). An override must be https://, or
 * http:// to a loopback host (local development); anything else is ignored so a
 * typo can never downgrade the account key to cleartext on a public host.
 */

export const ZEROFYE_DEFAULT_BASE_URL = 'https://zerofye.com'

type Env = Record<string, string | undefined>

function processEnv(): Env {
  return typeof process !== 'undefined' && process.env ? process.env : {}
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** http(s) origin (no path) for an accepted override, else null. */
function parseBase(raw: string | undefined): URL | null {
  const value = raw?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.username || url.password) return null
    if (url.protocol === 'https:') return url
    if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url
  } catch {
    /* fall through */
  }
  return null
}

/** Service origin without a trailing slash, e.g. `https://zerofye.com`. */
export function zerofyeBaseUrl(env: Env = processEnv()): string {
  const url = parseBase(env.ZEROFYE_BASE_URL) ?? parseBase(env.GSK_BASE_URL)
  if (!url) return ZEROFYE_DEFAULT_BASE_URL
  return url.origin
}

/** Hostname of the service origin (`zerofye.com`). */
export function zerofyeBaseHost(env: Env = processEnv()): string {
  return new URL(zerofyeBaseUrl(env)).hostname
}

/** `<base>/<path>` with exactly one slash between. */
export function zerofyeUrl(path: string, env: Env = processEnv()): string {
  return `${zerofyeBaseUrl(env)}/${path.replace(/^\/+/, '')}`
}

/** Whether `hostname` is `base` or a subdomain of it (IPs / single-label hosts have no subdomain tree). */
export function isSameSiteHost(hostname: string, baseHostname: string): boolean {
  const host = hostname.toLowerCase()
  const registrable = baseHostname.toLowerCase().replace(/^www\./, '')
  const flat =
    baseHostname.startsWith('[') || /^[\d.]+$/.test(baseHostname) || !registrable.includes('.')
  if (flat) return host === baseHostname.toLowerCase()
  return host === registrable || host === baseHostname.toLowerCase() || host.endsWith(`.${registrable}`)
}

/**
 * True when `raw` is an http(s) URL on the configured service site: same
 * protocol and port as the base, host equal to it or one of its subdomains.
 * Used to decide where the account key / attribution header may be sent.
 */
export function isZerofyeServiceUrl(raw: string | undefined, env: Env = processEnv()): boolean {
  if (!raw) return false
  try {
    const url = new URL(raw)
    const base = new URL(zerofyeBaseUrl(env))
    if (url.username || url.password) return false
    if (url.protocol !== base.protocol || url.port !== base.port) return false
    return isSameSiteHost(url.hostname, base.hostname)
  } catch {
    return false
  }
}
