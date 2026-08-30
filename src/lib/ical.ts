/**
 * Fokusert iCalendar-parser (RFC 5545-delmengde) for kalenderfeeder fra Google
 * Calendar («Hemmelig adresse i iCal-format»).
 *
 * Hvorfor egen parser og ikke `ical.js`/`rrule`: vi trenger bare VEVENT ut av
 * én kjent produsent, koden skal kjøre i workerd uten Node-avhengigheter, og
 * gjentakelsesreglene må ekspanderes i *veggklokke*-tid slik at en ukentlig
 * øvelse kl. 19:00 blir 19:00 også etter sommertidsomleggingen. Det er ~500
 * linjer ren TS uten polyfills, mot et bibliotek som drar med seg egen
 * tidssonemotor. Tidssonene løses av `Intl` (full ICU i workerd og node), så
 * VTIMEZONE-blokkene i feeden trengs ikke.
 *
 * Dekker: linjefolding, escapede tegn, DTSTART/DTEND med TZID, UTC (`Z`),
 * heldagshendelser (VALUE=DATE), DURATION, RRULE (DAILY/WEEKLY/MONTHLY/YEARLY
 * med INTERVAL, BYDAY, BYMONTHDAY, BYMONTH, COUNT, UNTIL, WKST), EXDATE,
 * RECURRENCE-ID (endret enkeltforekomst) og STATUS:CANCELLED.
 */

export type CalendarEvent = {
  /** Stabil nøkkel per forekomst (uid, evt. uid#start for gjentakelser). */
  id: string
  uid: string
  title: string
  /** ISO-8601 i UTC. */
  start: string
  /** ISO-8601 i UTC, eller null når hendelsen ikke har sluttidspunkt. */
  end: string | null
  allDay: boolean
  location: string | null
  description: string | null
  url: string | null
}

export type ExpandOptions = {
  /** Start på tidsvinduet (inklusiv). */
  from: Date | number
  /** Slutt på tidsvinduet (eksklusiv). */
  to: Date | number
  /** Maks antall forekomster som returneres. Standard 200. */
  max?: number
  /** Tidssone for «flytende» tidspunkter uten TZID. Standard Europe/Oslo. */
  defaultTimeZone?: string
}

const DEFAULT_TIME_ZONE = 'Europe/Oslo'
const DEFAULT_MAX = 200
/** Vern mot patologiske RRULE-er (uendelig regel + tomt vindu). */
const MAX_PERIODS = 20_000
const DAY_MS = 86_400_000

// ---------- Linjer og properties ----------

type IcsProperty = {
  name: string
  params: Record<string, string>
  value: string
}

/**
 * Slår sammen brettede linjer (RFC 5545 §3.1: fortsettelseslinjer starter med
 * mellomrom eller tab) og fjerner tomme linjer.
 */
export function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else if (line.length > 0) {
      out.push(line)
    }
  }
  return out
}

/** `\n`, `\,`, `\;` og `\\` i TEXT-verdier. */
function unescapeText(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = value[++i]
    if (next === undefined) break
    if (next === 'n' || next === 'N') out += '\n'
    else out += next
  }
  return out
}

function parseProperty(line: string): IcsProperty | null {
  // Navn og parametre står før første kolon som ikke er inne i en sitert verdi.
  let colon = -1
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') quoted = !quoted
    else if (ch === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon === -1) return null

  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const parts = splitUnquoted(head, ';')
  const name = (parts.shift() ?? '').toUpperCase()
  if (!name) return null

  const params: Record<string, string> = {}
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).toUpperCase()
    let raw = part.slice(eq + 1)
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) raw = raw.slice(1, -1)
    params[key] = raw
  }
  return { name, params, value }
}

function splitUnquoted(input: string, sep: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (const ch of input) {
    if (ch === '"') {
      quoted = !quoted
      current += ch
    } else if (ch === sep && !quoted) {
      out.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  out.push(current)
  return out
}

// ---------- Tidssoner ----------

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, fmt)
  }
  return fmt
}

