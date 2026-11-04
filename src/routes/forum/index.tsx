import { useForumRefresh } from '../../components/useForumRefresh'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { listForum } from '../../server/forum'
import { BackArrow, buttonClass, EmptyState, PageHeader, Stamp } from '../../components/ui'
import { shortWhen } from '../../components/compose/when'

export const Route = createFileRoute('/forum/')({
  beforeLoad: ({ context }) => { if (!context.me) throw redirect({ to: '/login' }) },
  validateSearch: (search: Record<string, unknown>) => ({ page: Math.max(0, Math.min(100000, Math.floor(Number(search.page) || 0))) }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listForum({ data: deps }),
  // Fane i TabBar.tsx: vis forrige versjon med en gang og hent ny i bakgrunnen.
  preloadStaleTime: Infinity,
  component: ForumPage,
})

/**
 * Forumet — trådene med siste aktivitet øverst. Kompakt sidehode med «Start en
 * tråd», så én liste med like rader: tittel, én metadatalinje og uleste til
 * høyre. Lesbar bredde også på iPad (ikke utstrakt).
 */
function ForumPage() {
  useForumRefresh()
  const { topics, hasMore } = Route.useLoaderData()
  const { page } = Route.useSearch()
  return <div className="mx-auto max-w-2xl">
    <PageHeader
      className="rise"
      title="Forum"
      summary={page > 0 ? `Side ${page + 1}` : undefined}
      action={<Link className={buttonClass('primary', 'sm')} to="/forum/ny">Start en tråd</Link>}
    />
    {topics.length === 0 ? <EmptyState
      title={page ? 'Ingen flere tråder' : 'Ingen tråder ennå'}
      action={page ? <Link to="/forum" search={{ page: 0 }} className={buttonClass('secondary')}>Til første side</Link> : <Link to="/forum/ny" className={buttonClass('primary')}>Start den første</Link>}
    >{page ? undefined : 'Spør om noe, foreslå en fest eller start en diskusjon. Alle medlemmer kan lese og svare.'}</EmptyState>
    : <ul className="forum-list rise mt-4" style={{ animationDelay: '60ms' }} aria-label="Diskusjoner">
      {topics.map((topic) => {
        const unread = topic.unreadCount > 0
        return <li key={topic.id}>
          <Link to="/forum/$topicId" params={{ topicId: topic.id }} search={{ page: 0 }} className="forum-row">
            <span className="min-w-0 flex-1">
              <span className={`block break-words text-[1rem] leading-snug text-ink ${unread ? 'font-bold' : 'font-semibold'}`}>{topic.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.8rem] text-ink-faint">
                <span>{topic.author ?? 'Tidligere medlem'}</span>
                <span aria-hidden>·</span>
                <span>{topic.replyCount === 1 ? '1 svar' : `${topic.replyCount} svar`}</span>
                <span aria-hidden>·</span>
                <span>{shortWhen(topic.activityAt)}</span>
                {topic.locked && <Stamp className="ml-1">Låst</Stamp>}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {topic.unreadMentionCount > 0 && <span className="mention" title="Omtaler deg">@</span>}
              {unread && <span className="wall-count tabular" title={`${topic.unreadCount} uleste svar`}>{topic.unreadCount}<span className="sr-only"> uleste svar</span></span>}
              <span className="forum-row-chevron" aria-hidden><BackArrow /></span>
            </span>
          </Link>
        </li>
      })}
    </ul>}
    {(page > 0 || hasMore) && <nav aria-label="Sider" className="mt-4 flex justify-between">
      {page > 0 ? <Link to="/forum" search={{ page: page - 1 }} className={buttonClass('ghost', 'sm')}>← Nyere</Link> : <span />}
      {hasMore && <Link to="/forum" search={{ page: page + 1 }} className={buttonClass('ghost', 'sm')}>Eldre →</Link>}
    </nav>}
  </div>
}
