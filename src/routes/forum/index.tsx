import { useForumRefresh } from '../../components/useForumRefresh'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { listForum, searchForum } from '../../server/forum'
import { Highlight, SearchField, SearchHitLine, SortButton, SortSheet, useSearchText } from '../../components/Search'
import { Segmented } from '../../components/Segmented'
import { BackArrow, Button, buttonClass, EmptyState, PageHeader, Stamp } from '../../components/ui'
import { shortWhen } from '../../components/compose/when'
import { type ForumSort, FORUM_SORTS, FORUM_SORT_VALUES, effectiveForumSort, forumSortOptions } from '../../lib/forum-search'
import { type SearchHit, SEARCH_MAX_LENGTH, isSearchable, searchTerms } from '../../lib/post-search'

type ForumSearch = { page: number; q?: string; sortering?: ForumSort }

export const Route = createFileRoute('/forum/')({
  beforeLoad: ({ context }) => { if (!context.me) throw redirect({ to: '/login' }) },
  validateSearch: (search: Record<string, unknown>): ForumSearch => {
    const page = Math.max(0, Math.min(100000, Math.floor(Number(search.page) || 0)))
    const q = typeof search.q === 'string' && search.q ? search.q.slice(0, SEARCH_MAX_LENGTH) : undefined
    const sortering = FORUM_SORT_VALUES.find((s) => s === search.sortering)
    return { page, ...(q ? { q } : {}), ...(sortering ? { sortering } : {}) }
  },
  loaderDeps: ({ search }) => search,
  // Med et søk (`?q=`) er lista søketreffene — alle de beste, uten sider.
  loader: async ({ deps }) =>
    deps.q && isSearchable(deps.q)
      ? { kind: 'search' as const, ...(await searchForum({ data: { q: deps.q, sort: deps.sortering } })) }
      : { kind: 'list' as const, ...(await listForum({ data: { page: deps.page, sort: deps.sortering } })) },
  // Fane i TabBar.tsx: vis forrige versjon med en gang og hent ny i bakgrunnen.
  preloadStaleTime: Infinity,
  component: ForumPage,
})

/**
 * Forumet — trådene med siste aktivitet øverst. Kompakt sidehode med «Start en
 * tråd», et søkefelt, så én liste med like rader: tittel, én metadatalinje og
 * uleste til høyre. Lesbar bredde også på iPad (ikke utstrakt).
 *
 * Søket (`?q=`, `searchForum`) går gjennom tittel, trådstarten og alle svarene.
 * Står treffet i et svar, lenker raden rett til svaret (`?svar=`), og raden
 * viser hvor treffet står. Sorteringen (`?sortering=`) skjer på serveren, for
 * lista er delt i sider; standardvalget skrives aldri i URL-en.
 */
