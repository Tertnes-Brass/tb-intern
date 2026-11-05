import { useBlocker } from '@tanstack/react-router'
import { useRef } from 'react'
import { draftTimeLabel } from '../../lib/drafts'
import { Button, Modal } from '../ui'

/**
 * Spør før man forlater en skriveflate med ulagrede endringer — «Avbryt»,
 * tilbake-sveip, en fane eller en lenke. «Forkast» sletter også utkastet på
 * enheten; «Fortsett å skrive» blir stående. Lukking av vinduet/fanen får
 * nettleserens egen advarsel (`beforeunload`).
 *
 * `shouldBlock` er en funksjon og ikke en verdi, så kalleren kan slå vakten av
 * i samme øyeblikk som en vellykket innsending navigerer videre.
 */
export function LeaveGuard({ shouldBlock, onDiscard }: { shouldBlock: () => boolean; onDiscard: () => void }) {
  const ref = useRef(shouldBlock)
  ref.current = shouldBlock
  const blocker = useBlocker({
    shouldBlockFn: () => ref.current(),
    enableBeforeUnload: () => ref.current(),
    withResolver: true,
  })
  const open = blocker.status === 'blocked'
  return (
    <Modal open={open} onClose={() => blocker.reset?.()} title="Forkast endringene?">
      <p className="text-sm leading-relaxed text-ink-soft">
        Det du har skrevet er ikke publisert. Forkaster du, slettes teksten også fra denne enheten.
      </p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {/* type="button": vakten står inne i skjemaet, og en knapp uten type sender det. */}
        <Button
          type="button"
          variant="danger"
          onClick={() => {
            onDiscard()
            blocker.proceed?.()
          }}
        >
          Forkast
        </Button>
        <Button type="button" variant="primary" autoFocus onClick={() => blocker.reset?.()}>
          Fortsett å skrive
        </Button>
      </div>
    </Modal>
  )
}

/**
 * «Gjenopprettet utkast fra kl. 14:32 · Forkast» — en stille linje over
 * skrivefeltet når teksten kom fra enheten og ikke fra serveren.
 */
export function DraftNotice({
  restored,
  onDiscard,
  className = '',
}: {
  restored: { savedAt: number; stale: boolean } | null
  onDiscard: () => void
  className?: string
}) {
  if (!restored) return null
  return (
    <p className={`draft-notice ${className}`} role="status">
      <span className="min-w-0">
        Gjenopprettet utkast fra {draftTimeLabel(restored.savedAt)}
        {restored.stale && <span className="text-ink-faint"> · innlegget er endret siden</span>}
      </span>
      <button type="button" className="draft-notice-action hit" onClick={onDiscard}>
        Forkast
      </button>
    </p>
  )
}
