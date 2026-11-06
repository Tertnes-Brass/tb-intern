import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useScrollRow } from '../../components/AreaNav'
import { z } from 'zod'
import { PostCard, postSender } from '../../components/PostCard'
import { shortWhen } from '../../components/compose/when'
import { SearchField, SortButton, SortSheet, useSearchText } from '../../components/Search'
import { BackArrow, Button, buttonClass, EmptyState, PageHeader } from '../../components/ui'
import {
  type PostSort,
  POST_SORTS,
  SEARCH_MAX_LENGTH,
  effectiveSort,
  isSearchable,
  searchTerms,
  sortOptions,
  sortPosts,
} from '../../lib/post-search'
import { seenThisSession } from '../../lib/read-posts-client'
import { UNREAD_WINDOW_DAYS } from '../../lib/unread'
import { listPosts, searchPosts, type PostSearchResult } from '../../server/posts'

/**
 * Beskjeder (#28) — veggen.
 *
 * Primærbruker er medlemmet, og primærhandlingen er å se hva som er nytt:
 * innleggene ligger nyeste først, rett under et kompakt sidehode og én rad med
 * filtre — det første innlegget skal stå på første skjerm på telefonen.
 * Utkast er et eget filter med kompakte rader, ikke fulle kort over feeden. På iPad på
 * tvers og desktop flytter filtrene og utkastene ut i en sidespalte. Alle
 * innloggede kan skrive; `posts.publish` gir «Fra styret», «Viktig», styre-
 * målgruppen, e-post og utkast. Filtreringen skjer i `listPosts`, ikke her.
 *
 * Søket (`?q=`) går til serveren (`searchPosts`): tittel, HELE teksten,
 * avsender og kommentarer i alle beskjeder leseren kan se. Filtrene og
 * sorteringen (`?sortering=`) gjelder både veggen og søketreffene, og gjøres
 * her på skjermen med `sortPosts` — begge listene har tallene som trengs.
 * «Beste treff» finnes bare mens man søker, og er da standard.
 */

const filterSchema = z.object({
  // Validert så visningen kan lenkes til (docs/designprinsipper.md §4).
  // `utkast` viser bare utkastene (for dem som har noen; andre får en tom liste).
  vis: z.enum(['alt', 'ulest', 'utkast', 'styret', 'arkivar', 'viktig']).default('alt').catch('alt'),
  q: z.string().max(SEARCH_MAX_LENGTH).optional().catch(undefined),
  sortering: z.enum(['treff', 'nyeste', 'eldste', 'aktive', 'aktivitet']).optional().catch(undefined),
})

type Filter = z.infer<typeof filterSchema>['vis']

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'alt', label: 'Alle' },
  { value: 'ulest', label: 'Uleste' },
  { value: 'utkast', label: 'Utkast' },
  { value: 'styret', label: 'Fra styret' },
  { value: 'arkivar', label: 'Notearkivar' },
  { value: 'viktig', label: 'Viktig' },
]

export const Route = createFileRoute('/beskjeder/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  validateSearch: filterSchema,
  loader: () => listPosts(),
  // Fane i TabBar.tsx: vis forrige versjon med en gang og hent ny i bakgrunnen.
  preloadStaleTime: Infinity,
  component: PostsPage,
})

type Drafts = Awaited<ReturnType<typeof listPosts>>['drafts']

/**
 * Utkastene (bare for dem som har noen): kompakte rader bak filteret «Utkast»
 * og i sidespalten — ikke fulle kort med reaksjoner over de publiserte
 * innleggene. Hvert utkast lenker til detaljsiden, der «Publiser» og
 * «Rediger» står.
 */
function DraftList({ drafts }: { drafts: Drafts }) {
  return (
    <ul className="divide-y divide-line">
      {drafts.map((post) => (
        <li key={post.id}>
          <Link to="/beskjeder/$postId" params={{ postId: post.id }} className="wall-draft">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{post.heading}</span>
              <span className="block truncate text-xs text-ink-faint">
                {postSender(post)} · endret {shortWhen(post.updatedAt)}
              </span>
            </span>
            <BackArrow />
          </Link>
        </li>
      ))}
    </ul>
  )
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string; previous: PostSearchResult[] | null }
  | { status: 'done'; query: string; results: PostSearchResult[] }
  | { status: 'error'; query: string }

