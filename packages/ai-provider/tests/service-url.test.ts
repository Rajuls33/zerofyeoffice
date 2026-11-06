import { describe, expect, it } from 'vitest'
import {
  ZEROFYE_DEFAULT_BASE_URL,
  isSameSiteHost,
  isZerofyeServiceUrl,
  zerofyeBaseHost,
  zerofyeBaseUrl,
  zerofyeUrl,
} from '../src/service-url'

describe('zerofyeBaseUrl', () => {
  it('defaults to https://zerofye.com', () => {
    expect(ZEROFYE_DEFAULT_BASE_URL).toBe('https://zerofye.com')
    expect(zerofyeBaseUrl({})).toBe('https://zerofye.com')
    expect(zerofyeBaseHost({})).toBe('zerofye.com')
  })

  it('accepts an https override and strips the path', () => {
    expect(zerofyeBaseUrl({ ZEROFYE_BASE_URL: 'https://office.example.com/some/path/' })).toBe(
      'https://office.example.com',
    )
  })

  it('accepts http only for loopback hosts (local development)', () => {
    expect(zerofyeBaseUrl({ ZEROFYE_BASE_URL: 'http://localhost:8787' })).toBe('http://localhost:8787')
    expect(zerofyeBaseUrl({ ZEROFYE_BASE_URL: 'http://127.0.0.1:8787' })).toBe('http://127.0.0.1:8787')
  })

  it('ignores cleartext on a public host, credentials in the URL and garbage', () => {
    for (const bad of [
      'http://office.example.com',
      'https://user:pass@office.example.com',
      'ftp://office.example.com',
      'not a url',
      '',
      '   ',
    ]) {
      expect(zerofyeBaseUrl({ ZEROFYE_BASE_URL: bad })).toBe(ZEROFYE_DEFAULT_BASE_URL)
    }
  })

  it('keeps GSK_BASE_URL as a fallback alias; ZEROFYE_BASE_URL wins', () => {
    expect(zerofyeBaseUrl({ GSK_BASE_URL: 'https://legacy.example.com' })).toBe(
      'https://legacy.example.com',
    )
    expect(
      zerofyeBaseUrl({
        ZEROFYE_BASE_URL: 'https://new.example.com',
        GSK_BASE_URL: 'https://legacy.example.com',
      }),
    ).toBe('https://new.example.com')
    // an unusable ZEROFYE_BASE_URL falls through to the alias, then the default
    expect(
      zerofyeBaseUrl({ ZEROFYE_BASE_URL: 'http://evil.example.com', GSK_BASE_URL: 'https://legacy.example.com' }),
    ).toBe('https://legacy.example.com')
  })
})

describe('zerofyeUrl', () => {
  it('joins with exactly one slash', () => {
    expect(zerofyeUrl('api/anthropic', {})).toBe('https://zerofye.com/api/anthropic')
    expect(zerofyeUrl('/api/anthropic', {})).toBe('https://zerofye.com/api/anthropic')
    expect(zerofyeUrl('///api/x', { ZEROFYE_BASE_URL: 'http://localhost:8787' })).toBe(
      'http://localhost:8787/api/x',
    )
  })
})

describe('isSameSiteHost', () => {
  it('matches the host, www and subdomains of the registrable domain', () => {
    expect(isSameSiteHost('zerofye.com', 'zerofye.com')).toBe(true)
    expect(isSameSiteHost('www.zerofye.com', 'zerofye.com')).toBe(true)
    expect(isSameSiteHost('auth.zerofye.com', 'zerofye.com')).toBe(true)
    expect(isSameSiteHost('zerofye.com', 'www.zerofye.com')).toBe(true)
    expect(isSameSiteHost('A.B.Zerofye.com', 'zerofye.com')).toBe(true)
  })

  it('rejects look-alikes', () => {
    expect(isSameSiteHost('evilzerofye.com', 'zerofye.com')).toBe(false)
    expect(isSameSiteHost('zerofye.com.evil.test', 'zerofye.com')).toBe(false)
    expect(isSameSiteHost('zerofye.co', 'zerofye.com')).toBe(false)
  })

  it('gives IP literals and single-label hosts no subdomain tree', () => {
    expect(isSameSiteHost('127.0.0.1', '127.0.0.1')).toBe(true)
    expect(isSameSiteHost('evil.127.0.0.1', '127.0.0.1')).toBe(false)
    expect(isSameSiteHost('localhost', 'localhost')).toBe(true)
    expect(isSameSiteHost('evil.localhost', 'localhost')).toBe(false)
  })
})

describe('isZerofyeServiceUrl (where the account key may be sent)', () => {
  it('accepts the service origin and its subdomains', () => {
    expect(isZerofyeServiceUrl('https://zerofye.com/api/anthropic/v1/messages', {})).toBe(true)
    expect(isZerofyeServiceUrl('https://www.zerofye.com/x', {})).toBe(true)
    expect(isZerofyeServiceUrl('https://auth.zerofye.com/device', {})).toBe(true)
  })

  it('rejects other hosts, look-alikes, wrong scheme/port and embedded credentials', () => {
    for (const bad of [
      undefined,
      '',
      'https://api.anthropic.com/v1/messages',
      'https://evilzerofye.com/x',
      'https://zerofye.com.evil.test/x',
      'http://zerofye.com/x',
      'https://zerofye.com:8443/x',
      'https://user:pw@zerofye.com/x',
      'not a url',
    ]) {
      expect(isZerofyeServiceUrl(bad, {})).toBe(false)
    }
  })

  it('follows an explicit loopback override, and only that origin', () => {
    const env = { ZEROFYE_BASE_URL: 'http://localhost:8787' }
    expect(isZerofyeServiceUrl('http://localhost:8787/api/x', env)).toBe(true)
    expect(isZerofyeServiceUrl('http://localhost:9999/api/x', env)).toBe(false)
    expect(isZerofyeServiceUrl('https://zerofye.com/api/x', env)).toBe(false)
  })
})
