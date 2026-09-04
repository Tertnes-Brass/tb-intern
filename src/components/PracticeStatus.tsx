import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  PRACTICE_COMMENT_MAX,
  PRACTICE_HINTS,
  PRACTICE_LABELS,
  PRACTICE_STATUSES,
  practiceSummary,
  type PracticeCounts,
  type PracticeStatus,
} from '../lib/practice'
import type { ProjectPractice } from '../server/practice'
import { clearMyPracticeStatus, setMyPracticeStatus } from '../server/practice'
import { toast, toastError } from './toast'
import { Button, Stamp } from './ui'

/**
 * Frivillig øvingsstatus per verk (#30).
 *
 * **Tonen er kravet.** Saken ber om noe som føles støttende, ikke
 * kontrollerende, og det er UI-et som avgjør om den følelsen stemmer:
 *
 * - Ingen skjerm her viser hvem som IKKE har markert noe. Serveren sender
 *   heller ikke tallet som skulle til for å regne det ut (`src/lib/practice.ts`).
 * - Å trykke på en status man allerede har, fjerner den. Statusen skal være like
 *   lett å ta bort som å sette — ellers er den ikke frivillig.
 * - «Vil øve med noen» er et ØNSKE, ikke et varsel. Den vises i oversikten som
 *   noe dirigenten og gruppelederen kan svare på, aldri som en avviksliste.
 */

const chipBase =
  'cursor-pointer rounded-[7px] border px-2.5 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.07em] transition-all disabled:opacity-50 disabled:pointer-events-none'

/** Min egen status på ett verk. Rendres i repertoarraden på prosjektsiden. */
export function PracticeControl({
  projectId,
  workId,
  mine,
  counts,
}: {
  projectId: string
  workId: string
  mine: { status: PracticeStatus; comment: string | null } | null
  counts: PracticeCounts | null
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [commentOpen, setCommentOpen] = useState(false)
  const [comment, setComment] = useState(mine?.comment ?? '')

  const choose = async (status: PracticeStatus) => {
    setSaving(true)
    try {
      // Samme status om igjen = fjern den. Frivillig betyr at veien ut er like
      // kort som veien inn.
      if (mine?.status === status) {
        await clearMyPracticeStatus({ data: { projectId, workId } })
        setCommentOpen(false)
        setComment('')
        toast('Statusen er fjernet')
      } else {
        await setMyPracticeStatus({ data: { projectId, workId, status, comment: comment.trim() || null } })
        toast('Takk — det er notert')
      }
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  const saveComment = async () => {
    if (!mine) return
    setSaving(true)
    try {
      await setMyPracticeStatus({
        data: { projectId, workId, status: mine.status, comment: comment.trim() || null },
      })
      setCommentOpen(false)
      toast('Merknaden er lagret')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="print-hidden mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRACTICE_STATUSES.map((status) => {
          const active = mine?.status === status
          return (
            <button
              key={status}
              type="button"
              disabled={saving}
              aria-pressed={active}
              title={PRACTICE_HINTS[status]}
              onClick={() => choose(status)}
              className={`${chipBase} ${
                active
                  ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
                  : 'border-line-strong text-ink-faint hover:border-brass/50 hover:text-ink-soft'
              }`}
            >
              {PRACTICE_LABELS[status]}
            </button>
          )
        })}
        {mine && !commentOpen && (
          <button
            type="button"
            onClick={() => setCommentOpen(true)}
            className="inline-flex cursor-pointer items-center rounded-lg px-2 py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ink-faint transition-colors hover:text-brass-strong"
          >
            {mine.comment ? 'Endre merknad' : '+ Merknad'}
          </button>
        )}
      </div>

      {mine?.comment && !commentOpen && (
        <p className="mt-1.5 text-[0.82rem] leading-snug text-ink-soft">«{mine.comment}»</p>
      )}

      {commentOpen && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <input
            className="field-input min-w-48 flex-1"
            value={comment}
            maxLength={PRACTICE_COMMENT_MAX}
            placeholder="Takt 40 og utover"
            autoFocus
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setComment(mine?.comment ?? '')
                setCommentOpen(false)
              }
            }}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" loading={saving} onClick={saveComment}>
              Lagre
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setComment(mine?.comment ?? '')
                setCommentOpen(false)
              }}
            >
              Avbryt
            </Button>
          </div>
        </div>
      )}

      {counts && counts.total > 0 && (
        <p className="mt-1.5 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint">
          {practiceSummary(counts)}
        </p>
      )}
    </div>
  )
}

/**
 * Oversikten for dirigenten og gruppelederen. Serveren har allerede filtrert
 * navnene på leserens omfang (`practiceScope`) — skjermen filtrerer ingenting,
 * den viser det den fikk.
 */
export function PracticeOverview({
  repertoire,
  practice,
}: {
  repertoire: Array<{ workId: string; title: string }>
  practice: ProjectPractice
}) {
  if (practice.names === null) return null

  const rows = repertoire
    .map((work) => ({
      ...work,
      counts: practice.counts[work.workId] ?? null,
      names: practice.names?.[work.workId] ?? [],
    }))
    .filter((row) => row.names.length > 0 || (row.counts?.total ?? 0) > 0)

  return (
    <section className="rise" style={{ animationDelay: '140ms' }}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="kicker">Øvingsstatus</h2>
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint">
          {practice.scope === 'sections' ? 'Dine stemmegrupper' : 'Hele korpset'}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-2 text-sm leading-relaxed text-ink-soft">
          Ingen har markert noe ennå. Statusen er frivillig, og folk setter den når de vil — det finnes
          ingen liste over hvem som ikke har gjort det.
        </p>
      ) : (
        <>
          <ul className="sheet divide-y divide-[var(--line)] overflow-hidden">
            {rows.map((row) => {
              const wantsHelp = row.names.filter((n) => n.status === 'needs_help')
              return (
                <li key={row.workId} className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="display-title text-[1rem] font-semibold text-ink">{row.title}</span>
                    <span className="font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ink-faint">
                      {row.counts ? practiceSummary(row.counts) : ''}
                    </span>
                  </div>

                  {wantsHelp.length > 0 && (
                    <ul className="mt-2 space-y-1 border-l-2 border-brass/40 pl-3">
                      {wantsHelp.map((n) => (
                        <li key={n.userId} className="text-[0.86rem] leading-snug text-ink-soft">
                          <span className="font-semibold text-ink">{n.name}</span>
                          {n.partName ? <span className="text-ink-faint"> · {n.partName}</span> : null}
                          {n.comment ? <span> — «{n.comment}»</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}

                  {row.names.length > wantsHelp.length && (
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {row.names
                        .filter((n) => n.status !== 'needs_help')
                        .map((n) => (
                          <Stamp key={n.userId} title={n.comment ?? undefined}>
                            {n.name} · {PRACTICE_LABELS[n.status].toLowerCase()}
                          </Stamp>
                        ))}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="mt-2.5 text-[0.78rem] leading-snug text-ink-faint">
            Frivillig og selvvalgt. «{PRACTICE_LABELS.needs_help}» er et ønske om å ta stykket sammen med
            noen — ikke en anmerkning.
          </p>
        </>
      )}
    </section>
  )
}
