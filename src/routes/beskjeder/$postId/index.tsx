import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast, toastError } from '../../../components/toast'
import { Button, EmptyState, Kicker, Modal, Stamp } from '../../../components/ui'
import { formatDateTime } from '../../../lib/format'
import { notifyResultMessage, paragraphs, tokenize } from '../../../lib/posts'
import { deletePost, getPost, publishPost, resendPostNotifications, unpublishPost } from '../../../server/posts'

/**
 * Hele beskjeden. Avsnittene bevares som skrevet, og URL-er blir klikkbare —
 * teksten rendres som React-noder, aldri som HTML fra brukerinnhold.
 */
export const Route = createFileRoute('/beskjeder/$postId/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: ({ params }) => getPost({ data: { id: params.postId } }),
  errorComponent: ({ error }) => <EmptyState title="Kunne ikke åpne beskjeden">{error.message}</EmptyState>,
  component: PostPage,
})

/** Ren tekst med avsnitt, enkle linjeskift og auto-lenkede URL-er. */
function PostBody({ body }: { body: string }) {
  return (
    <div className="max-w-2xl space-y-4 text-[0.98rem] leading-relaxed text-ink-soft">
      {paragraphs(body).map((paragraph, pi) => (
        <p key={pi}>
          {paragraph.split('\n').map((line, li) => (
            <span key={li}>
              {li > 0 && <br />}
              {tokenize(line).map((token, ti) =>
                token.kind === 'link' ? (
                  <a
                    key={ti}
                    href={token.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link-brass break-words"
                  >
                    {token.value}
                  </a>
                ) : (
                  <span key={ti}>{token.value}</span>
                ),
              )}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
}

function PostPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const post = data.post
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState<'resend' | 'publish' | 'unpublish' | 'delete' | null>(null)
  const isDraft = post.publishedAt === null

  const act = async (kind: 'resend' | 'publish' | 'unpublish' | 'delete', fn: () => Promise<unknown>) => {
    setBusy(kind)
    try {
      await fn()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const resend = () =>
    act('resend', async () => {
      const result = await resendPostNotifications({ data: { id: post.id } })
      const { message, kind } = notifyResultMessage(result)
      toast(message.replace(/^Publisert\. /, ''), kind)
      await router.invalidate()
    })

  const publish = () =>
    act('publish', async () => {
      const result = await publishPost({ data: { id: post.id, sendEmail: notify } })
      const { message, kind } = notifyResultMessage(result)
      setConfirmPublish(false)
      toast(message, kind)
      await router.invalidate()
    })

  const unpublish = () =>
    act('unpublish', async () => {
      await unpublishPost({ data: { id: post.id } })
      toast('Beskjeden er avpublisert og er nå et utkast')
      await router.invalidate()
    })

  const remove = () =>
    act('delete', async () => {
      await deletePost({ data: { id: post.id } })
      setConfirmDelete(false)
      toast('Beskjeden er slettet')
      await router.navigate({ to: '/beskjeder' })
    })

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="rise">
        <Link
          to="/beskjeder"
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← Beskjeder
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Kicker>{isDraft ? 'Utkast' : 'Beskjed'}</Kicker>
          {post.importance === 'important' && <Stamp tone="oxblood">Viktig</Stamp>}
          {post.audience === 'board' && <Stamp tone="brass">Styret</Stamp>}
          {isDraft && <Stamp tone="oxblood">Ikke publisert</Stamp>}
        </div>

        <h1 className="display-title mt-2 break-words text-[clamp(2rem,5vw,3.2rem)] font-semibold italic leading-[1.05] text-ink [hyphens:auto]">
          {post.title}
        </h1>
        <p className="mt-3 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-ink-soft">
          {post.authorName} ·{' '}
          {isDraft ? `sist endret ${formatDateTime(post.updatedAt)}` : formatDateTime(post.publishedAt!)}
        </p>

        <div className="staff-rule mt-6 w-full opacity-50" aria-hidden />
      </header>

      <article className="rise" style={{ animationDelay: '80ms' }}>
        <PostBody body={post.body} />
      </article>

      {data.canPublish && (
        <section className="sheet rise space-y-4 px-5 py-5" style={{ animationDelay: '140ms' }}>
          <div>
            <Kicker className="mb-1">Styret</Kicker>
            <p className="text-sm leading-relaxed text-ink-soft">
              {isDraft ? (
                'Utkastet er kun synlig for dem som kan publisere beskjeder.'
              ) : data.delivery ? (
                <>
                  E-post: {data.delivery.sent} sendt
                  {data.delivery.logged > 0 ? ` · ${data.delivery.logged} loggført lokalt` : ''}
                  {data.delivery.failed > 0 ? ` · ${data.delivery.failed} feilet` : ''}
                  {data.delivery.pending > 0
                    ? ` · ${data.delivery.pending} mangler`
                    : ' · alle mottakere har fått den'}
                  .
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isDraft ? (
              <Button variant="primary" onClick={() => setConfirmPublish(true)}>
                Publiser
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => void resend()}
                loading={busy === 'resend'}
                disabled={data.delivery?.pending === 0}
              >
                Send e-post på nytt
              </Button>
            )}
            <Link to="/beskjeder/$postId/rediger" params={{ postId: post.id }}>
              <Button>Rediger</Button>
            </Link>
            {!isDraft && (
              <Button onClick={() => void unpublish()} loading={busy === 'unpublish'}>
                Avpubliser
              </Button>
            )}
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Slett
            </Button>
          </div>
          {!isDraft && data.delivery && data.delivery.pending === 0 && (
            <p className="text-xs text-ink-faint">
              «Send e-post på nytt» går bare til dem som mangler varselet — ingen får den samme beskjeden to ganger.
            </p>
          )}
        </section>
      )}

      <Modal open={confirmPublish} onClose={() => setConfirmPublish(false)} title="Publisere beskjeden?" kicker="Beskjeder">
        <p className="text-sm leading-relaxed text-ink-soft">
          «{post.title}» blir synlig for {post.audience === 'board' ? 'styret' : 'alle medlemmer'} med det samme.
        </p>
        <label className="mt-4 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brass)]"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium text-ink">Send e-post til medlemmene</span>
            <span className="mt-0.5 block text-xs leading-snug text-ink-soft">
              Følger varslingsvalget til hver enkelt. Ingen får den samme beskjeden to ganger.
            </span>
          </span>
        </label>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setConfirmPublish(false)}>
            Avbryt
          </Button>
          <Button variant="primary" onClick={() => void publish()} loading={busy === 'publish'}>
            Publiser nå
          </Button>
        </div>
      </Modal>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette beskjeden?" kicker="Beskjeder">
        <p className="text-sm leading-relaxed text-ink-soft">
          «{post.title}» slettes for alle. E-poster som allerede er sendt, kan ikke trekkes tilbake.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Avbryt
          </Button>
          <Button variant="danger" onClick={() => void remove()} loading={busy === 'delete'}>
            Slett beskjeden
          </Button>
        </div>
      </Modal>
    </div>
  )
}