/**
 * Søket mot serveren for `q` i URL-en. Et svar som kommer etter at søket er
 * endret, kastes — ellers kunne et tregt svar på «kon» overskrive «konsert».
 * Mens et nytt søk går, står de forrige treffene (dempet) i stedet for en tom side.
 */
function useWallSearch(q: string): { state: SearchState; retry: () => void } {
  const searching = isSearchable(q)
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!searching) {
      setState({ status: 'idle' })
      return
    }
    let live = true
    setState((prev) => ({
      status: 'loading',
      query: q,
      previous: prev.status === 'done' ? prev.results : prev.status === 'loading' ? prev.previous : null,
    }))
    searchPosts({ data: { q } })
      .then((r) => live && setState({ status: 'done', query: q, results: r.results }))
      .catch(() => live && setState({ status: 'error', query: q }))
    return () => {
      live = false
    }
  }, [q, searching, attempt])

  return { state, retry: () => setAttempt((n) => n + 1) }
}

function PostsPage() {
  const data = Route.useLoaderData()
  const { vis, q = '', sortering } = Route.useSearch()
  const navigate = Route.useNavigate()
  // Det valgte filteret rulles inn i bildet (på en iPhone står «Viktig» ellers
  // utenfor kanten, og det filtrerte feedet har ingen synlig valgt tilstand).
  const chipsRef = useRef<HTMLElement>(null)
  useScrollRow(chipsRef, vis, '[aria-current="page"]')
  const [sortOpen, setSortOpen] = useState(false)

  // URL-en oppdateres når man tar en pause i skrivingen.
  const field = useSearchText(q, (text) =>
    navigate({
      search: (prev) => ({
        ...prev,
        q: text.trim() ? text : undefined,
        // Utkastene er ikke med i søket; et søk viser de publiserte.
        vis: text.trim() && prev.vis === 'utkast' ? 'alt' : prev.vis,
      }),
      replace: true,
    }),
  )

  const searching = isSearchable(q)
  const terms = searching ? searchTerms(q) : undefined
  const search = useWallSearch(q)
  const sort = effectiveSort(sortering, searching)

  const clearSearch = () => {
    field.reset()
    navigate({ search: (prev) => ({ ...prev, q: undefined, sortering: prev.sortering === 'treff' ? undefined : prev.sortering }), replace: true })
  }
  const chooseSort = (value: PostSort) => {
    // Standardvalget står ikke i URL-en.
    navigate({ search: (prev) => ({ ...prev, sortering: value === effectiveSort(undefined, searching) ? undefined : value }), replace: true })
  }

  // Samme regel som merket på kortet: et innlegg du har åpnet i denne økten er
  // lest, selv om lista ennå ikke er hentet på nytt.
  const isUnread = (post: { id: string; unread: boolean }) => post.unread && !seenThisSession(post.id)
  const unreadCount = data.posts.filter(isUnread).length

  const matchesFilter = (post: (typeof data.posts)[number]) =>
    vis === 'ulest'
      ? isUnread(post)
      : vis === 'styret'
        ? post.official
        : vis === 'arkivar'
          ? post.fromArchive
          : vis === 'viktig'
            ? post.importance === 'important'
            : true

  // Kilden: veggen, eller søketreffene (de forrige mens et nytt søk går).
  // Et svar teller bare som ferdig for søket som står i URL-en nå — før
  // første henting (og i rendringen rett etter at `q` endret seg) søker vi.
  const st = search.state
  const settled = searching && (st.status === 'done' || st.status === 'error') && st.query === q
  const loading = searching && !settled
  const failed = settled && st.status === 'error'
  const results: PostSearchResult[] | null = !searching
    ? null
    : st.status === 'done'
      ? st.results
      : st.status === 'loading'
        ? st.previous
        : null
  const hits = results ? new Map(results.map((r) => [r.id, r.hit])) : null
  const visible = sortPosts((results ?? (searching ? [] : data.posts)).filter(matchesFilter), sort)

  const sortLabel = POST_SORTS.find((s) => s.value === sort)?.label ?? 'Nyeste'
  const sortIsDefault = sort === effectiveSort(undefined, searching)

  // «Utkast» er bare et filter for dem som har utkast å se.
  const filters = FILTERS.filter((f) => f.value !== 'utkast' || data.drafts.length > 0 || vis === 'utkast')
  const filterLinks = (layout: 'row' | 'rail') =>
    filters.map((filter) => (
      <Link
        key={filter.value}
        from={Route.fullPath}
        to="/beskjeder"
        // Søket og sorteringen følger med; utkastene er ikke med i søket.
        search={(prev) => ({ ...prev, vis: filter.value, q: filter.value === 'utkast' ? undefined : prev.q })}
        aria-current={vis === filter.value ? 'page' : undefined}
        className={`${layout === 'row' ? 'wall-chip hit' : 'wall-rail-link'} ${vis === filter.value ? 'is-on' : ''} ${filter.value === 'utkast' ? 'is-draft' : ''}`}
      >
        <span>{filter.label}</span>
        {filter.value === 'ulest' && unreadCount > 0 && <span className="wall-count tabular">{unreadCount}</span>}
        {filter.value === 'utkast' && data.drafts.length > 0 && (
          <span className="wall-count tabular">{data.drafts.length}</span>
        )}
      </Link>
    ))

  const filterName = FILTERS.find((f) => f.value === vis)?.label ?? ''

  return (
    <div className="mx-auto max-w-2xl lg:max-w-[62rem]">
      <PageHeader
        className="rise"
        title="Veggen"
        action={
          <Link to="/beskjeder/ny" className={buttonClass('primary', 'sm')}>
            Skriv innlegg
          </Link>
        }
      />

      <div className="mt-3 lg:mt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start lg:gap-10">
        <div className="min-w-0">
          {/* Søket står alltid synlig; sorteringen bor bak en knapp ved siden
              av under lg, og i sidespalten fra lg. */}
          <div className="rise flex items-center gap-2" role="search">
            <SearchField
              value={field.text}
              onChange={field.setText}
              onClear={clearSearch}
              maxLength={SEARCH_MAX_LENGTH}
              placeholder="Søk i beskjeder og kommentarer"
              label="Søk i tittel, tekst, avsender og kommentarer"
            />
            {vis !== 'utkast' && (
              <SortButton label={sortLabel} isDefault={sortIsDefault} onClick={() => setSortOpen(true)} className="lg:hidden" />
            )}
          </div>

          {/* Telefon og iPad på høykant: filtrene — og utkastene, for dem som
              har noen — som én rad som kan dras sidelengs. */}
          <nav ref={chipsRef} className="wall-chips mt-2 lg:hidden" aria-label="Filtrer veggen">
            {filterLinks('row')}
          </nav>

          {searching && vis !== 'utkast' && (
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[0.85rem] text-ink-soft">
              <p role="status" aria-live="polite">
                {loading && !results
                  ? 'Søker …'
                  : failed
                    ? 'Søket feilet'
                    : `${visible.length} treff på «${q.trim()}»${vis !== 'alt' ? ` i «${filterName}»` : ''}`}
                {!sortIsDefault && !failed && results && <span className="text-ink-faint"> · {sortLabel.toLowerCase()} først</span>}
              </p>
              <button
                type="button"
                onClick={clearSearch}
                className="hit cursor-pointer text-[0.85rem] text-ink-soft underline-offset-2 hover:text-ink hover:underline"
              >
                Tøm søket
              </button>
            </div>
          )}

          <section
            className={`rise mt-3 space-y-3 transition-opacity ${loading && results ? 'opacity-60' : ''}`}
            style={{ animationDelay: '60ms' }}
            aria-label={searching ? 'Søketreff' : 'Innlegg'}
            aria-busy={loading || undefined}
          >
            {vis === 'utkast' ? (
              data.drafts.length === 0 ? (
                <EmptyState title="Ingen utkast">Utkast du lagrer, havner her til de er publisert.</EmptyState>
              ) : (
                <div className="wall-drafts">
                  <p className="px-[0.9rem] pt-3 pb-2 text-xs text-ink-faint">
                    Ikke publisert ennå — bare synlig for dem som kan publisere beskjeder.
                  </p>
                  <DraftList drafts={data.drafts} />
                </div>
              )
            ) : failed ? (
              <EmptyState title="Søket feilet" action={<Button onClick={search.retry}>Prøv igjen</Button>}>
                Sjekk nettet og prøv igjen.
              </EmptyState>
            ) : searching && !results ? null : visible.length === 0 ? (
              searching ? (
                <EmptyState
                  title={results && results.length > 0 ? `Ingen treff i «${filterName}»` : `Ingen treff på «${q.trim()}»`}
                  action={
                    results && results.length > 0 ? (
                      <Link from={Route.fullPath} to="/beskjeder" search={(prev) => ({ ...prev, vis: 'alt' })} className={buttonClass('secondary')}>
                        Søk i alle
                      </Link>
                    ) : (
                      <Button onClick={clearSearch}>Tøm søket</Button>
                    )
                  }
                >
                  {results && results.length > 0
                    ? `Søket ga ${results.length} treff, men ingen av dem er i dette filteret.`
                    : 'Søket går gjennom tittel, tekst, avsender og kommentarer i alle beskjeder du kan se. Prøv færre eller kortere ord.'}
                </EmptyState>
              ) : (
                <EmptyState
                  title={
                    vis === 'alt'
                      ? 'Ingenting på veggen ennå'
                      : vis === 'ulest'
                        ? 'Du har lest alt'
                        : 'Ingen innlegg i dette filteret'
                  }
                  action={
                    vis === 'alt' ? (
                      <Link to="/beskjeder/ny" className={buttonClass('primary')}>
                        Skriv det første
                      </Link>
                    ) : (
                      <Link from={Route.fullPath} to="/beskjeder" search={(prev) => ({ ...prev, vis: 'alt' })} className={buttonClass('secondary')}>
                        Vis alle
                      </Link>
                    )
                  }
                >
                  {vis === 'alt'
                    ? 'Beskjeder fra styret, notearkivaren og medlemmene havner her. Del en beskjed, et bilde fra konserten eller et spørsmål til resten av korpset.'
                    : vis === 'ulest'
                      ? `Ingen uleste beskjeder fra de siste ${UNREAD_WINDOW_DAYS} dagene.`
                      : 'Prøv et annet filter.'}
                </EmptyState>
              )
            ) : (
              visible.map((post) => <PostCard key={post.id} post={post} terms={terms} hit={hits?.get(post.id) ?? null} />)
            )}
          </section>
        </div>

        {/* iPad på tvers og desktop: en smal sidespalte med filtrene,
            sorteringen og utkastene, i stedet for et utstrakt telefonoppsett. */}
        <aside className="wall-rail hidden lg:block" aria-label="Veggen">
          <nav aria-label="Filtrer veggen" className="space-y-0.5">
            {filterLinks('rail')}
          </nav>
          {vis !== 'utkast' && (
            <section className="mt-7" aria-labelledby="wall-sort-heading">
              <h2 id="wall-sort-heading" className="mb-2 text-[0.85rem] font-semibold text-ink-soft">
                Sortering
              </h2>
              <div role="radiogroup" aria-labelledby="wall-sort-heading" className="space-y-0.5">
                {sortOptions(searching).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={sort === option.value}
                    onClick={() => chooseSort(option.value)}
                    className={`wall-rail-link ${sort === option.value ? 'is-on' : ''}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          {data.drafts.length > 0 && vis !== 'utkast' && (
            <section className="mt-7">
              <h2 className="mb-2 text-[0.85rem] font-semibold text-ink-soft">Utkast <span className="tabular font-normal text-ink-faint">· {data.drafts.length}</span></h2>
              <DraftList drafts={data.drafts} />
            </section>
          )}
        </aside>
      </div>

      <SortSheet
        open={sortOpen}
        onClose={() => setSortOpen(false)}
        options={sortOptions(searching)}
        value={sort}
        onChange={chooseSort}
      />
    </div>
  )
}
