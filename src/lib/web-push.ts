/**
 * Web Push uten avhengigheter — bare WebCrypto, som finnes både i Workers og i
 * Node (testene). To deler:
 *
 * 1. **VAPID** (RFC 8292): en signert JWT som forteller push-tjenesten (Apple,
 *    Google, Mozilla) hvem som sender. Nøkkelparet er appens, ikke brukerens.
 * 2. **Kryptering** (RFC 8291 + RFC 8188, `aes128gcm`): innholdet krypteres til
 *    den ene nettleseren som abonnerer, med nøklene den oppga. Push-tjenesten
 *    ser aldri teksten.
 *
 * `web-push.test.ts` låser krypteringen mot testvektoren i RFC 8291 vedlegg A.
 */

const encoder = new TextEncoder()

export function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const b of view) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** Et ukomprimert P-256-punkt (65 byte: 0x04 ‖ x ‖ y) + privat skalar → JWK. */
function ecJwk(publicKey: Uint8Array, privateKey?: Uint8Array): JsonWebKey {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) throw new Error('Ugyldig P-256-nøkkel')
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(publicKey.slice(1, 33)),
    y: base64UrlEncode(publicKey.slice(33, 65)),
    ...(privateKey ? { d: base64UrlEncode(privateKey) } : {}),
    ext: true,
  }
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

/** HKDF (RFC 5869) med ett utvidelsessteg — vi trenger aldri mer enn 32 byte. */
async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const prk = await hmac(salt, ikm)
  const okm = await hmac(prk, concat(info, new Uint8Array([1])))
  return okm.slice(0, length)
}

export type PushKeys = {
  /** Abonnentens offentlige nøkkel (base64url, 65 byte ukomprimert). */
  p256dh: string
  /** Abonnentens autentiseringshemmelighet (base64url, 16 byte). */
  auth: string
}

/**
 * Krypterer `plaintext` til én abonnent (`aes128gcm`, én post). `salt` og
 * `senderKeys` kan settes for å teste mot RFC-vektoren; ellers lages ferske
 * verdier for hver melding, slik standarden krever.
 */
export async function encryptPushPayload(
  plaintext: Uint8Array,
  keys: PushKeys,
  opts: { salt?: Uint8Array; senderKeys?: { publicKey: Uint8Array; privateKey: Uint8Array } } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = base64UrlDecode(keys.p256dh)
  const authSecret = base64UrlDecode(keys.auth)
  const salt = opts.salt ? new Uint8Array(opts.salt) : crypto.getRandomValues(new Uint8Array(16))

  let asPublic: Uint8Array<ArrayBuffer>
  let asPrivateKey: CryptoKey
  if (opts.senderKeys) {
    asPublic = new Uint8Array(opts.senderKeys.publicKey)
    asPrivateKey = await crypto.subtle.importKey(
      'jwk',
      ecJwk(opts.senderKeys.publicKey, opts.senderKeys.privateKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    )
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    asPrivateKey = pair.privateKey
  }

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivateKey, 256))

  // RFC 8291 §3.4: IKM fra delt hemmelighet + auth, så CEK og nonce (RFC 8188).
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12)

  // Én post: innholdet + avgrenser 0x02 (siste post), ingen ekstra utfylling.
  const record = concat(plaintext, new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record))

  // Hode: salt (16) ‖ postlengde (4, big-endian) ‖ nøkkel-id-lengde (1) ‖ nøkkel-id.
  const header = new Uint8Array(16 + 4 + 1)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096, false)
  header[20] = asPublic.length
  return concat(header, asPublic, ciphertext)
}

export type VapidKeys = {
  /** base64url, 65 byte ukomprimert P-256-punkt. Den samme som nettleseren får. */
  publicKey: string
  /** base64url, 32 byte. Hemmelig — Worker-secret, aldri til klienten. */
  privateKey: string
  /** `mailto:` eller `https:` — hvem push-tjenesten kan kontakte. */
  subject: string
}

/**
 * `Authorization`-headeren for én forespørsel til en push-tjeneste. JWT-en er
 * bundet til tjenestens opprinnelse og gyldig i tolv timer (maks er 24).
 */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  )
  const unsigned = `${header}.${claims}`
  const key = await crypto.subtle.importKey(
    'jwk',
    ecJwk(base64UrlDecode(vapid.publicKey), base64UrlDecode(vapid.privateKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  // WebCrypto gir r ‖ s (64 byte), som er nettopp JWS-formatet for ES256.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned))
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${vapid.publicKey}`
}

/**
 * Push-tjenestene vi sender til. Serveren poster til en adresse nettleseren
 * oppga — uten en liste ville et rått kall kunnet få Workeren til å sende
 * forespørsler hvor som helst (SSRF).
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
]

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((re) => re.test(url.hostname))
}
