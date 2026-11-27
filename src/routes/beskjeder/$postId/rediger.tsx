import { createFileRoute, redirect } from '@tanstack/react-router'
import { PostForm } from '../../../components/PostForm'
import { draftKey } from '../../../lib/drafts'
import { EmptyState } from '../../../components/ui'
import { getPost } from '../../../server/posts'
import { calloutWhen } from '../../../components/Callout'

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
  const { post, callout, canPublish, canArchive, attachments } = Route.useLoaderData()
  const me = Route.useRouteContext().me

  if (!post.canEdit) {
    return <EmptyState title="Du kan bare endre dine egne innlegg">Gå tilbake til veggen for å lese det.</EmptyState>
  }

  // Samme skriveflate som et nytt innlegg; «Avbryt» går tilbake til innlegget.
  return (
    <PostForm
      post={{
        ...post,
        attachments,
        callout: callout && {
          kind: callout.kind,
          projectId: callout.projectId ?? '',
          eventDate: callout.eventDate ?? '',
          startTime: callout.startTime ?? '',
          location: callout.location ?? '',
          respondBy: callout.respondBy ?? '',
          needed: callout.needed === null ? '' : String(callout.needed),
        },
        calloutLocked: !!callout?.manage && callout.manage.yes.length + callout.manage.maybe.length + callout.manage.no.length > 0,
        calloutLinked: callout?.kind === 'spilleoppdrag' && callout.projectId
          ? { name: 'Spilleoppdrag', when: [calloutWhen(callout), callout.location].filter(Boolean).join(' · ') }
          : null,
      }}
      permissions={me?.permissions ?? []}
      canPublish={canPublish}
      canArchive={canArchive}
      draftKey={me ? draftKey(me.id, { kind: 'edit-post', postId: post.id }) : undefined}
    />
  )
}
