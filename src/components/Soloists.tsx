import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  MAX_SOLOISTS_PER_WORK,
  SOLOIST_NAME_MAX,
  SOLOIST_ROLE_MAX,
  soloistLabel,
} from '../lib/soloists'
import type { ProjectSoloist } from '../server/soloists'
import { addProjectSoloist, removeProjectSoloist, updateProjectSoloist } from '../server/soloists'
import { listProjectMembers } from '../server/projects'
import { toast, toastError } from './toast'
import { Button, Field, Modal } from './ui'

/**
 * Solister på et verk i et prosjekt (#50).
 *
 * Lesevisningen er en linje i repertoarlista, med samme form som
 * slagverkslinjen (`PercussionLine`) men i oxblood: det er programinformasjon,
 * ikke en merknad. Redigeringen ligger i en dialog og ikke inline, fordi en
 * solist er tre felt og ikke en tekstblokk — og fordi flere solister på samme
 * stykke skal kunne ordnes uten at raden i programmet vokser til en skjerm.
 */

type Member = { id: string; name: string; partName: string | null }

export function SoloistLine({ soloists }: { soloists: ProjectSoloist[] }) {
  if (soloists.length === 0) return null
  return (
    <div className="mt-2.5 border-l-2 border-oxblood/40 pl-3">
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-oxblood">
        {soloists.length === 1 ? 'Solist' : 'Solister'}
      </p>
      <ul className="mt-1 space-y-0.5">
        {soloists.map((s) => (
          <li key={s.id} className="text-[0.85rem] leading-snug text-ink-soft">
            {soloistLabel(s)}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Lesevisning + inngang til dialogen. Uten `canEdit` er den bare lesevisningen. */
export function SoloistsField({
  projectId,
  workId,
  workTitle,
  soloists,
  canEdit,
}: {
  projectId: string
  workId: string
  workTitle: string
  soloists: ProjectSoloist[]
  canEdit: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!canEdit) return <SoloistLine soloists={soloists} />

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="print-hidden -mx-2 -my-1 block w-full cursor-pointer rounded-lg px-2 py-1 text-left transition-colors hover:bg-paper-sunken/70"
      >
        {soloists.length > 0 ? (
          <SoloistLine soloists={soloists} />
        ) : (
          <span className="font-mono text-[0.64rem] uppercase tracking-[0.14em] text-ink-faint transition-colors hover:text-oxblood">
            + Solist
          </span>
        )}
      </button>
      <SoloistsModal
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        workId={workId}
        workTitle={workTitle}
        soloists={soloists}
      />
    </>
  )
}

function SoloistsModal({
  open,
  onClose,
  projectId,
  workId,
  workTitle,
  soloists,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  workId: string
  workTitle: string
  soloists: ProjectSoloist[]
}) {
  const router = useRouter()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Medlemslista hentes når dialogen åpnes, ikke ved hver render av programmet:
  // en prosjektside med femten verk skal ikke gjøre femten oppslag ingen ser.
  useEffect(() => {
    if (!open || members !== null) return
    listProjectMembers()
      .then((res) => setMembers(res.members.map(({ id, name, partName }) => ({ id, name, partName }))))
      .catch((err) => toastError(err))
  }, [open, members])

  const remove = async (id: string) => {
    setBusyId(id)
    try {
      await removeProjectSoloist({ data: { id, projectId } })
      toast('Solisten er fjernet')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={workTitle} kicker="Solister">
      <div className="space-y-4">
        {soloists.length === 0 ? (
          <p className="text-sm leading-relaxed text-ink-soft">
            Ingen solister på dette stykket ennå. Velg et medlem fra lista, eller skriv inn navnet på en
            vikar, en gjest eller en gruppe.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)] rounded-xl border border-line">
            {soloists.map((s) =>
              editingId === s.id ? (
                <li key={s.id} className="px-3 py-3">
                  <SoloistForm
                    members={members}
                    initial={s}
                    submitLabel="Lagre"
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (value) => {
                      await updateProjectSoloist({ data: { id: s.id, projectId, ...value } })
                      toast('Solisten er oppdatert')
                      setEditingId(null)
                      await router.invalidate()
                    }}
                  />
                </li>
              ) : (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.92rem] font-semibold text-ink">{soloistLabel(s)}</span>
                    <span className="block font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint">
                      {s.userId ? 'Medlem' : 'Ekstern / gruppe'}
                    </span>
                  </span>
                  <button
                    onClick={() => setEditingId(s.id)}
                    className="inline-flex items-center rounded-lg px-2.5 py-2 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink"
                  >
                    Rediger
                  </button>
                  <button
                    disabled={busyId === s.id}
                    onClick={() => remove(s.id)}
                    className="inline-flex items-center rounded-lg px-2.5 py-2 text-xs font-medium text-danger/80 transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                  >
                    Fjern
                  </button>
                </li>
              ),
            )}
          </ul>
        )}

        {soloists.length < MAX_SOLOISTS_PER_WORK && editingId === null && (
          <div className="rounded-xl border border-dashed border-line-strong px-3 py-3">
            <SoloistForm
              members={members}
              initial={null}
              submitLabel="Legg til"
              onSubmit={async (value) => {
                await addProjectSoloist({ data: { projectId, workId, ...value } })
                toast('Solisten er lagt til')
                await router.invalidate()
              }}
            />
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Lukk
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Ett solistfelt. Enten et medlem ELLER et navn — velgeren og tekstfeltet
 * nullstiller hverandre i UI-et, og `parseSoloistInput` på serveren lar uansett
 * medlemmet vinne. Rollen er fri tekst og gjelder begge tilfellene.
 */
function SoloistForm({
  members,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  members: Member[] | null
  initial: ProjectSoloist | null
  submitLabel: string
  onSubmit: (value: { userId: string | null; externalName: string | null; role: string | null }) => Promise<void>
  onCancel?: () => void
}) {
  const [userId, setUserId] = useState(initial?.userId ?? '')
  const [externalName, setExternalName] = useState(initial?.externalName ?? '')
  const [role, setRole] = useState(initial?.role ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!userId && !externalName.trim()) {
      toast('Velg et medlem, eller skriv inn navnet på solisten', 'error')
      return
    }
    setSaving(true)
    try {
      await onSubmit({
        userId: userId || null,
        externalName: userId ? null : externalName.trim() || null,
        role: role.trim() || null,
      })
      if (!initial) {
        setUserId('')
        setExternalName('')
        setRole('')
      }
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Medlem">
        <select
          className="field-input"
          value={userId}
          disabled={members === null}
          onChange={(e) => {
            setUserId(e.target.value)
            if (e.target.value) setExternalName('')
          }}
        >
          <option value="">{members === null ? 'Laster medlemmer …' : 'Ingen — skriv inn navn under'}</option>
          {(members ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.partName ? ` · ${m.partName}` : ''}
            </option>
          ))}
        </select>
      </Field>

      <Field label="… eller navn" hint="Vikar, gjestesolist eller en gruppe — «Trombonegruppa»">
        <input
          className="field-input"
          value={externalName}
          maxLength={SOLOIST_NAME_MAX}
          disabled={!!userId}
          placeholder="Kåre Vik"
          onChange={(e) => setExternalName(e.target.value)}
        />
      </Field>

      <Field label="Rolle" hint="Valgfritt: «Kornettsolist», «Duett», «Sopran»">
        <input
          className="field-input"
          value={role}
          maxLength={SOLOIST_ROLE_MAX}
          placeholder="Kornettsolist"
          onChange={(e) => setRole(e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Avbryt
          </Button>
        )}
        <Button size="sm" variant="primary" loading={saving} onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
