import { formatBytes } from '../../../lib/format'
import { postAttachmentUrl } from '../../../lib/post-attachments'
import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { ActionMenu, type ActionMenuItem } from '../../../components/ActionMenu'
import { CommentComposer } from '../../../components/CommentComposer'
import { MessageMediaGallery } from '../../../components/MessageMedia'
import { ReactionBar } from '../../../components/Reactions'
import { Dock } from '../../../components/compose/Dock'
import { draftKey } from '../../../lib/drafts'
import { Icon } from '../../../components/Icons'
import { useThreadMark } from '../../../components/useThreadMark'
import { buildThreads, foldChildren, replyContext } from '../../../lib/threads'
import { SenderMark, postSender } from '../../../components/PostCard'
import { Glyph } from '../../../components/compose/Composer'
import { shortWhen } from '../../../components/compose/when'
import { rememberPostRead } from '../../../lib/read-posts-client'
import { toast, toastError } from '../../../components/toast'
import { Avatar, BackArrow, Button, buttonClass, EmptyState, Modal, Stamp } from '../../../components/ui'
import { formatDateTime } from '../../../lib/format'
import { markdownToHtml } from '../../../lib/markdown'
import { type MentionUser, UNKNOWN_MENTION, postLineTokens, renderCommentHtml } from '../../../lib/mentions'
import { postImageUrl } from '../../../lib/post-images-client'
import { refreshShellCounts } from '../../../lib/shell-events'
import {
  DEFAULT_NOTIFY,
  commentCountLabel,
  notifyLabel,
  notifyResultMessage,
  type PostFormat,
  paragraphs,
} from '../../../lib/posts'
import {
  addComment,
  deleteComment,
  deletePost,
  getPost,
  markPostRead,
  publishPost,
  resendPostNotifications,
  unpublishPost,
} from '../../../server/posts'

/**
 * Hele innlegget med bilder, reaksjoner og kommentartråd.
 *
 * Leseflaten først: tittel, avsenderlinje og tekst. Det forfatteren og styret
 * kan gjøre med innlegget (rediger, publiser/send e-post, avpubliser, slett)
 * bor i den felles `ActionMenu` bak «Administrer» — samme meny som på
 * prosjekter og i styret — med Rediger først og Slett nederst. E-post sendes
 * aldri rett fra menyen: «Send e-post» / «Send til de N som mangler» åpner en
 * bekreftelse med antall mottakere, for en utsending kan ikke angres. Et
 * utkast har i tillegg «Rediger · Publiser» rett over teksten. Kommentarfeltet
 * ligger fast nederst på berøringsskjerm (`Dock`), og en kommentar slettes
 * først etter en bekreftelse.
 *
 * Ren tekst (`plain_text`, alt som fantes før #79) rendres som React-noder:
 * avsnittene bevares som skrevet og URL-er blir klikkbare, men ingenting blir
 * noen gang HTML fra brukerinnhold. Markdown går gjennom `markdownToHtml`, som
 * bygger utdata av en allowlist — rå HTML og farlige lenker kommer aldri ut.
 */
export const Route = createFileRoute('/beskjeder/$postId/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: ({ params }) => getPost({ data: { id: params.postId } }),
  errorComponent: ({ error }) => <EmptyState title="Kunne ikke åpne beskjeden">{error.message}</EmptyState>,
  component: PostPage,
})

/**
 * Innleggets tekst, i det formatet forfatteren valgte. `mentions` er dagens navn
 * på de omtalte, slått opp server-side — begge formatene gjør markøren om til
 * den samme chip-en som i kommentarer.
 */
