import { MentionTextarea } from '../../components/MentionTextarea'
import { forumMarkers, forumMentionDraft, forumMentionHtml } from '../../lib/forum-mentions'
import type { MentionUser } from '../../lib/mentions'
import { useForumRefresh } from '../../components/useForumRefresh'
import { useThreadMark } from '../../components/useThreadMark'
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Avatar, BackArrow, Button, buttonClass, Field, Stamp } from '../../components/ui'
import { Glyph } from '../../components/compose/Composer'
import { Dock } from '../../components/compose/Dock'
import { DraftNotice } from '../../components/compose/LeaveGuard'
import { useLocalDraft } from '../../components/compose/useLocalDraft'
import { draftKey, isTextDraft } from '../../lib/drafts'
import { shortWhen } from '../../components/compose/when'
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
  return <article ref={article} id={domId} className={kind === 'reply' ? `thread-item -mx-2 space-y-1.5 px-2 py-3 ${marked ? 'thread-marked' : ''}` : 'space-y-3'}>
    {/* Trådstarten har navn og tid i sidehodet; her står bare «Rediger». */}
    {(kind === 'reply' || (canEdit && !editing)) && <div className="flex flex-wrap items-center gap-x-2 text-[0.8rem] text-ink-faint">{kind === 'reply' && <><Avatar name={name} size="sm" /><p><strong className="font-semibold text-ink">{name}</strong> · <time title={new Date(createdAt).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'short', timeStyle: 'short' })}>{shortWhen(createdAt)}</time>{updatedAt > createdAt && ' · Redigert'}</p></>}
      {unread && <span className="h-2 w-2 rounded-full bg-brass" title="Nytt"><span className="sr-only">Nytt</span></span>}
      {!editing && (onReply || canEdit) && <span className="ml-auto flex items-center gap-1">
        {onReply && <button type="button" aria-label={`Svar ${name}`} className="hit inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-xs text-ink-faint hover:bg-paper-sunken hover:text-ink" onClick={onReply}><Icon name="reply" size={13} />Svar</button>}
        {canEdit && <button type="button" className="hit cursor-pointer rounded-full px-2 py-1 text-xs text-ink-faint hover:bg-paper-sunken hover:text-ink" onClick={() => { const initial = forumMentionDraft(body, mentions); setDraft(initial.text); setChosen(initial.chosen); setEditing(true) }}>Rediger</button>}
      </span>}
    </div>}
    {context}
    {editing ? <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); if (busy) return; setBusy(true); setError('')
      try { await editForumText({ data: { id, kind, body: forumMarkers(draft, chosen) } }); setEditing(false); await router.invalidate() }
      catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke lagre.') } finally { setBusy(false) }
    }}>
      <Field label="Rediger tekst" hint="Skriv @ for å omtale noen."><MentionTextarea className="field-input min-h-40" required maxLength={20000} value={draft} onChange={setDraft} chosen={chosen} onChosenChange={setChosen} search={(query) => searchForumMentions({ data: { query } })} /></Field>
      <div className="flex gap-2"><Button type="submit" disabled={busy || !draft.trim()}>Lagre</Button><Button type="button" disabled={busy} onClick={() => setEditing(false)}>Avbryt</Button></div>
    </form> : <p className={`whitespace-pre-wrap break-words leading-relaxed ${kind === 'topic' ? 'text-[1.02rem] text-ink' : 'text-[0.95rem] text-ink-soft'}`} dangerouslySetInnerHTML={{ __html: forumMentionHtml(body, mentions) }} />}
    {error && <p role="alert" className="text-danger">{error}</p>}
  </article>
}

type Restored = { savedAt: number; stale: boolean } | null