/** Tidssonens forskyvning fra UTC i ms på et gitt UTC-tidspunkt. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  // `hour` kan bli 24 for midnatt i noen ICU-versjoner; Date.UTC håndterer det.
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - utcMs
}

/**
 * Veggklokke i `timeZone` → UTC-millisekunder. `floatingMs` er tidspunktet
 * tolket som om det var UTC (dvs. `Date.UTC(...)` av felttallene).
 *
 * To iterasjoner: første gjetning bruker forskyvningen på feil side av en
 * eventuell omlegging, andre runde treffer. I DST-hullet (kl. 02:00–03:00 om
 * våren i Oslo) finnes ikke tidspunktet, og vi lander deterministisk på
 * tidspunktet rett etter hoppet — som er det Google også gjør.
 */
function floatingToUtc(floatingMs: number, timeZone: string): number {
  const first = floatingMs - zoneOffsetMs(floatingMs, timeZone)
  return floatingMs - zoneOffsetMs(first, timeZone)
}

// ---------- Dato/tid-verdier ----------

type IcsMoment = {
  /** Veggklokken tolket som UTC (grunnlag for gjentakelsesregning). */
  floating: number
  /** Faktisk UTC-tidspunkt. */
  utc: number
  dateOnly: boolean
  timeZone: string
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/

function parseMoment(prop: IcsProperty, defaultTimeZone: string, rawValue?: string): IcsMoment | null {
  const value = (rawValue ?? prop.value).trim()
  const m = DATE_RE.exec(value)
  if (!m) return null
  const [, y, mo, d, hh, mm, ss, z] = m
  const dateOnly = prop.params.VALUE === 'DATE' || hh === undefined
  const floating = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh ?? '0'),
    Number(mm ?? '0'),
    Number(ss ?? '0'),
  )
  if (z === 'Z') return { floating, utc: floating, dateOnly: false, timeZone: 'UTC' }
  const timeZone = prop.params.TZID ?? defaultTimeZone
  return { floating, utc: floatingToUtc(floating, timeZone), dateOnly, timeZone }
}

// ---------- RRULE ----------

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

type ByDay = { weekday: number; ordinal: number | null }

type Recurrence = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count: number | null
  /** Veggklokke-grense (floating ms), slik at sammenlikningen er tidssonefri. */
  until: number | null
  byDay: ByDay[]
  byMonthDay: number[]
  byMonth: number[]
  weekStart: number
}

export function parseRRule(value: string, timeZone: string): Recurrence | null {
  const parts: Record<string, string> = {}
  for (const chunk of value.split(';')) {
    const eq = chunk.indexOf('=')
    if (eq === -1) continue
    parts[chunk.slice(0, eq).toUpperCase()] = chunk.slice(eq + 1)
  }
  const freq = parts.FREQ?.toUpperCase()
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null

  const byDay: ByDay[] = []
  for (const token of (parts.BYDAY ?? '').split(',')) {
    const t = token.trim().toUpperCase()
    if (!t) continue
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(t)
    if (!m) continue
    byDay.push({ weekday: WEEKDAYS.indexOf(m[2] as (typeof WEEKDAYS)[number]), ordinal: m[1] ? Number(m[1]) : null })
  }

  const numbers = (raw: string | undefined): number[] =>
    (raw ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n !== 0)

  let until: number | null = null
  if (parts.UNTIL) {
    const m = DATE_RE.exec(parts.UNTIL.trim())
    if (m) {
      const [, y, mo, d, hh, mm, ss, z] = m
      const floating = Date.UTC(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(hh ?? '23'),
        Number(mm ?? '59'),
        Number(ss ?? '59'),
      )
      // UNTIL er i UTC når den ender på Z; regningen vår er i veggklokke, så
      // regn den om til tidssonen DTSTART bruker.
      until = z === 'Z' ? floating + zoneOffsetMs(floating, timeZone) : floating
    }
  }

  return {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL ?? '1') || 1),
    count: parts.COUNT ? Math.max(0, Number(parts.COUNT)) : null,
    until,
    byDay,
    byMonthDay: numbers(parts.BYMONTHDAY),
    byMonth: numbers(parts.BYMONTH).filter((n) => n >= 1 && n <= 12),
    weekStart: Math.max(0, WEEKDAYS.indexOf((parts.WKST?.toUpperCase() ?? 'MO') as (typeof WEEKDAYS)[number])),
  }
}

