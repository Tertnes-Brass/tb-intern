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
}: {
  postId: string
  /** Kalles med den ferdige teksten (markører, ikke navn). Kaster den, beholdes teksten. */
  onSubmit: (body: string) => Promise<void>
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

  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
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
        placeholder="Skriv en kommentar … bruk @ for å nevne noen"
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
  )
}