/** Feltet for et nytt svar på tråden: fast nederst på berøringsskjerm (`Dock`), som kommentarfeltet på veggen. */
function ReplyDock({ draft, onDraft, busy, error, onSubmit, restored, onDiscard }: {
  draft: Draft; onDraft: (draft: Draft) => void; busy: boolean; error: string; onSubmit: () => void
  restored: Restored; onDiscard: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`
  }, [draft.body])
  return <Dock><form onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
    {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
    <DraftNotice restored={restored} onDiscard={onDiscard} />
    <div className="flex items-end gap-2">
      <MentionTextarea
        textareaRef={ref}
        wrapperClassName="min-w-0 flex-1"
        className="field-input comment-dock-input"
        rows={1}
        required
        maxLength={20000}
        aria-label="Svar på tråden"
        aria-describedby="forum-reply-hint"
        placeholder="Svar på tråden …"
        value={draft.body}
        onChange={(body) => onDraft({ ...draft, body })}
        chosen={draft.chosen}
        onChosenChange={(chosen) => onDraft({ ...draft, chosen })}
        search={(query) => searchForumMentions({ data: { query } })}
        onKeyDown={(e) => { if (isSubmitShortcut(e)) { e.preventDefault(); onSubmit() } }}
      />
      <Button type="submit" variant="primary" loading={busy} disabled={!draft.body.trim()} aria-label="Publiser svar" className="comment-dock-send">
        {!busy && <Glyph name="send" size={18} />}
      </Button>
    </div>
    <p id="forum-reply-hint" className="sr-only">Skriv @ for å velge et medlem eller Alle i korpset. Vil du svare noen bestemt, trykk «Svar» under svaret deres.</p>
  </form></Dock>
}

/**
 * Svarfeltet som åpner seg i tråden, under svarene til roten — der svaret
 * havner. Teksten bor hos siden, ikke her: bytter man hvem man svarer, følger
 * det man har skrevet med i stedet for å forsvinne.
 */
function InlineReply({ target, draft, onDraft, busy, error, onSubmit, onCancel, restored, onDiscard }: {
  target: ReplyTarget; draft: Draft; onDraft: (draft: Draft) => void; busy: boolean; error: string
  onSubmit: () => void; onCancel: () => void; restored: Restored; onDiscard: () => void
}) {
  return <form className="mt-1 space-y-2 rounded-[9px] border border-line bg-paper-sunken/40 p-3" onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
    <div className="flex items-center gap-2 text-xs text-ink-soft">
      <span className="h-4 w-[3px] shrink-0 rounded-full bg-brass" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Svarer <strong className="text-ink">{target.name}</strong></span>
      <button type="button" className="shrink-0 cursor-pointer px-1 py-0.5 text-ink-faint hover:text-ink" onClick={onCancel}>Avbryt</button>
    </div>
    <DraftNotice restored={restored} onDiscard={onDiscard} />
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
  const [topDraft, setTopDraft] = useState<Draft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [replying, setReplying] = useState<ReplyTarget | null>(null)
  const [replyDraft, setReplyDraft] = useState<Draft>(EMPTY_DRAFT)
  const [replyBusy, setReplyBusy] = useState(false)
  const [replyError, setReplyError] = useState('')
  /** Røtter der alle svarene er foldet ut. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const { markedId, markElement } = useThreadMark()

  // Svarene lagres på enheten mens man skriver (src/lib/drafts.ts): ett utkast
  // for svaret på tråden, og ett per svar man svarer på.
  const me = Route.useRouteContext().me
  const topLocal = useLocalDraft<Draft>({
    storageKey: me ? draftKey(me.id, { kind: 'forum-reply', topicId: topic.id }) : null,
    value: topDraft,
    initial: EMPTY_DRAFT,
    validate: isTextDraft,
    onRestore: setTopDraft,
  })
  const replyLocal = useLocalDraft<Draft>({
    storageKey: me && replying ? draftKey(me.id, { kind: 'forum-reply', topicId: topic.id, replyToId: replying.id }) : null,
    value: replyDraft,
    initial: EMPTY_DRAFT,
    validate: isTextDraft,
    onRestore: setReplyDraft,
  })

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
      replyLocal.clear()
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
        {composerHere && replying && <InlineReply target={replying} draft={replyDraft} onDraft={setReplyDraft} busy={replyBusy} error={replyError} onSubmit={() => void sendReply()} onCancel={cancelReply}
          restored={replyLocal.restored} onDiscard={() => { replyLocal.discard(); setReplyDraft(EMPTY_DRAFT) }} />}
      </div>}
    </div>
  }

  const sendTopLevel = async () => {
    const text = forumMarkers(topDraft.body, topDraft.chosen)
    if (busy || !text.trim()) return
    setBusy(true); setError('')
    try {
      const result = await replyToForum({ data: { topicId: topic.id, body: text } })
      topLocal.clear()
      setTopDraft(EMPTY_DRAFT)
      await navigate({ search: { page: result.page, svar: result.id }, replace: true }).catch(() => undefined)
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke sende svaret.') } finally { setBusy(false) }
  }

  return <div className="mx-auto max-w-2xl">
    <Link to="/forum" search={{ page: 0 }} className="back-link mb-3"><BackArrow />Forum</Link>
    <header className="rise">
      {topic.locked && <Stamp className="mb-2">Låst for nye svar</Stamp>}
      <h1 className="display-title break-words text-[clamp(1.75rem,5vw,2.5rem)] font-semibold leading-[1.1] text-ink">{topic.title}</h1>
      <div className="mt-4 flex items-center gap-3 border-y border-line py-3">
        <Avatar name={displayName(data.author)} />
        <p className="min-w-0 flex-1 text-[0.8rem] leading-snug text-ink-faint">
          <strong className="block truncate text-[0.9rem] font-semibold text-ink">{displayName(data.author)}</strong>
          {shortWhen(topic.createdAt)}{topic.updatedAt > topic.createdAt && ' · Redigert'}
        </p>
        <Button size="sm" variant={data.following ? 'secondary' : 'ghost'} disabled={busy} aria-pressed={data.following}
          title={data.following ? 'Du får varsel om nye svar i tråden. Trykk for å slå av.' : 'Få varsel om nye svar i tråden. Du får uansett varsel når noen nevner deg eller svarer deg.'}
          onClick={async () => {
            setBusy(true); setError(''); try { await setForumFollow({ data: { topicId: topic.id, following: !data.following } }); await router.invalidate() }
            catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke endre varslene.') } finally { setBusy(false) }
          }}><Icon name="bell" size={15} />{data.following ? 'Følger' : 'Følg'}</Button>
        {data.canModerate && <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
          setBusy(true); setError(''); try { await setForumLock({ data: { id: topic.id, locked: !topic.locked } }); await router.invalidate() }
          catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke endre tråden.') } finally { setBusy(false) }
        }}>{topic.locked ? 'Åpne' : 'Lås'}<span className="sr-only"> tråden</span></Button>}
      </div>
    </header>
    <div className="rise mt-5" style={{ animationDelay: '60ms' }}>
      <ForumText key={topic.id} {...topic} kind="topic" mentions={data.mentions} author={data.author} canEdit={data.canEdit} />
    </div>
    {/* Feil fra «Følg»/«Lås» og fra svaret vises i svarfeltet når det står der. */}
    {error && (topic.locked || replying) && <p role="alert" className="mt-3 text-danger">{error}</p>}
    <section className="rise mt-8" style={{ animationDelay: '120ms' }} aria-label="Svar">
      <h2 className="mb-1 text-[0.95rem] font-semibold text-ink">Svar{page > 0 ? <span className="font-normal text-ink-soft"> · side {page + 1}</span> : ''}</h2>
      {!data.replies.length && <p className="py-3 text-sm text-ink-soft">{page ? 'Ingen flere svar.' : topic.locked ? 'Ingen svar.' : 'Ingen svar ennå — skriv det første nedenfor.'}</p>}
      <div className="divide-y divide-line">{data.replies.map(renderThread)}</div>
      {(page > 0 || data.hasMore) && <nav aria-label="Sider med svar" className="mt-3 flex justify-between">
        {page > 0 ? <Link to="/forum/$topicId" params={{ topicId: topic.id }} search={{ page: page - 1 }} className={buttonClass('ghost', 'sm')}>← Nyere svar</Link> : <span />}
        {data.hasMore && <Link to="/forum/$topicId" params={{ topicId: topic.id }} search={{ page: page + 1 }} className={buttonClass('ghost', 'sm')}>Eldre svar →</Link>}
      </nav>}
    </section>
    {topic.locked
      ? <p className="mt-6 rounded-[12px] border border-dashed border-line-strong bg-paper-sunken px-4 py-3 text-sm text-ink-soft">Tråden er låst. Du kan fortsatt lese samtalen.</p>
      // Skjult mens man svarer noen bestemt, så det ikke står to skrivefelt på skjermen.
      : !replying && <ReplyDock draft={topDraft} onDraft={setTopDraft} busy={busy} error={error} onSubmit={() => void sendTopLevel()}
          restored={topLocal.restored} onDiscard={() => { topLocal.discard(); setTopDraft(EMPTY_DRAFT) }} />}
  </div>
}