/** Setter klokkeslettet fra `template` på datoen `floatingDay`. */
function withTimeOf(floatingDay: number, template: number): number {
  const d = new Date(floatingDay)
  const t = new Date(template)
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    t.getUTCHours(),
    t.getUTCMinutes(),
    t.getUTCSeconds(),
  )
}

function monthDaysFor(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/**
 * Ekspanderer en gjentakelsesregel i veggklokke-tid. Returnerer floating ms
 * (samme rom som `IcsMoment.floating`), sortert stigende.
 */
export function expandRecurrence(
  startFloating: number,
  rule: Recurrence,
  windowEndFloating: number,
): number[] {
  const out: number[] = []
  const start = new Date(startFloating)
  const limit = rule.until !== null ? Math.min(rule.until, windowEndFloating) : windowEndFloating

  const push = (value: number): boolean => {
    if (value < startFloating) return true
    if (rule.until !== null && value > rule.until) return false
    if (value > windowEndFloating) return false
    if (rule.byMonth.length > 0 && !rule.byMonth.includes(new Date(value).getUTCMonth() + 1)) return true
    out.push(value)
    return rule.count === null || out.length < rule.count
  }

  if (rule.freq === 'DAILY') {
    const allowed = rule.byDay.map((b) => b.weekday)
    for (let k = 0; k < MAX_PERIODS; k++) {
      const day = startFloating + k * rule.interval * DAY_MS
      if (day > limit) break
      if (allowed.length > 0 && !allowed.includes(new Date(day).getUTCDay())) continue
      if (!push(day)) break
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length > 0 ? rule.byDay.map((b) => b.weekday) : [start.getUTCDay()]
    // Ukestart før DTSTART, slik at BYDAY-dager tidligere i samme uke faller
    // bort via `value < startFloating` i stedet for å forskyve hele serien.
    const offsetToWeekStart = (start.getUTCDay() - rule.weekStart + 7) % 7
    const weekStart = startFloating - offsetToWeekStart * DAY_MS
    outer: for (let k = 0; k < MAX_PERIODS; k++) {
      const base = weekStart + k * rule.interval * 7 * DAY_MS
      if (base - 7 * DAY_MS > limit) break
      for (const weekday of [...days].sort((a, b) => ((a - rule.weekStart + 7) % 7) - ((b - rule.weekStart + 7) % 7))) {
        const offset = (weekday - rule.weekStart + 7) % 7
        const value = withTimeOf(base + offset * DAY_MS, startFloating)
        if (value > limit) continue
        if (!push(value)) break outer
      }
    }
  } else {
    // MONTHLY: én måned per periode. YEARLY: ett år per periode, med
    // BYMONTH-månedene (eller DTSTART sin måned) inne i hver.
    outer: for (let k = 0; k < MAX_PERIODS; k++) {
      const months: Array<{ year: number; month: number }> = []
      if (rule.freq === 'MONTHLY') {
        const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + k * rule.interval, 1))
        months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() })
      } else {
        const year = start.getUTCFullYear() + k * rule.interval
        const list = rule.byMonth.length > 0 ? rule.byMonth.map((m) => m - 1) : [start.getUTCMonth()]
        for (const month of [...list].sort((a, b) => a - b)) months.push({ year, month })
      }
      if (months.length === 0) break
      if (Date.UTC(months[0]!.year, months[0]!.month, 1) > limit) break

      for (const { year, month } of months) {
        const inMonth = monthDaysFor(year, month)
        const candidates: number[] = []

        if (rule.byDay.length > 0) {
          for (const { weekday, ordinal } of rule.byDay) {
            const matching: number[] = []
            for (let day = 1; day <= inMonth; day++) {
              if (new Date(Date.UTC(year, month, day)).getUTCDay() === weekday) matching.push(day)
            }
            if (ordinal === null) candidates.push(...matching)
            else {
              const day = ordinal > 0 ? matching[ordinal - 1] : matching[matching.length + ordinal]
              if (day !== undefined) candidates.push(day)
            }
          }
        } else if (rule.byMonthDay.length > 0) {
          for (const raw of rule.byMonthDay) {
            const day = raw > 0 ? raw : inMonth + raw + 1
            if (day >= 1 && day <= inMonth) candidates.push(day)
          }
        } else if (start.getUTCDate() <= inMonth) {
          candidates.push(start.getUTCDate())
        }

        for (const day of [...new Set(candidates)].sort((a, b) => a - b)) {
          const value = withTimeOf(Date.UTC(year, month, day), startFloating)
          if (value > limit) continue
          if (!push(value)) break outer
        }
      }
    }
  }

  return out.sort((a, b) => a - b)
}

