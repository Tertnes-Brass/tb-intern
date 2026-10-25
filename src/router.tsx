import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { RouteError } from './components/RouteError'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: RouteError,
    // Myk overgang mellom sider (View Transitions API), som i en app. Bare når
    // stien endres — et søkefelt som oppdaterer `?q=` for hvert tastetrykk skal
    // ikke blinke. Uten støtte i nettleseren skjer ingenting.
    // Notestativet er fullskjerm med eget oppsett; der er en kryssfade bare uro.
    // Ruteren spør bare `types` når nettleseren støtter overgangstyper — ellers
    // ville hver navigasjon (også `?q=` for hvert tastetrykk) fått overgangen.
    defaultViewTransition: viewTransitionTypesSupported()
      ? {
          types: ({ pathChanged, fromLocation, toLocation }) =>
            pathChanged &&
            !toLocation.pathname.startsWith('/noter/stativ/') &&
            !fromLocation?.pathname.startsWith('/noter/stativ/')
              ? ['navigate']
              : false,
        }
      : false,
  })

  return router
}

/** Samme sjekk som ruteren selv gjør før den bruker `types`. På serveren: nei. */
function viewTransitionTypesSupported(): boolean {
  if (typeof document === 'undefined' || typeof CSS === 'undefined') return false
  try {
    return CSS.supports('selector(:active-view-transition-type(navigate))')
  } catch {
    return false
  }
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
