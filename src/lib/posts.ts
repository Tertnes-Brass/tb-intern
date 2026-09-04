/**
 * Ren hjelpelogikk for Beskjeder (#28) — veggen: utdrag, avsnitt/auto-lenking,
 * hvem som får skrive hva, og mottakerutvalget for e-postvarsling. Ingen
 * server- eller DOM-avhengigheter, slik at reglene kan testes uten database,
 * R2 og e-postbinding.
 *
 * Teksten i et innlegg er ren tekst med avsnitt (`plain_text`) — URL-er
 * gjenkjennes og gjøres klikkbare ved rendring, alt annet vises som skrevet.
 * Forfatteren kan i stedet velge `markdown` (#79); da rendres teksten av
 * `src/lib/markdown.ts`, som er en egen modul nettopp for at feeden og kortene
 * ikke skal dra inn markdown-parseren for å telle kommentarer.
 */

export type PostAudience = 'all' | 'board'
export type PostImportance = 'normal' | 'important'
/**
 * Hvordan teksten skal tolkes ved rendring (#79). `plain_text` er standarden og
 * det eneste eksisterende innlegg har — de skal se ut nøyaktig som før.
 */
export type PostFormat = 'plain_text' | 'markdown'
/** Valget medlemmet gjør på /min-profil. Ingen rad i databasen = `all`. */
export type PostNotificationChoice = 'all' | 'important' | 'off'

export const POST_FORMATS: PostFormat[] = ['plain_text', 'markdown']
/**
 * Standarden for et nytt innlegg, og det formatet alle eksisterende innlegg
 * har. Én konstant, slik at skjemaet, sanitizeren og databasens `DEFAULT` ikke
 * kan komme i utakt.
 */
export const DEFAULT_POST_FORMAT: PostFormat = 'plain_text'

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

// ---------- Målretting (#28) ----------

/**
 * Hva en beskjed kan snevres inn mot, i tillegg til `audience`.
 *
 * `section` er en stemmegruppe — verdien i `parts.section` (se `SECTION_ORDER` i
 * `src/lib/taxonomy.ts`), ikke en enkeltstemme: «slagverk», ikke «Slagverk 2».
 * Det er den gruppen folk snakker om når de sier stemmegruppe, og den overlever
 * at noen bytter fra Slagverk 1 til Slagverk 3.
 *
 * `project` er ETT prosjekt; medlemmene i det er de som er satt opp på det (se
 * `projectMemberIds` i `src/server/post-audience.ts`).
 */
export type PostTargetKind = 'section' | 'project'
export const POST_TARGET_KINDS: PostTargetKind[] = ['section', 'project']

export type PostTarget = { kind: PostTargetKind; refId: string }

/**
 * Tak på antall målrettinger per beskjed. Nok til «alle kornetter, horn og
 * flygelhorn», lite nok til at raden ikke blir en spørring.
 */
export const MAX_POST_TARGETS = 12

/**
 * Det serveren vet om et MEDLEM når synlighet skal avgjøres: rettigheten som
 * åpner styre-beskjeder, stemmegruppene medlemmet spiller i, og prosjektene
 * medlemmet er satt opp på.
 *
 * Typen finnes for at regelen skal kunne stilles ÉN gang og brukes tre steder
 * (lesing, e-postmottakere, omtaler). `boolean` godtas fortsatt der bare
 * `posts.publish` er kjent — da er leseren uten stemmer og uten prosjekter, og
 * en målrettet beskjed er dermed ikke for hen. Fail-closed med vilje.
 */
export type PostReader = {
  /** Har `posts.publish` (styret, dirigent, admin) — avgjør `audience: 'board'`. */
  canPublish: boolean
  /** Stemmegruppene medlemmet har en tildelt stemme i (`parts.section`). */
  sectionIds: readonly string[]
  /** Prosjektene medlemmet er satt opp på. */
  projectIds: readonly string[]
}

/** Normaliserer den gamle `canPublish`-boolean-en til en leser uten målgruppedata. */
export function readerOf(reader: boolean | PostReader): PostReader {
  return typeof reader === 'boolean' ? { canPublish: reader, sectionIds: [], projectIds: [] } : reader
}

/** Alt som trengs for å avgjøre hvem en beskjed er for. `targets` mangler = ingen innsnevring. */
export type PostTargetingInput = { audience: PostAudience; targets?: readonly PostTarget[] }

