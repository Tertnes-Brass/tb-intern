import { describe, expect, it } from 'vitest'
import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPushPayload,
  isAllowedPushEndpoint,
  vapidAuthorization,
} from './web-push'

// RFC 8291, vedlegg A — testvektoren for aes128gcm-kryptering av en push-melding.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

describe('encryptPushPayload', () => {
  it('gir nøyaktig RFC 8291-vektoren', async () => {
    const body = await encryptPushPayload(
      new TextEncoder().encode(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      {
        salt: base64UrlDecode(RFC.salt),
        senderKeys: { publicKey: base64UrlDecode(RFC.asPublic), privateKey: base64UrlDecode(RFC.asPrivate) },
      },
    )
    expect(base64UrlEncode(body)).toBe(RFC.body)
  })

  it('bruker fersk salt og nøkkel for hver melding', async () => {
    const keys = { p256dh: RFC.uaPublic, auth: RFC.auth }
    const a = await encryptPushPayload(new TextEncoder().encode('hei'), keys)
    const b = await encryptPushPayload(new TextEncoder().encode('hei'), keys)
    expect(base64UrlEncode(a)).not.toBe(base64UrlEncode(b))
    // salt (16) + postlengde (4) + id-lengde (1) + nøkkel (65) + tekst + avgrenser + tag (16)
    expect(a.length).toBe(16 + 4 + 1 + 65 + 3 + 1 + 16)
  })
})

describe('vapidAuthorization', () => {
  it('signerer en JWT som kan verifiseres med den offentlige nøkkelen', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const publicKey = base64UrlEncode(await crypto.subtle.exportKey('raw', pair.publicKey))
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const now = Date.UTC(2026, 9, 25, 12)

    const header = await vapidAuthorization(
      'https://web.push.apple.com/QGuQyavXutnMH8ma',
      { publicKey, privateKey: jwk.d!, subject: 'https://intern.tertnesbrass.com' },
      now,
    )
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
    expect(match).not.toBeNull()
    const [, h, c, sig, k] = match!
    expect(k).toBe(publicKey)
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(c!)))).toEqual({
      aud: 'https://web.push.apple.com',
      exp: now / 1000 + 12 * 60 * 60,
      sub: 'https://intern.tertnesbrass.com',
    })
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      base64UrlDecode(sig!),
      new TextEncoder().encode(`${h}.${c}`),
    )
    expect(ok).toBe(true)
  })
})

describe('isAllowedPushEndpoint', () => {
  it('godtar de kjente push-tjenestene', () => {
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QGuQyavXutnMH8ma')).toBe(true)
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc:def')).toBe(true)
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/gAAA')).toBe(true)
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true)
  })

  it('avviser alt annet (SSRF)', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false)
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false)
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest')).toBe(false)
    expect(isAllowedPushEndpoint('ikke en url')).toBe(false)
  })
})
