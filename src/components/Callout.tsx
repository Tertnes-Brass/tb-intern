import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  CALLOUT_KIND_LABEL,
  CALLOUT_NOTE_MAX,
  CALLOUT_STATUSES,
  CALLOUT_STATUS_LABEL,
  type CalloutKind,
  type CalloutStatus,
  calloutCountLabel,
  calloutMineLabel,
} from '../lib/callouts'
import { formatDate, formatWeekday } from '../lib/format'
import { respondToCallout, setCalloutClosed } from '../server/callouts'
import type { CalloutDetail, CalloutSummary } from '../server/posts'
import type { CalloutManagedPerson } from '../server/callout-store'
import { Icon } from './Icons'
import { CrewEditor } from './ProjectCrew'
import { Segmented } from './Segmented'
import { toast, toastError } from './toast'
import { Avatar, BottomSheet, Button, buttonClass } from './ui'

/**
 * «Kan du?» på et innlegg. Kortet på veggen og detaljsiden deler knappene, så
 * man kan svare der man møter spørsmålet. Samtalen er innleggets vanlige
 * kommentarer; merknaden her er bare en kort beskjed til den ansvarlige.
 */

export function calloutWhen(c: { eventDate: string | null; startTime: string | null }): string {
  if (!c.eventDate) return ''
  const weekday = formatWeekday(c.eventDate)
  const day = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${formatDate(c.eventDate)}`
  return c.startTime ? `${day} kl. ${c.startTime}` : day
}

const CHOICE_ON: Record<CalloutStatus, string> = {
  yes: 'border-brass bg-[var(--brass-soft)] text-brass-strong',
  maybe: 'border-line-strong bg-paper-sunken text-ink',
  no: 'border-oxblood/60 bg-oxblood/10 text-oxblood',
}

/** De tre knappene og linjen om hva svaret betyr. Svaret vises med en gang. */
export function CalloutChoices({
  postId,
  kind,
  title,
  callout,
}: {
  postId: string
  kind: CalloutKind
  title: string
  callout: Pick<CalloutSummary, 'mine' | 'state' | 'isCrew'>
}) {
  const router = useRouter()
  const [mine, setMine] = useState(callout.mine)
  const [busy, setBusy] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  useEffect(() => setMine(callout.mine), [callout.mine?.status, callout.mine?.note])

  const write = async (status: CalloutStatus | null, note?: string | null) => {
    const before = mine
    setMine(status ? { status, note: note === undefined ? (mine?.note ?? null) : note } : null)
    setBusy(true)
    try {
      await respondToCallout({ data: { postId, status, ...(note === undefined ? {} : { note }) } })
      await router.invalidate()
    } catch (err) {
      setMine(before)
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const { state } = callout
  const locked = state.allowed.length === 0
  return (
    <div>
      {!locked && (
        <div role="group" aria-label={`Kan du? ${title}`} className="grid grid-cols-3 gap-1.5">
          {CALLOUT_STATUSES.map((status) => {
            const on = mine?.status === status
            // Etter fristen kan man fortsatt si fra om at man ikke kan.
            const disabled = busy || (!state.allowed.includes(status) && !on)
            return (
              <button
                key={status}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => {
                  if (on && !state.canClear) return
                  void write(on ? null : status)
                }}
                className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-[9px] border px-2 text-[0.88rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  on ? CHOICE_ON[status] : 'border-line-strong text-ink-soft can-hover:hover:border-brass/60 can-hover:hover:text-ink'
                }`}
              >
                {on && <Icon name="check" size={14} />}
                {CALLOUT_STATUS_LABEL[status]}
              </button>
            )
          })}
        </div>
      )}

      {state.message && <p className="mt-2 text-xs leading-snug text-ink-faint">{state.message}</p>}

      {mine && (
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5" aria-live="polite">
          <p className="min-w-0 text-[0.82rem] font-medium leading-snug text-ink-soft">
            {calloutMineLabel(kind, mine.status, callout.isCrew)}
            {mine.note && <span className="font-normal text-ink-faint"> · «{mine.note}»</span>}
          </p>
          {!locked && (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="hit cursor-pointer text-[0.8rem] font-medium text-brass-strong hover:underline"
            >
              {mine.note ? 'Endre merknad' : 'Legg til merknad'}
            </button>
          )}
        </div>
      )}

      <NoteSheet
        open={noteOpen}
        title={title}
        initial={mine?.note ?? ''}
        onClose={() => setNoteOpen(false)}
        onSave={async (note) => {
          setNoteOpen(false)
          if (mine) await write(mine.status, note)
        }}
      />
    </div>
  )
}

