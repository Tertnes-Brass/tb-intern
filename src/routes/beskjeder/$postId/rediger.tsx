import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { PostForm } from '../../../components/PostForm'
import { EmptyState, Kicker, Stamp } from '../../../components/ui'
import { getPost } from '../../../server/posts'

/** Redigering av en beskjed — samme skjema som `/beskjeder/ny`, gatet på `posts.publish`. */
export const Route = createFileRoute('/beskjeder/$postId/rediger')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    const canPublish = context.me.permissions.includes('*') || context.me.permissions.includes('posts.publish')
    if (!canPublish) throw redirect({ to: '/beskjeder' })
  },
  loader: ({ params }) => getPost({ data: { id: params.postId } }),
  errorComponent: ({ error }) => <EmptyState title="Kunne ikke åpne beskjeden">{error.message}</EmptyState>,
  component: EditPostPage,
})

function EditPostPage() {
  const { post } = Route.useLoaderData()
  const isDraft = post.publishedAt === null

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="rise">
        <Link
          to="/beskjeder/$postId"
          params={{ postId: post.id }}
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← Tilbake til beskjeden
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Kicker>Rediger</Kicker>
          {isDraft ? <Stamp tone="oxblood">Utkast</Stamp> : <Stamp tone="brass">Publisert</Stamp>}
        </div>
        <h1 className="display-title mt-2 text-3xl font-semibold italic text-ink sm:text-4xl">{post.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {isDraft
            ? 'Utkastet er ikke synlig for medlemmene ennå.'
            : 'Beskjeden er publisert. Endringer vises med det samme; e-post går kun til dem som ikke allerede har fått den.'}
        </p>
      </header>

      <section className="rise" style={{ animationDelay: '80ms' }}>
        <PostForm post={post} />
      </section>
    </div>
  )
}
