import { useEffect, useRef, useState } from 'react'
import { type TextDraft, isTextDraft } from '../lib/drafts'
import { type MentionUser, toMarkers } from '../lib/mentions'
import { searchMentionableMembers } from '../server/posts'
import { MentionTextarea } from './MentionTextarea'
import { ComposerTools } from './MediaPicker'
import { MediaDraftStrip, canSendWith, dropMedia, insertAtCursor, pasteMedia, useMediaDraft } from './MessageMedia'
import { Glyph } from './compose/Composer'
import { DraftNotice } from './compose/LeaveGuard'
import { useLocalDraft } from './compose/useLocalDraft'
import { Button } from './ui'

/**
 * Kommentarfeltet på veggen, med `@`-omtaler (#83).
 *
 * Selve autofullføringen bor i `MentionTextarea` og deles med innleggsskjemaet
 * og chatten. Det som er igjen her er kommentarens egen del: hva som skjer ved
 * innsending, og at teksten blir stående hvis nettet svikter.
 *
 * `toMarkers` oversetter `@Navn` til markører rett før innsending, og matcher
 * KUN navn som faktisk er valgt fra lista. Skriver noen `@Ola Nordmann` for
 * hånd, blir det stående som ren tekst — og serveren validerer uansett hver
 * markør på nytt før kommentaren lagres.
 *
 * Forslagslista legges OVER feltet: kommentarfeltet ligger nederst i tråden, og
 * på mobil står det rett over tastaturet når det har fokus. Plassen er der oppe.
 *
 * Bilder og GIF-er (knappen, lim inn eller dra inn) lastes opp straks de velges
 * og sendes som id-er sammen med teksten — se `MessageMedia.tsx`.
 *
 * `variant="dock"` er feltet i linjen nederst på detaljsiden (`.comment-dock`):
 * én linje som vokser med teksten (opp til ~6 linjer) og en rund sendeknapp,
 * som i en meldingsapp.
 *
 * `draftKey` (fra `draftKey(me.id, { kind: 'comment', … })`) lagrer teksten på
 * enheten mens man skriver, så den er der igjen etter en navigasjon eller en
 * omlasting — «Gjenopprettet utkast fra kl. … · Forkast» over feltet.
 */