function NoteSheet({
  open,
  title,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  title: string
  initial: string
  onClose: () => void
  onSave: (note: string | null) => void | Promise<void>
}) {
  const [text, setText] = useState(initial)
  useEffect(() => {
    if (open) setText(initial)
  }, [open, initial])
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Merknad"
      subtitle={title}
      footer={
        <Button variant="primary" className="w-full" onClick={() => void onSave(text.trim() || null)}>
          Lagre merknaden
        </Button>
      }
    >
      <label className="block">
        <span className="sr-only">Merknad til den ansvarlige</span>
        <textarea
          className="field-input min-h-24 resize-y"
          value={text}
          maxLength={CALLOUT_NOTE_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="Kan først etter kl. 18, tar med tilhenger …"
        />
      </label>
      <p className="mt-1.5 text-xs leading-snug text-ink-faint">
        Bare den ansvarlige ser merknaden. Spørsmål til alle passer bedre i kommentarene.
      </p>
    </BottomSheet>
  )
}

function Facts({ callout }: { callout: Pick<CalloutSummary, 'eventDate' | 'startTime' | 'location' | 'respondBy'> }) {
  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-[0.95rem] font-semibold leading-snug text-ink">{calloutWhen(callout)}</p>
      {callout.location && (
        <p className="flex items-start gap-1 text-[0.85rem] leading-snug text-ink-soft">
          <Icon name="pin" size={14} className="mt-[2px] shrink-0 text-brass" />
          <span className="min-w-0 break-words">{callout.location}</span>
        </p>
      )}
      {callout.respondBy && <p className="text-[0.78rem] text-ink-faint">Svar innen {formatDate(callout.respondBy)}</p>}
    </div>
  )
}

/** Kompakt versjon på kortet på veggen. Navnene og resten står på innlegget. */
export function CalloutCard({ postId, title, callout }: { postId: string; title: string; callout: CalloutSummary }) {
  const others = callout.yesCount - callout.yesPreview.length
  return (
    <section aria-label="Kan du?" className="mt-3 rounded-[11px] border border-line bg-paper-sunken/40 p-3">
      <p className="kicker">Kan du? · {CALLOUT_KIND_LABEL[callout.kind]}</p>
      <Facts callout={callout} />
      <div className="mt-2.5">
        <CalloutChoices postId={postId} kind={callout.kind} title={title} callout={callout} />
      </div>
      <Link to="/beskjeder/$postId" params={{ postId }} className="link-quiet mt-2 block text-[0.8rem] leading-snug text-ink-soft">
        <strong className="font-semibold text-ink">{calloutCountLabel(callout.yesCount, callout.needed)}</strong>
        {callout.yesPreview.length > 0 && ` · ${callout.yesPreview.join(', ')}${others > 0 ? ` +${others}` : ''}`}
      </Link>
    </section>
  )
}

type View = 'status' | 'part'

