/**
 * Reglene for riggelista (#12). Rene funksjoner uten server- eller
 * DOM-avhengigheter, slik at serveren, skjemaet og testene er enige om hva en
 * gyldig rad er — og slik at ingen av dem kan dra inn `cloudflare:workers` ved
 * et uhell (samme grense som `src/lib/utstyr.ts`).
 *
 * Lista er «ta med»-sjekklista: småperc, muter, reservedeler, notestativ,
 * bannere. Alt som ikke er et sceneoppsett (#11), men som likevel må i bilen.
 */

import { permissionsInclude } from './permissions'

// ---------- Tilgang ----------

/**
 * Redigering av lista krever ÉN av to rettigheter. Begrunnelsen er at lista har
 * to naturlige eiere og ingen av dem er hele sannheten: prosjektansvarlig vet
 * hva konserten trenger (`projects.manage`), materialforvalteren vet hva
 * korpset eier (`assets.manage`). En egen `rig.manage` ville betydd at begge
 * måtte huske å be om den, og en liste ingen får redigert er en liste ingen
 * bruker.
 *
 * AVKRYSSING er noe helt annet og krever bare `requireMe()`: det er riggegruppa
 * som står på gulvet med kassa i hendene, og de har sjelden noen rettighet i
 * det hele tatt. Se `RIG_CHECK_RULE` under.
 */
export const RIG_MANAGE_PERMISSIONS = ['projects.manage', 'assets.manage'] as const

export function canManageRigList(permissions: Iterable<string>): boolean {
  const list = [...permissions]
  return RIG_MANAGE_PERMISSIONS.some((p) => permissionsInclude(list, p))
}

/**
 * Dokumentasjon som kode: avkryssing er åpen for ALLE aktive medlemmer.
 * `currentUser()` returnerer allerede `null` for et deaktivert medlem, så
 * `requireMe()` ER regelen — det finnes ikke noe strengere krav å legge på.
 */
export const RIG_CHECK_RULE = 'Alle aktive medlemmer kan krysse av. Redigering krever projects.manage eller assets.manage.'

// ---------- Hvor lista hører hjemme ----------

export type RigScope = { kind: 'project'; projectId: string } | { kind: 'event'; occurrenceKey: string }

export type RigScopeInput = { projectId?: string | null; occurrenceKey?: string | null }

/**
 * Nøyaktig ÉN eier. Både null og begge satt er en feil, ikke en tolkning:
 * en rad som hørte til begge ville dukket opp to steder og blitt krysset av
 * to ganger av to personer som trodde de var alene om den.
 */
export function parseRigScope(input: RigScopeInput): RigScope {
  const projectId = (input.projectId ?? '').trim()
  const occurrenceKey = (input.occurrenceKey ?? '').trim()
  if (projectId && occurrenceKey) throw new Error('Riggelista hører til enten et prosjekt eller en øving')
  if (projectId) return { kind: 'project', projectId }
  if (occurrenceKey) return { kind: 'event', occurrenceKey }
  throw new Error('Riggelista mangler prosjekt eller øving')
}

// ---------- Validering ----------

export const RIG_NAME_MAX = 120
export const RIG_RESPONSIBLE_MAX = 80

export type RigItemInput = {
  /** Referanse til utstyrsregisteret. Navnet hentes da fra `assets` på serveren. */
  assetId?: string | null
  name?: string | null
  responsibleUserId?: string | null
  responsibleName?: string | null
}

export type RigItemValue = {
  assetId: string | null
  name: string
  responsibleUserId: string | null
  responsibleName: string | null
}

