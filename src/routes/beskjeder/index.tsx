import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { PostCard, postSender } from '../../components/PostCard'
import { shortWhen } from '../../components/compose/when'
import { BackArrow, buttonClass, EmptyState, PageHeader } from '../../components/ui'
import { seenThisSession } from '../../lib/read-posts-client'
import { UNREAD_WINDOW_DAYS } from '../../lib/unread'
import { listPosts } from '../../server/posts'

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
 */

const filterSchema = z.object({
  // Validert så visningen kan lenkes til (docs/designprinsipper.md §4).
  // `utkast` viser bare utkastene (for dem som har noen; andre får en tom liste).
  vis: z.enum(['alt', 'ulest', 'utkast', 'styret', 'arkivar', 'viktig']).default('alt').catch('alt'),
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

function PostsPage() {
  const data = Route.useLoaderData()
  const { vis } = Route.useSearch()

  // Samme regel som merket på kortet: et innlegg du har åpnet i denne økten er
  // lest, selv om lista ennå ikke er hentet på nytt.
  const isUnread = (post: (typeof data.posts)[number]) => post.unread && !seenThisSession(post.id)
  const unreadCount = data.posts.filter(isUnread).length

  const visible = data.posts.filter((post) =>
    vis === 'ulest'
      ? isUnread(post)
      : vis === 'styret'
        ? post.official
        : vis === 'arkivar'
          ? post.fromArchive
          : vis === 'viktig'
            ? post.importance === 'important'
            : true,
  )

  // «Utkast» er bare et filter for dem som har utkast å se.
  const filters = FILTERS.filter((f) => f.value !== 'utkast' || data.drafts.length > 0 || vis === 'utkast')
  const filterLinks = (layout: 'row' | 'rail') =>
    filters.map((filter) => (
      <Link
        key={filter.value}
        to="/beskjeder"
        search={{ vis: filter.value }}
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
          {/* Telefon og iPad på høykant: filtrene — og utkastene, for dem som
              har noen — som én rad som kan dras sidelengs. */}
          <nav className="wall-chips lg:hidden" aria-label="Filtrer veggen">
            {filterLinks('row')}
          </nav>


          <section className="rise mt-3 space-y-3 lg:mt-0" style={{ animationDelay: '60ms' }} aria-label="Innlegg">
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
            ) : visible.length === 0 ? (
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
                    <Link to="/beskjeder" search={{ vis: 'alt' }} className={buttonClass('secondary')}>
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
            ) : (
              visible.map((post) => <PostCard key={post.id} post={post} />)
            )}
          </section>
        </div>

        {/* iPad på tvers og desktop: en smal sidespalte med filtrene og
            utkastene, i stedet for et utstrakt telefonoppsett. */}
        <aside className="wall-rail hidden lg:block" aria-label="Veggen">
          <nav aria-label="Filtrer veggen" className="space-y-0.5">
            {filterLinks('rail')}
          </nav>
          {data.drafts.length > 0 && vis !== 'utkast' && (
            <section className="mt-7">
              <h2 className="mb-2 text-[0.85rem] font-semibold text-ink-soft">Utkast <span className="tabular font-normal text-ink-faint">· {data.drafts.length}</span></h2>
              <DraftList drafts={data.drafts} />
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