function ForumPage() {
  const data = Route.useLoaderData()
  const { page, q = '', sortering } = Route.useSearch()
  const navigate = Route.useNavigate()
  const searching = isSearchable(q)
  // Søket hentes ikke på nytt hvert 12. sekund — det leser hele forumet.
  useForumRefresh(!searching)
  const fetching = Route.useMatch({ select: (m) => !!m.isFetching })
  const [sortOpen, setSortOpen] = useState(false)

  const field = useSearchText(q, (text) =>
    navigate({ search: (prev) => ({ ...prev, page: 0, q: text.trim() ? text : undefined }), replace: true }),
  )
  const clearSearch = () => {
    field.reset()
    navigate({ search: (prev) => ({ page: 0, sortering: prev.sortering === 'treff' ? undefined : prev.sortering }), replace: true })
  }

  const sort = effectiveForumSort(sortering, searching)
  const sortIsDefault = sort === effectiveForumSort(undefined, searching)
  const sortLabel = FORUM_SORTS.find((s) => s.value === sort)?.label ?? ''
  const chooseSort = (value: ForumSort) =>
    navigate({ search: (prev) => ({ ...prev, page: 0, sortering: value === effectiveForumSort(undefined, searching) ? undefined : value }), replace: true })

  const result = data.kind === 'search' ? data : null
  const topics = data.topics
  const terms = result ? searchTerms(result.query) : undefined
  const hasMore = data.kind === 'list' && data.hasMore

  return <div className="mx-auto max-w-2xl">
    <PageHeader
      className="rise"
      title="Forum"
      summary={!result && page > 0 ? `Side ${page + 1}` : undefined}
      action={<Link className={buttonClass('primary', 'sm')} to="/forum/ny">Start en tråd</Link>}
    />

    <div className="rise mt-4 flex items-center gap-2" role="search">
      <SearchField
        value={field.text}
        onChange={field.setText}
        onClear={clearSearch}
        maxLength={SEARCH_MAX_LENGTH}
        placeholder="Søk i forumet"
        label="Søk i titler, innlegg og svar"
      />
      <SortButton label={sortLabel} isDefault={sortIsDefault} onClick={() => setSortOpen(true)} className="sm:hidden" />
    </div>

    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[0.85rem] text-ink-soft">
      {result ? <p role="status" aria-live="polite">
        {result.total} treff på «{result.query.trim()}»
        {result.limited && <span className="text-ink-faint"> · viser de {result.topics.length} beste</span>}
        {' · '}
        <button type="button" onClick={clearSearch} className="hit cursor-pointer underline-offset-2 hover:text-ink hover:underline">Tøm søket</button>
      </p> : <span />}
      {/* Med mus og på iPad: valgene rett på siden. På telefon: knappen ved søket. */}
      <Segmented
        className="max-sm:hidden"
        label="Sorter trådene"
        value={sort}
        options={forumSortOptions(searching)}
        onChange={chooseSort}
      />
    </div>

    {topics.length === 0 ? result ? <EmptyState
      title={`Ingen treff på «${result.query.trim()}»`}
      action={<Button onClick={clearSearch}>Tøm søket</Button>}
    >Søket går gjennom titlene, trådstartene og alle svarene. Prøv færre eller kortere ord.</EmptyState>
    : <EmptyState
      title={page ? 'Ingen flere tråder' : 'Ingen tråder ennå'}
      action={page ? <Link to="/forum" search={{ page: 0 }} className={buttonClass('secondary')}>Til første side</Link> : <Link to="/forum/ny" className={buttonClass('primary')}>Start den første</Link>}
    >{page ? undefined : 'Spør om noe, foreslå en fest eller start en diskusjon. Alle medlemmer kan lese og svare.'}</EmptyState>
    : <ul
      className={`forum-list rise mt-3 transition-opacity ${result && fetching ? 'opacity-60' : ''}`}
      style={{ animationDelay: '60ms' }}
      aria-label={result ? 'Søketreff' : 'Diskusjoner'}
      aria-busy={(result && fetching) || undefined}
    >
      {topics.map((topic) => {
        const unread = topic.unreadCount > 0
        const hit: SearchHit = 'hit' in topic ? topic.hit : null
        // Et treff i et svar lenker rett til svaret; tråden ruller dit og lyser det opp.
        const reply = hit?.kind === 'comment' ? hit.commentId : undefined
        return <li key={topic.id}>
          <Link to="/forum/$topicId" params={{ topicId: topic.id }} search={reply ? { page: 0, svar: reply } : { page: 0 }} className="forum-row">
            <span className="min-w-0 flex-1">
              <span className={`block break-words text-[1rem] leading-snug text-ink ${unread ? 'font-bold' : 'font-semibold'}`}><Highlight text={topic.title} terms={terms} /></span>
              <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.8rem] text-ink-faint">
                {topic.deletedAt
                  ? <span className="italic">Innlegget er slettet</span>
                  : <span><Highlight text={topic.author ?? 'Tidligere medlem'} terms={terms} /></span>}
                <span aria-hidden>·</span>
                <span>{topic.replyCount === 1 ? '1 svar' : `${topic.replyCount} svar`}</span>
                <span aria-hidden>·</span>
                <span>{shortWhen(sort === 'nye' ? topic.createdAt : topic.activityAt)}</span>
                {topic.locked && <Stamp className="ml-1">Låst</Stamp>}
              </span>
              {hit && terms && <SearchHitLine
                label={hit.kind === 'comment' ? `Svar fra ${hit.author}` : 'I trådstarten'}
                snippet={hit.snippet}
                terms={terms}
              />}
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
    {!result && (page > 0 || hasMore) && <nav aria-label="Sider" className="mt-4 flex justify-between">
      {page > 0 ? <Link to="/forum" search={(prev) => ({ ...prev, page: page - 1 })} className={buttonClass('ghost', 'sm')}>← {sort === 'aktive' ? 'Forrige' : 'Nyere'}</Link> : <span />}
      {hasMore && <Link to="/forum" search={(prev) => ({ ...prev, page: page + 1 })} className={buttonClass('ghost', 'sm')}>{sort === 'aktive' ? 'Neste' : 'Eldre'} →</Link>}
    </nav>}

    <SortSheet open={sortOpen} onClose={() => setSortOpen(false)} options={forumSortOptions(searching)} value={sort} onChange={chooseSort} />
  </div>
}
