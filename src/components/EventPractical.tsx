import { Link, useRouter } from '@tanstack/react-router'
import { type ReactNode, useEffect, useState } from 'react'
import {
  PRACTICAL_ADDRESS_MAX,
  PRACTICAL_LOCATION_MAX,
  PRACTICAL_NAME_MAX,
  PRACTICAL_NOTE_MAX,
  PRACTICAL_URL_MAX,
  hasEventPractical,
} from '../lib/practical'
import { setEventProject, updateEventPractical } from '../server/event-meta'
import { toast, toastError } from './toast'
import { Button, Field, Modal, SectionHeading, Stamp } from './ui'

/**
 * Praktisk info på én øving (#10): hvor vi er, når man skal møte, hvem som
 * dirigerer, hvem som låser opp, hvem som rigger — og hvilke prosjekter øvingen
 * hører til.
 *
 * **Fravær og øvingsrekkefølge er IKKE her.** De finnes allerede
 * (`event_attendance`, `event_setlist`) og har sine egne seksjoner på ruta;
 * denne blokka lenker til dem i stedet for å gjenta dem.
 *
 * Seksjonen vises bare når det finnes noe å vise — eller når den som ser siden
 * er den som skal fylle den ut. En tom boks er ikke informasjon.
 */

export type PracticalValues = {
  locationName: string | null
  locationAddress: string | null
  mapUrl: string | null
  meetupCrew: string | null
  meetupMusicians: string | null
  conductor: string | null
  keyholder: string | null
  crew: string | null
  substitutes: string | null
  practicalNote: string | null
}

type ProjectOption = { id: string; name: string; eventDate: string | null }

