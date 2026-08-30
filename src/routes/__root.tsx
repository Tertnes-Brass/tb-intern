import { HeadContent, Outlet, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router'
import { Shell } from '../components/Shell'
import { Toaster } from '../components/toast'
import { getMe } from '../server/auth'

import appCss from '../styles.css?url'

// Statisk, kompilert-inn temainit (ingen brukerinput): settes før første maling
// for å unngå blink av feil tema.
const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);root.setAttribute('data-theme',resolved);root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRoute({
  beforeLoad: async () => {
    const me = await getMe()
    return { me }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Intern · Tertnes Brass' },
      { name: 'robots', content: 'noindex' },
      { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#f7f1e6' },
      { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#171310' },
    ],
    links: [
      { rel: 'icon', href: '/favicon.ico' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
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
  const bare =
    pathname === '/login' ||
    pathname === '/glemt-passord' ||
    pathname === '/tilbakestill-passord' ||
    pathname.startsWith('/v/')

  if (bare || !me) return <Outlet />
  return (
    <Shell me={me}>
      <Outlet />
    </Shell>
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
        <Scripts />
      </body>
    </html>
  )
}
