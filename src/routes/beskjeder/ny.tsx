import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { EMPTY_CALLOUT } from '../../components/CalloutFields'
import { PostForm } from '../../components/PostForm'
import { canCreateCallout } from '../../lib/callouts'
import { draftKey } from '../../lib/drafts'

/**
 * Skriveflaten for et nytt innlegg. Alle innloggede kan skrive på veggen;
 * `posts.publish` utvider skjemaet med målgruppe, viktighet, «Fra styret»,
 * e-post og utkast. Håndhevelsen ligger i `createPost`/`publishPost`.
 */
export const Route = createFileRoute('/beskjeder/ny')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  // «Spør korpset» fra veggen eller et spilleoppdrag: feltene står klare.
  validateSearch: z.object({
    kan: z.enum(['dugnad', 'spilleoppdrag']).optional().catch(undefined),
    prosjekt: z.string().max(100).optional().catch(undefined),
  }),
  component: NewPostPage,
})

function NewPostPage() {
  const me = Route.useRouteContext().me
  const { kan, prosjekt } = Route.useSearch()
  const canPublish = !!me && (me.permissions.includes('*') || me.permissions.includes('posts.publish'))
  const canArchive = !!me && (me.permissions.includes('*') || me.permissions.includes('posts.archive'))

  // Skriveflaten eier hele siden: «Avbryt · Nytt innlegg · Publiser» øverst,
  // teksten rett under (src/components/compose/Composer.tsx).
  // Utkastet på enheten har brukerens id i nøkkelen (src/lib/drafts.ts).
  const preset = kan && me && canCreateCallout(me.permissions, kan)
    ? { ...EMPTY_CALLOUT, kind: kan, projectId: kan === 'spilleoppdrag' ? (prosjekt ?? '') : '' }
    : null
  const key = me ? draftKey(me.id, { kind: 'new-post' }) : undefined
  return (
    <PostForm
      // Eget utkast for «Kan du?», så det ikke blander seg med et påbegynt innlegg.
      key={preset ? `${preset.kind}:${preset.projectId}` : 'plain'}
      canPublish={canPublish}
      canArchive={canArchive}
      draftKey={key && preset ? `${key}:kan:${preset.kind}:${preset.projectId}` : key}
      permissions={me?.permissions ?? []}
      presetCallout={preset}
    />
  )
}