export function EventPracticalSection({
  occurrenceKey,
  practical,
  linkedProjects,
  projectOptions,
  canManage,
  eventLocation,
}: {
  occurrenceKey: string
  practical: PracticalValues
  linkedProjects: ProjectOption[]
  projectOptions: ProjectOption[]
  canManage: boolean
  /** Stedet slik det står i Google-hendelsen — vises bare når vi ikke vet bedre. */
  eventLocation: string | null
}) {
  const [editing, setEditing] = useState(false)
  const filled = hasEventPractical(practical)

  if (!filled && !canManage && linkedProjects.length === 0) return null

  return (
    <section className="rise" style={{ animationDelay: '40ms' }}>
      <SectionHeading
        title="Praktisk"
        className="mb-4"
        action={
          canManage ? (
            <Button size="sm" onClick={() => setEditing(true)}>
              {filled ? 'Rediger praktisk info' : 'Legg inn praktisk info'}
            </Button>
          ) : undefined
        }
      />

      {filled ? (
        <div className="sheet px-4 py-4 sm:px-5">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {(practical.locationName || practical.locationAddress || practical.mapUrl) && (
              <Item label="Sted">
                {practical.locationName && <span className="block">{practical.locationName}</span>}
                {practical.locationAddress && (
                  <span className="block text-ink-soft">{practical.locationAddress}</span>
                )}
                {practical.mapUrl && (
                  <a
                    href={practical.mapUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="link-brass mt-0.5 inline-block font-mono text-[0.66rem] uppercase tracking-[0.14em]"
                  >
                    Åpne kart →
                  </a>
                )}
              </Item>
            )}

            {(practical.meetupCrew || practical.meetupMusicians) && (
              <Item label="Oppmøte">
                {practical.meetupCrew && (
                  <span className="block">
                    <span className="tabular font-semibold">{practical.meetupCrew}</span> riggegruppe
                  </span>
                )}
                {practical.meetupMusicians && (
                  <span className="block">
                    <span className="tabular font-semibold">{practical.meetupMusicians}</span> musikanter
                  </span>
                )}
              </Item>
            )}

            {practical.conductor && <Item label="Dirigent">{practical.conductor}</Item>}
            {practical.keyholder && <Item label="Nøkkelansvarlig">{practical.keyholder}</Item>}
            {practical.crew && <Item label="Riggegruppe">{multiline(practical.crew)}</Item>}
            {practical.substitutes && <Item label="Vikarer">{multiline(practical.substitutes)}</Item>}
            {practical.practicalNote && (
              <Item label="Godt å vite" wide>
                {multiline(practical.practicalNote)}
              </Item>
            )}
          </dl>
        </div>
      ) : canManage ? (
        <p className="text-sm text-ink-soft">
          Ingen praktisk info ennå. Adresse, oppmøtetider, dirigent, nøkkelansvarlig og riggegruppe hører hjemme
          her — da slipper alle å spørre i chatten.
          {eventLocation ? ` Kalenderen sier «${eventLocation}».` : ''}
        </p>
      ) : null}

      <ProjectLinks
        occurrenceKey={occurrenceKey}
        linkedProjects={linkedProjects}
        projectOptions={projectOptions}
        canManage={canManage}
      />

      <PracticalDialog
        occurrenceKey={occurrenceKey}
        practical={practical}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </section>
  )
}

function Item({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="kicker mb-1">{label}</dt>
      <dd className="text-[0.92rem] leading-snug text-ink">{children}</dd>
    </div>
  )
}

/** Flerlinjet fritekst vises med linjeskiftene i behold — lista er poenget. */
function multiline(value: string) {
  return <span className="block whitespace-pre-line">{value}</span>
}

/**
 * Prosjektene øvingen hører til. n:m (#10): en øving kan peke på flere
 * prosjekter, og hver kobling settes for seg — to personer som kobler hvert
 * sitt prosjekt samtidig skal ikke overskrive hverandre.
 */
function ProjectLinks({
  occurrenceKey,
  linkedProjects,
  projectOptions,
  canManage,
}: {
  occurrenceKey: string
  linkedProjects: ProjectOption[]
  projectOptions: ProjectOption[]
  canManage: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const linkedIds = new Set(linkedProjects.map((p) => p.id))
  const available = projectOptions.filter((p) => !linkedIds.has(p.id))

  const act = async (projectId: string, linked: boolean) => {
    setBusy(true)
    try {
      await setEventProject({ data: { occurrenceKey, projectId, linked } })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  if (!canManage && linkedProjects.length === 0) return null

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-ink-faint">Hører til</span>
      {linkedProjects.length === 0 && !canManage && (
        <span className="text-sm text-ink-faint">Ingen prosjekter</span>
      )}
      {linkedProjects.map((project) => (
        <span key={project.id} className="inline-flex items-center gap-1">
          <Link to="/noter/prosjekter/$projectId" params={{ projectId: project.id }}>
            <Stamp className="cursor-pointer">{project.name}</Stamp>
          </Link>
          {canManage && (
            <button
              type="button"
              disabled={busy}
              aria-label={`Fjern koblingen til ${project.name}`}
              title={`Fjern koblingen til ${project.name}`}
              onClick={() => act(project.id, false)}
              className="grid h-6 w-6 cursor-pointer place-items-center rounded-full text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:pointer-events-none disabled:opacity-30"
            >
              <svg width="9" height="9" viewBox="0 0 11 11" fill="none" aria-hidden>
                <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </span>
      ))}
      {canManage && available.length > 0 && (
        <select
          className="field-input !w-auto !text-base sm:!text-xs"
          value=""
          disabled={busy}
          aria-label="Koble øvingen til et prosjekt"
          onChange={(e) => {
            if (e.target.value) act(e.target.value, true)
          }}
        >
          <option value="">+ Koble til prosjekt …</option>
          {available.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

function PracticalDialog({
  occurrenceKey,
  practical,
  open,
  onClose,
}: {
  occurrenceKey: string
  practical: PracticalValues
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [form, setForm] = useState(practical)
  const [saving, setSaving] = useState(false)

  // Skjemaet fylles på nytt hver gang dialogen åpnes: står den med en gammel
  // kladd etter at noen andre har lagret, ville «Lagre» skrevet den tilbake.
  useEffect(() => {
    if (open) setForm(practical)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (patch: Partial<PracticalValues>) => setForm((f) => ({ ...f, ...patch }))

  const submit = async () => {
    setSaving(true)
    try {
      await updateEventPractical({ data: { occurrenceKey, ...form } })
      toast('Praktisk info er lagret')
      onClose()
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Praktisk info" kicker="Denne øvingen" wide mobileFull>
      <div className="space-y-4">
        <Field label="Sted" hint="Navnet folk kjenner det som — «Tertnes skole, musikkrommet»">
          <input
            className="field-input"
            value={form.locationName ?? ''}
            maxLength={PRACTICAL_LOCATION_MAX}
            onChange={(e) => set({ locationName: e.target.value })}
            autoFocus
          />
        </Field>
        <Field label="Adresse" hint="Så en vikar finner fram uten å spørre">
          <input
            className="field-input"
            value={form.locationAddress ?? ''}
            maxLength={PRACTICAL_ADDRESS_MAX}
            placeholder="Snellingen 1, 5113 Tertnes"
            onChange={(e) => set({ locationAddress: e.target.value })}
          />
        </Field>
        <Field label="Kartlenke" hint="Google Maps eller lignende. Må begynne med https://">
          <input
            className="field-input"
            value={form.mapUrl ?? ''}
            maxLength={PRACTICAL_URL_MAX}
            inputMode="url"
            placeholder="https://maps.app.goo.gl/…"
            onChange={(e) => set({ mapUrl: e.target.value })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Oppmøte riggegruppe" hint="Klokkeslett, f.eks. 17:00">
            <input
              className="field-input"
              value={form.meetupCrew ?? ''}
              maxLength={8}
              inputMode="numeric"
              placeholder="17:00"
              onChange={(e) => set({ meetupCrew: e.target.value })}
            />
          </Field>
          <Field label="Oppmøte musikanter" hint="Klokkeslett, f.eks. 18:15">
            <input
              className="field-input"
              value={form.meetupMusicians ?? ''}
              maxLength={8}
              inputMode="numeric"
              placeholder="18:15"
              onChange={(e) => set({ meetupMusicians: e.target.value })}
            />
          </Field>
          <Field label="Dirigent">
            <input
              className="field-input"
              value={form.conductor ?? ''}
              maxLength={PRACTICAL_NAME_MAX}
              onChange={(e) => set({ conductor: e.target.value })}
            />
          </Field>
          <Field label="Nøkkelansvarlig" hint="Den som låser opp">
            <input
              className="field-input"
              value={form.keyholder ?? ''}
              maxLength={PRACTICAL_NAME_MAX}
              onChange={(e) => set({ keyholder: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Riggegruppe" hint="Ett navn per linje">
          <textarea
            className="field-input min-h-20"
            value={form.crew ?? ''}
            maxLength={PRACTICAL_NOTE_MAX}
            onChange={(e) => set({ crew: e.target.value })}
          />
        </Field>
        <Field label="Vikarer" hint="Hvem som stiller for hvem. Fravær og oppmøte føres lenger ned på siden">
          <textarea
            className="field-input min-h-20"
            value={form.substitutes ?? ''}
            maxLength={PRACTICAL_NOTE_MAX}
            onChange={(e) => set({ substitutes: e.target.value })}
          />
        </Field>
        <Field label="Godt å vite" hint="Parkering, inngang, hva man tar med">
          <textarea
            className="field-input min-h-20"
            value={form.practicalNote ?? ''}
            maxLength={PRACTICAL_NOTE_MAX}
            onChange={(e) => set({ practicalNote: e.target.value })}
          />
        </Field>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">
            Avbryt
          </Button>
          <Button variant="primary" loading={saving} onClick={submit} className="w-full sm:w-auto">
            Lagre
          </Button>
        </div>
      </div>
    </Modal>
  )
}
