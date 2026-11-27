import { useEffect, useState } from 'react'
import { CALLOUT_KIND_LABEL, CALLOUT_LOCATION_MAX, CALLOUT_NEEDED_MAX, type CalloutKind } from '../lib/callouts'
import type { PostCalloutDraft } from '../lib/drafts'
import { formatDate } from '../lib/format'
import { listAskableGigs } from '../server/callouts'
import { Segmented } from './Segmented'
import { toastError } from './toast'

type Gig = Awaited<ReturnType<typeof listAskableGigs>>[number]

export const EMPTY_CALLOUT: PostCalloutDraft = {
  kind: 'dugnad',
  projectId: '',
  eventDate: '',
  startTime: '',
  location: '',
  respondBy: '',
  needed: '',
}

/**
 * Feltene som gjør et innlegg til «Kan du?». Et spilleoppdrag kan knyttes til
 * et oppdrag som finnes, eller lages her. Da blir tittelen navnet på oppdraget.
 */
export function CalloutFields({
  value,
  onChange,
  onRemove,
  kinds,
  locked,
  linked,
  onGigPicked,
}: {
  value: PostCalloutDraft
  onChange: (next: PostCalloutDraft) => void
  onRemove: () => void
  /** Typene denne personen kan stille spørsmål om. */
  kinds: CalloutKind[]
  /** Noen har svart: typen og oppdraget står fast. */
  locked: boolean
  /** Lagret på et oppdrag: dato, tid og sted endres på prosjektet. */
  linked: { name: string; when: string } | null
  onGigPicked?: (gig: Gig) => void
}) {
  const [gigs, setGigs] = useState<Gig[] | null>(null)
  const isGig = value.kind === 'spilleoppdrag'
  const set = (patch: Partial<PostCalloutDraft>) => onChange({ ...value, ...patch })

  useEffect(() => {
    if (!isGig || linked || gigs) return
    let cancelled = false
    listAskableGigs()
      .then((rows) => {
        if (cancelled) return
        setGigs(rows)
        const preset = rows.find((gig) => gig.id === value.projectId)
        if (preset) onGigPicked?.(preset)
      })
      .catch((err) => {
        if (!cancelled) toastError(err)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGig, linked])

  const chosenGig = gigs?.find((gig) => gig.id === value.projectId) ?? null
  const usesProject = isGig && (!!linked || !!chosenGig)

  return (
    <section aria-label="Kan du?" className="mx-4 mb-3 rounded-[11px] border border-line bg-paper-sunken/40 p-3.5 sm:mx-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.92rem] font-semibold text-ink">Kan du?</p>
          <p className="text-xs leading-snug text-ink-faint">
            {isGig ? 'Folk svarer om de kan. Du velger hvem som spiller.' : 'Folk svarer om de kan, og «Kan» betyr at de er med.'}
          </p>
        </div>
        <button type="button" onClick={onRemove} className="hit shrink-0 cursor-pointer text-[0.82rem] font-medium text-ink-soft hover:text-danger">
          Fjern
        </button>
      </div>

      <div className="space-y-3">
        {kinds.length > 1 && !locked && (
          <Segmented
            label="Hva gjelder det?"
            stretch
            value={value.kind}
            options={kinds.map((kind) => ({ value: kind, label: CALLOUT_KIND_LABEL[kind] }))}
            onChange={(kind) => set({ kind, projectId: '' })}
          />
        )}

        {isGig && !linked && !locked && (
          <label className="block">
            <span className="composer-label">Oppdrag</span>
            <select
              className="field-input"
              value={value.projectId}
              onChange={(e) => {
                const gig = gigs?.find((g) => g.id === e.target.value)
                set({ projectId: e.target.value })
                if (gig) onGigPicked?.(gig)
              }}
            >
              <option value="">Nytt spilleoppdrag</option>
              {(gigs ?? []).map((gig) => (
                <option key={gig.id} value={gig.id}>
                  {gig.name}
                  {gig.eventDate ? ` · ${formatDate(gig.eventDate)}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {usesProject ? (
          <p className="rounded-[9px] border border-line px-3 py-2 text-sm leading-snug text-ink-soft">
            <strong className="font-semibold text-ink">{linked?.name ?? chosenGig?.name}</strong>
            {' · '}
            {linked?.when ??
              [chosenGig?.eventDate ? formatDate(chosenGig.eventDate) : null, chosenGig?.startTime, chosenGig?.venue].filter(Boolean).join(' · ')}
            <span className="mt-0.5 block text-xs text-ink-faint">Dato, tid og sted endres på prosjektet.</span>
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="composer-label">Dato</span>
                <input type="date" required className="field-input" value={value.eventDate} onChange={(e) => set({ eventDate: e.target.value })} />
              </label>
              <label className="block">
                <span className="composer-label">Klokkeslett</span>
                <input type="time" className="field-input" value={value.startTime} onChange={(e) => set({ startTime: e.target.value })} />
              </label>
            </div>
            <label className="block">
              <span className="composer-label">Sted</span>
              <input
                className="field-input"
                value={value.location}
                maxLength={CALLOUT_LOCATION_MAX}
                onChange={(e) => set({ location: e.target.value })}
                placeholder={isGig ? 'Scandic Bergen City' : 'Øvingslokalet'}
              />
            </label>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="composer-label">Svarfrist</span>
            <input type="date" className="field-input" value={value.respondBy} onChange={(e) => set({ respondBy: e.target.value })} />
          </label>
          <label className="block">
            <span className="composer-label">Trenger</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={CALLOUT_NEEDED_MAX}
              className="field-input"
              value={value.needed}
              onChange={(e) => set({ needed: e.target.value })}
              placeholder="Antall"
            />
          </label>
        </div>
      </div>
    </section>
  )
}
