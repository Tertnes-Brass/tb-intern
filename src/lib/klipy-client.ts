/**
 * Nettlesersiden av GIF-velgeren: kallene går rett fra medlemmets nettleser til
 * KLIPY (vilkåret for å bruke dem, se src/lib/klipy.ts). Ingen informasjonskapsler
 * og ingen referrer følger med — KLIPY får vite at noen søker, ikke hvor.
 */

import { getKlipyConfig } from '../server/klipy'
import { type KlipyCategory, type KlipyConfig, type KlipyItem, klipyEndpoint, parseKlipyCategories, parseKlipyItems } from './klipy'
import type { ExternalMediaKind } from './message-media'

let configPromise: Promise<KlipyConfig | null> | null = null

/** Oppsettet hentes én gang per økt i fanen. Null = GIF-søket er av. */
export function loadKlipyConfig(): Promise<KlipyConfig | null> {
  configPromise ??= getKlipyConfig().catch((err: unknown) => {
    configPromise = null
    throw err
  })
  return configPromise
}

async function klipyJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`KLIPY svarte ${res.status}`)
  return res.json()
}

export type KlipyFeed = { op: 'search'; q: string } | { op: 'trending' } | { op: 'recent' }

export async function fetchKlipyItems(
  config: KlipyConfig,
  kind: ExternalMediaKind,
  feed: KlipyFeed,
  page: number,
  signal?: AbortSignal,
): Promise<{ items: KlipyItem[]; hasNext: boolean }> {
  const url = klipyEndpoint(config, kind, feed.op === 'search' ? { op: 'search', q: feed.q, page } : { op: feed.op, page })
  return parseKlipyItems(kind, await klipyJson(url, signal))
}

const categoryCache = new Map<ExternalMediaKind, Promise<KlipyCategory[]>>()

/** Kategoriene endrer seg sjelden; én henting per fane per økt. */
export function fetchKlipyCategories(config: KlipyConfig, kind: ExternalMediaKind): Promise<KlipyCategory[]> {
  let cached = categoryCache.get(kind)
  if (!cached) {
    cached = klipyJson(klipyEndpoint(config, kind, { op: 'categories' })).then(parseKlipyCategories)
    cached.catch(() => categoryCache.delete(kind))
    categoryCache.set(kind, cached)
  }
  return cached
}

/**
 * «Delt» — KLIPY bruker det til «nylig brukt» og bedre treff, og vilkårene sier
 * vi ikke skal stå i veien for målingene deres. Beste forsøk; en feil her skal
 * aldri stoppe meldingen.
 */
export function triggerKlipyShare(config: KlipyConfig, item: KlipyItem, q: string): void {
  void fetch(klipyEndpoint(config, item.kind, { op: 'share', slug: item.slug }), {
    method: 'POST',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customer_id: config.customerId, ...(q ? { q } : {}) }),
  }).catch(() => {})
}