/**
 * Treffer målrettingen dette medlemmet?
 *
 * INGEN målretting betyr ALLE — en beskjed uten rader i `post_targets` oppfører
 * seg nøyaktig som før målretting fantes, og det er hele grunnen til at
 * `audience` fortsatt er en egen kolonne. Flere målrettinger er et ELLER: en
 * beskjed til «slagverk + Julekonserten» treffer den som er i én av dem.
 */
export function matchesTargets(targets: readonly PostTarget[] | undefined, reader: PostReader): boolean {
  if (!targets || targets.length === 0) return true
  return targets.some((t) =>
    t.kind === 'section' ? reader.sectionIds.includes(t.refId) : reader.projectIds.includes(t.refId),
  )
}

/**
 * Er dette medlemmet i målgruppen for beskjeden? Ett regelsted for lesing,
 * e-postmottakere og «Sett av N av M», slik at de tre aldri kan komme i utakt.
 *
 * Merk at dette IKKE er det samme som «kan lese»: en med `posts.publish` kan
 * lese alt (moderasjon), men er ikke mottaker av en beskjed til slagverksgruppa
 * med mindre hen selv spiller slagverk.
 */
export function inPostAudience(post: PostTargetingInput, member: PostReader): boolean {
  if (post.audience === 'board' && !member.canPublish) return false
  return matchesTargets(post.targets, member)
}

/**
 * Fjerner målretting den som skriver ikke har lov til å sette, og rydder lista:
 * ukjente typer ut, tomme id-er ut, duplikater ut, og et hardt tak.
 *
 * Hvem som kan målrette er samme rettighet som styre-målgruppen: `posts.publish`.
 * Uten den blir lista tom — akkurat som `audience` tvinges til `all`.
 */
