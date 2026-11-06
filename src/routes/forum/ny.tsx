import { MentionTextarea } from '../../components/MentionTextarea'
import { MediaDraftStrip, canSendWith, dropMedia, insertAtCursor, pasteMedia, useMediaDraft } from '../../components/MessageMedia'
import { ComposerTools } from '../../components/MediaPicker'
import { forumMarkers } from '../../lib/forum-mentions'
import { type TextDraft, draftKey, isTextDraft } from '../../lib/drafts'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useId, useRef, useState } from 'react'
import { ComposerBar, ComposerLayout, ComposerTitle } from '../../components/compose/Composer'
import { DraftNotice, LeaveGuard } from '../../components/compose/LeaveGuard'
import { useLocalDraft } from '../../components/compose/useLocalDraft'
import { Button } from '../../components/ui'
import { createForumTopic, searchForumMentions } from '../../server/forum'

export const Route = createFileRoute('/forum/ny')({
  beforeLoad: ({ context }) => { if (!context.me) throw redirect({ to: '/login' }) },
  component: NewTopic,
})

const EMPTY: TextDraft = { title: '', body: '', chosen: [] }

function NewTopic() {
  const navigate = useNavigate()
  const me = Route.useRouteContext().me
  const [value, setValue] = useState<TextDraft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const media = useMediaDraft()
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const bodyId = useId()
  const hintId = useId()
  // Teksten lagres på enheten mens man skriver, og «Avbryt» spør før den forkastes
  // (src/components/compose/useLocalDraft.ts og LeaveGuard.tsx).
  const local = useLocalDraft<TextDraft>({
    storageKey: me ? draftKey(me.id, { kind: 'forum-new' }) : null,
    value,
    initial: EMPTY,
    validate: isTextDraft,
    onRestore: setValue,
  })
  const leaving = useRef(false)
  const dirty = !!(value.title?.trim() || value.body.trim()) || media.items.length > 0
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const title = value.title ?? ''
  // Samme skriveflate som veggen (src/components/compose/Composer.tsx), uten
  // valg-spalten: en tråd har bare overskrift og tekst.
  // Vakten står utenfor skjemaet, så ingen knapp i arket kan sende det.
  return <><form className="composer composer-narrow" {...dropMedia(media)} onSubmit={async (event) => {
    event.preventDefault(); if (busy || !canSendWith(value.body, media)) return; setBusy(true); setError('')
    try {
      const mediaIds = media.ids
      const result = await createForumTopic({ data: { title, body: forumMarkers(value.body, value.chosen), mediaIds } })
      media.clear(mediaIds)
      local.clear(); leaving.current = true
      await navigate({ to: '/forum/$topicId', params: { topicId: result.id }, search: { page: 0 } })
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Kunne ikke opprette tråden.'); setBusy(false) }
  }}>
    <ComposerBar
      cancel={<Link to="/forum" search={{ page: 0 }} className="composer-cancel">Avbryt</Link>}
      title="Ny tråd"
      actions={<Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy || !title.trim() || !canSendWith(value.body, media)}>Publiser</Button>}
      status={local.savedAt && dirty ? 'Lagret på enheten' : null}
    />
    <DraftNotice restored={local.restored} onDiscard={() => { local.discard(); setValue(EMPTY) }} className="composer-notice" />
    {error && <p role="alert" className="composer-notice text-danger">{error}</p>}
    <ComposerLayout main={<div className="composer-sheet">
      <ComposerTitle label="Overskrift" required maxLength={180} autoFocus placeholder="Overskrift" value={title} onChange={(e) => setValue((v) => ({ ...v, title: e.target.value }))} />
      <label htmlFor={bodyId} className="sr-only">Innlegg</label>
      <MentionTextarea id={bodyId} textareaRef={bodyRef} aria-describedby={hintId} className="composer-body" placement="below" required={!media.ids.length} maxLength={20000} placeholder="For eksempel: Hvem blir med på fest etter julekonserten?" value={value.body} onChange={(body) => setValue((v) => ({ ...v, body }))} chosen={value.chosen} onChosenChange={(chosen) => setValue((v) => ({ ...v, chosen }))} search={(query) => searchForumMentions({ data: { query } })} onPaste={pasteMedia(media)} />
      <p id={hintId} className="composer-hint pb-4">Alle medlemmer kan lese tråden og svare. Skriv @ for å velge et medlem eller Alle i korpset. Bilder og GIF-er kan også limes inn eller dras hit.</p>
      <MediaDraftStrip draft={media} className="px-4 pb-3 sm:px-5" />
      <div className="composer-toolbar">
        <ComposerTools media={media} disabled={busy} onEmoji={(emoji) => insertAtCursor(bodyRef.current, value.body, (body) => setValue((v) => ({ ...v, body })), emoji)} />
      </div>
    </div>} />
  </form>
  <LeaveGuard shouldBlock={() => dirtyRef.current && !leaving.current} onDiscard={local.discard} filesPending={media.items.length > 0} />
  </>
}