function clean(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/**
 * Normaliserer og håndhever invariantene, og kaster med en norsk melding UI-et
 * kan vise rått (som `sanitizeAssetInput` og `parseSetlistInput`).
 *
 * `name` er ALLTID satt, også for en rad som peker på utstyrsregisteret: det er
 * snapshotet som gjør at linja overlever at gjenstanden slettes (`asset_id` er
 * SET NULL). Serveren sender inn `assets.name` som navn når en gjenstand er
 * valgt — navnet kommer aldri fra klienten i det tilfellet, på samme måte som
 * `ensureMeta` tar tittelen fra feeden og ikke fra payloaden.
 *
 * Ansvarlig er ENTEN et medlem ELLER en fritekst-gruppe. Er begge sendt inn,
 * vinner medlemmet og fritekstfeltet nullstilles — ellers ville en rad kunnet
 * vise «Ingrid» ett sted og «riggegruppa» et annet.
 */
export function parseRigItemInput(input: RigItemInput): RigItemValue {
  const name = clean(input.name, RIG_NAME_MAX)
  if (!name) throw new Error('Skriv inn hva som skal med')

  const responsibleUserId = clean(input.responsibleUserId, 64)
  const responsibleName = responsibleUserId ? null : clean(input.responsibleName, RIG_RESPONSIBLE_MAX)

  return {
    assetId: clean(input.assetId, 64),
    name,
    responsibleUserId,
    responsibleName,
  }
}

// ---------- De to avkryssingene ----------

export type RigCheckField = 'taken' | 'returned'

export type RigCheckState = {
  takenAt: number | null
  takenBy: string | null
  returnedAt: number | null
  returnedBy: string | null
}

/**
 * Én avkryssing, med invarianten «kommet tilbake ⇒ tatt med» håndhevet.
 *
 * De tre reglene, i den rekkefølgen de betyr noe:
 *
 * 1. **Krysser du av «kommet tilbake» uten at «tatt med» står, settes begge.**
 *    En ting som er kommet tilbake var per definisjon med, og å kreve to trykk
 *    fra noen som står i en varebil i regnet er måten en sjekkliste slutter å
 *    bli brukt på. Begge radene får samme person og samme tid — det er ærlig:
 *    det er alt vi faktisk vet.
 * 2. **Fjerner du «tatt med», forsvinner «kommet tilbake» også.** Ellers ville
 *    lista kunnet vise noe som er tilbake uten å ha vært borte, og
 *    `rigProgress` ville telt et utestående som ikke finnes.
 * 3. **Å krysse av på nytt endrer ikke hvem/når.** Første avkryssing er den som
 *    gjelder; en som trykker to ganger skal ikke overskrive sporet til den som
 *    faktisk bar kassa.
 */
export function applyRigCheck(
  state: RigCheckState,
  field: RigCheckField,
  checked: boolean,
  actorId: string,
  now: number,
): RigCheckState {
  if (field === 'taken') {
    if (!checked) return { takenAt: null, takenBy: null, returnedAt: null, returnedBy: null }
    if (state.takenAt !== null) return state
    return { ...state, takenAt: now, takenBy: actorId }
  }

  if (!checked) return { ...state, returnedAt: null, returnedBy: null }
  if (state.returnedAt !== null) return state
  return {
    takenAt: state.takenAt ?? now,
    takenBy: state.takenAt === null ? actorId : state.takenBy,
    returnedAt: now,
    returnedBy: actorId,
  }
}

export type RigStatus = 'pending' | 'taken' | 'returned'

export function rigStatus(state: Pick<RigCheckState, 'takenAt' | 'returnedAt'>): RigStatus {
  if (state.returnedAt !== null) return 'returned'
  if (state.takenAt !== null) return 'taken'
  return 'pending'
}

export const RIG_STATUS_LABELS: Record<RigStatus, string> = {
  pending: 'Ikke tatt med',
  taken: 'Tatt med',
  returned: 'Kommet tilbake',
}

// ---------- Opptelling ----------

export type RigProgress = {
  total: number
  taken: number
  returned: number
  /** Tatt med, men ikke kommet tilbake — det som fortsatt står et sted. */
  outstanding: number
}

/**
 * Tallene prosjekt-dashboardet og øvingssida viser. `outstanding` er det eneste
 * som er verdt en advarsel dagen etter konserten: `taken - returned` er tingene
 * som fortsatt ligger igjen i en gymsal et sted.
 */
export function rigProgress(items: Array<Pick<RigCheckState, 'takenAt' | 'returnedAt'>>): RigProgress {
  let taken = 0
  let returned = 0
  for (const item of items) {
    const status = rigStatus(item)
    if (status === 'taken' || status === 'returned') taken += 1
    if (status === 'returned') returned += 1
  }
  return { total: items.length, taken, returned, outstanding: taken - returned }
}

/** Én linje til dashboardet: «7 av 12 tatt med · 3 ikke kommet tilbake». */
export function rigProgressLine(progress: RigProgress): string {
  if (progress.total === 0) return 'Ingen ting på lista ennå'
  const parts = [`${progress.taken} av ${progress.total} tatt med`]
  if (progress.returned > 0) parts.push(`${progress.returned} kommet tilbake`)
  if (progress.outstanding > 0) parts.push(`${progress.outstanding} ikke tilbake`)
  return parts.join(' · ')
}

// ---------- Gruppering og sortering ----------

export type RigItemSummary = RigCheckState & {
  id: string
  name: string
  assetId: string | null
  responsibleUserId: string | null
  responsibleName: string | null
}

/** Nøkkelen en rad grupperes på: medlemmets id, gruppenavnet, eller ingenting. */
export function rigResponsibleKey(item: Pick<RigItemSummary, 'responsibleUserId' | 'responsibleName'>): string {
  if (item.responsibleUserId) return `u:${item.responsibleUserId}`
  if (item.responsibleName) return `n:${item.responsibleName.toLowerCase()}`
  return ''
}

export type RigGroup<T> = { key: string; label: string; items: T[] }

/**
 * Oppslaget `groupRigByResponsible` trenger, bygget av radene selv.
 *
 * Serveren sender med `responsibleMemberName` — medlemmets navn slik det er I
 * DAG, lest av en join mot `user` (som omtaler i #83). Klienten har dermed alt
 * den trenger uten en egen medlemsliste, og et navnebytte slår gjennom overalt
 * uten at riggelista må skrives om.
 */
export function rigNameLookup(
  items: Array<{ responsibleUserId: string | null; responsibleMemberName: string | null }>,
): (userId: string) => string | null {
  const byId = new Map<string, string>()
  for (const item of items) {
    if (item.responsibleUserId && item.responsibleMemberName) byId.set(item.responsibleUserId, item.responsibleMemberName)
  }
  return (userId: string) => byId.get(userId) ?? null
}

export const RIG_NO_RESPONSIBLE_LABEL = 'Uten ansvarlig'

/**
 * Lista gruppert på ansvarlig — det saken ber om («ansvarlig person/gruppe pr.
 * item eller item-group»). Gruppen er avledet, ikke lagret: én kolonne som
 * peker på et medlem eller et navn gir nøyaktig den samme inndelingen som en
 * egen gruppetabell ville gitt, uten at noen må vedlikeholde gruppene.
 *
 * Rekkefølgen er alfabetisk på gruppenavn (norsk kollasjon), og «Uten
 * ansvarlig» ALLTID sist: det er restbunken, ikke en gruppe.
 *
 * `nameFor` slår opp dagens navn på et medlem (som omtaler i #83) — lista skal
 * ikke vise et gammelt navn fordi raden ble laget i fjor.
 */
export function groupRigByResponsible<T extends Pick<RigItemSummary, 'name' | 'responsibleUserId' | 'responsibleName'>>(
  items: T[],
  nameFor: (userId: string) => string | null,
): Array<RigGroup<T>> {
  const groups = new Map<string, RigGroup<T>>()
  for (const item of items) {
    const key = rigResponsibleKey(item)
    const label = item.responsibleUserId
      ? (nameFor(item.responsibleUserId) ?? 'Tidligere medlem')
      : (item.responsibleName ?? RIG_NO_RESPONSIBLE_LABEL)
    const group = groups.get(key) ?? { key, label, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => a.name.localeCompare(b.name, 'nb'))
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === '') return 1
    if (b.key === '') return -1
    return a.label.localeCompare(b.label, 'nb')
  })
}
