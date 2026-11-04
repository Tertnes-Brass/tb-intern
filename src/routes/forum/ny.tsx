import { MentionTextarea } from '../../components/MentionTextarea'
import { forumMarkers } from '../../lib/forum-mentions'
import type { MentionUser } from '../../lib/mentions'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { ComposerBar, ComposerLayout, ComposerTitle } from '../../components/compose/Composer'
import { Button } from '../../components/ui'
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
  const bodyId = useId()
  const hintId = useId()
  // Samme skriveflate som veggen (src/components/compose/Composer.tsx), uten
  // valg-spalten: en tråd har bare overskrift og tekst.
  return <form className="composer composer-narrow" onSubmit={async (event) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('')
    try { const result = await createForumTopic({ data: { title, body: forumMarkers(body, chosen) } }); await navigate({ to: '/forum/$topicId', params: { topicId: result.id }, search: { page: 0 } }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke opprette tråden.'); setBusy(false) }
  }}>
    <ComposerBar
      cancel={<Link to="/forum" search={{ page: 0 }} className="composer-cancel">Avbryt</Link>}
      title="Ny tråd"
      actions={<Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy || !title.trim() || !body.trim()}>Publiser</Button>}
    />
    {error && <p role="alert" className="composer-notice text-danger">{error}</p>}
    <ComposerLayout main={<div className="composer-sheet">
      <ComposerTitle label="Overskrift" required maxLength={180} autoFocus placeholder="Overskrift" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor={bodyId} className="sr-only">Innlegg</label>
      <MentionTextarea id={bodyId} aria-describedby={hintId} className="composer-body" placement="below" required maxLength={20000} placeholder="For eksempel: Hvem blir med på fest etter julekonserten?" value={body} onChange={setBody} chosen={chosen} onChosenChange={setChosen} search={(query) => searchForumMentions({ data: { query } })} />
      <p id={hintId} className="composer-hint pb-4">Alle medlemmer kan lese tråden og svare. Skriv @ for å velge et medlem eller Alle i korpset.</p>
    </div>} />
  </form>
}
