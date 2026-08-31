import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { PostCard } from '../../components/PostCard'
import { Button, EmptyState, Kicker } from '../../components/ui'
import { listPosts } from '../../server/posts'

/**
 * Beskjeder (#28) — veggen.
 *
 * Primærbruker er medlemmet, og primærhandlingen er å se hva som er nytt:
 * innleggene ligger nyeste først, uten søk eller filtre å komme forbi. Alle
 * innloggede kan skrive; `posts.publish` gir «Fra styret», «Viktig», styre-
 * målgruppen, e-post og utkast. Filtreringen skjer i `listPosts`, ikke her.
 */

const filterSchema = z.object({
  // Validert så visningen kan lenkes til (docs/designprinsipper.md §4).
  vis: z.enum(['alt', 'styret', 'viktig']).default('alt').catch('alt'),
})

type Filter = z.infer<typeof filterSchema>['vis']

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'alt', label: 'Alt' },
  { value: 'styret', label: 'Fra styret' },
  { value: 'viktig', label: 'Viktig' },
]

export const Route = createFileRoute('/beskjeder/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  validateSearch: filterSchema,
  loader: () => listPosts(),
  component: PostsPage,
})

function PostsPage() {
  const data = Route.useLoaderData()
  const { vis } = Route.useSearch()

  const visible = data.posts.filter((post) =>
    vis === 'styret' ? post.official : vis === 'viktig' ? post.importance === 'important' : true,
  )

  return (
    <div className="space-y-8">
      <header className="rise">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Kicker className="mb-2">Beskjeder</Kicker>
            <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Veggen</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
              Beskjeder fra styret og alt annet korpset deler med hverandre. Alle kan skrive her — styret merker sine
              med «Fra styret», og de sendes også på e-post.
            </p>
          </div>
          <Link to="/beskjeder/ny">
            <Button variant="primary">Skriv innlegg</Button>
          </Link>
        </div>

        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Filtrer veggen">
          {FILTERS.map((filter) => (
            <Link
              key={filter.value}
              to="/beskjeder"
              search={{ vis: filter.value }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                vis === filter.value
                  ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
                  : 'border-line text-ink-soft hover:border-brass hover:text-brass-strong'
              }`}
            >
              {filter.label}
            </Link>
          ))}
        </nav>
      </header>

      {data.drafts.length > 0 && vis === 'alt' && (
        <section className="rise space-y-3" style={{ animationDelay: '60ms' }}>
          <h2 className="kicker">Ikke publisert ennå</h2>
          {data.drafts.map((post) => (
            <PostCard key={post.id} post={post} draft />
          ))}
        </section>
      )}

      <section className="rise space-y-3" style={{ animationDelay: '120ms' }}>
        {visible.length === 0 ? (
          <EmptyState
            title={vis === 'alt' ? 'Ingenting på veggen ennå' : 'Ingen innlegg i dette filteret'}
            action={
              vis === 'alt' ? (
                <Link to="/beskjeder/ny">
                  <Button variant="primary">Skriv det første</Button>
                </Link>
              ) : (
                <Link to="/beskjeder" search={{ vis: 'alt' }}>
                  <Button>Vis alt</Button>
                </Link>
              )
            }
          >
            {vis === 'alt'
              ? 'Del en beskjed, et bilde fra konserten eller et spørsmål til resten av korpset.'
              : 'Prøv et annet filter.'}
          </EmptyState>
        ) : (
          visible.map((post) => <PostCard key={post.id} post={post} />)
        )}
      </section>
    </div>
  )
}
