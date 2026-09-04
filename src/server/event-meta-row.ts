import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { eventMeta } from '../db/schema'
import { loadCalendar } from './calendar-feed'

/**
 * `event_meta`-raden for én forekomst — opprettet lazily.
 *
 * **Hvorfor en egen modul:** funksjonen trengs av to skrivelag (`event-meta.ts`
 * for øvingsplan, praktisk info og oppmøte; `rigg.ts` for riggelista på en
 * øving), og begge er moduler som IKKE eksporterer noe levende, nettopp fordi
 * rutene importerer dem. En `export function ensureMeta` i `event-meta.ts`
 * ville holdt modulkroppen i live i klientbygget og dratt `cloudflare:workers`
 * med seg — samme felle som `post-images.ts` og `gruppeledere.ts` beskriver i
 * AGENTS.md. Den lever derfor her, der bare serverkode importerer den.
 */

/** Forekomsten fra feeden, eller `null` når den ikke finnes i vinduet. */
export async function feedOccurrence(occurrenceKey: string) {
  const calendar = await loadCalendar(Date.now())
  return {
    calendar,
    event: calendar.events.find((e) => e.occurrenceKey === occurrenceKey) ?? null,
  }
}

/**
 * Henter (eller oppretter) `event_meta` for en forekomst. Raden lages FØRSTE
 * gang noen skriver noe lokalt — en hendelse ingen har rørt har ingen rad, og
 * kalenderen forblir en ren lesekopi av Google.
 *
 * Snapshotet (`summary`, `start`, `uid`) tas alltid fra FEEDEN, aldri fra
 * klienten: et rått kall skal ikke kunne dikte opp en hendelse med valgfri
 * tittel. Finnes ikke forekomsten i feeden, kan man bare skrive videre på en rad
 * som allerede finnes (den foreldreløse hendelsen) — ikke lage en ny.
 */
export async function ensureEventMeta(d: Db, occurrenceKey: string, actorId: string): Promise<void> {
  const existing = await d
    .select({ occurrenceKey: eventMeta.occurrenceKey })
    .from(eventMeta)
    .where(eq(eventMeta.occurrenceKey, occurrenceKey))
    .limit(1)
  const now = new Date()
  if (existing[0]) {
    await d.update(eventMeta).set({ updatedAt: now }).where(eq(eventMeta.occurrenceKey, occurrenceKey))
    return
  }
  const { event } = await feedOccurrence(occurrenceKey)
  if (!event) throw new Error('Hendelsen finnes ikke i kalenderen')
  await d
    .insert(eventMeta)
    .values({
      occurrenceKey,
      uid: event.uid,
      summary: event.title,
      start: new Date(event.start),
      linkedProjectId: null,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
}
