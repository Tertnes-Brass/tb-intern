import { MentionTextarea } from '../../components/MentionTextarea'
import { forumMarkers, forumMentionDraft, forumMentionHtml } from '../../lib/forum-mentions'
import type { MentionUser } from '../../lib/mentions'
import { useForumRefresh } from '../../components/useForumRefresh'
import { useThreadMark } from '../../components/useThreadMark'
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button, Field, Stamp } from '../../components/ui'
import { editForumText, getForumTopic, markForumRepliesRead, replyToForum, searchForumMentions, setForumFollow, setForumLock } from '../../server/forum'
import { Icon } from '../../components/Icons'
import { refreshShellCounts } from '../../lib/shell-events'
import { foldChildren, replyContext } from '../../lib/threads'

/** `?svar=` er en svar-id — aldri fritekst som havner i en spørring eller i DOM-en. */
const REPLY_ID = /^[\w-]{1,100}$/

export const Route = createFileRoute('/forum/$topicId')({
  beforeLoad: ({ context }) => { if (!context.me) throw redirect({ to: '/login' }) },
  validateSearch: (search: Record<string, unknown>): { page: number; svar?: string } => {
    const page = Math.max(0, Math.min(100000, Math.floor(Number(search.page) || 0)))
    return typeof search.svar === 'string' && REPLY_ID.test(search.svar) ? { page, svar: search.svar } : { page }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => getForumTopic({ data: { id: params.topicId, ...deps } }),
  component: TopicPage,
})

type TopicData = Awaited<ReturnType<typeof getForumTopic>>
type RootReply = TopicData['replies'][number]
type ChildReply = RootReply['children'][number]
/** Svaret man er i ferd med å svare på, og roten svaret havner under. */
type ReplyTarget = { id: string; rootId: string; name: string }
type Draft = { body: string; chosen: MentionUser[] }

const EMPTY_DRAFT: Draft = { body: '', chosen: [] }
const displayName = (author: string | null) => author ?? 'Tidligere medlem'
const replyDomId = (id: string) => `svar-${id}`
const replyRef = (r: ChildReply) => ({ id: r.reply.id, parentId: r.reply.parentId, replyToId: r.reply.replyToId, createdAt: r.reply.createdAt })

/** Cmd/Ctrl+Enter sender; Enter alene er linjeskift, for forumsvar kan være lange. */
const isSubmitShortcut = (e: React.KeyboardEvent) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing

function ForumText({ id, kind, body, author, createdAt, updatedAt, canEdit, unread = false, topicId, mentions, domId, marked = false, context, onReply }: {
  id: string; kind: 'topic' | 'reply'; body: string; author: string | null; createdAt: number; updatedAt: number; canEdit: boolean; unread?: boolean; topicId?: string; mentions: MentionUser[]
  /** Ankeret `?svar=` og «Svar til …» ruller til. */
  domId?: string
  marked?: boolean
  /** «Svar til Jonas» over teksten, når svaret gjelder et annet svar enn roten. */
  context?: ReactNode
  onReply?: () => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [chosen, setChosen] = useState<MentionUser[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const article = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!unread || !topicId || !article.current) return
    let sent = false
    let visible = false
    let cancelled = false
    const mark = async () => {
      if (sent || !visible || document.visibilityState !== 'visible') return
      sent = true
      try { await markForumRepliesRead({ data: { topicId, replyIds: [id] } }); refreshShellCounts() }
      catch { if (!cancelled) sent = false }
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; void mark() })
    observer.observe(article.current)
    const retry = window.setInterval(() => void mark(), 12000)
    document.addEventListener('visibilitychange', mark)
    return () => { cancelled = true; observer.disconnect(); clearInterval(retry); document.removeEventListener('visibilitychange', mark) }
  }, [id, topicId, unread])
  const name = displayName(author)
  return <article ref={article} id={domId} className={kind === 'reply' ? `thread-item -mx-2 space-y-1.5 px-2 py-3 ${marked ? 'thread-marked' : ''}` : 'space-y-2 border-b border-line pb-4'}>
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft"><p><strong className="text-ink">{name}</strong> · {new Date(createdAt).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'short', timeStyle: 'short' })}{updatedAt > createdAt && ' · Redigert'}</p>
      {unread && <span className="font-semibold text-brass-strong">Nytt</span>}
      {!editing && (onReply || canEdit) && <span className="ml-auto flex items-center">
        {onReply && <button type="button" aria-label={`Svar ${name}`} className="inline-flex cursor-pointer items-center gap-1 px-2 py-1 text-xs text-ink-faint hover:text-ink" onClick={onReply}><Icon name="reply" size={13} />Svar</button>}
        {canEdit && <button type="button" className="cursor-pointer px-2 py-1 text-xs text-ink-faint hover:text-ink" onClick={() => { const initial = forumMentionDraft(body, mentions); setDraft(initial.text); setChosen(initial.chosen); setEditing(true) }}>Rediger</button>}
      </span>}
    </div>
    {context}
    {editing ? <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); if (busy) return; setBusy(true); setError('')
      try { await editForumText({ data: { id, kind, body: forumMarkers(draft, chosen) } }); setEditing(false); await router.invalidate() }
      catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke lagre.') } finally { setBusy(false) }
    }}>
      <Field label="Rediger tekst" hint="Skriv @ for å omtale noen."><MentionTextarea className="field-input min-h-40" required maxLength={20000} value={draft} onChange={setDraft} chosen={chosen} onChosenChange={setChosen} search={(query) => searchForumMentions({ data: { query } })} /></Field>
      <div className="flex gap-2"><Button type="submit" disabled={busy || !draft.trim()}>Lagre</Button><Button type="button" disabled={busy} onClick={() => setEditing(false)}>Avbryt</Button></div>
    </form> : <p className="whitespace-pre-wrap break-words leading-relaxed" dangerouslySetInnerHTML={{ __html: forumMentionHtml(body, mentions) }} />}
    {error && <p role="alert" className="text-danger">{error}</p>}
  </article>
}

