/**
 * Push-varsler: hva som står i dem, og hvem som får dem. Rene regler uten
 * database og nettverk, testet i `push.test.ts`. Selve utsendingen er
 * `src/server/push-send.ts`, krypteringen `src/lib/web-push.ts`.
 *
 * Varslene følger de SAMME valgene som e-posten på /min-profil — «Beskjeder»
 * og «Når noen nevner deg» gjelder begge kanalene. Push går bare til enheter
 * der medlemmet selv har slått på varsler; ingen får push uten å ha bedt om det.
 */

/** Det service workeren viser (public/sw.js). Holdes lite: maks ~4 kB kryptert. */
export type PushMessage = {
  title: string
  body: string
  /** Relativ adresse i appen som åpnes ved trykk. */
  url: string
  /** Samme `tag` erstatter et tidligere varsel i stedet for å legge et nytt oppå. */
  tag: string
  /** Tallet på app-ikonet etter dette varselet, når det er kjent. */
  badge?: number
}

/** Hvor lenge push-tjenesten skal prøve å levere før varselet er uaktuelt (sekunder). */
export const PUSH_TTL = {
  post: 3 * 24 * 60 * 60,
  mention: 3 * 24 * 60 * 60,
  rsvp: 18 * 60 * 60,
} as const

const BODY_MAX = 160

function clip(text: string, max = BODY_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

export function postPushMessage(post: {
  id: string
  heading: string
  important: boolean
  official: boolean
  fromArchive?: boolean
  authorName: string
}): PushMessage {
  const from = post.fromArchive ? 'fra notearkivar' : post.official ? 'fra styret' : `fra ${post.authorName}`
  return {
    title: post.important ? `Viktig ${from}` : `Ny beskjed ${from}`,
    body: clip(post.heading),
    url: `/beskjeder/${post.id}`,
    tag: `post:${post.id}`,
  }
}

export function mentionPushMessage(input: {
  postId: string
  /** Den som skrev kommentaren eller innlegget. */
  authorName: string
  excerpt: string
  where: 'comment' | 'post'
}): PushMessage {
  return {
    title: input.where === 'comment' ? `${input.authorName} nevnte deg i en kommentar` : `${input.authorName} nevnte deg`,
    body: clip(input.excerpt),
    url: `/beskjeder/${input.postId}`,
    tag: `mention:${input.postId}`,
  }
}

export function rsvpReminderMessage(event: {
  occurrenceKey: string
  title: string
  /** «i morgen kl. 19:00» */
  when: string
}): PushMessage {
  return {
    title: `Kommer du ${event.when}?`,
    body: `${event.title} — du har ikke svart ennå.`,
    url: `/kalender/${event.occurrenceKey}`,
    tag: `rsvp:${event.occurrenceKey}`,
  }
}

export const RSVP_REMINDER_CHOICES = ['all', 'off'] as const
export type RsvpReminderChoice = (typeof RSVP_REMINDER_CHOICES)[number]

/**
 * Hvem som får påminnelsen om oppmøte for én hendelse: aktive medlemmer med
 * minst én enhet som tar imot varsler, som ikke har svart, og som ikke har
 * slått påminnelsen av (ingen rad = på).
 */
export function rsvpReminderRecipients(input: {
  subscribers: Array<{ userId: string; isActive: boolean; pref: RsvpReminderChoice | null }>
  answered: ReadonlySet<string>
}): string[] {
  const out = new Set<string>()
  for (const s of input.subscribers) {
    if (!s.isActive || s.pref === 'off' || input.answered.has(s.userId)) continue
    out.add(s.userId)
  }
  return [...out]
}

/** «iPhone · Safari» — så man kan se hvilke enheter som får varsler. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  const device = /iPad/.test(ua)
    ? 'iPad'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Ukjent enhet'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\/|FxiOS/.test(ua)
      ? 'Firefox'
      : /Chrome\/|CriOS/.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null
  return browser ? `${device} · ${browser}` : device
}