// ---------- VEVENT ----------

type RawEvent = {
  uid: string
  summary: string
  location: string | null
  description: string | null
  url: string | null
  status: string | null
  start: IcsMoment
  end: IcsMoment | null
  /** Varighet i ms utledet av DTEND eller DURATION. */
  durationMs: number | null
  rrule: string | null
  exDates: number[]
  recurrenceId: IcsMoment | null
}

const DURATION_RE = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

export function parseDuration(value: string): number | null {
  const m = DURATION_RE.exec(value.trim().toUpperCase())
  if (!m) return null
  const [, sign, w, d, h, mi, s] = m
  const ms =
    Number(w ?? 0) * 7 * DAY_MS +
    Number(d ?? 0) * DAY_MS +
    Number(h ?? 0) * 3_600_000 +
    Number(mi ?? 0) * 60_000 +
    Number(s ?? 0) * 1000
  return sign === '-' ? -ms : ms
}

function parseEvents(ics: string, defaultTimeZone: string): { events: RawEvent[]; timeZone: string } {
  const lines = unfoldLines(ics)
  const events: RawEvent[] = []
  let calendarTimeZone = defaultTimeZone
  let current: Partial<RawEvent> & { exDates: number[] } = { exDates: [] }
  let inEvent = false
  let depth = 0

  for (const line of lines) {
    const prop = parseProperty(line)
    if (!prop) continue

    if (prop.name === 'BEGIN') {
      if (prop.value.toUpperCase() === 'VEVENT') {
        inEvent = true
        depth = 0
        current = { exDates: [] }
      } else if (inEvent) depth++
      continue
    }
    if (prop.name === 'END') {
      if (prop.value.toUpperCase() === 'VEVENT' && inEvent) {
        inEvent = false
        if (current.uid && current.start) events.push(finishEvent(current))
      } else if (inEvent) depth--
      continue
    }
    if (!inEvent) {
      // VTIMEZONE-blokker hoppes over — Intl løser tidssonene for oss.
      if (prop.name === 'X-WR-TIMEZONE' && prop.value.trim()) calendarTimeZone = prop.value.trim()
      continue
    }
    // Egenskaper inne i VALARM o.l. skal ikke lekke opp på hendelsen.
    if (depth > 0) continue

    switch (prop.name) {
      case 'UID':
        current.uid = unescapeText(prop.value)
        break
      case 'SUMMARY':
        current.summary = unescapeText(prop.value)
        break
      case 'LOCATION':
        current.location = unescapeText(prop.value) || null
        break
      case 'DESCRIPTION':
        current.description = unescapeText(prop.value) || null
        break
      case 'URL':
        current.url = prop.value.trim() || null
        break
      case 'STATUS':
        current.status = prop.value.trim().toUpperCase()
        break
      case 'DTSTART':
        current.start = parseMoment(prop, calendarTimeZone) ?? undefined
        break
      case 'DTEND':
        current.end = parseMoment(prop, calendarTimeZone) ?? undefined
        break
      case 'DURATION':
        current.durationMs = parseDuration(prop.value)
        break
      case 'RRULE':
        current.rrule = prop.value.trim()
        break
      case 'RECURRENCE-ID':
        current.recurrenceId = parseMoment(prop, calendarTimeZone) ?? undefined
        break
      case 'EXDATE':
        for (const chunk of prop.value.split(',')) {
          const moment = parseMoment(prop, calendarTimeZone, chunk)
          if (moment) current.exDates.push(moment.floating)
        }
        break
    }
  }

  return { events, timeZone: calendarTimeZone }
}

