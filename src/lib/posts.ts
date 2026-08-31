/**
 * Ren hjelpelogikk for Beskjeder (#28) — veggen: utdrag, avsnitt/auto-lenking,
 * hvem som får skrive hva, og mottakerutvalget for e-postvarsling. Ingen
 * server- eller DOM-avhengigheter, slik at reglene kan testes uten database,
 * R2 og e-postbinding.
 *
 * Teksten i et innlegg er ren tekst med avsnitt — ikke markdown. URL-er
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

// ---------- Hvem får skrive hva ----------

/**
 * Alle innloggede kan skrive på veggen. Det `posts.publish` gir, er de fire
 * tingene som gjør et innlegg til noe mer enn en melding fra et medlem:
 * «Fra styret»-merket, «Viktig», styre-målgruppen og e-postvarsling — pluss
 * moderasjon av andres innlegg.
 */
export type PostWriterInput = {
  title: string | null
  body: string
  audience: PostAudience
  importance: PostImportance
  official: boolean
}

/**
 * Fjerner alt en vanlig skribent ikke har lov til å sette. Serveren kaller
 * denne på både opprettelse og redigering, så et privilegert felt aldri kan
 * snikes inn via et rått kall — UI-et skjuler dem bare.
 */
export function sanitizePostInput(input: PostWriterInput, canPublish: boolean): PostWriterInput {
  const title = input.title?.trim() ? input.title.trim() : null
  const body = input.body.trim()
  if (canPublish) return { ...input, title, body }
  return { title, body, audience: 'all', importance: 'normal', official: false }
}

/** Eieren av innlegget, eller en med `posts.publish` (moderasjon). */
export function canEditPost(
  me: { id: string } | null,
  post: { authorId: string | null },
  canPublish: boolean,
): boolean {
  if (!me) return false
  if (canPublish) return true
  return post.authorId !== null && post.authorId === me.id
}

/** Samme regel for kommentarer: egen kommentar, eller moderator. */
export function canDeleteComment(
  me: { id: string } | null,
  comment: { authorId: string | null },
  canPublish: boolean,
): boolean {
  if (!me) return false
  if (canPublish) return true
  return comment.authorId !== null && comment.authorId === me.id
}

/** Maks antall bilder per innlegg. Håndheves server-side ved opplasting. */
export const MAX_POST_IMAGES = 10
/** Maks størrelse per bilde. */
export const MAX_POST_IMAGE_BYTES = 10 * 1024 * 1024
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
] as const

/** `null` = greit. Ellers en begrunnelse klienten kan vise. */
export function imageRejectionReason(file: { type: string; size: number }): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase() as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return 'Bare bilder (JPG, PNG, WebP, GIF eller HEIC)'
  }
  if (file.size > MAX_POST_IMAGE_BYTES) return 'Bildet er større enn 10 MB'
  if (file.size <= 0) return 'Tom fil'
  return null
}

/** Filendelsen R2-nøkkelen skal ha. Nøkkelen bygges ALDRI av filnavnet. */
export function imageExtension(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/heic':
      return 'heic'
    default:
      return 'jpg'
  }
}

// ---------- Visning ----------

/**
 * Overskriften i feed, hub og e-post: tittelen når den finnes, ellers første
 * linje av teksten. Et medlemsinnlegg er ofte bare et par setninger, og skal
 * ikke tvinges til å finne på en tittel.
 */
export function postHeading(post: { title: string | null; body: string }, n = 70): string {
  const title = post.title?.trim()
  if (title) return title
  const firstLine = paragraphs(post.body)[0]?.split('\n')[0] ?? ''
  return excerpt(firstLine, n) || 'Uten tittel'
}

/** «3 kommentarer», «1 kommentar», «Ingen kommentarer ennå». */
export function commentCountLabel(n: number): string {
  if (n === 0) return 'Ingen kommentarer ennå'
  return n === 1 ? '1 kommentar' : `${n} kommentarer`
}

// ---------- Reaksjoner ----------

export type ReactionState = { count: number; mine: boolean }

/** Optimistisk toggle: samme regel på klienten og i testene som i databasen. */
export function toggleReaction(state: ReactionState): ReactionState {
  return state.mine ? { count: Math.max(0, state.count - 1), mine: false } : { count: state.count + 1, mine: true }
}

/** «Liker», «Du liker dette», «Du og 3 andre liker dette», «4 liker dette». */
export function reactionLabel(state: ReactionState): string {
  if (state.count === 0) return 'Ingen har likt dette ennå'
  if (!state.mine) return state.count === 1 ? '1 liker dette' : `${state.count} liker dette`
  if (state.count === 1) return 'Du liker dette'
  const others = state.count - 1
  return others === 1 ? 'Du og 1 annen liker dette' : `Du og ${others} andre liker dette`
}

// ---------- E-postkopi ----------

/** Emnefeltet. «Viktig:» foran gjør at det synes i innboksen uten å åpne. */
export function postEmailSubject(title: string, important: boolean): string {
  return important ? `Viktig: ${title}` : title
}

/** Avsenderlinjen i e-posten: «Fra styret · Navn» eller bare navnet. */
export function postEmailFrom(authorName: string, official: boolean): string {
  return official ? `Fra styret · ${authorName}` : authorName
}

/**
 * Bildene følger ikke med i e-posten — de ligger bak innlogging. Si i stedet
 * fra at de finnes. Tom streng når innlegget ikke har bilder.
 */
export function postEmailImageNote(imageCount: number): string {
  if (imageCount <= 0) return ''
  const what = imageCount === 1 ? 'Ett bilde er lagt ved' : `${imageCount} bilder er lagt ved`
  return `${what} — se dem på internsiden.`
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
