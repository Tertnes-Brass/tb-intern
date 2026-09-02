import { z } from 'zod'

/**
 * Den utvidede medlemsprofilen (#25) og kontaktinformasjonen (#14).
 *
 * Ren logikk: katalogen over interesser/kompetanse, valideringen av de nye
 * feltene, innsynsregelen for kontaktinfo og filtreringen medlemslista bruker.
 * Ingen databasekall og ingen `cloudflare:workers` — modulen importeres av både
 * serverfunksjonene og rutene, og skal kunne testes uten Workers-runtime.
 *
 * Hovedstemmen ligger IKKE her. Den kommer fra stemmetildelingen (`user_parts`)
 * og er sannheten om både seksjon og filtilgang; profilen viser den, den lager
 * ingen parallell kopi av den.
 */

// ---------- Interesser og kompetanse ----------

/**
 * Fast katalog, ikke fritekst-tagger. Poenget i #25 er å kunne svare på «hvem
 * kan hjelpe med rigg?» — det krever at alle har krysset av det SAMME ordet.
 * Fritekstfeltet ved siden av fanger opp nyansen («har hengerfeste»).
 *
 * Nøklene er engelske (kodeidentifikatorer), etikettene norske (UI).
 */
export const INTEREST_CATALOG = [
  { key: 'dugnad', label: 'Dugnad', hint: 'Loppemarked, kafé, salg og annet felles arbeid' },
  { key: 'rigg', label: 'Rigg', hint: 'Bære, stille opp og rydde ned på konsert og øvelse' },
  { key: 'transport', label: 'Transport', hint: 'Kjøre utstyr eller folk — henger, varebil, tilhengerfeste' },
  { key: 'board', label: 'Styrearbeid', hint: 'Verv i styret eller en komité' },
  { key: 'social', label: 'Sosialt', hint: 'Turer, fester og det som holder korpset sammen' },
  { key: 'archive', label: 'Arkivarbeid', hint: 'Noter, skanning, katalogisering og utlån' },
] as const

export type InterestKey = (typeof INTEREST_CATALOG)[number]['key']

export const INTEREST_KEYS = INTEREST_CATALOG.map((i) => i.key) as InterestKey[]

const INTEREST_LABELS = new Map<string, string>(INTEREST_CATALOG.map((i) => [i.key, i.label]))

/** Etiketten for en nøkkel. Ukjent nøkkel gir nøkkelen selv — aldri tom tekst. */
export function interestLabel(key: string): string {
  return INTEREST_LABELS.get(key) ?? key
}

export const interestsSchema = z.array(z.enum(INTEREST_KEYS)).max(INTEREST_KEYS.length)

/**
 * Rekkefølgen følger KATALOGEN, ikke avkryssingsrekkefølgen: to medlemmer med
 * samme kompetanse skal vise den likt i lista. Duplikater og ukjente nøkler
 * faller ut — en rå payload skal aldri kunne finne på egne tagger.
 */
export function normalizeInterests(values: readonly string[]): InterestKey[] {
  const chosen = new Set(values)
  return INTEREST_KEYS.filter((key) => chosen.has(key))
}

/** Leser JSON-kolonnen. Ugyldig eller ødelagt innhold blir en tom liste, aldri et kast. */
export function parseInterests(raw: string | null | undefined): InterestKey[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return normalizeInterests(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return []
  }
}

export function serializeInterests(values: readonly string[]): string {
  return JSON.stringify(normalizeInterests(values))
}

/**
 * Filteret i medlemslista: valgte tagger SNEVRER INN (AND). Velger du «rigg» og
 * «transport», er du ute etter noen som kan begge deler — ikke en lengre liste.
 * Ingen valgte tagger = ingen filtrering.
 */
export function matchesInterests(memberInterests: readonly string[], selected: readonly string[]): boolean {
  if (selected.length === 0) return true
  const has = new Set(memberInterests)
  return selected.every((key) => has.has(key))
}

/** Teller opp hvor mange medlemmer som har hver tagg — brukes til «Rigg 7» i filteret. */
export function countInterests(
  members: ReadonlyArray<{ interests: readonly string[] }>,
): Record<InterestKey, number> {
  const counts = Object.fromEntries(INTEREST_KEYS.map((key) => [key, 0])) as Record<InterestKey, number>
  for (const member of members) {
    for (const key of new Set(member.interests)) {
      if (key in counts) counts[key as InterestKey] += 1
    }
  }
  return counts
}

// ---------- Fritekstfelt ----------

export const MAX_NOTE_LENGTH = 500
export const MAX_INSTRUMENT_NOTE_LENGTH = 200

