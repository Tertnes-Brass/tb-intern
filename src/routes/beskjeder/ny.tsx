import { createFileRoute, redirect } from '@tanstack/react-router'
import { PostForm } from '../../components/PostForm'

/**
 * Skriveflaten for et nytt innlegg. Alle innloggede kan skrive på veggen;
 * `posts.publish` utvider skjemaet med målgruppe, viktighet, «Fra styret»,
 * e-post og utkast. Håndhevelsen ligger i `createPost`/`publishPost`.
 */
export const Route = createFileRoute('/beskjeder/ny')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  component: NewPostPage,
})

function NewPostPage() {
  const me = Route.useRouteContext().me
  const canPublish = !!me && (me.permissions.includes('*') || me.permissions.includes('posts.publish'))
  const canArchive = !!me && (me.permissions.includes('*') || me.permissions.includes('posts.archive'))

  // Skriveflaten eier hele siden: «Avbryt · Nytt innlegg · Publiser» øverst,
  // teksten rett under (src/components/compose/Composer.tsx).
  return <PostForm canPublish={canPublish} canArchive={canArchive} />
}
