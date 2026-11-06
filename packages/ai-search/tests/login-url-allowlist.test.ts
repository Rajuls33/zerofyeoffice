import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAllowedAuthUrl, startZerofyeofficeLogin } from '../src/zerofyeoffice-auth'

describe('isAllowedAuthUrl', () => {
  const BASE = 'https://zerofye.com'

  it('accepts https on the endpoint host', () => {
    expect(isAllowedAuthUrl('https://zerofye.com/login?x=1', BASE)).toBeTruthy()
  })

  it('accepts sibling hosts on the endpoint registrable domain (review point 1)', () => {
    // the verify page may move between the auth service's own hosts
    expect(isAllowedAuthUrl('https://auth.zerofye.com/device', BASE)).toBeTruthy()
    expect(isAllowedAuthUrl('https://zerofye.com/device', BASE)).toBeTruthy()
  })

  it('accepts siblings of a non-www staging base', () => {
    expect(
      isAllowedAuthUrl(
        'https://auth.staging.zerofye.com/device',
        'https://www.staging.zerofye.com',
      ),
    ).toBeTruthy()
  })

  it('still refuses a different registrable domain', () => {
    // a staging endpoint must not be able to send the browser to production,
    // and no host outside the endpoint's registrable domain passes
    expect(
      isAllowedAuthUrl('https://zerofye.com/device', 'https://staging.zerofye.com'),
    ).toBeFalsy()
    expect(isAllowedAuthUrl('https://zerofye.com.evil.example/x', BASE)).toBeFalsy()
    expect(isAllowedAuthUrl('https://notzerofye.com/x', BASE)).toBeFalsy()
  })

  it('refuses other protocols and unparseable input', () => {
    for (const bad of [
      'file:///etc/passwd',
      'smb://share/x',
      'ms-msdt:-foo',
      'http://zerofye.com/login',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isAllowedAuthUrl(bad, BASE)).toBeFalsy()
    }
  })

  it('requires exact host equality for IP literals and localhost', () => {
    expect(isAllowedAuthUrl('https://localhost/device', 'https://localhost')).toBeTruthy()
    expect(isAllowedAuthUrl('https://sub.localhost/device', 'https://localhost')).toBeFalsy()
    expect(isAllowedAuthUrl('https://127.0.0.1/device', 'https://127.0.0.1')).toBeTruthy()
    // `evil.127.0.0.1` is a public DNS name that resolves elsewhere
    expect(isAllowedAuthUrl('https://evil.127.0.0.1/device', 'https://127.0.0.1')).toBeFalsy()
    expect(isAllowedAuthUrl('https://[::1]/device', 'https://[::1]')).toBeTruthy()
    expect(isAllowedAuthUrl('https://[::2]/device', 'https://[::1]')).toBeFalsy()
  })
})

describe('startZerofyeofficeLogin auth_url allowlist', () => {
  let savedBase: string | undefined
  let savedFetch: typeof fetch | undefined

  const stubDeviceCode = (authUrl: string, pollJson: unknown = { status: 'expired' }) => {
    savedBase = process.env.GSK_BASE_URL
    savedFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/office_addin_auth/device_code')) {
        return new Response(
          JSON.stringify({
            device_code: 'dc',
            auth_url: authUrl,
            expires_in: 1,
            poll_interval: 0.001,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify(pollJson), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    process.env.GSK_BASE_URL = 'https://zerofye.com'
  }

  afterEach(() => {
    if (savedBase === undefined) delete process.env.GSK_BASE_URL
    else process.env.GSK_BASE_URL = savedBase
    if (savedFetch !== undefined) globalThis.fetch = savedFetch
    vi.unstubAllGlobals()
  })

  it('emits error "auth_url_rejected" and never a url event for a file:// auth_url', async () => {
    stubDeviceCode('file:///etc/passwd')
    const events: { phase: string; error?: string }[] = []
    startZerofyeofficeLogin((p) => events.push(p))
    await vi.waitFor(() => expect(events.at(-1)?.phase).toBe('error'))
    expect(events).toEqual([{ phase: 'error', error: 'auth_url_rejected' }])
  })

  it('opens a sibling-host auth_url (auth.zerofye.com) end-to-end', async () => {
    stubDeviceCode('https://auth.zerofye.com/device?code=abc')
    const events: { phase: string; url?: string }[] = []
    startZerofyeofficeLogin((p) => events.push(p))
    await vi.waitFor(() => expect(events.at(-1)?.phase).toBe('error')) // poll stub answers 'expired'
    expect(events[0]).toEqual({
      phase: 'url',
      url: 'https://auth.zerofye.com/device?code=abc',
      expiresInSec: 1,
    })
  })
})
