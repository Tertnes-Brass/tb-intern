/**
 * Egendefinert server-entry for Worker-en.
 *
 * TanStack Start plukker opp `src/server.ts` automatisk som server-entry (i
 * stedet for standard `@tanstack/react-start/server-entry`). Vi gjenskaper
 * standard `fetch`-handler og legger til en `scheduled`-handler for Cron
 * Triggers (ukentlig backup — se `wrangler.jsonc` og `src/server/backup.ts`).
 *
 * NB: importer fra `@tanstack/react-start/server`, ikke `@tanstack/start-server-core`
 * direkte (sistnevnte knekker vite-pluginens virtuelle moduler).
 */
import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { runScheduledBackup } from './server/backup'

const handleRequest = createStartHandler(defaultStreamHandler)

export default {
  fetch(request) {
    return handleRequest(request)
  },
  scheduled(controller, _env, ctx) {
    ctx.waitUntil(runScheduledBackup(controller))
  },
} satisfies ExportedHandler<Env>