export function sanitizePostTargets(targets: readonly PostTarget[] | undefined, canPublish: boolean): PostTarget[] {
  if (!canPublish || !targets) return []
  const seen = new Set<string>()
  const out: PostTarget[] = []
  for (const t of targets) {
    if (!POST_TARGET_KINDS.includes(t.kind)) continue
    const refId = t.refId.trim()
    if (!refId) continue
    const key = `${t.kind}:${refId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind: t.kind, refId })
    if (out.length >= MAX_POST_TARGETS) break
  }
  return out
}

/**
 * Én linje om hvem beskjeden er snevret inn til, til merkelappen i feeden og på
 * detaljsiden. `labels` er oppslaget fra id til norsk navn (stemmegruppe eller
 * prosjektnavn); en id uten navn vises som «ukjent gruppe» heller enn som en
 * rå id — en slettet prosjektrad skal ikke lekke en base64-nøkkel til skjermen.
 */
export function targetLabel(targets: readonly PostTarget[], labels: ReadonlyMap<string, string>): string {
  if (targets.length === 0) return ''
  const names = targets.map((t) => labels.get(`${t.kind}:${t.refId}`) ?? 'ukjent gruppe')
  if (names.length === 1) return names[0]!
  return `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`
}

// ---------- Mottakerutvalg ----------

/** Et potensielt mottakende medlem, slik `publishPost` henter det fra databasen. */
export type PostRecipient = PostReader & {
  userId: string
  email: string | null
  isActive: boolean
}

/**
 * Hvem skal ha e-post om denne beskjeden?
 *
 * Fire krav, alle må være oppfylt: medlemmet er aktivt, har en e-postadresse,
 * preferansen tillater det (ingen preferanse = alle beskjeder), og målgruppen
 * omfatter dem. `audience: 'board'` går kun til dem som selv kan publisere, og
 * en målrettet beskjed går kun til dem målrettingen treffer — en beskjed til
 * slagverksgruppa skal ikke e-postes til hele korpset.
 * Idempotens (allerede varslet) håndteres av `notification_log`, ikke her.
 */
export function recipientsFor(
  post: PostTargetingInput & { importance: PostImportance },
  members: PostRecipient[],
  prefs: Map<string, PostNotificationChoice> | Record<string, PostNotificationChoice>,
): PostRecipient[] {
  const lookup = (userId: string): PostNotificationChoice =>
    (prefs instanceof Map ? prefs.get(userId) : prefs[userId]) ?? 'all'

  return members.filter((m) => {
    if (!m.isActive) return false
    if (!m.email || !m.email.trim()) return false
    if (!inPostAudience(post, m)) return false
    const choice = lookup(m.userId)
    if (choice === 'off') return false
    if (choice === 'important' && post.importance !== 'important') return false
    return true
  })
}

/**
 * Kan denne beskjeden vises for denne leseren?
 *
 * `posts.publish` ser alt (moderasjon og leveringsstatus krever det). Alle andre
 * må ha en PUBLISERT beskjed som er i målgruppen deres — `audience` først, så
 * målrettingen som en innsnevring oppå. En beskjed uten målretting oppfører seg
 * nøyaktig som før.
 *
 * At forfatteren alltid ser sitt eget innlegg håndteres i `visibleTo` på
 * serveren: det er en regel om eierskap, ikke om målgruppe.
 */
export function canReadPost(
  post: PostTargetingInput & { publishedAt: number | null },
  reader: boolean | PostReader,
): boolean {
  const r = readerOf(reader)
  if (r.canPublish) return true
  return post.publishedAt !== null && inPostAudience(post, r)
}

// ---------- Lest/sett (#28) ----------

/**
 * Hvem TELLER som mottaker av beskjeden — nevneren i «Sett av N av M».
 *
 * Ikke det samme som «kan lese»: en moderator uten stemme i slagverksgruppa kan
 * lese en beskjed til slagverk, men er ikke en av dem den skulle nå. Forfatteren
 * telles heller ikke; hen har åpenbart sett sitt eget innlegg, og en teller som
 * starter på «1 av 35» ville vært misvisende.
 */
export function postAudienceMembers<T extends PostReader & { userId: string; isActive: boolean }>(
  post: PostTargetingInput & { authorId?: string | null },
  members: readonly T[],
): T[] {
  return members.filter((m) => m.isActive && m.userId !== post.authorId && inPostAudience(post, m))
}

/**
 * Hvem får se sett-status? Forfatteren og `posts.publish`-holdere — det er de
 * samme som ser leveringsstatus for e-posten. For alle andre er tallet ikke bare
 * uinteressant, det er en sosial opplysning om andre medlemmer.
 */
export function canSeeSeenStatus(
  me: { id: string } | null,
  post: { authorId: string | null },
  canPublish: boolean,
): boolean {
  if (!me) return false
  return canPublish || (post.authorId !== null && post.authorId === me.id)
}

/**
 * NAVNELISTA er strengere enn tallet: kun for VIKTIGE beskjeder (issue-kravet er
 * at admin/stab skal kunne se hvem som har sett en viktig kunngjøring — hvem som
 * leste en trivelig hilsen er ingens sak).
 */
export function canSeeSeenNames(
  me: { id: string } | null,
  post: { authorId: string | null; importance: PostImportance },
  canPublish: boolean,
): boolean {
  return post.importance === 'important' && canSeeSeenStatus(me, post, canPublish)
}

/** «Sett av 12 av 34», «Ingen har åpnet den ennå», «Sett av alle 34». */
export function seenLabel(seen: number, total: number): string {
  if (total <= 0) return 'Ingen mottakere'
  if (seen <= 0) return `Ingen av ${total} har åpnet den ennå`
  if (seen >= total) return total === 1 ? 'Sett av mottakeren' : `Sett av alle ${total}`
  return `Sett av ${seen} av ${total}`
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
  /** Rein tekst eller markdown. Ikke privilegert — alle kan velge fritt. */
  format: PostFormat
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
  // Formatet er ikke et privilegium: et medlem som skriver en lang beskjed skal
  // kunne strukturere den, akkurat som styret.
  const format: PostFormat = input.format === 'markdown' ? 'markdown' : DEFAULT_POST_FORMAT
  if (canPublish) return { ...input, title, body, format }
  return { title, body, format, audience: 'all', importance: 'normal', official: false }
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

/**
 * Er «Send e-post» huket av når publiseringsflaten åpnes? Nei (#85).
 *
 * Å publisere og å sende masse-e-post er to forskjellige handlinger, og bare
 * den ene kan angres. Med avkryssingen på som standard var det nok å overse
 * den for å sende e-post til hele korpset. Valget kan fortsatt slås på
 * eksplisitt, og gjør da nøyaktig det samme som før.
 *
 * Konstanten deles av PostForm, publiseringsdialogen og testen, slik at en
 * senere UI-endring ikke kan slå standarden på igjen uten at testen faller.
 */
export const DEFAULT_NOTIFY = false

/**
 * Etiketten ved avkryssingen. «nå» og målgruppen står i selve etiketten, ikke
 * bare i hjelpeteksten under: det skal gå fram av det man huker av at det
 * sendes e-post, og til hvem.
 *
 * Er beskjeden målrettet, er DET mottakerlista — «hele korpset» ville vært en
 * ren løgn på en beskjed til slagverksgruppa.
 */
export function notifyLabel(audience: PostAudience, targets = ''): string {
  if (targets) return `Send e-post til ${targets} nå`
  return audience === 'board' ? 'Send e-post til styret nå' : 'Send e-post til hele korpset nå'
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
