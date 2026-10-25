import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Myk overgang mellom sider (View Transitions API), som i en app. Bare når
    // stien endres — et søkefelt som oppdaterer `?q=` for hvert tastetrykk skal
    // ikke blinke. Uten støtte i nettleseren skjer ingenting.
    defaultViewTransition: {
      types: ({ pathChanged }) => (pathChanged ? ['navigate'] : false),
    },
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