/** Hele spørsmålet på innlegget, med den ansvarliges oversikt. */
export function CalloutPanel({ postId, title, callout }: { postId: string; title: string; callout: CalloutDetail }) {
  const router = useRouter()
  const [picking, setPicking] = useState(false)
  const [closing, setClosing] = useState(false)
  const closed = callout.state.phase === 'closed'

  const toggleClosed = async () => {
    setClosing(true)
    try {
      await setCalloutClosed({ data: { postId, closed: !closed } })
      toast(closed ? 'Svarene er åpnet igjen' : 'Svarene er stengt')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setClosing(false)
    }
  }

  return (
    <section aria-labelledby="kan-du-tittel" className="surface-group p-4 sm:p-5">
      <h2 id="kan-du-tittel" className="kicker">
        Kan du? · {CALLOUT_KIND_LABEL[callout.kind]}
      </h2>
      <Facts callout={callout} />
      {callout.kind === 'spilleoppdrag' && !callout.isCrew && !callout.mine && (
        <p className="mt-1.5 text-[0.82rem] leading-snug text-ink-soft">
          Svar om du kan. Den ansvarlige velger hvem som spiller, og de valgte får notene.
        </p>
      )}

      <div className="mt-3">
        <CalloutChoices postId={postId} kind={callout.kind} title={title} callout={callout} />
      </div>

      {callout.isCrew && callout.projectId && (
        <Link to="/noter/prosjekter/$projectId" params={{ projectId: callout.projectId }} className="link-brass hit mt-2 inline-block text-sm">
          Åpne oppdraget og notene
        </Link>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <p className="text-[0.88rem] font-semibold text-ink">{calloutCountLabel(callout.yesCount, callout.needed)}</p>
        {!callout.manage &&
          (callout.yes.length > 0 ? (
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{callout.yes.map((p) => p.name).join(', ')}</p>
          ) : (
            <p className="mt-1 text-sm text-ink-faint">Ingen har svart at de kan ennå.</p>
          ))}
        {callout.manage && <ManageView callout={callout} manage={callout.manage} />}
      </div>

      {callout.canManage && (
        <div className="mt-4 flex flex-wrap gap-2">
          {callout.canPickCrew && callout.projectId && (
            <Button variant="primary" size="sm" onClick={() => setPicking(true)}>
              Velg hvem som spiller
            </Button>
          )}
          {callout.projectId && !callout.isCrew && callout.canPickCrew && (
            <Link to="/noter/prosjekter/$projectId" params={{ projectId: callout.projectId }} className={buttonClass('secondary', 'sm')}>
              Åpne oppdraget
            </Link>
          )}
          {callout.state.phase !== 'past' && (
            <Button variant="ghost" size="sm" loading={closing} onClick={() => void toggleClosed()}>
              {closed ? 'Åpne svarene igjen' : 'Steng svarene'}
            </Button>
          )}
        </div>
      )}

      {callout.canPickCrew && callout.projectId && (
        <CrewEditor projectId={callout.projectId} open={picking} onClose={() => setPicking(false)} />
      )}
    </section>
  )
}

function ManageView({ callout, manage }: { callout: CalloutDetail; manage: NonNullable<CalloutDetail['manage']> }) {
  const [view, setView] = useState<View>('status')
  const showParts = callout.kind === 'spilleoppdrag'
  return (
    <div className="mt-2">
      {showParts && (
        <Segmented
          label="Vis svarene"
          value={view}
          options={[
            { value: 'status', label: 'Etter svar' },
            { value: 'part', label: 'Etter stemme' },
          ]}
          onChange={setView}
          className="mb-3"
        />
      )}
      {view === 'part' && showParts ? (
        <ul className="divide-y divide-line">
          {manage.byPart.map((part) => (
            <li key={part.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="w-32 shrink-0 text-[0.85rem] font-medium text-ink">{part.name}</span>
              <span className="min-w-0 flex-1 text-right text-[0.85rem] leading-snug">
                {part.people.length === 0 ? (
                  <span className="text-ink-faint">Ingen ennå</span>
                ) : (
                  part.people.map((p, i) => (
                    <span key={p.userId} className={p.status === 'yes' ? 'text-ink' : 'text-ink-faint'}>
                      {i > 0 && ', '}
                      {p.name}
                      {p.status === 'maybe' && ' (usikker)'}
                      {p.isCrew && ' ✓'}
                    </span>
                  ))
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3">
          <PeopleGroup label="Kan" people={manage.yes} open />
          <PeopleGroup label="Usikker" people={manage.maybe} open />
          <PeopleGroup label="Kan ikke" people={manage.no} open />
          <PeopleGroup label="Ikke svart" people={manage.unanswered} />
        </div>
      )}
      <p className="mt-3 text-xs leading-snug text-ink-faint">
        Bare du og andre ansvarlige ser usikre, nei, ubesvarte og merknader.
      </p>
    </div>
  )
}

function PeopleGroup({ label, people, open = false }: { label: string; people: CalloutManagedPerson[]; open?: boolean }) {
  if (people.length === 0) return null
  return (
    <details open={open} className="group">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-[0.82rem] font-semibold text-ink-soft">
        <Icon name="chevronRight" size={14} className="shrink-0 transition-transform group-open:rotate-90" />
        {label} <span className="tabular font-normal text-ink-faint">{people.length}</span>
      </summary>
      <ul className="mt-0.5 space-y-1.5 pl-5">
        {people.map((p) => (
          <li key={p.userId} className="flex items-start gap-2">
            <Avatar name={p.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block text-[0.88rem] font-medium leading-tight text-ink">
                {p.name}
                {p.isCrew && <span className="ml-1.5 text-[0.72rem] font-semibold text-brass-strong">Valgt</span>}
              </span>
              {p.parts.length > 0 && <span className="block truncate text-xs text-ink-faint">{p.parts.join(' · ')}</span>}
              {p.note && <span className="mt-0.5 block text-[0.82rem] leading-snug text-ink-soft">«{p.note}»</span>}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
