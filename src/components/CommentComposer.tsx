import { useState } from 'react'
import { type MentionUser, toMarkers } from '../lib/mentions'
import { searchMentionableMembers } from '../server/posts'
import { MentionTextarea } from './MentionTextarea'
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
 */
export function CommentComposer({
  postId,
  onSubmit,
  replyTo,
  onCancel,
}: {
  postId: string
  /** Kalles med den ferdige teksten (markører, ikke navn). Kaster den, beholdes teksten. */
  onSubmit: (body: string) => Promise<void>
  /**
   * Svar på en kommentar: feltet åpner seg i tråden, får fokus i samme trykk
   * (ellers kommer ikke tastaturet opp på iPhone) og viser hvem man svarer.
   */
  replyTo?: { name: string }
  onCancel?: () => void
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  /** Medlemmene som FAKTISK er valgt fra lista — grunnlaget for `toMarkers`. */
  const [chosen, setChosen] = useState<MentionUser[]>([])

  const submit = async () => {
    const text = toMarkers(body, chosen)
    if (!text.trim()) return
    setBusy(true)
    try {
      await onSubmit(text)
      setBody('')
      setChosen([])
    } catch {
      // Kalleren har allerede vist feilen. Teksten blir stående, så en tapt
      // forbindelse ikke koster skribenten kommentaren.
    } finally {
      setBusy(false)
    }
  }

  const field = (
    <div className={replyTo ? 'flex flex-col gap-2 sm:flex-row sm:items-end' : 'mt-4 flex flex-col gap-2 sm:flex-row sm:items-end'}>
      <MentionTextarea
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
        // Escape lukker først forslagslista (i MentionTextarea), så et tomt svarfelt.
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onCancel && !body.trim()) onCancel()
        }}
        autoFocus={!!replyTo}
        aria-label={replyTo ? `Svar til ${replyTo.name}` : 'Ny kommentar'}
        placeholder={replyTo ? `Svar ${replyTo.name} … bruk @ for å nevne noen` : 'Skriv en kommentar … bruk @ for å nevne noen'}
      />
      <Button
        type="button"
        variant="primary"
        loading={busy}
        disabled={!body.trim()}
        onClick={() => void submit()}
        className="w-full sm:w-auto"
      >
        {replyTo ? 'Svar' : 'Kommenter'}
      </Button>
    </div>
  )
  if (!replyTo) return field
  return (
    <div className="space-y-2 rounded-[9px] border border-line bg-paper-sunken/40 p-3">
      <div className="flex items-center gap-2 text-xs text-ink-soft">
        <span className="h-4 w-[3px] shrink-0 rounded-full bg-brass" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          Svarer <strong className="text-ink">{replyTo.name}</strong>
        </span>
        {onCancel && (
          <button type="button" onClick={onCancel} className="shrink-0 cursor-pointer px-1 py-0.5 text-ink-faint hover:text-ink">
            Avbryt
          </button>
        )}
      </div>
      {field}
    </div>
  )
}