function finishEvent(partial: Partial<RawEvent> & { exDates: number[] }): RawEvent {
  const start = partial.start!
  const end = partial.end ?? null
  const durationMs =
    end !== null
      ? end.floating - start.floating
      : partial.durationMs !== undefined && partial.durationMs !== null
        ? partial.durationMs
        : start.dateOnly
          ? DAY_MS
          : null
  return {
    uid: partial.uid!,
    summary: partial.summary ?? '',
    location: partial.location ?? null,
    description: partial.description ?? null,
    url: partial.url ?? null,
    status: partial.status ?? null,
    start,
    end,
    durationMs,
    rrule: partial.rrule ?? null,
    exDates: partial.exDates,
    recurrenceId: partial.recurrenceId ?? null,
  }
}

// ---------- Offentlig API ----------

function toEvent(source: RawEvent, startFloating: number, isRecurring: boolean): CalendarEvent {
  // `floatingToUtc` er identitet for tidssonen «UTC», så Z-tider trenger ingen
  // egen gren. Varigheten legges på i veggklokke-rommet — en øvelse 19:00–21:00
  // varer to timer også i uken sommertiden legges om.
  const timeZone = source.start.timeZone
  const startUtc = floatingToUtc(startFloating, timeZone)
  const endUtc = source.durationMs === null ? null : floatingToUtc(startFloating + source.durationMs, timeZone)

  const start = new Date(startUtc).toISOString()
  return {
    id: isRecurring ? `${source.uid}#${start}` : source.uid,
    uid: source.uid,
    title: source.summary || '(uten tittel)',
    start,
    end: endUtc === null ? null : new Date(endUtc).toISOString(),
    allDay: source.start.dateOnly,
    location: source.location,
    description: source.description,
    url: source.url,
  }
}

/**
 * Parser en iCalendar-feed og returnerer forekomster som overlapper vinduet
 * `[from, to)`, sortert stigende på starttidspunkt og begrenset til `max`.
 */
export function expandEvents(ics: string, options: ExpandOptions): CalendarEvent[] {
  const from = typeof options.from === 'number' ? options.from : options.from.getTime()
  const to = typeof options.to === 'number' ? options.to : options.to.getTime()
  const max = options.max ?? DEFAULT_MAX
  const defaultTimeZone = options.defaultTimeZone ?? DEFAULT_TIME_ZONE

  const { events } = parseEvents(ics, defaultTimeZone)

  // Endrede enkeltforekomster (RECURRENCE-ID) slås opp per uid + opprinnelig start.
  const overrides = new Map<string, RawEvent>()
  for (const event of events) {
    if (event.recurrenceId) overrides.set(`${event.uid}#${event.recurrenceId.floating}`, event)
  }

  const collected: CalendarEvent[] = []
  const seen = new Set<string>()

  const consider = (source: RawEvent, floating: number, isRecurring: boolean) => {
    if (source.status === 'CANCELLED') return
    const event = toEvent(source, floating, isRecurring)
    if (seen.has(event.id)) return
    const startMs = Date.parse(event.start)
    const endMs = event.end === null ? startMs : Date.parse(event.end)
    if (startMs >= to) return
    if (endMs <= from && startMs < from) return
    seen.add(event.id)
    collected.push(event)
  }

  for (const source of events) {
    if (source.recurrenceId) continue // håndteres via overrides
    if (!source.rrule) {
      consider(source, source.start.floating, false)
      continue
    }
    const rule = parseRRule(source.rrule, source.start.timeZone)
    if (!rule) {
      consider(source, source.start.floating, false)
      continue
    }
    // Vinduets slutt i veggklokke-rom.
    const windowEndFloating = to + zoneOffsetMs(to, source.start.timeZone)
    const exDates = new Set(source.exDates)
    for (const floating of expandRecurrence(source.start.floating, rule, windowEndFloating)) {
      if (exDates.has(floating)) continue
      const override = overrides.get(`${source.uid}#${floating}`)
      if (override) {
        consider(override, override.start.floating, true)
        continue
      }
      consider(source, floating, true)
    }
  }

  collected.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title, 'nb-NO')))
  return collected.slice(0, max)
}
