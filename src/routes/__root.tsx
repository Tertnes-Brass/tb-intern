import { HeadContent, Outlet, Scripts, createRootRoute, useRouter, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { SessionGuards } from '../components/AppBehaviour'
import { Shell } from '../components/Shell'
import { Toaster } from '../components/toast'
import { loadMe, onMeChange, primeMe } from '../lib/me-client'
import { initPwa } from '../lib/pwa'
import { THEME_COLORS, applyTheme, followSystemTheme, readThemeMode, resolveTheme } from '../lib/theme'

import appCss from '../styles.css?url'

// Statisk, kompilert-inn temainit (ingen brukerinput): settes før første maling
// for å unngå blink av feil tema. `theme-color` følger det valgte temaet, ikke
// bare telefonens — ellers får en installert app lys statuslinje over mørkt
// papir. Samme regler som `src/lib/theme.ts`. Merker også installert app på iOS
// (`ios-app`, samme regel som `isIos() && isStandalone()` i src/lib/pwa.ts), der
// skallet ruller i stedet for vinduet — før første maling, så ingenting hopper.
const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);root.setAttribute('data-theme',resolved);root.style.colorScheme=resolved;var color=resolved==='dark'?'${THEME_COLORS.dark}':'${THEME_COLORS.light}';document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=color});var n=navigator;var standalone=n.standalone===true||window.matchMedia('(display-mode: standalone)').matches;var ios=/iPhone|iPad|iPod/.test(n.userAgent)||(n.userAgent.indexOf('Macintosh')>-1&&n.maxTouchPoints>1);if(standalone&&ios)root.classList.add('ios-app');}catch(e){}})();`

export const Route = createRootRoute({
  // Venter ikke på serveren ved hver navigasjon — se `src/lib/me-client.ts`.
  beforeLoad: async ({ location, preload }) => {
    const me = await loadMe({ pathname: location.pathname, preload })
    return { me }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      // viewport-fit=cover: siden tegnes under hjem-indikatoren og rundt hakket,
      // og `env(safe-area-inset-*)` i styles.css holder innholdet unna.
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'Intern · Tertnes Brass' },
      { name: 'robots', content: 'noindex' },
      // Én meta uten `media`: React slår sammen like `<meta name>`, og fargen skal
      // følge det VALGTE temaet. Temainit-skriptet og `applyTheme` setter den.
      { name: 'theme-color', content: THEME_COLORS.light },
      // Installert på Hjem-skjermen (iOS): fullskjerm, kort navn under ikonet.
      // `default` gir statuslinje i `theme-color`, så innholdet starter under den.
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'TB Intern' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
    ],
    links: [
      { rel: 'icon', href: '/favicon.ico' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'stylesheet', href: appCss },
    ],
    scripts: [{ children: THEME_INIT_SCRIPT }],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
})

function RootLayout() {
  const me = Route.useRouteContext().me
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const router = useRouter()
  useEffect(() => primeMe(me), [me])
  useEffect(() => onMeChange(() => void router.invalidate()), [router])
  const bare =
    pathname === '/login' ||
    pathname === '/glemt-passord' ||
    pathname === '/tilbakestill-passord' ||
    pathname.startsWith('/v/') ||
    // Notestativet er fullskjerm: ingen meny, ingen fanelinje.
    pathname.startsWith('/noter/stativ/')

  if (bare || !me) {
    return (
      <>
        {me && <SessionGuards userId={me.id} />}
        <Outlet />
      </>
    )
  }
  return (
    <>
      <SessionGuards userId={me.id} />
      <Shell me={me}>
        <Outlet />
      </Shell>
    </>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="paper-grain antialiased">
        {children}
        <Toaster />
        <PwaInit />
        <Scripts />
      </body>
    </html>
  )
}

/** Service worker, installasjonsforespørsel og «følg telefonens tema». */
function PwaInit() {
  useEffect(() => {
    initPwa()
    // Temainit-skriptet kan ha kjørt før `theme-color`-meta-en fantes.
    applyTheme(resolveTheme(readThemeMode()))
    return followSystemTheme()
  }, [])
  return null
}