/**
 * Svarfeltet som åpner seg i tråden, under svarene til roten — der svaret
 * havner. Teksten bor hos siden, ikke her: bytter man hvem man svarer, følger
 * det man har skrevet med i stedet for å forsvinne.
 */
function InlineReply({ target, draft, onDraft, busy, error, onSubmit, onCancel }: {
  target: ReplyTarget; draft: Draft; onDraft: (draft: Draft) => void; busy: boolean; error: string
  onSubmit: () => void; onCancel: () => void
}) {
  return <form className="mt-1 space-y-2 rounded-[9px] border border-line bg-paper-sunken/40 p-3" onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
    <div className="flex items-center gap-2 text-xs text-ink-soft">
      <span className="h-4 w-[3px] shrink-0 rounded-full bg-brass" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Svarer <strong className="text-ink">{target.name}</strong></span>
      <button type="button" className="shrink-0 cursor-pointer px-1 py-0.5 text-ink-faint hover:text-ink" onClick={onCancel}>Avbryt</button>
    </div>
    <MentionTextarea
      // Fokus i samme trykk som åpnet feltet, så tastaturet kommer opp på iPhone.
      autoFocus
      className="field-input min-h-20 w-full"
      required
      maxLength={20000}
      aria-label={`Svar til ${target.name}`}
      placeholder={`Svar ${target.name} … @ nevner noen`}
      value={draft.body}
      onChange={(body) => onDraft({ ...draft, body })}
      chosen={draft.chosen}
      onChosenChange={(chosen) => onDraft({ ...draft, chosen })}
      search={(query) => searchForumMentions({ data: { query } })}
      onKeyDown={(e) => {
        if (isSubmitShortcut(e)) { e.preventDefault(); onSubmit() }
        // Escape lukker først forslagslista (i MentionTextarea), så et tomt felt.
        else if (e.key === 'Escape' && !draft.body.trim()) onCancel()
      }}
    />
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!draft.body.trim()}>Svar</Button>
  </form>
}

