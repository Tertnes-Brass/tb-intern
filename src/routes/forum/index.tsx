import { useForumRefresh } from '../../components/useForumRefresh'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { listForum } from '../../server/forum'
import { Kicker, Stamp } from '../../components/ui'

export const Route = createFileRoute('/forum/')({
  beforeLoad: ({ context }) => { if (!context.me) throw redirect({ to: '/login' }) },
  validateSearch: (search: Record<string, unknown>) => ({ page: Math.max(0, Math.min(100000, Math.floor(Number(search.page) || 0))) }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listForum({ data: deps }),
  component: ForumPage,
})

function ForumPage() {
  useForumRefresh()
  const { topics, hasMore } = Route.useLoaderData()
  const { page } = Route.useSearch()
  return <div className="mx-auto max-w-3xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><Kicker>Korpset snakker sammen</Kicker><h1 className="display-title text-4xl font-semibold">Forum</h1>
        <p className="mt-2 text-ink-soft">Spør om noe, foreslå en fest eller start en diskusjon.</p></div>
      <Link className="inline-flex rounded-[9px] bg-brass px-4 py-2 text-sm font-medium text-paper-raised transition-colors hover:bg-brass-strong" to="/forum/ny">Start en tråd</Link>
    </header>
    <section className="sheet divide-y divide-line" aria-label="Diskusjoner">
      {topics.length === 0 && <div className="p-8 text-ink-soft">{page ? 'Ingen flere tråder.' : 'Ingen tråder ennå. Start den første samtalen!'}</div>}
      {topics.map((topic) => <Link key={topic.id} to="/forum/$topicId" params={{ topicId: topic.id }} search={{ page: 0 }} className="block px-4 py-3 transition-colors hover:bg-paper-sunken">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold break-words">{topic.title}</h2>{topic.unreadCount > 0 && <span className="text-xs font-semibold text-brass-strong">● {topic.unreadCount} uleste svar</span>}{topic.unreadMentionCount > 0 && <span className="mention">@ Omtaler deg</span>}{topic.locked && <Stamp>Låst</Stamp>}</div>
        <p className="mt-1 text-sm text-ink-soft">{topic.author ?? 'Tidligere medlem'} · {topic.replyCount} svar · Siste aktivitet {new Date(topic.activityAt).toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo' })}</p>
      </Link>)}
    </section>
    <nav aria-label="Sider" className="flex justify-between">
      {page > 0 ? <Link to="/forum" search={{ page: page - 1 }} className="link-quiet">← Forrige</Link> : <span />}
      {hasMore && <Link to="/forum" search={{ page: page + 1 }} className="link-quiet">Neste →</Link>}
    </nav>
  </div>
}
