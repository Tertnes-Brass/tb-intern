import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { RouteError } from './components/RouteError'
import { APP_SCROLLER_SELECTOR } from './lib/app-scroll'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    // I installert iOS-app ruller skallet, ikke vinduet (src/lib/app-scroll.ts):
    // ny side starter øverst, og «tilbake» gjenoppretter posisjonen.
    scrollToTopSelectors: [APP_SCROLLER_SELECTOR],
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: RouteError,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
