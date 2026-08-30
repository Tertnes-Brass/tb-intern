import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { legacyHostRedirect } from './lib/host-redirect'

/**
 * Global request-middleware. Kjører før både server functions og server routes
 * (`/api/*`, `/v/*`), altså så tidlig som forespørselen kan gripes uten en egen
 * Worker-entry.
 *
 * MERK: så snart denne fila finnes, bruker Start *våre* requestMiddleware i
 * stedet for standardlista. CSRF-middlewaren må derfor listes eksplisitt — med
 * samme filter som Start sin egen — ellers står server functions ubeskyttet.
 */

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

/** 301 fra de gamle domenene til `BETTER_AUTH_URL` (aldri hardkodet her). */
const legacyHostRedirectMiddleware = createMiddleware({ type: 'request' }).server(({ request, next }) => {
  const target = legacyHostRedirect(request.url, env.BETTER_AUTH_URL)
  if (target) {
    return new Response(null, {
      status: 301,
      headers: { location: target, 'cache-control': 'no-store' },
    })
  }
  return next()
})

export const startInstance = createStart(() => ({
  requestMiddleware: [legacyHostRedirectMiddleware, csrfMiddleware],
}))
