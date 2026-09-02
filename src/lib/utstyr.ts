/**
 * Reglene for utstyrsregisteret (#13). Rene funksjoner uten server- eller
 * DOM-avhengigheter, slik at serveren, skjemaet og testene er enige om hva en
 * gyldig gjenstand er — og slik at ingen av dem kan importere `cloudflare:workers`
 * ved et uhell.
 *
 * Saken ba uttrykkelig om å slippe klistremerker og QR-koder: merking kan
 * påvirke klangen på et slagverksinstrument. Identiteten er derfor bildet pluss
 * opplysningene, og alle feltene utenom navnet er valgfrie — et trommestativ har
 * verken produsent, modell eller serienummer, og registeret skal tåle at det
 * meste er tomt uten å se ødelagt ut.
 */

/** Rettigheten som gater ALL skriving i registeret. Lesing krever bare innlogging. */
export const ASSETS_PERMISSION = 'assets.manage'

// ---------- Kategorier ----------

/**
 * Forslagslista i skjemaet. Kategori er FRITEKST i databasen med vilje: en ny
 * kategori skal ikke kreve en migrasjon, og en SQLite-enum kan ikke utvides uten
 * tabell-rebuild (se AGENTS.md om D1). Lista er altså en hjelp til å skrive det
 * samme ordet to ganger, ikke en begrensning.
 */
export const ASSET_CATEGORIES = [
  'Slagverk',
  'Messinginstrument',
  'Transport',
  'Notestativ',
  'Lyd og lys',
  'Uniform',
  'Annet',
] as const

// ---------- Eierskap ----------

export const OWNER_KINDS = ['band', 'trommelaget', 'member', 'external'] as const
export type OwnerKind = (typeof OWNER_KINDS)[number]

export function isOwnerKind(value: string): value is OwnerKind {
  return (OWNER_KINDS as readonly string[]).includes(value)
}

/** Etikettene i skjemaet, i den rekkefølgen valgene skal stå. */
export const OWNER_KIND_LABELS: Record<OwnerKind, string> = {
  band: 'Tertnes Brass',
  trommelaget: 'Trommelaget',
  member: 'Privat — medlem',
  external: 'Privat — utenfor korpset',
}

/**
 * Eieren slik den skal vises. `memberName` slås opp mot `user`-tabellen ved
 * lesing, så navnet alltid er dagens — som med omtaler i src/lib/mentions.ts.
 *
 * Et medlem som er slettet gir `owner_user_id = NULL` (SET NULL i skjemaet).
 * Da faller vi tilbake på `ownerName` hvis den finnes, ellers en ærlig
 * «Privat eier (ukjent)» — aldri korpsets navn, som ville vært feil eierskap.
 */
export function ownerLabel(asset: {
  ownerKind: OwnerKind
  ownerName?: string | null
  memberName?: string | null
}): string {
  switch (asset.ownerKind) {
    case 'band':
      return OWNER_KIND_LABELS.band
    case 'trommelaget':
      return OWNER_KIND_LABELS.trommelaget
    case 'member':
      return asset.memberName ?? asset.ownerName ?? 'Privat eier (ukjent)'
    case 'external':
      return asset.ownerName ?? 'Privat eier'
  }
}

// ---------- Lån inn ----------

export type LoanFields = {
  loanedFrom: string | null
  loanFrom: string | null
  loanUntil: string | null
}

export type LoanStatus =
  | { onLoan: false }
  | { onLoan: true; from: string; period: string | null; expired: boolean }

/**
 * «Er den lånt, og av hvem?» Sannheten er ett felt — `loanedFrom`. Et eget
 * boolsk «er lånt» ville før eller siden gitt to svar på samme spørsmål, akkurat
 * som to oppmøtetabeller ville gjort (se AGENTS.md om `event_attendance`).
 *
 * `today` sendes inn i stedet for å leses fra klokka, slik at «utløpt» kan
 * testes uten å fryse tiden.
 */
export function loanStatus(asset: LoanFields, today: string): LoanStatus {
  const from = asset.loanedFrom?.trim()
  if (!from) return { onLoan: false }
  const start = asset.loanFrom?.trim() || null
  const end = asset.loanUntil?.trim() || null
  const period = start && end ? `${start} – ${end}` : start ? `fra ${start}` : end ? `til ${end}` : null
  return { onLoan: true, from, period, expired: end !== null && end < today }
}

// ---------- Kobling til prosjekt ----------

export const ASSET_USAGES = ['planned', 'used'] as const
export type AssetUsage = (typeof ASSET_USAGES)[number]

