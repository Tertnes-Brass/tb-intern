const dateFmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })
const dateShortFmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' })
const weekdayFmt = new Intl.DateTimeFormat('nb-NO', { weekday: 'long' })
const dateTimeFmt = new Intl.DateTimeFormat('nb-NO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  // Eksplisitt tidssone: SSR kjører i UTC (workerd), og runtime-tidssonen
  // ville gitt hydration-mismatch mot klientens norske tid.
  timeZone: 'Europe/Oslo',
})

const timeFmt = new Intl.DateTimeFormat('nb-NO', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Oslo',
})
// `en-CA` gir «2026-03-25» direkte, uten manuell sammensetting av delene.
const isoDateFmt = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Europe/Oslo',
})

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return dateFmt.format(new Date(`${iso}T12:00:00`))
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return ''
  return dateShortFmt.format(new Date(`${iso}T12:00:00`))
}

export function formatWeekday(iso: string | null | undefined): string {
  if (!iso) return ''
  return weekdayFmt.format(new Date(`${iso}T12:00:00`))
}

/** Epoch-ms → «3. jul. 2026, 14:30» */
export function formatDateTime(ms: number): string {
  return dateTimeFmt.format(new Date(ms))
}

/**
 * Fullt tidspunkt (ISO med tidssone, eller epoch-ms) → datoen slik den ser ut i
 * Norge, «2026-03-25». Broen mellom kalenderens UTC-tidspunkter og
 * `formatDate`/`formatWeekday`/`relativeDays`, som tar rene datoer.
 */
export function toOsloDate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return isoDateFmt.format(d)
}

/** Fullt tidspunkt → «19:00» i norsk tid. */
export function formatTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return timeFmt.format(d)
}

/** «19:00–21:30», eller bare «19:00» når sluttidspunkt mangler eller er likt. */
export function formatTimeRange(
  start: string | number | null | undefined,
  end?: string | number | null | undefined,
): string {
  const from = formatTime(start)
  if (!from) return ''
  const to = formatTime(end)
  if (!to || to === from) return from
  return `${from}–${to}`
}

/** «om 13 dager», «i dag», «for 3 dager siden» */
export function relativeDays(iso: string | null | undefined): string {
  if (!iso) return ''
  const target = new Date(`${iso}T12:00:00`)
  const now = new Date()
  const days = Math.round((target.getTime() - now.getTime()) / 86_400_000)
  if (days === 0) return 'i dag'
  if (days === 1) return 'i morgen'
  if (days === -1) return 'i går'
  if (days > 1) return `om ${days} dager`
  return `for ${-days} dager siden`
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** «4:30» eller «270» → sekunder. Tom/ugyldig → null. */
export function parseDurationToSec(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  const colon = s.match(/^(\d{1,2}):([0-5]?\d)$/)
  if (colon) return Number(colon[1]) * 60 + Number(colon[2])
  const plain = s.match(/^\d+$/)
  if (plain) return Number(s)
  return null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ROMAN: Array<[number, string]> = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]

/** 1 → I, 4 → IV … til programnummerering. */
export function toRoman(n: number): string {
  let out = ''
  let rest = Math.max(1, Math.min(n, 39))
  for (const [v, sym] of ROMAN) {
    while (rest >= v) {
      out += sym
      rest -= v
    }
  }
  return out
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('')
}