function TopicPage() {
  useForumRefresh()
  const data = Route.useLoaderData()
  const { topic } = data
  // Siden serveren faktisk returnerte: med `?svar=` er det siden svaret står på.
  const page = data.page
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [body, setBody] = useState('')
  const [chosen, setChosen] = useState<MentionUser[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [replying, setReplying] = useState<ReplyTarget | null>(null)
  const [replyDraft, setReplyDraft] = useState<Draft>(EMPTY_DRAFT)
  const [replyBusy, setReplyBusy] = useState(false)
  const [replyError, setReplyError] = useState('')
  /** Røtter der alle svarene er foldet ut. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const { markedId, markElement } = useThreadMark()

  // Fra et varsel eller etter eget svar: rull til svaret én gang per lenke —
  // ikke på nytt hver gang tråden oppdateres i bakgrunnen.
  const focused = useRef<string | null>(null)
  useEffect(() => {
    if (!data.focus || focused.current === data.focus) return
    focused.current = data.focus
    markElement(replyDomId(data.focus))
  }, [data.focus, markElement])

  const expand = (rootId: string) => setExpanded((prev) => new Set(prev).add(rootId))
  const jumpTo = (id: string, rootId: string) => { expand(rootId); markElement(replyDomId(id)) }
  const startReply = (target: ReplyTarget) => { setReplyError(''); setReplying(target) }
  const cancelReply = () => { setReplying(null); setReplyDraft(EMPTY_DRAFT); setReplyError('') }

  const sendReply = async () => {
    const text = forumMarkers(replyDraft.body, replyDraft.chosen)
    if (!replying || replyBusy || !text.trim()) return
    setReplyBusy(true); setReplyError('')
    try {
      const result = await replyToForum({ data: { topicId: topic.id, body: text, replyToId: replying.id } })
      // Svaret er lagret. Navigasjonen henter tråden på nytt og ruller til det.
      await navigate({ search: { page: result.page, svar: result.id }, replace: true }).catch(() => undefined)
      cancelReply()
    } catch (e) { setReplyError(e instanceof Error ? e.message : 'Kunne ikke sende svaret.') } finally { setReplyBusy(false) }
  }

  const renderThread = (root: RootReply) => {
    const canReply = !topic.locked
    const composerHere = canReply && replying?.rootId === root.reply.id
    const fold = expanded.has(root.reply.id)
      ? { hidden: 0, visible: root.children }
      : foldChildren(root.children, { mustShow: (c) => !!c.unread || c.reply.id === data.focus || c.reply.id === replying?.id || replyDomId(c.reply.id) === markedId })
    return <div key={root.reply.id} className="py-1">
      <ForumText {...root.reply} kind="reply" mentions={data.mentions} author={root.author} canEdit={root.canEdit} unread={!!root.unread} topicId={topic.id}
        domId={replyDomId(root.reply.id)} marked={markedId === replyDomId(root.reply.id)}
        onReply={canReply ? () => startReply({ id: root.reply.id, rootId: root.reply.id, name: displayName(root.author) }) : undefined} />
      {(root.children.length > 0 || composerHere) && <div className="mb-2 ml-1 border-l-2 border-line pl-3 sm:ml-3 sm:pl-5">
        {fold.hidden > 0 && <button type="button" className="cursor-pointer py-1.5 text-sm font-medium text-brass-strong hover:underline" onClick={() => expand(root.reply.id)}>
          Vis {fold.hidden === 1 ? 'ett tidligere svar' : `${fold.hidden} tidligere svar`}
        </button>}
        {fold.visible.map((child) => {
          const ctx = replyContext(child, root.children, replyRef)
          return <ForumText key={child.reply.id} {...child.reply} kind="reply" mentions={data.mentions} author={child.author} canEdit={child.canEdit} unread={!!child.unread} topicId={topic.id}
            domId={replyDomId(child.reply.id)} marked={markedId === replyDomId(child.reply.id)}
            context={ctx.kind === 'sibling'
              ? <button type="button" title="Vis svaret" className="inline-flex max-w-full cursor-pointer items-center gap-1 text-xs text-ink-faint hover:text-ink" onClick={() => jumpTo(ctx.target.reply.id, root.reply.id)}>
                  <Icon name="reply" size={12} /><span className="truncate">Svar til <strong className="font-semibold">{displayName(ctx.target.author)}</strong></span>
                </button>
              : ctx.kind === 'gone' ? <p className="text-xs italic text-ink-faint">Svar på et svar som ikke finnes lenger</p> : null}
            onReply={canReply ? () => startReply({ id: child.reply.id, rootId: root.reply.id, name: displayName(child.author) }) : undefined} />
        })}
        {composerHere && replying && <InlineReply target={replying} draft={replyDraft} onDraft={setReplyDraft} busy={replyBusy} error={replyError} onSubmit={() => void sendReply()} onCancel={cancelReply} />}
      </div>}
    </div>
  }

  const sendTopLevel = async () => {
    const text = forumMarkers(body, chosen)
    if (busy || !text.trim()) return
    setBusy(true); setError('')
    try {
      const result = await replyToForum({ data: { topicId: topic.id, body: text } })
      setBody(''); setChosen([])
      await navigate({ search: { page: result.page, svar: result.id }, replace: true }).catch(() => undefined)
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke sende svaret.') } finally { setBusy(false) }
  }

  return <div className="mx-auto max-w-3xl space-y-5">
    <Link to="/forum" search={{ page: 0 }} className="link-quiet">← Forum</Link>
    <header className="space-y-3"><h1 className="display-title break-words text-3xl font-semibold sm:text-4xl">{topic.title}</h1>
      {topic.locked && <Stamp>Låst for nye svar</Stamp>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} aria-pressed={data.following} title={data.following ? 'Du får varsel om nye svar i denne tråden' : undefined} onClick={async () => {
          setBusy(true); setError(''); try { await setForumFollow({ data: { topicId: topic.id, following: !data.following } }); await router.invalidate() }
          catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke endre varslene.') } finally { setBusy(false) }
        }}><Icon name="bell" size={14} />{data.following ? 'Slå av varsler' : 'Følg tråden'}</Button>
        {data.canModerate && <Button size="sm" disabled={busy} onClick={async () => {
          setBusy(true); setError(''); try { await setForumLock({ data: { id: topic.id, locked: !topic.locked } }); await router.invalidate() }
          catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke endre tråden.') } finally { setBusy(false) }
        }}>{topic.locked ? 'Åpne tråden igjen' : 'Lås tråden'}</Button>}
      </div>
      <p className="text-xs text-ink-faint">{data.following
        ? 'Du følger tråden og får varsel om nye svar på enheter der du har slått på varsler.'
        : 'Du får fortsatt varsel når noen nevner deg eller svarer på noe du har skrevet.'}</p>
    </header>
    <ForumText key={topic.id} {...topic} kind="topic" mentions={data.mentions} author={data.author} canEdit={data.canEdit} />
    {error && <p role="alert" className="text-danger">{error}</p>}
    {topic.locked ? <p className="text-ink-soft">Tråden er låst. Du kan fortsatt lese samtalen.</p> : <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void sendTopLevel() }}>
      <Field label="Svar på tråden" hint="Vil du svare noen bestemt, trykk «Svar» under svaret deres. Skriv @ for å velge et medlem eller Alle i korpset."><MentionTextarea className="field-input min-h-20" required maxLength={20000} value={body} onChange={setBody} chosen={chosen} onChosenChange={setChosen} search={(query) => searchForumMentions({ data: { query } })}
        onKeyDown={(e) => { if (isSubmitShortcut(e)) { e.preventDefault(); void sendTopLevel() } }} /></Field>
      <Button type="submit" variant="primary" disabled={busy || !body.trim()}>{busy ? 'Sender …' : 'Publiser svar'}</Button>
    </form>}
    <h2 className="display-title text-2xl">Svar</h2>
    {!data.replies.length && <p className="text-ink-soft">{page ? 'Ingen flere svar.' : 'Ingen svar ennå.'}</p>}
    <div className="divide-y divide-line">{data.replies.map(renderThread)}</div>
    {(page > 0 || data.hasMore) && <nav aria-label="Sider med svar" className="flex justify-between">
      {page > 0 ? <Link to="/forum/$topicId" params={{ topicId: topic.id }} search={{ page: page - 1 }}>← Nyere svar</Link> : <span />}
      {data.hasMore && <Link to="/forum/$topicId" params={{ topicId: topic.id }} search={{ page: page + 1 }}>Eldre svar →</Link>}
    </nav>}
  </div>
}