export function isAssetUsage(value: string): value is AssetUsage {
  return (ASSET_USAGES as readonly string[]).includes(value)
}

export const USAGE_LABELS: Record<AssetUsage, string> = {
  planned: 'Skal brukes til',
  used: 'Brukt på',
}

export type AssetProjectLink = {
  projectId: string
  projectName: string
  eventDate: string | null
  usage: AssetUsage
  note: string | null
}

/**
 * «Sist brukt på»: koblingen med `usage = 'used'` og seneste prosjektdato.
 * Datoen leses av prosjektet, ikke av en egen kolonne på koblingen — da kan de
 * to aldri komme i utakt når konserten flyttes. Prosjekter uten dato er ikke
 * kandidater: de kan ikke rangeres, og «sist» ville vært en gjetning.
 */
export function lastUsedLink(links: AssetProjectLink[]): AssetProjectLink | null {
  const used = links.filter((l) => l.usage === 'used' && l.eventDate)
  if (used.length === 0) return null
  return used.reduce((best, l) => (l.eventDate! > best.eventDate! ? l : best))
}

/** «Skal brukes til», tidligste dato først. Udaterte prosjekter havner sist. */
export function plannedLinks(links: AssetProjectLink[]): AssetProjectLink[] {
  return links
    .filter((l) => l.usage === 'planned')
    .sort((a, b) => (a.eventDate ?? '9999').localeCompare(b.eventDate ?? '9999'))
}

// ---------- Søk og filtrering ----------

export type AssetSummary = {
  id: string
  name: string
  category: string | null
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  ownerKind: OwnerKind
  ownerName: string | null
  memberName: string | null
  loanedFrom: string | null
}

export type AssetFilter = {
  q?: string
  category?: string | null
  ownerKind?: OwnerKind | null
  /** Kun gjenstander som er lånt inn. */
  onLoan?: boolean
}

/**
 * Fritekstsøket treffer alt som står PÅ gjenstanden — også serienummer og
 * eiernavn. Materialforvalteren har som regel gjenstanden i hånda og leser et
 * nummer fra den, ikke et navn hen husker.
 */
export function matchesAssetQuery(asset: AssetSummary, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    asset.name,
    asset.category,
    asset.manufacturer,
    asset.model,
    asset.serialNumber,
    asset.ownerName,
    asset.memberName,
    asset.loanedFrom,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return needle.split(/\s+/).every((word) => haystack.includes(word))
}

/** Filtrene kombineres med OG. Tomt filter gir hele lista, i samme rekkefølge. */
export function filterAssets<T extends AssetSummary>(assets: T[], filter: AssetFilter): T[] {
  return assets.filter((asset) => {
    if (filter.q && !matchesAssetQuery(asset, filter.q)) return false
    if (filter.category && (asset.category ?? '') !== filter.category) return false
    if (filter.ownerKind && asset.ownerKind !== filter.ownerKind) return false
    if (filter.onLoan && !asset.loanedFrom) return false
    return true
  })
}

/**
 * Sorteringen i oversikten: kategori først (tomme sist, så registeret ikke
 * åpner med «uten kategori»), deretter navn. Norsk kollasjon, så Å kommer etter
 * Z og ikke midt i alfabetet.
 */
export function compareAssets(a: AssetSummary, b: AssetSummary): number {
  const ca = a.category?.trim() || '￿'
  const cb = b.category?.trim() || '￿'
  if (ca !== cb) return ca.localeCompare(cb, 'nb')
  return a.name.localeCompare(b.name, 'nb')
}

// ---------- Validering ----------

export const ASSET_NAME_MAX = 120
export const ASSET_SHORT_MAX = 80
export const ASSET_CATEGORY_MAX = 60
export const ASSET_OWNER_MAX = 120
export const ASSET_NOTES_MAX = 4000
export const ASSET_LINK_NOTE_MAX = 200

export type AssetInput = {
  name?: string | null
  category?: string | null
  manufacturer?: string | null
  model?: string | null
  serialNumber?: string | null
  ownerKind?: string | null
  ownerUserId?: string | null
  ownerName?: string | null
  loanedFrom?: string | null
  loanFrom?: string | null
  loanUntil?: string | null
  notes?: string | null
}

export type AssetValue = {
  name: string
  category: string | null
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  ownerKind: OwnerKind
  ownerUserId: string | null
  ownerName: string | null
  loanedFrom: string | null
  loanFrom: string | null
  loanUntil: string | null
  notes: string | null
}