function PostBody({ body, format, mentions }: { body: string; format: PostFormat; mentions: MentionUser[] }) {
  const html = useMemo(
    () => (format === 'markdown' ? markdownToHtml(body, { mentions }) : ''),
    [body, format, mentions],
  )
  if (format === 'markdown') {
    return (
      // Sanitert i src/lib/markdown.ts: utdata inneholder kun taggene rendreren
      // selv skriver, og alt brukerinnhold er escapet på vei ut.
      <div className="prose max-w-2xl" dangerouslySetInnerHTML={{ __html: html }} />
    )
  }
  return (
    <div className="max-w-2xl space-y-4 text-[0.98rem] leading-relaxed text-ink-soft">
      {paragraphs(body).map((paragraph, pi) => (
        <p key={pi}>
          {paragraph.split('\n').map((line, li) => (
            <span key={li}>
              {li > 0 && <br />}
              {postLineTokens(line, mentions).map((token, ti) =>
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
                ) : token.kind === 'mention' ? (
                  // Samme chip som i kommentarene; en slettet bruker blir
                  // «Ukjent medlem», aldri rå markørtekst.
                  <span key={ti} className={token.name === null ? 'mention mention-unknown' : 'mention'}>
                    {token.name === null ? UNKNOWN_MENTION : `@${token.name}`}
                  </span>
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

type Comment = Awaited<ReturnType<typeof getPost>>['comments'][number]
/** Svaret man er i ferd med å skrive: hva det svarer på, og roten det havner under. */
type CommentReplyTarget = { id: string; rootId: string; name: string }

const commentDomId = (id: string) => `kommentar-${id}`
const commentRef = (c: Comment) => ({ id: c.id, parentId: c.parentId, replyToId: c.replyToId, createdAt: c.createdAt })

/** Kommentaren `#kommentar-<id>` i adressen peker på (fra et varsel eller en e-post). */
function hashCommentId(): string | null {
  if (typeof window === 'undefined') return null
  const match = /^#kommentar-([\w-]{1,100})$/.exec(window.location.hash)
  return match ? match[1] : null
}

/**
 * Kommentarene med svar på svar (`src/lib/threads.ts`): toppkommentarene
 * kronologisk, svarene innrykket under dem. «Svar» åpner feltet nederst i
 * tråden det havner i, ikke nederst på siden.
 */
function CommentThread({
  postId,
  comments,
  canComment,
  userId,
}: {
  postId: string
  comments: Comment[]
  canComment: boolean
  /** Utkastene på enheten har brukerens id i nøkkelen. */
  userId: string | null
}) {
  const router = useRouter()
  const [deleting, setDeleting] = useState<string | null>(null)
  /** Kommentaren som venter på «Slette kommentaren?». */
  const [confirmDelete, setConfirmDelete] = useState<Comment | null>(null)
  const [replying, setReplying] = useState<CommentReplyTarget | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const { markedId, markElement } = useThreadMark()
  const threads = useMemo(() => buildThreads(comments, commentRef), [comments])
  const count = comments.filter((c) => !c.deleted).length

  // Lenket rett til en kommentar: rull dit én gang når siden vises.
  useEffect(() => {
    const id = hashCommentId()
    if (!id) return
    setFocusId(id)
    markElement(commentDomId(id))
  }, [markElement])

  const expand = (rootId: string) => setExpanded((prev) => new Set(prev).add(rootId))

  const submit = async (body: string, mediaIds: string[], target: CommentReplyTarget | null) => {
    try {
      const result = await addComment({ data: { postId, body, replyToId: target?.id ?? null, mediaIds } })
      await router.invalidate()
      if (target) {
        setReplying(null)
        expand(target.rootId)
        markElement(commentDomId(result.id))
      }
    } catch (err) {
      toastError(err)
      // Videre til skrivefeltet, som beholder teksten så den ikke går tapt.
      throw err
    }
  }

  const remove = async (id: string) => {
    setDeleting(id)
    try {
      await deleteComment({ data: { id } })
      setConfirmDelete(null)
      if (replying?.id === id) setReplying(null)
      await router.invalidate()
      toast('Kommentaren er slettet')
    } catch (err) {
      toastError(err)
    } finally {
      setDeleting(null)
    }
  }

  const item = (comment: Comment, rootId: string, siblings: Comment[] | null) => {
    const domId = commentDomId(comment.id)
    const marked = markedId === domId
    if (comment.deleted) {
      return (
        <li key={comment.id} id={domId} className={`thread-item flex gap-2.5 ${marked ? 'thread-marked' : ''}`}>
          <span className="h-8 w-8 shrink-0 rounded-full border border-dashed border-line" aria-hidden />
          <p className="flex-1 px-1 py-2 text-sm italic text-ink-faint">Kommentaren er slettet.</p>
        </li>
      )
    }
    const ctx = siblings ? replyContext(comment, siblings, commentRef) : null
    return (
      <li key={comment.id} id={domId} className={`thread-item flex gap-2.5 ${marked ? 'thread-marked' : ''}`}>
        <Avatar name={comment.author.name} size="sm" />
        <div className="sheet min-w-0 flex-1 px-3.5 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-[0.85rem] font-semibold text-ink">{comment.author.name}</p>
            <div className="flex shrink-0 items-center gap-2">
              <time className="text-xs text-ink-faint" title={formatDateTime(comment.createdAt)}>
                {shortWhen(comment.createdAt)}
              </time>
              {comment.canDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(comment)}
                  disabled={deleting === comment.id}
                  className="hit cursor-pointer text-xs text-ink-faint transition-colors hover:text-danger disabled:opacity-50"
                >
                  Slett
                </button>
              )}
            </div>
          </div>
          {ctx?.kind === 'sibling' && (
            <button
              type="button"
              title="Vis kommentaren"
              onClick={() => markElement(commentDomId(ctx.target.id))}
              className="mt-0.5 inline-flex max-w-full cursor-pointer items-center gap-1 text-xs text-ink-faint transition-colors hover:text-ink"
            >
              <Icon name="reply" size={12} />
              <span className="truncate">
                {ctx.target.deleted ? (
                  'Svar på en slettet kommentar'
                ) : (
                  <>
                    Svar til <strong className="font-semibold">{ctx.target.author.name}</strong>
                  </>
                )}
              </span>
            </button>
          )}
          {ctx?.kind === 'gone' && <p className="mt-0.5 text-xs italic text-ink-faint">Svar på en slettet kommentar</p>}
          {/* Omtaler blir chips og nettadresser blir lenker; brukerinnhold escapes av `renderCommentHtml`
              (allowlist ved konstruksjon, som i markdown.ts). Linjeskift
              beholdes av `whitespace-pre-wrap`, akkurat som før. */}
          {comment.body && (
            <p
              className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft"
              dangerouslySetInnerHTML={{ __html: renderCommentHtml(comment.body, comment.mentions) }}
            />
          )}
          <MessageMediaGallery items={comment.media} className="mt-2" />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {canComment && (
              <button
                type="button"
                aria-label={`Svar ${comment.author.name}`}
                onClick={() => setReplying({ id: comment.id, rootId, name: comment.author.name })}
                className="hit inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-ink-soft transition-colors hover:text-ink"
              >
                <Icon name="reply" size={13} />
                Svar
              </button>
            )}
            <ReactionBar kind="post_comment" targetId={comment.id} reactions={comment.reactions} canReact={canComment} />
          </div>
        </div>
      </li>
    )
  }

  return (
    <>
    <section className="rise" style={{ animationDelay: '160ms' }} aria-label="Kommentarer">
      <h2 className="mb-3 text-[0.95rem] font-semibold text-ink">{commentCountLabel(count)}</h2>

      <ul className="space-y-3">
        {threads.map((root) => {
          const composerHere = canComment && replying?.rootId === root.id
          const fold = expanded.has(root.id)
            ? { hidden: 0, visible: root.children }
            : foldChildren(root.children, {
                mustShow: (c) => c.id === focusId || c.id === replying?.id || commentDomId(c.id) === markedId,
              })
          return (
            <li key={root.id}>
              <ul>{item(root, root.id, null)}</ul>
              {(root.children.length > 0 || composerHere) && (
                <div className="mt-2 ml-4 space-y-2 border-l-2 border-line pl-3 sm:ml-10 sm:pl-4">
                  {fold.hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => expand(root.id)}
                      className="hit cursor-pointer text-[0.78rem] font-medium text-brass-strong hover:underline"
                    >
                      Vis {fold.hidden === 1 ? 'ett tidligere svar' : `${fold.hidden} tidligere svar`}
                    </button>
                  )}
                  <ul className="space-y-2">{fold.visible.map((child) => item(child, root.id, root.children))}</ul>
                  {composerHere && replying && (
                    <CommentComposer
                      // Ny nøkkel per mål: et påbegynt svar til én person skal ikke stå igjen hos en annen.
                      key={replying.id}
                      postId={postId}
                      draftKey={userId ? draftKey(userId, { kind: 'comment', postId, replyToId: replying.id }) : undefined}
                      replyTo={{ name: replying.name }}
                      onCancel={() => setReplying(null)}
                      onSubmit={(body, mediaIds) => submit(body, mediaIds, replying)}
                    />
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

    </section>
    {/* Nytt kommentarfelt: på berøringsskjerm ligger det fast nederst, over
        fanelinjen (`Dock`, `.comment-dock` i styles.css) — det er alltid innen
        rekkevidde, uansett hvor langt ned i innlegget man er. Skjules mens man
        svarer i en tråd, så det ikke står to skrivefelt på skjermen. */}
    {canComment && !replying && (
      <Dock>
        <CommentComposer
          variant="dock"
          postId={postId}
          draftKey={userId ? draftKey(userId, { kind: 'comment', postId }) : undefined}
          onSubmit={(body, mediaIds) => submit(body, mediaIds, null)}
        />
      </Dock>
    )}
    <Modal open={confirmDelete !== null} onClose={() => (deleting ? undefined : setConfirmDelete(null))} title="Slette kommentaren?">
      <p className="text-sm leading-relaxed text-ink-soft">
        Kommentaren fjernes for alle. Har noen svart på den, står det «Kommentaren er slettet» der den var, så svarene
        beholder sammenhengen.
      </p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={deleting !== null}>
          Avbryt
        </Button>
        <Button variant="danger" loading={deleting !== null} onClick={() => confirmDelete && void remove(confirmDelete.id)}>
          Slett kommentaren
        </Button>
      </div>
    </Modal>
    </>
  )
}

function PostPage() {
  const data = Route.useLoaderData()
  const me = Route.useRouteContext().me
  const router = useRouter()
  const post = data.post
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  /** «Sende e-post til N?» — utsending går aldri rett fra menyen. */
  const [confirmSend, setConfirmSend] = useState(false)
  // Avslått som standard (#85): publisering og masseutsending er to handlinger.
  const [notify, setNotify] = useState(DEFAULT_NOTIFY)
  const [busy, setBusy] = useState<'resend' | 'publish' | 'unpublish' | 'delete' | null>(null)
  const isDraft = post.publishedAt === null

  // Lest først når siden faktisk vises — ikke når ruteren forhåndslaster den.
  useEffect(() => {
    if (isDraft) return
    rememberPostRead(post.id)
    markPostRead({ data: { id: post.id } })
      .then(refreshShellCounts)
      .catch(() => {})
  }, [post.id, isDraft])

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
      setConfirmSend(false)
      const { message, kind } = notifyResultMessage(result)
      toast(message.replace(/^Publisert\. /, ''), kind)
      await router.invalidate()
    })

  const publish = () =>
    act('publish', async () => {
      const result = await publishPost({ data: { id: post.id, sendEmail: (data.canPublish || data.canArchive) && notify } })
      const { message, kind } = notifyResultMessage(result)
      setConfirmPublish(false)
      toast(data.canPublish || data.canArchive ? message : 'Publisert på veggen', kind)
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

  const canPublishDraft = isDraft && post.canEdit
  const delivery = data.delivery
  // «Send e-post» før noe er sendt; «Send til de N som mangler» etterpå.
  const anyDelivered = !!delivery && delivery.sent + delivery.logged + delivery.failed > 0
  const pending = delivery?.pending ?? 0
  const sendLabel = !anyDelivered ? 'Send e-post' : pending > 0 ? `Send til de ${pending} som mangler` : 'E-post er sendt til alle'
  const deliveryHint = delivery
    ? !anyDelivered
      ? pending === 1
        ? 'Ikke sendt ennå · 1 mottaker'
        : `Ikke sendt ennå · ${pending} mottakere`
      : [
          `${delivery.sent} sendt`,
          delivery.logged > 0 ? `${delivery.logged} loggført lokalt` : null,
          delivery.failed > 0 ? `${delivery.failed} feilet` : null,
          pending === 0 ? 'ingen får den to ganger' : null,
        ]
          .filter(Boolean)
          .join(' · ')
    : undefined

  const manageItems: ActionMenuItem[] = post.canEdit
    ? [
        {
          label: 'Rediger',
          hint: `Tekst, bilder${data.canPublish ? ', vedlegg' : ''} og valg`,
          icon: 'notes',
          onSelect: () => void router.navigate({ to: '/beskjeder/$postId/rediger', params: { postId: post.id } }),
        },
        ...(isDraft
          ? [{ label: 'Publiser', hint: 'Gjør innlegget synlig, med valg om varsel', icon: 'megaphone' as const, onSelect: () => setConfirmPublish(true) }]
          : delivery
            ? [{ label: sendLabel, hint: deliveryHint, icon: 'bell' as const, disabled: pending === 0 || busy === 'resend', onSelect: () => setConfirmSend(true) }]
            : []),
        ...(!isDraft && data.canPublish
          ? [{ label: 'Avpubliser', hint: 'Tar innlegget av veggen og gjør det til et utkast', icon: 'refresh' as const, disabled: busy === 'unpublish', onSelect: () => void unpublish() }]
          : []),
        { label: 'Slett innlegget', hint: 'Med kommentarer, bilder og vedlegg', icon: 'close', tone: 'danger', onSelect: () => setConfirmDelete(true) },
      ]
    : []

  return (
    <div className="mx-auto max-w-2xl">
      <header className="rise">
        <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
          <Link to="/beskjeder" className="back-link">
            <BackArrow />
            Veggen
          </Link>
          {post.canEdit && <ActionMenu label="Administrer" title={post.heading} items={manageItems} />}
        </div>

        {(post.importance === 'important' || post.audience === 'board' || isDraft) && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {isDraft && <Stamp tone="oxblood">Utkast</Stamp>}
            {post.importance === 'important' && <Stamp tone="oxblood">Viktig</Stamp>}
            {post.audience === 'board' && <Stamp>Kun styret</Stamp>}
          </div>
        )}

        {post.title && (
          <h1 className="display-title break-words text-[clamp(1.85rem,5vw,2.8rem)] font-semibold leading-[1.08] text-ink [hyphens:auto]">
            {post.title}
          </h1>
        )}

        <div className="mt-4 flex items-center gap-3 border-y border-line py-3">
          <SenderMark post={post} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.9rem] font-semibold leading-tight text-ink">
              {postSender(post)}
              {(post.official || post.fromArchive) && <span className="font-normal text-ink-soft"> · {post.author.name}</span>}
            </p>
            <p className="mt-0.5 text-[0.8rem] text-ink-faint">
              {isDraft ? `Sist endret ${formatDateTime(post.updatedAt)}` : formatDateTime(post.publishedAt!)}
            </p>
          </div>
        </div>
      </header>

      {canPublishDraft && (
        <div className="rise mt-5 flex flex-wrap items-center gap-3 rounded-[12px] border border-dashed border-line-strong bg-paper-sunken px-4 py-3" style={{ animationDelay: '40ms' }}>
          <p className="min-w-0 flex-1 text-sm text-ink-soft">
            {data.canPublish
              ? 'Utkastet er kun synlig for dem som kan publisere beskjeder.'
              : 'Innlegget er ikke publisert ennå.'}
          </p>
          <div className="flex gap-2">
            <Link to="/beskjeder/$postId/rediger" params={{ postId: post.id }} className={buttonClass('secondary', 'sm')}>
              Rediger
            </Link>
            <Button size="sm" variant="primary" onClick={() => setConfirmPublish(true)}>
              Publiser
            </Button>
          </div>
        </div>
      )}

      <article className="rise mt-6 space-y-5" style={{ animationDelay: '80ms' }}>
        <PostBody body={post.body} format={post.format} mentions={post.mentions} />
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
        {data.attachments.length > 0 && (
          <section className="rounded-[12px] border border-line" aria-label="Vedlegg">
            <h2 className="kicker px-4 pt-3">Vedlegg</h2>
            <ul className="divide-y divide-line">
              {data.attachments.map((file) => (
                <li key={file.id}>
                  <a href={postAttachmentUrl(file.id)} download className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm no-underline hover:bg-paper-sunken">
                    <Glyph name="clip" size={16} />
                    <span className="min-w-0 flex-1 break-all text-brass-strong">
                      <span className="sr-only">Last ned </span>
                      {file.fileName}
                    </span>
                    <span className="shrink-0 text-xs text-ink-faint">{formatBytes(file.size)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!isDraft && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <ReactionBar kind="post" targetId={post.id} reactions={post.reactions} size="md" />
          </div>
        )}
      </article>

      {!isDraft && (
        <div className="mt-8">
          <CommentThread postId={post.id} comments={data.comments} canComment userId={me?.id ?? null} />
        </div>
      )}

      <Modal open={confirmPublish} onClose={() => setConfirmPublish(false)} title="Publisere innlegget?" kicker="Veggen">
        <p className="text-sm leading-relaxed text-ink-soft">
          Innlegget blir synlig for {post.audience === 'board' ? 'styret' : 'alle medlemmer'} med det samme.
        </p>
        {(data.canPublish || (data.canArchive && post.canEdit && !post.official && post.audience === 'all')) && (
          <label className="mt-4 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brass)]"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-ink">{notifyLabel(post.audience)}</span>
              <span className="mt-0.5 block text-xs leading-snug text-ink-soft">
                Sender e-post, og varsel til dem som har slått på varsler på en enhet. Uten avkryssing
                publiseres innlegget uten varsel. Varselet følger varslingsvalget til hver enkelt, og ingen
                får den samme beskjeden to ganger.
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

      <Modal
        open={confirmSend}
        onClose={() => (busy === 'resend' ? undefined : setConfirmSend(false))}
        title={pending === 1 ? 'Sende e-post til 1 medlem?' : `Sende e-post til ${pending} medlemmer?`}
        kicker="Veggen"
      >
        <p className="text-sm leading-relaxed text-ink-soft">
          «{post.heading}» går på e-post til {pending === 1 ? 'det ene medlemmet' : `de ${pending} medlemmene`} som ikke har fått
          den{anyDelivered ? ' ennå' : ''}, og som varsel til dem som har slått på varsler på en enhet. En e-post kan ikke trekkes
          tilbake. Ingen får den samme beskjeden to ganger.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setConfirmSend(false)} disabled={busy === 'resend'}>
            Avbryt
          </Button>
          <Button variant="primary" onClick={() => void resend()} loading={busy === 'resend'} disabled={pending === 0}>
            {pending === 1 ? 'Send til 1' : `Send til ${pending}`}
          </Button>
        </div>
      </Modal>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette innlegget?" kicker="Veggen">
        <p className="text-sm leading-relaxed text-ink-soft">
          «{post.heading}» slettes for alle, sammen med kommentarer, bilder og vedlegg. E-poster som allerede er sendt, kan ikke
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
