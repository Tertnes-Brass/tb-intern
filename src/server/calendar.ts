import { createServerFn } from '@tanstack/react-start'
import type { CalendarEvent } from '../lib/ical'
import { requireMe } from './access'
import { type CalendarPayload, loadCalendar } from './calendar-feed'

/**
 * Serverfunksjonene for Kalender-området. Selve hentingen og tolkningen av
 * feeden bor i `calendar-feed.ts` — se kommentaren der for hvorfor.
 */

export type { CalendarPayload }

/** Hele kalendervinduet: fra i går og åtte uker frem, maks 200 forekomster. */
export const getCalendar = createServerFn().handler(async (): Promise<CalendarPayload> => {
  await requireMe()
  return loadCalendar(Date.now())
})

/** Kun neste hendelse — til hub-forsiden, som ikke trenger hele lista. */
export const getNextEvent = createServerFn().handler(
  async (): Promise<{ configured: boolean; error: boolean; next: CalendarEvent | null }> => {
    await requireMe()
    const { configured, error, next } = await loadCalendar(Date.now())
    return { configured, error, next }
  },
)