/** Trimmer, kollapser mellomrom og kutter. Tom streng blir `null`. */
function clean(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/** Flerlinjet fritekst: linjeskift bevares, men ikke ubrukte tomme linjer. */
function cleanText(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function cleanDate(value: string | null | undefined, label: string): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) throw new Error(`${label} må være en dato`)
  return trimmed
}

/**
 * Normaliserer og håndhever invariantene. Kaster med en norsk melding UI-et kan
 * vise rått — samme mønster som `parseSetlistInput` i src/lib/setlist.ts.
 *
 * Funksjonen kalles på BÅDE opprettelse og redigering (som `sanitizePostInput`
 * i src/lib/posts.ts), slik at et rått kall ikke kan legge igjen en rad der
 * eierfeltene motsier hverandre — for eksempel et `owner_user_id` som blir
 * stående etter at eierskapet er endret til «Tertnes Brass».
 */
export function sanitizeAssetInput(input: AssetInput): AssetValue {
  const name = clean(input.name, ASSET_NAME_MAX)
  if (!name) throw new Error('Gjenstanden må ha et navn')

  const rawKind = (input.ownerKind ?? 'band').trim()
  if (!isOwnerKind(rawKind)) throw new Error('Ugyldig eier')
  const ownerKind: OwnerKind = rawKind

  // Eierfeltene nullstilles etter valget, ikke etter hva skjemaet sendte med.
  let ownerUserId: string | null = null
  let ownerName: string | null = null
  if (ownerKind === 'member') {
    ownerUserId = clean(input.ownerUserId, 64)
    if (!ownerUserId) throw new Error('Velg hvilket medlem som eier gjenstanden')
  } else if (ownerKind === 'external') {
    ownerName = clean(input.ownerName, ASSET_OWNER_MAX)
    if (!ownerName) throw new Error('Skriv inn navnet på eieren')
  }

  const loanedFrom = clean(input.loanedFrom, ASSET_OWNER_MAX)
  const loanFrom = cleanDate(input.loanFrom, 'Lånt fra-dato')
  const loanUntil = cleanDate(input.loanUntil, 'Lånt til-dato')
  // En låneperiode uten utlåner er en dato uten mening — og den ville gjort
  // `loanStatus` til en løgn, siden den leser `loanedFrom` som sannheten.
  if (!loanedFrom && (loanFrom || loanUntil)) {
    throw new Error('Skriv inn hvem gjenstanden er lånt av')
  }
  if (loanFrom && loanUntil && loanUntil < loanFrom) {
    throw new Error('Lånet kan ikke slutte før det begynner')
  }

  return {
    name,
    category: clean(input.category, ASSET_CATEGORY_MAX),
    manufacturer: clean(input.manufacturer, ASSET_SHORT_MAX),
    model: clean(input.model, ASSET_SHORT_MAX),
    serialNumber: clean(input.serialNumber, ASSET_SHORT_MAX),
    ownerKind,
    ownerUserId,
    ownerName,
    loanedFrom,
    loanFrom: loanedFrom ? loanFrom : null,
    loanUntil: loanedFrom ? loanUntil : null,
    notes: cleanText(input.notes, ASSET_NOTES_MAX),
  }
}

// ---------- Bilder ----------

/**
 * Bildereglene er BEVISST egne, ikke gjenbrukt fra src/lib/posts.ts. Områdene
 * skal kunne endre grensene sine uavhengig (et utstyrsbilde er ett bilde av én
 * gjenstand, ikke et fotoalbum fra en konsert), og samme linje er trukket for
 * `leader_channels` mot `board_channels` — se AGENTS.md.
 */
export const MAX_ASSET_IMAGES = 6
export const MAX_ASSET_IMAGE_BYTES = 10 * 1024 * 1024
export const ALLOWED_ASSET_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
] as const

/** `null` = greit. Ellers en begrunnelse klienten kan vise. */
export function assetImageRejectionReason(file: { type: string; size: number }): string | null {
  const type = file.type.toLowerCase()
  if (!(ALLOWED_ASSET_IMAGE_TYPES as readonly string[]).includes(type)) {
    return 'Bare bilder (JPG, PNG, WebP, GIF eller HEIC)'
  }
  if (file.size > MAX_ASSET_IMAGE_BYTES) return 'Bildet er større enn 10 MB'
  if (file.size <= 0) return 'Tom fil'
  return null
}

/** Filendelsen R2-nøkkelen skal ha. Nøkkelen bygges ALDRI av filnavnet. */
export function assetImageExtension(contentType: string): string {
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
