import { createFileRoute, redirect } from '@tanstack/react-router'
import { PostForm } from '../../../components/PostForm'
import { EmptyState } from '../../../components/ui'
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
  const { post, canPublish, canArchive, attachments } = Route.useLoaderData()

  if (!post.canEdit) {
    return <EmptyState title="Du kan bare endre dine egne innlegg">Gå tilbake til veggen for å lese det.</EmptyState>
  }

  // Samme skriveflate som et nytt innlegg; «Avbryt» går tilbake til innlegget.
  return <PostForm post={{ ...post, attachments }} canPublish={canPublish} canArchive={canArchive} />
}
