/**
 * Ren hjelpelogikk for Beskjeder (#28): utdrag, avsnitt/auto-lenking og
 * mottakerutvalget for e-postvarsling. Ingen server- eller DOM-avhengigheter,
 * slik at reglene kan testes uten database og e-postbinding.
 *
 * Teksten i en beskjed er ren tekst med avsnitt — ikke markdown. URL-er
 * gjenkjennes og gjøres klikkbare ved rendring; alt annet vises som skrevet.
 */

export type PostAudience = 'all' | 'board'
export type PostImportance = 'normal' | 'important'
/** Valget medlemmet gjør på /min-profil. Ingen rad i databasen = `all`. */
export type PostNotificationChoice = 'all' | 'important' | 'off'

export const POST_AUDIENCES: PostAudience[] = ['all', 'board']
export const POST_IMPORTANCES: PostImportance[] = ['normal', 'important']
export const POST_NOTIFICATION_CHOICES: PostNotificationChoice[] = ['all', 'important', 'off']

/** Standard lengde på utdraget i feeden, på hub-en og i e-posten. */
export const EXCERPT_LENGTH = 180

/**
 * Kort, énlinjes utdrag: avsnitt slås sammen, mellomrom normaliseres, og
 * kuttet skjer på siste ordgrense før grensen slik at ord ikke halveres.
 */
export function excerpt(body: string, n: number = EXCERPT_LENGTH): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (n <= 0) return ''
  if (flat.length <= n) return flat
  const cut = flat.slice(0, n)
  const lastSpace = cut.lastIndexOf(' ')
  // Ett langt ord uten mellomrom: kutt hardt heller enn å returnere ingenting.
  const head = lastSpace > n * 0.4 ? cut.slice(0, lastSpace) : cut
  return `${head.replace(/[.,;:!?\-–—\s]+$/, '')}…`
}

/** Avsnitt = tekst adskilt av én eller flere tomme linjer. Tomme avsnitt faller bort. */
export function paragraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export type PostToken = { kind: 'text'; value: string } | { kind: 'link'; value: string; href: string }

// Ingen `g`-flagg: mønsteret brukes med `exec` mot en stadig kortere rest, og et
// delt regex med `lastIndex` ville hoppet over annethvert treff.
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>()[\]{}"'«»]+/i
/** «Se www.tertnesbrass.no.» skal ikke få punktumet med i lenken. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/

/** Skiller en linje i ren tekst og URL-er, slik at React kan rendre lenkene selv. */
export function tokenize(line: string): PostToken[] {
  const out: PostToken[] = []
  let rest = line
  for (;;) {
    const match = URL_PATTERN.exec(rest)
    if (!match) break
    const raw = match[0].replace(TRAILING_PUNCTUATION, '')
    if (!raw) break
    if (match.index > 0) out.push({ kind: 'text', value: rest.slice(0, match.index) })
    out.push({ kind: 'link', value: raw, href: raw.startsWith('www.') ? `https://${raw}` : raw })
    rest = rest.slice(match.index + raw.length)
  }
  if (rest.length > 0) out.push({ kind: 'text', value: rest })
  return out
}

/** Escaper alt som kan bryte ut av HTML-kontekst. Brukes før auto-lenking. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Tekst → HTML for e-post: avsnitt blir `<p>`, enkle linjeskift blir `<br>`, og
 * URL-er blir lenker. ALT brukerinnhold escapes først — teksten er skrevet av et
 * menneske i en textarea, aldri betrodd som HTML.
 */
export function bodyToHtml(body: string, paragraphStyle = ''): string {
  const style = paragraphStyle ? ` style="${paragraphStyle}"` : ''
  return paragraphs(body)
    .map((p) => {
      const html = p
        .split('\n')
        .map((line) =>
          tokenize(line)
            .map((t) =>
              t.kind === 'link'
                ? `<a href="${escapeHtml(t.href)}">${escapeHtml(t.value)}</a>`
                : escapeHtml(t.value),
            )
            .join(''),
        )
        .join('<br>')
      return `<p${style}>${html}</p>`
    })
    .join('')
}

// ---------- Mottakerutvalg ----------

/** Et potensielt mottakende medlem, slik `publishPost` henter det fra databasen. */
export type PostRecipient = {
  userId: string
  email: string | null
  isActive: boolean
  /** Har `posts.publish` (styret, dirigent, admin) — avgjør `audience: 'board'`. */
  canPublish: boolean
}

/**
 * Hvem skal ha e-post om denne beskjeden?
 *
 * Fire krav, alle må være oppfylt: medlemmet er aktivt, har en e-postadresse,
 * preferansen tillater det (ingen preferanse = alle beskjeder), og målgruppen
 * omfatter dem. `audience: 'board'` går kun til dem som selv kan publisere.
 * Idempotens (allerede varslet) håndteres av `notification_log`, ikke her.
 */
export function recipientsFor(
  post: { audience: PostAudience; importance: PostImportance },
  members: PostRecipient[],
  prefs: Map<string, PostNotificationChoice> | Record<string, PostNotificationChoice>,
): PostRecipient[] {
  const lookup = (userId: string): PostNotificationChoice =>
    (prefs instanceof Map ? prefs.get(userId) : prefs[userId]) ?? 'all'

  return members.filter((m) => {
    if (!m.isActive) return false
    if (!m.email || !m.email.trim()) return false
    if (post.audience === 'board' && !m.canPublish) return false
    const choice = lookup(m.userId)
    if (choice === 'off') return false
    if (choice === 'important' && post.importance !== 'important') return false
    return true
  })
}

/** Kan denne beskjeden vises for en leser med/uten `posts.publish`? */
export function canReadPost(
  post: { audience: PostAudience; publishedAt: number | null },
  canPublish: boolean,
): boolean {
  if (canPublish) return true
  return post.publishedAt !== null && post.audience === 'all'
}

// ---------- Kvittering etter varsling ----------

/**
 * Én linje om hva som FAKTISK skjedde med varslingen — samme sannhetskilde i
 * toast og kvittering. `logged` betyr at e-post ikke er aktivert her og at
 * innholdet bare gikk til konsollen; det skal aldri presenteres som «sendt»
 * (samme regel som `inviteDeliveryMessage` i lib/invitation.ts).
 */
export function notifyResultMessage(result: { sent: number; logged: number; failed: number; skipped: number }): {
  message: string
  kind: 'ok' | 'error'
} {
  const { sent, logged, failed, skipped } = result
  if (sent === 0 && logged === 0 && failed === 0) {
    return {
      message: skipped > 0 ? 'Publisert. Alle mottakerne har allerede fått e-post.' : 'Publisert. Ingen e-post ble sendt.',
      kind: 'ok',
    }
  }
  if (logged > 0 && sent === 0 && failed === 0) {
    return {
      message: `Publisert, men e-post er ikke aktivert her — ${logged} varsler ble bare loggført lokalt.`,
      kind: 'error',
    }
  }
  const parts = [`Sendt til ${sent} ${sent === 1 ? 'medlem' : 'medlemmer'}`]
  if (logged > 0) parts.push(`${logged} loggført lokalt`)
  if (failed > 0) parts.push(`${failed} feilet`)
  if (skipped > 0) parts.push(`${skipped} hadde den fra før`)
  return { message: `${parts.join(' · ')}.`, kind: failed > 0 ? 'error' : 'ok' }
}
