#!/usr/bin/env node
// Lager et VAPID-nøkkelpar for Web Push (src/server/push-send.ts).
//
// Bruk:
//   node scripts/generate-vapid-keys.mjs
// og lim verdiene inn som secrets — aldri i en fil i repoet:
//   pnpm exec wrangler secret put VAPID_PUBLIC_KEY
//   pnpm exec wrangler secret put VAPID_PRIVATE_KEY
//   (staging: legg til --env staging; egne nøkler per miljø)
// Lokalt: legg begge i .dev.vars (som er gitignorert).
//
// Bytter man nøkler, blir alle eksisterende abonnement ugyldige: push-tjenestene
// svarer da 403/410, og medlemmene må slå på varsler på nytt.
import { webcrypto as crypto } from 'node:crypto'

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey))
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey)

console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${d}`)