export const interestsNoteSchema = z
  .string()
  .trim()
  .max(MAX_NOTE_LENGTH, `Teksten kan ikke være lengre enn ${MAX_NOTE_LENGTH} tegn`)

export const otherInstrumentsSchema = z
  .string()
  .trim()
  .max(MAX_INSTRUMENT_NOTE_LENGTH, `Teksten kan ikke være lengre enn ${MAX_INSTRUMENT_NOTE_LENGTH} tegn`)

/** Tom tekst lagres som NULL, ikke som ''. «Ikke utfylt» skal ha én representasjon. */
export function normalizeNote(value: string): string | null {
  return value.trim() || null
}

// ---------- Bistemmer ----------

/** Fire er nok til «kan også trå til på …» uten at profilen blir en ønskeliste. */
export const MAX_SECONDARY_PARTS = 4

export const secondaryPartsSchema = z.array(z.string()).max(MAX_SECONDARY_PARTS)

/**
 * Bistemmer er KOMPETANSE, ikke tilgang: raden ligger i `member_instruments` og
 * rører aldri `user_parts`, som er det eneste som gir stemmefiler. Derfor kan
 * medlemmet sette dem selv.
 *
 * Den tildelte hovedstemmen (og andre tildelte stemmer) filtreres bort — å føre
 * opp sin egen stemme som bistemme er støy, og ville sett ut som to sannheter om
 * det samme.
 */
export function cleanSecondaryParts(
  requested: readonly string[],
  assignedPartIds: readonly string[],
): string[] {
  const assigned = new Set(assignedPartIds)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of requested) {
    if (!id || assigned.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length === MAX_SECONDARY_PARTS) break
  }
  return out
}

// ---------- Innsyn i kontaktinformasjon (#14) ----------

export type ContactViewer = {
  /** `members.manage` — medlemsansvarlig ser og redigerer alle. */
  canManageMembers: boolean
  /** Ens egen id: du ser alltid din egen kontaktinfo, også om profilen er deaktivert. */
  viewerId: string
}

export type ContactSubject = {
  id: string
  isActive: boolean
}

/**
 * Medlemslista er intern, og hele poenget i #14 er å få tak i folk ved fravær.
 * Kontaktinfo er derfor synlig for alle innloggede medlemmer — `currentUser()`
 * returnerer allerede `null` for deaktiverte, så «innlogget» betyr «aktiv».
 *
 * Unntaket går andre veien: et DEAKTIVERT medlem er ikke lenger en kollega man
 * skal kunne ringe, og nummeret til en som har sluttet vises bare for
 * medlemsansvarlig (som fortsatt må kunne rydde) og for medlemmet selv.
 */
export function canSeeContactInfo(viewer: ContactViewer, member: ContactSubject): boolean {
  if (member.isActive) return true
  return viewer.canManageMembers || viewer.viewerId === member.id
}

/**
 * Nuller ut kontaktfeltene den som ser ikke har lov til å se. Kalles SERVER-side
 * i `listMembers`, slik at feltene aldri følger med i payloaden — skjermen skal
 * ikke måtte huske regelen (samme prinsipp som slagverksfeltene i #10).
 */
export function redactContact<T extends ContactSubject & { email: string; phone: string | null }>(
  viewer: ContactViewer,
  member: T,
): T {
  if (canSeeContactInfo(viewer, member)) return member
  return { ...member, email: '', phone: null }
}

// ---------- Søk i medlemslista ----------

/**
 * Fritekstsøket treffer navn, e-post, telefon, stemmenavn og bistemmer. Søk på
 * telefon er med fordi det motsatte spørsmålet også finnes: «hvem er det som
 * ringer fra dette nummeret?»
 */
export function matchesMemberQuery(
  member: {
    name: string
    email: string
    phone: string | null
    parts: ReadonlyArray<{ name: string }>
    secondaryParts: ReadonlyArray<{ name: string }>
    otherInstruments: string | null
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    member.name,
    member.email,
    member.phone ?? '',
    member.otherInstruments ?? '',
    ...member.parts.map((p) => p.name),
    ...member.secondaryParts.map((p) => p.name),
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

/** Har profilen noe utover navn, rolle og stemme å vise? Styrer tomtilstanden. */
export function hasProfileDetails(member: {
  phone: string | null
  interests: readonly string[]
  interestsNote: string | null
  otherInstruments: string | null
  secondaryParts: ReadonlyArray<unknown>
}): boolean {
  return Boolean(
    member.phone ||
      member.interests.length > 0 ||
      member.interestsNote ||
      member.otherInstruments ||
      member.secondaryParts.length > 0,
  )
}
