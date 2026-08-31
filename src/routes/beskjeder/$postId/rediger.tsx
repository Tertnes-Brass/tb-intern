import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { PostForm } from '../../../components/PostForm'
import { EmptyState, Kicker, Stamp } from '../../../components/ui'
import { getPost } from '../../../server/posts'

/**
 * Redigering — samme skjema som `/beskjeder/ny`. Eieren kan endre sitt eget
 * innlegg, `posts.publish` kan i tillegg moderere andres. `getPost` avviser
 * innlegg du ikke får se, og `updatePost` avviser dem du ikke får endre.
 */
export const Route = createFileRoute('/beskjeder/$postId/rediger')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: ({ params }) => getPost({ data: { id: params.postId } }),
  errorComponent: ({ error }) => <EmptyState title="Kunne ikke åpne beskjeden">{error.message}</EmptyState>,
  component: EditPostPage,
})

function EditPostPage() {
  const { post, canPublish } = Route.useLoaderData()
  const isDraft = post.publishedAt === null

  if (!post.canEdit) {
    return <EmptyState title="Du kan bare endre dine egne innlegg">Gå tilbake til veggen for å lese det.</EmptyState>
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="rise">
        <Link
          to="/beskjeder/$postId"
          params={{ postId: post.id }}
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← Tilbake til innlegget
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Kicker>Rediger</Kicker>
          {isDraft ? <Stamp tone="oxblood">Utkast</Stamp> : <Stamp tone="brass">Publisert</Stamp>}
        </div>
        <h1 className="display-title mt-2 text-3xl font-semibold italic text-ink sm:text-4xl">{post.heading}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {isDraft
            ? 'Utkastet er ikke synlig for medlemmene ennå.'
            : 'Innlegget er publisert. Endringer vises med det samme; e-post går kun til dem som ikke allerede har fått den.'}
        </p>
      </header>

      <section className="rise" style={{ animationDelay: '80ms' }}>
        <PostForm post={post} canPublish={canPublish} />
      </section>
    </div>
  )
}