export function CommentComposer({
  postId,
  onSubmit,
  replyTo,
  onCancel,
  variant = 'inline',
  draftKey,
}: {
  postId: string
  /** Kalles med den ferdige teksten (markører, ikke navn) og bildene. Kaster den, beholdes teksten og bildene. */
  onSubmit: (body: string, mediaIds: string[]) => Promise<void>
  /**
   * Svar på en kommentar: feltet åpner seg i tråden, får fokus i samme trykk
   * (ellers kommer ikke tastaturet opp på iPhone) og viser hvem man svarer.
   */
  replyTo?: { name: string }
  onCancel?: () => void
  variant?: 'inline' | 'dock'
  draftKey?: string
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  /** Medlemmene som FAKTISK er valgt fra lista — grunnlaget for `toMarkers`. */
  const [chosen, setChosen] = useState<MentionUser[]>([])
  const media = useMediaDraft()
  const textRef = useRef<HTMLTextAreaElement>(null)
  const dockRef = useRef<HTMLTextAreaElement>(null)
  const local = useLocalDraft<TextDraft>({
    storageKey: draftKey,
    value: { body, chosen },
    initial: EMPTY_DRAFT,
    validate: isTextDraft,
    onRestore: (draft) => {
      setBody(draft.body)
      setChosen(draft.chosen)
    },
  })
  const discard = () => {
    local.discard()
    setBody('')
    setChosen([])
  }
  const notice = <DraftNotice restored={local.restored} onDiscard={discard} />

  // Dokk-feltet vokser med teksten, så man ser hva man skriver.
  useEffect(() => {
    const el = dockRef.current
    if (!el || variant !== 'dock') return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`
  }, [body, variant])

  const submit = async () => {
    const text = toMarkers(body, chosen)
    if (busy || !canSendWith(text, media)) return
    setBusy(true)
    const mediaIds = media.ids
    try {
      await onSubmit(text, mediaIds)
      // Bildene hører til kommentaren nå og skal ikke slettes når feltet lukkes.
      media.clear(mediaIds)
      local.clear()
      setBody('')
      setChosen([])
    } catch {
      // Kalleren har allerede vist feilen. Teksten blir stående, så en tapt
      // forbindelse ikke koster skribenten kommentaren.
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'dock') {
    return (
      <>
      {notice}
      <MediaDraftStrip draft={media} className="mb-2" />
      <div className="flex items-end gap-1.5" {...dropMedia(media)}>
        <ComposerTools media={media} disabled={busy} compact onEmoji={(emoji) => insertAtCursor(dockRef.current, body, setBody, emoji)} />
        <MentionTextarea
          textareaRef={dockRef}
          wrapperClassName="min-w-0 flex-1"
          className="field-input comment-dock-input"
          rows={1}
          value={body}
          onChange={setBody}
          chosen={chosen}
          onChosenChange={setChosen}
          search={(query) => searchMentionableMembers({ data: { postId, query } })}
          onEnter={() => void submit()}
          onPaste={pasteMedia(media)}
          aria-label="Ny kommentar"
          placeholder="Skriv en kommentar …"
        />
        <Button
          type="button"
          variant="primary"
          loading={busy}
          disabled={!canSendWith(body, media)}
          onClick={() => void submit()}
          aria-label="Kommenter"
          className="comment-dock-send"
        >
          {!busy && <Glyph name="send" size={18} />}
        </Button>
      </div>
      </>
    )
  }

  const field = (
    <div className={replyTo ? 'space-y-2' : 'mt-4 space-y-2'} {...dropMedia(media)}>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <MentionTextarea
        textareaRef={textRef}
        wrapperClassName="flex-1"
        className="field-input min-h-16 w-full resize-y text-sm"
        value={body}
        onChange={setBody}
        chosen={chosen}
        onChosenChange={setChosen}
        // Hvem som kan omtales avgjøres server-side av innlegget: kun aktive
        // medlemmer som selv kan lese det.
        search={(query) => searchMentionableMembers({ data: { postId, query } })}
        onEnter={() => void submit()}
        onPaste={pasteMedia(media)}
        // Escape lukker først forslagslista (i MentionTextarea), så et tomt svarfelt.
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onCancel && !busy && !body.trim() && !media.items.length) onCancel()
        }}
        autoFocus={!!replyTo}
        aria-label={replyTo ? `Svar til ${replyTo.name}` : 'Ny kommentar'}
        placeholder={replyTo ? `Svar ${replyTo.name} … bruk @ for å nevne noen` : 'Skriv en kommentar … bruk @ for å nevne noen'}
      />
      <div className="flex gap-2">
        <ComposerTools media={media} disabled={busy} compact onEmoji={(emoji) => insertAtCursor(textRef.current, body, setBody, emoji)} />
        <Button
          type="button"
          variant="primary"
          loading={busy}
          disabled={!canSendWith(body, media)}
          onClick={() => void submit()}
          className="flex-1 sm:flex-none"
        >
          {replyTo ? 'Svar' : 'Kommenter'}
        </Button>
      </div>
    </div>
    <MediaDraftStrip draft={media} />
    </div>
  )
  if (!replyTo) return <>{local.restored && <DraftNotice restored={local.restored} onDiscard={discard} className="mt-4" />}{field}</>
  return (
    <div className="space-y-2 rounded-[9px] border border-line bg-paper-sunken/40 p-3">
      <div className="flex items-center gap-2 text-xs text-ink-soft">
        <span className="h-4 w-[3px] shrink-0 rounded-full bg-brass" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          Svarer <strong className="text-ink">{replyTo.name}</strong>
        </span>
        {/* Ikke mens kommentaren sendes: «Avbryt» sletter bildene, og de kan være på vei inn. */}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="shrink-0 cursor-pointer px-1 py-0.5 text-ink-faint hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            Avbryt
          </button>
        )}
      </div>
      {notice}
      {field}
    </div>
  )
}

const EMPTY_DRAFT: TextDraft = { body: '', chosen: [] }
