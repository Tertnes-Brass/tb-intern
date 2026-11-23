import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { CALLOUT_STATUS_LABEL, CALLOUT_STATUS_RANK, type CalloutStatus } from '../lib/callouts'
import { getCrewOptions, setProjectCrew } from '../server/project-crew'
import type { CrewMember } from '../server/project-crew-store'
import { Icon } from './Icons'
import { toast, toastError } from './toast'
import { Avatar, Button, buttonClass, Modal } from './ui'

/**
 * «Med på oppdraget»: hvem som spiller, og hvilken stemme. Alle som ser et
 * spilleoppdrag ser besetningen, men bare `projects.manage` kan endre den.
 */
export function ProjectCrewSection({
  projectId,
  crew,
  canManage,
  myId,
  callout = null,
}: {
  projectId: string
  crew: CrewMember[]
  canManage: boolean
  myId: string
  /** Spørsmålet på veggen, for den som styrer oppdraget. */
  callout?: { postId: string; yes: number } | null
}) {
  const [editing, setEditing] = useState(false)
  return (
    <section className="rise" style={{ animationDelay: '80ms' }} aria-labelledby="med-pa-oppdraget">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="med-pa-oppdraget" className="display-title text-xl font-semibold text-ink">
          Med på oppdraget
          {crew.length > 0 && <span className="ml-2 text-sm font-normal text-ink-faint">{crew.length}</span>}
        </h2>
        {canManage && crew.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Endre
          </Button>
        )}
      </div>

      {canManage && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line px-3.5 py-2.5">
          <p className="min-w-0 flex-1 basis-48 text-sm leading-snug text-ink-soft">
            {callout
              ? `Spurt på veggen · ${callout.yes} kan`
              : 'Vet du ikke hvem som kan? Spør korpset på veggen.'}
          </p>
          {callout ? (
            <Link to="/beskjeder/$postId" params={{ postId: callout.postId }} className={buttonClass('secondary', 'sm')}>
              Se svarene
            </Link>
          ) : (
            <Link to="/beskjeder/ny" search={{ kan: 'spilleoppdrag', prosjekt: projectId }} className={buttonClass('secondary', 'sm')}>
              Spør korpset
            </Link>
          )}
        </div>
      )}

      {crew.length === 0 ? (
        <div className="surface-group flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <p className="min-w-0 flex-1 basis-56 text-sm leading-snug text-ink-soft">
            {canManage
              ? 'Ingen er valgt ennå. Bare de du velger, får oppdraget i kalenderen og notene på stativet.'
              : 'Ingen er valgt ennå.'}
          </p>
          {canManage && (
            <Button size="sm" variant="primary" onClick={() => setEditing(true)}>
              Velg hvem som er med
            </Button>
          )}
        </div>
      ) : (
        <ul className="list-group">
          {crew.map((member) => (
            <li key={member.userId} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
              <Avatar name={member.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.95rem] font-medium text-ink">
                  {member.name}
                  {member.userId === myId && <span className="font-normal text-ink-faint"> (deg)</span>}
                </span>
                <span className="block truncate text-xs text-ink-soft">
                  {member.parts.length > 0 ? member.parts.map((p) => p.nameNo).join(' · ') : 'Ingen stemme valgt'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage && <CrewEditor projectId={projectId} open={editing} onClose={() => setEditing(false)} />}
    </section>
  )
}

type Options = Awaited<ReturnType<typeof getCrewOptions>>

export function CrewEditor({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [options, setOptions] = useState<Options | null>(null)
  const [selected, setSelected] = useState<Map<string, string[]>>(new Map())
  const [order, setOrder] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  // Ett stemmevalg åpent om gangen: et helt korps er over tjue stemmer per rad.
  const [openParts, setOpenParts] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setOptions(null)
    setQuery('')
    setOpenParts(null)
    getCrewOptions({ data: { projectId } })
      .then((res) => {
        if (cancelled) return
        const initial = new Map(res.crew.map((c) => [c.userId, c.partIds]))
        setOptions(res)
        setSelected(initial)
        // De som alt er med, står øverst. Rekkefølgen låses når arket åpnes, så
        // en rad ikke hopper bort i det man trykker på den.
        // Deretter de som har svart at de kan, og de som ikke kan til slutt.
        const answer = new Map(res.responses.map((r) => [r.userId, r.status]))
        const rank = (id: string) => CALLOUT_STATUS_RANK[answer.get(id) ?? 'none']
        setOrder(
          [...res.members]
            .sort((a, b) => Number(initial.has(b.id)) - Number(initial.has(a.id)) || rank(a.id) - rank(b.id))
            .map((m) => m.id),
        )
      })
      .catch((err) => {
        if (cancelled) return
        toastError(err)
        onClose()
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId])

  const responses = useMemo(() => new Map((options?.responses ?? []).map((r) => [r.userId, r])), [options])

  const members = useMemo(() => {
    if (!options) return []
    const byId = new Map(options.members.map((m) => [m.id, m]))
    const needle = query.trim().toLocaleLowerCase('nb')
    return order
      .flatMap((id) => byId.get(id) ?? [])
      .filter((m) => !needle || m.name.toLocaleLowerCase('nb').includes(needle) || m.ownParts.some((p) => p.toLocaleLowerCase('nb').includes(needle)))
  }, [options, order, query])

  const toggleMember = (id: string) =>
    setSelected((current) => {
      const next = new Map(current)
      if (next.has(id)) next.delete(id)
      else next.set(id, [])
      return next
    })

  const togglePart = (memberId: string, partId: string) =>
    setSelected((current) => {
      const next = new Map(current)
      const parts = next.get(memberId) ?? []
      next.set(memberId, parts.includes(partId) ? parts.filter((p) => p !== partId) : [...parts, partId])
      return next
    })

  const save = async () => {
    setSaving(true)
    try {
      await setProjectCrew({
        data: { projectId, members: [...selected].map(([userId, partIds]) => ({ userId, partIds })) },
      })
      toast(selected.size === 1 ? '1 musiker er med' : `${selected.size} musikere er med`)
      await router.invalidate()
      onClose()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Hvem er med?"
      kicker="Spilleoppdrag"
      subtitle="Velg stemme der noen skal spille noe annet enn til vanlig."
      footer={
        <Button variant="primary" onClick={save} loading={saving} disabled={!options} className="w-full">
          Lagre · {selected.size} med
        </Button>
      }
    >
      {!options ? (
        <p className="py-6 text-center text-sm text-ink-faint">Laster medlemmene …</p>
      ) : (
        <div className="space-y-3">
          <input
            type="search"
            className="field-input"
            placeholder="Søk på navn eller stemme …"
            aria-label="Søk blant medlemmene"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
            autoCorrect="off"
            spellCheck={false}
          />
          {members.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-faint">Ingen treff på «{query}»</p>
          ) : (
            <ul className="list-group">
              {members.map((member) => {
                const chosen = selected.get(member.id)
                const response = responses.get(member.id)
                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      aria-pressed={!!chosen}
                      onClick={() => toggleMember(member.id)}
                      className="flex min-h-13 w-full cursor-pointer items-center gap-3 px-3.5 py-2 text-left transition-colors can-hover:hover:bg-paper-sunken"
                    >
                      <span
                        aria-hidden
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border ${
                          chosen ? 'border-brass bg-brass text-paper' : 'border-line-strong'
                        }`}
                      >
                        {chosen && <Icon name="check" size={13} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.92rem] font-medium text-ink">{member.name}</span>
                        <span className="block truncate text-xs text-ink-faint">
                          {member.ownParts.join(' · ') || 'Ingen stemme til vanlig'}
                        </span>
                        {response?.note && <span className="block text-xs leading-snug text-ink-soft">«{response.note}»</span>}
                      </span>
                      {response && <AnswerMark status={response.status} />}
                    </button>
                    {chosen && options.parts.length > 0 && (
                      <div className="px-3.5 pb-2.5 pl-[2.75rem]">
                        <button
                          type="button"
                          aria-expanded={openParts === member.id}
                          onClick={() => setOpenParts((id) => (id === member.id ? null : member.id))}
                          className="inline-flex min-h-8 max-w-full cursor-pointer items-center gap-1 text-left text-xs font-medium text-brass-strong pointer-coarse:min-h-11"
                        >
                          <span className="min-w-0 truncate">
                            Stemme:{' '}
                            {chosen.length === 0
                              ? 'Vanlig stemme'
                              : options.parts.filter((p) => chosen.includes(p.id)).map((p) => p.nameNo).join(', ')}
                          </span>
                          <Icon name="chevronRight" size={14} className={`shrink-0 transition-transform ${openParts === member.id ? 'rotate-90' : ''}`} />
                        </button>
                        {openParts === member.id && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={`Stemme for ${member.name}`}>
                            <PartChip active={chosen.length === 0} onClick={() => setSelected((c) => new Map(c).set(member.id, []))}>
                              Vanlig stemme
                            </PartChip>
                            {options.parts.map((part) => (
                              <PartChip key={part.id} active={chosen.includes(part.id)} onClick={() => togglePart(member.id, part.id)}>
                                {part.nameNo}
                              </PartChip>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  )
}

function AnswerMark({ status }: { status: CalloutStatus }) {
  const tone = status === 'yes' ? 'text-brass-strong' : status === 'no' ? 'text-oxblood' : 'text-ink-faint'
  return <span className={`shrink-0 text-xs font-semibold ${tone}`}>{CALLOUT_STATUS_LABEL[status]}</span>
}

function PartChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer rounded-[7px] border px-2.5 py-1.5 text-xs transition-colors pointer-coarse:min-h-11 ${
        active
          ? 'border-brass bg-[var(--brass-soft)] font-medium text-brass-strong'
          : 'border-line-strong text-ink-soft can-hover:hover:border-brass/50'
      }`}
    >
      {children}
    </button>
  )
}
