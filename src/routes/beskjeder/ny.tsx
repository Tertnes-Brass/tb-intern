import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { PostForm } from '../../components/PostForm'
import { Kicker } from '../../components/ui'

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

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="rise">
        <Link
          to="/beskjeder"
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← Veggen
        </Link>
        <Kicker className="mb-2">Nytt innlegg</Kicker>
        <h1 className="display-title text-3xl font-semibold italic text-ink sm:text-4xl">Skriv innlegg</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {canPublish
            ? 'Lagre som utkast mens du jobber. Når du publiserer, kan medlemmene få beskjeden på e-post med det samme.'
            : 'Del en beskjed, et bilde eller et spørsmål med resten av korpset. Innlegget blir synlig for alle innloggede.'}
        </p>
      </header>

      <section className="rise" style={{ animationDelay: '80ms' }}>
        <PostForm canPublish={canPublish} />
      </section>
    </div>
  )
}
