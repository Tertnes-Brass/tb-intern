import { MentionTextarea } from '../../components/MentionTextarea'
import { forumMarkers } from '../../lib/forum-mentions'
import type { MentionUser } from '../../lib/mentions'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button, Field } from '../../components/ui'
import { createForumTopic, searchForumMentions } from '../../server/forum'

export const Route = createFileRoute('/forum/ny')({
  beforeLoad: ({ context }) => { if (!context.me) throw redirect({ to: '/login' }) },
  component: NewTopic,
})

function NewTopic() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [chosen, setChosen] = useState<MentionUser[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="mx-auto max-w-2xl space-y-6">
    <Link to="/forum" search={{ page: 0 }} className="link-quiet">← Forum</Link>
    <h1 className="display-title text-3xl font-semibold">Start en tråd</h1>
    <p className="text-ink-soft">Alle medlemmer kan lese tråden og svare.</p>
    <form className="sheet space-y-5 p-6" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return; setBusy(true); setError('')
      try { const result = await createForumTopic({ data: { title, body: forumMarkers(body, chosen) } }); await navigate({ to: '/forum/$topicId', params: { topicId: result.id }, search: { page: 0 } }) }
      catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke opprette tråden.'); setBusy(false) }
    }}>
      <Field label="Overskrift"><input className="field-input" required maxLength={180} placeholder="For eksempel: Hvem blir med på fest?" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Innlegg" hint="Skriv @ for å velge et medlem eller Alle i korpset."><MentionTextarea className="field-input min-h-48" required maxLength={20000} value={body} onChange={setBody} chosen={chosen} onChosenChange={setChosen} search={(query) => searchForumMentions({ data: { query } })} /></Field>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy || !title.trim() || !body.trim()}>{busy ? 'Oppretter …' : 'Publiser tråd'}</Button>
    </form>
  </div>
}
