import { MentionTextarea } from '../../components/MentionTextarea'
import { forumMarkers, forumMentionDraft, forumMentionHtml } from '../../lib/forum-mentions'
import type { MentionUser } from '../../lib/mentions'
import { useForumRefresh } from '../../components/useForumRefresh'
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Button, Field, Stamp } from '../../components/ui'
import { editForumText, getForumTopic, markForumRepliesRead, replyToForum, searchForumMentions, setForumLock } from '../../server/forum'

export const Route = createFileRoute('/forum/$topicId')({
  beforeLoad: ({ context }) => { if (!context.me) throw redirect({ to: '/login' }) },
  validateSearch: (search: Record<string, unknown>) => ({ page: Math.max(0, Math.min(100000, Math.floor(Number(search.page) || 0))) }),
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => getForumTopic({ data: { id: params.topicId, ...deps } }),
  component: TopicPage,
})

function ForumText({ id, kind, body, author, createdAt, updatedAt, canEdit, unread = false, topicId, mentions }: {
  id: string; kind: 'topic' | 'reply'; body: string; author: string | null; createdAt: number; updatedAt: number; canEdit: boolean; unread?: boolean; topicId?: string; mentions: MentionUser[]
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
      try { await markForumRepliesRead({ data: { topicId, replyIds: [id] } }) }
      catch { if (!cancelled) sent = false }
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; void mark() })
    observer.observe(article.current)
    const retry = window.setInterval(() => void mark(), 12000)
    document.addEventListener('visibilitychange', mark)
    return () => { cancelled = true; observer.disconnect(); clearInterval(retry); document.removeEventListener('visibilitychange', mark) }
  }, [id, topicId, unread])
  return <article ref={article} className={kind === 'reply' ? 'space-y-1.5 py-3' : 'space-y-2 border-b border-line pb-4'}>
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft"><p><strong className="text-ink">{author ?? 'Tidligere medlem'}</strong> · {new Date(createdAt).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'short', timeStyle: 'short' })}{updatedAt > createdAt && ' · Redigert'}</p>
      {unread && <span className="font-semibold text-brass-strong">Nytt</span>}
      {canEdit && !editing && <button type="button" className="ml-auto cursor-pointer px-2 py-1 text-xs text-ink-faint hover:text-ink" onClick={() => { const initial = forumMentionDraft(body, mentions); setDraft(initial.text); setChosen(initial.chosen); setEditing(true) }}>Rediger</button>}
    </div>
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

function TopicPage() {
  useForumRefresh()
  const data = Route.useLoaderData()
  const { topic } = data
  const { page } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [body, setBody] = useState('')
  const [chosen, setChosen] = useState<MentionUser[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="mx-auto max-w-3xl space-y-5">
    <Link to="/forum" search={{ page: 0 }} className="link-quiet">← Forum</Link>
    <header className="space-y-3"><h1 className="display-title break-words text-3xl font-semibold sm:text-4xl">{topic.title}</h1>
      {topic.locked && <Stamp>Låst for nye svar</Stamp>}
      {data.canModerate && <Button size="sm" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); try { await setForumLock({ data: { id: topic.id, locked: !topic.locked } }); await router.invalidate() }
        catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke endre tråden.') } finally { setBusy(false) }
      }}>{topic.locked ? 'Åpne tråden igjen' : 'Lås tråden'}</Button>}
    </header>
    <ForumText key={topic.id} {...topic} kind="topic" mentions={data.mentions} author={data.author} canEdit={data.canEdit} />
    {error && <p role="alert" className="text-danger">{error}</p>}
    {topic.locked ? <p className="text-ink-soft">Tråden er låst. Du kan fortsatt lese samtalen.</p> : <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); if (busy) return; setBusy(true); setError('')
      try { const result = await replyToForum({ data: { topicId: topic.id, body: forumMarkers(body, chosen) } }); setBody(''); setChosen([]); await navigate({ search: { page: result.page } }); await router.invalidate() }
      catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke sende svaret.') } finally { setBusy(false) }
    }}>
      <Field label="Skriv et svar" hint="Skriv @ for å velge et medlem eller Alle i korpset."><MentionTextarea className="field-input min-h-20" required maxLength={20000} value={body} onChange={setBody} chosen={chosen} onChosenChange={setChosen} search={(query) => searchForumMentions({ data: { query } })} /></Field>
      <Button type="submit" variant="primary" disabled={busy || !body.trim()}>{busy ? 'Sender …' : 'Publiser svar'}</Button>
    </form>}
    <h2 className="display-title text-2xl">Svar</h2>
    {!data.replies.length && <p className="text-ink-soft">{page ? 'Ingen flere svar.' : 'Ingen svar ennå.'}</p>}
    <div className="divide-y divide-line">{data.replies.map(({ reply, author, canEdit, unread }) => <ForumText key={reply.id} {...reply} kind="reply" mentions={data.mentions} author={author} canEdit={canEdit} unread={!!unread} topicId={topic.id} />)}</div>
    {(page > 0 || data.hasMore) && <nav aria-label="Sider med svar" className="flex justify-between">
      {page > 0 ? <Link to="/forum/$topicId" params={{ topicId: topic.id }} search={{ page: page - 1 }}>← Nyere svar</Link> : <span />}
      {data.hasMore && <Link to="/forum/$topicId" params={{ topicId: topic.id }} search={{ page: page + 1 }}>Eldre svar →</Link>}
    </nav>}
  </div>
}
