import startEntry from '@tanstack/react-start/server-entry'
import { runOverdueReminders } from './server/board-notify'

/**
 * Worker-entry. Denne fila finnes av én grunn: Start sin egen entry
 * (`@tanstack/react-start/server-entry`) eksporterer bare `fetch`, og vi trenger
 * i tillegg en `scheduled`-handler til den daglige påminnelsen om forfalte
 * styreoppgaver (`triggers.crons` i wrangler.jsonc).
 *
 * `main` i wrangler.jsonc peker hit i stedet for på pakken. Cloudflare-pluginen
 * pakker `main` inn i worker-entryen og setter den som input for `ssr`-miljøet;
 * Start-pluginen respekterer en input som allerede er satt, så hele
 * SSR-oppsettet er uendret — vi legger bare en handler ved siden av `fetch`.
 * `fetch` sendes rett videre, uten et eneste ekstra ledd i forespørselsveien.
 *
 * Lokalt (`pnpm dev`) kan cron-en trigges manuelt:
 * `curl "http://localhost:<port>/cdn-cgi/handler/scheduled?cron=0+7+*+*+*"`.
 */
export default {
  fetch: (...args: Parameters<typeof startEntry.fetch>) => startEntry.fetch(...args),

  scheduled: (_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) => {
    // `waitUntil` holder isolaten i live til utsendingen er ferdig. Kjøringen er
    // idempotent per kalenderdag (`settings`-raden `board.reminders.lastRunDate`),
    // så en cron som utløses to ganger sender ikke dobbelt.
    ctx.waitUntil(runOverdueReminders())
  },
}
