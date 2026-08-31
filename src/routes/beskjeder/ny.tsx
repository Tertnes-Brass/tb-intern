import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { PostForm } from '../../components/PostForm'
import { Kicker } from '../../components/ui'

/** Skriveflaten for en ny beskjed. Gaten er `posts.publish`, håndhevet i `createPost`. */
export const Route = createFileRoute('/beskjeder/ny')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    const canPublish = context.me.permissions.includes('*') || context.me.permissions.includes('posts.publish')
    if (!canPublish) throw redirect({ to: '/beskjeder' })
  },
  component: NewPostPage,
})

function NewPostPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="rise">
        <Link
          to="/beskjeder"
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← Beskjeder
        </Link>
        <Kicker className="mb-2">Ny beskjed</Kicker>
        <h1 className="display-title text-3xl font-semibold italic text-ink sm:text-4xl">Skriv beskjed</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Lagre som utkast mens du jobber. Når du publiserer, kan medlemmene få den på e-post med det samme.
        </p>
      </header>

      <section className="rise" style={{ animationDelay: '80ms' }}>
        <PostForm />
      </section>
    </div>
  )
}
