import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { LikeButton } from '../../../components/PostCard'
import { toast, toastError } from '../../../components/toast'
import { Avatar, Button, EmptyState, Kicker, Modal, Stamp } from '../../../components/ui'
import { formatDateTime } from '../../../lib/format'
import { postImageUrl } from '../../../lib/post-images-client'
import { commentCountLabel, notifyResultMessage, paragraphs, tokenize } from '../../../lib/posts'
import {
  addComment,
  deleteComment,
  deletePost,
  getPost,
  publishPost,
  resendPostNotifications,
  unpublishPost,
} from '../../../server/posts'

/**
 * Hele innlegget med bilder, reaksjoner og kommentartråd. Avsnittene bevares
 * som skrevet, og URL-er blir klikkbare — teksten rendres som React-noder,
 * aldri som HTML fra brukerinnhold.
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

function CommentThread({
  postId,
  comments,
  canComment,
}: {
  postId: string
  comments: Awaited<ReturnType<typeof getPost>>['comments']
  canComment: boolean
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const submit = async () => {
    if (!body.trim()) return
    setBusy(true)
    try {
      await addComment({ data: { postId, body } })
      setBody('')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setDeleting(id)
    try {
      await deleteComment({ data: { id } })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <section className="rise" style={{ animationDelay: '160ms' }}>
      <h2 className="kicker mb-3">{commentCountLabel(comments.length)}</h2>

      <ul className="space-y-3">
        {comments.map((comment) => (
          <li key={comment.id} className="flex gap-2.5">
            <Avatar name={comment.author.name} size="sm" />
            <div className="sheet min-w-0 flex-1 px-3.5 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[0.82rem] font-semibold text-ink">{comment.author.name}</p>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[0.58rem] uppercase tracking-[0.12em] text-ink-faint">
                    {formatDateTime(comment.createdAt)}
                  </span>
                  {comment.canDelete && (
                    <button
                      type="button"
                      onClick={() => void remove(comment.id)}
                      disabled={deleting === comment.id}
                      className="cursor-pointer text-[0.62rem] text-ink-faint transition-colors hover:text-danger disabled:opacity-50"
                    >
                      Slett
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft">
                {comment.body}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {canComment && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <textarea
            className="field-input min-h-16 flex-1 resize-y text-sm"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Skriv en kommentar …"
            onKeyDown={(e) => {
              // Enter sender på desktop; skift+enter gir linjeskift. På mobil
              // gjør tastaturets enter linjeskift, og knappen under sender.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <Button
            type="button"
            variant="primary"
            loading={busy}
            disabled={!body.trim()}
            onClick={() => void submit()}
            className="w-full sm:w-auto"
          >
            Kommenter
          </Button>
        </div>
      )}
    </section>
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
      const result = await publishPost({ data: { id: post.id, sendEmail: data.canPublish && notify } })
      const { message, kind } = notifyResultMessage(result)
      setConfirmPublish(false)
      toast(data.canPublish ? message : 'Publisert på veggen', kind)
      await router.invalidate()
    })

  const unpublish = () =>
    act('unpublish', async () => {
      await unpublishPost({ data: { id: post.id } })
      toast('Innlegget er avpublisert og er nå et utkast')
      await router.invalidate()
    })

  const remove = () =>
    act('delete', async () => {
      await deletePost({ data: { id: post.id } })
      setConfirmDelete(false)
      toast('Innlegget er slettet')
      await router.navigate({ to: '/beskjeder' })
    })

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="rise">
        <Link
          to="/beskjeder"
          className="link-quiet mb-4 inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
        >
          ← Veggen
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Kicker>{isDraft ? 'Utkast' : post.official ? 'Beskjed fra styret' : 'Innlegg'}</Kicker>
          {post.official && <Stamp tone="brass">Fra styret</Stamp>}
          {post.importance === 'important' && <Stamp tone="oxblood">Viktig</Stamp>}
          {post.audience === 'board' && <Stamp>Kun styret</Stamp>}
          {isDraft && <Stamp tone="oxblood">Ikke publisert</Stamp>}
        </div>

        {post.title && (
          <h1 className="display-title mt-2 break-words text-[clamp(2rem,5vw,3.2rem)] font-semibold italic leading-[1.05] text-ink [hyphens:auto]">
            {post.title}
          </h1>
        )}

        <div className="mt-3 flex items-center gap-2.5">
          <Avatar name={post.official ? 'Tertnes Brass' : post.author.name} size="sm" />
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-ink-soft">
            {post.official ? `Styret · ${post.author.name}` : post.author.name} ·{' '}
            {isDraft ? `sist endret ${formatDateTime(post.updatedAt)}` : formatDateTime(post.publishedAt!)}
          </p>
        </div>

        <div className="staff-rule mt-6 w-full opacity-50" aria-hidden />
      </header>

      <article className="rise space-y-5" style={{ animationDelay: '80ms' }}>
        <PostBody body={post.body} />
        {post.images.length > 0 && (
          <ul className="space-y-3">
            {post.images.map((image) => (
              <li key={image.id}>
                <a href={postImageUrl(image.id)} target="_blank" rel="noopener noreferrer">
                  <img
                    src={postImageUrl(image.id)}
                    alt={image.fileName}
                    loading="lazy"
                    className="w-full rounded-[11px] border border-line"
                  />
                </a>
              </li>
            ))}
          </ul>
        )}
        {!isDraft && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <LikeButton postId={post.id} count={post.likeCount} mine={post.likedByMe} />
            <span className="text-xs text-ink-faint">{commentCountLabel(data.comments.length)}</span>
          </div>
        )}
      </article>

      {!isDraft && <CommentThread postId={post.id} comments={data.comments} canComment />}

      {post.canEdit && (
        <section className="sheet rise space-y-4 px-5 py-5" style={{ animationDelay: '200ms' }}>
          <div>
            <Kicker className="mb-1">{data.canPublish ? 'Styret' : 'Ditt innlegg'}</Kicker>
            <p className="text-sm leading-relaxed text-ink-soft">
              {isDraft ? (
                data.canPublish
                  ? 'Utkastet er kun synlig for dem som kan publisere beskjeder.'
                  : 'Innlegget er ikke publisert ennå.'
              ) : data.delivery ? (
                <>
                  E-post: {data.delivery.sent} sendt
                  {data.delivery.logged > 0 ? ` · ${data.delivery.logged} loggført lokalt` : ''}
                  {data.delivery.failed > 0 ? ` · ${data.delivery.failed} feilet` : ''}
                  {data.delivery.pending > 0 ? ` · ${data.delivery.pending} mangler` : ' · alle mottakere har fått den'}
                  .
                </>
              ) : (
                'Du kan redigere eller slette innlegget ditt.'
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isDraft ? (
              <Button variant="primary" onClick={() => setConfirmPublish(true)}>
                Publiser
              </Button>
            ) : (
              data.canPublish && (
                <Button
                  variant="primary"
                  onClick={() => void resend()}
                  loading={busy === 'resend'}
                  disabled={data.delivery?.pending === 0}
                >
                  Send e-post på nytt
                </Button>
              )
            )}
            <Link to="/beskjeder/$postId/rediger" params={{ postId: post.id }}>
              <Button>Rediger</Button>
            </Link>
            {!isDraft && data.canPublish && (
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

      <Modal open={confirmPublish} onClose={() => setConfirmPublish(false)} title="Publisere innlegget?" kicker="Veggen">
        <p className="text-sm leading-relaxed text-ink-soft">
          Innlegget blir synlig for {post.audience === 'board' ? 'styret' : 'alle medlemmer'} med det samme.
        </p>
        {data.canPublish && (
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
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setConfirmPublish(false)}>
            Avbryt
          </Button>
          <Button variant="primary" onClick={() => void publish()} loading={busy === 'publish'}>
            Publiser nå
          </Button>
        </div>
      </Modal>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette innlegget?" kicker="Veggen">
        <p className="text-sm leading-relaxed text-ink-soft">
          «{post.heading}» slettes for alle, sammen med kommentarer og bilder. E-poster som allerede er sendt, kan ikke
          trekkes tilbake.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Avbryt
          </Button>
          <Button variant="danger" onClick={() => void remove()} loading={busy === 'delete'}>
            Slett innlegget
          </Button>
        </div>
      </Modal>
    </div>
  )
}
