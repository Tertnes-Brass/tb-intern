import { env } from 'cloudflare:workers'

/**
 * Signert «billett» for en pågående multipart-opplasting.
 *
 * Klienten må sende R2-nøkkelen og uploadId tilbake for hver del, så de kan
 * ikke være rå klientdata: uten signatur kunne en arkivar byttet ut nøkkelen og
 * skrevet over en vilkårlig fil i bøtta. Billetten er statsløs (HMAC over
 * BETTER_AUTH_SECRET), så den krever ingen egen tabell.
 */
export type UploadTicket = {
  workId: string
  fileId: string
  key: string
  uploadId: string
  fileName: string
  userId: string
  exp: number
}

/** Rikelig for en treg opplasting, kort nok til at en lekket billett dør fort. */
const TTL_MS = 6 * 60 * 60 * 1000

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(env.BETTER_AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signUploadTicket(data: Omit<UploadTicket, 'exp'>): Promise<string> {
  const ticket: UploadTicket = { ...data, exp: Date.now() + TTL_MS }
  const payload = toBase64Url(encoder.encode(JSON.stringify(ticket)))
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(payload))
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`
}

/**
 * Returnerer billetten bare hvis signaturen holder, den ikke er utløpt, og den
 * tilhører `userId` — en billett skal ikke kunne gjenbrukes av en annen bruker.
 */
export async function verifyUploadTicket(
  token: string | null | undefined,
  userId: string,
): Promise<UploadTicket | null> {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot < 1) return null

  const payload = token.slice(0, dot)
  let ticket: UploadTicket
  try {
    // crypto.subtle.verify sammenligner i konstant tid.
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(),
      fromBase64Url(token.slice(dot + 1)),
      encoder.encode(payload),
    )
    if (!valid) return null
    ticket = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as UploadTicket
  } catch {
    return null
  }

  if (typeof ticket.exp !== 'number' || ticket.exp < Date.now()) return null
  if (ticket.userId !== userId) return null
  return ticket
}
