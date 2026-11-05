import { toOsloDate } from '../../lib/format'

const timeFmt = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
const dayFmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' })
const yearFmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Oslo' })

/**
 * Kort tidspunkt for metadatalinjen på veggen og i forumet: «i dag 14:30»,
 * «i går 09:12», «3. nov.» og — et annet år — «3. nov. 2025». Kalenderdager i
 * norsk tid på både server og klient (samme grep som `relativeDays`), så SSR og
 * hydrering er enige.
 */
export function shortWhen(ms: number, now: number = Date.now()): string {
  const day = toOsloDate(ms)
  const today = toOsloDate(now)
  if (day === today) return `i dag ${timeFmt.format(ms)}`
  if (day === toOsloDate(now - 86_400_000)) return `i går ${timeFmt.format(ms)}`
  return day.slice(0, 4) === today.slice(0, 4) ? dayFmt.format(ms) : yearFmt.format(ms)
}
