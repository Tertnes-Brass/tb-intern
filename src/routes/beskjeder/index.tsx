import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Button, EmptyState, Kicker, Stamp } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { listPosts } from '../../server/posts'

/**
 * Beskjeder (#28) — feeden.
 *
 * Primærbruker er medlemmet, og primærhandlingen er å lese siste beskjed: den
 * ligger øverst, uten filtre eller søk å komme forbi. Skrivere (`posts.publish`)
 * får i tillegg «Skriv beskjed» og utkastene sine. Selve filtreringen av
 * styre-beskjeder og utkast skjer i `listPosts`, ikke her.
 */
export const Route = createFileRoute('/beskjeder/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: () => listPosts(),
  component: PostsPage,
})

type Data = Awaited<ReturnType<typeof listPosts>>
type Item = Data['posts'][number]

function PostRow({ post, draft }: { post: Item; draft?: boolean }) {
  return (
    <li className="hairline-row">
      <Link to="/beskjeder/$postId" params={{ postId: post.id }} className="link-quiet block py-4">
        <span className="flex flex-wrap items-center gap-2">
          {draft && <Stamp tone="oxblood">Utkast</Stamp>}
          {post.importance === 'important' && <Stamp tone="oxblood">Viktig</Stamp>}
          {post.audience === 'board' && <Stamp tone="brass">Styret</Stamp>}
        </span>
        <span className="display-title mt-1.5 block text-[1.15rem] font-semibold leading-snug text-ink sm:text-[1.3rem]">
          {post.title}
        </span>
        <span className="mt-1 block font-mono text-[0.64rem] uppercase tracking-[0.14em] text-ink-faint">
          {draft ? `Sist endret ${formatDateTime(post.updatedAt)}` : formatDateTime(post.publishedAt ?? post.createdAt)}
          {' · '}
          {post.authorName}
        </span>
        <span className="mt-2 block max-w-2xl text-sm leading-relaxed text-ink-soft">{post.excerpt}</span>
      </Link>
    </li>
  )
}

function PostsPage() {
  const data = Route.useLoaderData()

  return (
    <div className="space-y-10">
      <header className="rise">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Kicker className="mb-2">Fra styret</Kicker>
            <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Beskjeder</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
              Informasjon til korpset, samlet ett sted. Du får dem også på e-post — velg selv hvor mye under «Min
              profil».
            </p>
          </div>
          {data.canPublish && (
            <Link to="/beskjeder/ny">
              <Button variant="primary">Skriv beskjed</Button>
            </Link>
          )}
        </div>
        <div className="staff-rule mt-7 w-full opacity-50" aria-hidden />
      </header>

      {data.drafts.length > 0 && (
        <section className="rise" style={{ animationDelay: '60ms' }}>
          <h2 className="kicker mb-1">Utkast · kun synlig for styret</h2>
          <ul>
            {data.drafts.map((post) => (
              <PostRow key={post.id} post={post} draft />
            ))}
          </ul>
        </section>
      )}

      <section className="rise" style={{ animationDelay: '120ms' }}>
        {data.posts.length === 0 ? (
          <EmptyState
            title="Ingen beskjeder ennå"
            action={
              data.canPublish ? (
                <Link to="/beskjeder/ny">
                  <Button variant="primary">Skriv den første</Button>
                </Link>
              ) : undefined
            }
          >
            Når styret har noe å si, står det her — og kommer på e-post.
          </EmptyState>
        ) : (
          <ul>
            {data.posts.map((post) => (
              <PostRow key={post.id} post={post} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
