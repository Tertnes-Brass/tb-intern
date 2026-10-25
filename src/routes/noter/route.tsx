import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'

type AreaNavItem = {
  to: '/noter' | '/noter/prosjekter' | '/noter/arkiv'
  label: string
  exact?: boolean
}

/**
 * Noteområdet: Mine noter, Prosjekter og Arkiv. Toppmenyen viser bare «Noter»
 * (se `Shell.tsx`), og undernavigasjonen her er området sin egen meny —
 * navigasjonsmodell (a) i `docs/designprinsipper.md` §6.
 */
export const Route = createFileRoute('/noter')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    return { me: context.me }
  },
  component: NoterLayout,
})

function NoterLayout() {
  const me = Route.useRouteContext().me
  const canBrowseArchive =
    me.permissions.includes('*') ||
    me.permissions.includes('archive.viewAll') ||
    me.permissions.includes('works.manage')

  const items: AreaNavItem[] = [
    { to: '/noter', label: 'Mine noter', exact: true },
    { to: '/noter/prosjekter', label: 'Prosjekter' },
  ]
  if (canBrowseArchive) items.push({ to: '/noter/arkiv', label: 'Arkiv' })

  return (
    <div>
      <div className="area-nav-wrap print-hidden">
        <nav
          className="area-nav"
          aria-label="Noter"
        >
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact ?? false }}
              className="area-link"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  )
}
