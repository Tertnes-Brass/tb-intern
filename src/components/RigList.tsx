import { Link, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  RIG_NAME_MAX,
  RIG_RESPONSIBLE_MAX,
  groupRigByResponsible,
  rigNameLookup,
  rigProgress,
  rigProgressLine,
  rigStatus,
} from '../lib/rigg'
import { addRigItem, removeRigItem, searchAssetsForRig, setRigCheck, updateRigItem } from '../server/rigg'
import { toast, toastError } from './toast'
import { Button, Field, Modal, SectionHeading, Stamp } from './ui'

/**
 * Riggelista (#12) — «ta med»-sjekklista for et prosjekt eller en øving.
 *
 * Komponenten deles av `/noter/prosjekter/$projectId` og `/kalender/$eventId`,
 * og kjenner ikke til hvilken av dem den står i: den får et `scope` inn og
 * sender det videre til serverfunksjonene, som avgjør tilgangen. Det er samme
 * grep som `ChatPanel` gjør med `api`/`channelApi` — komponenten kjenner ingen
 * tabell, og tilgangskontrollen ligger i modulen funksjonene kom fra.
 *
 * **De to avkryssingene er åpne for alle innloggede.** Det er ikke en
 * forglemmelse i UI-et: det er riggegruppa som står på gulvet, og serveren
 * håndhever nøyaktig det samme (`setRigCheck` krever bare `requireMe()`).
 * Redigering av selve lista krever `projects.manage` eller `assets.manage`, og
 * `canManage` kommer fra serveren — knappene her er kosmetikk.
 */

export type RigItem = {
  id: string
  assetId: string | null
  name: string
  assetExists: boolean
  responsibleUserId: string | null
  responsibleName: string | null
  responsibleMemberName: string | null
  takenAt: number | null
  takenBy: string | null
  takenByName: string | null
  returnedAt: number | null
  returnedBy: string | null
  returnedByName: string | null
}

export type RigScopeProps = { projectId: string; occurrenceKey?: undefined } | { occurrenceKey: string; projectId?: undefined }

type MemberOption = { id: string; name: string }

export function RigListSection({
  scope,
  items,
  memberOptions,
  canManage,
  animationDelay,
}: {
  scope: RigScopeProps
  items: RigItem[]
  memberOptions: MemberOption[]
  canManage: boolean
  animationDelay?: string
}) {
  const [editing, setEditing] = useState<RigItem | 'new' | null>(null)

  // Ingenting på lista og ingen skriverett: da er seksjonen bare støy — samme
  // regel som «Oppkjøring» på prosjektsiden.
  if (items.length === 0 && !canManage) return null

  const progress = rigProgress(items)
  const groups = groupRigByResponsible(items, rigNameLookup(items))

  return (
    <section className="rise" style={{ animationDelay }}>
      <SectionHeading
        kicker={items.length > 0 ? rigProgressLine(progress) : undefined}
        title="Riggeliste"
        className="mb-4"
        action={
          canManage ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing('new')} className="print-hidden">
              + Legg til
            </Button>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <p className="text-sm text-ink-soft">
          Ingenting på lista ennå. Her hører småperc, muter, reservedeler, notestativ og bannere hjemme — alt
          som skal med, men som ikke står i sceneoppsettet.
        </p>
      ) : (
        <>
          {progress.outstanding > 0 && (
            <p className="mb-3 text-sm text-ink-soft">
              <strong className="text-ink">
                {progress.outstanding} {progress.outstanding === 1 ? 'ting' : 'ting'}
              </strong>{' '}
              er tatt med, men ikke krysset av som kommet tilbake.
            </p>
          )}
          <div className="space-y-5">
            {groups.map((group) => (
              <div key={group.key}>
                <h3 className="kicker mb-1.5">{group.label}</h3>
                <ul className="sheet overflow-hidden">
                  {group.items.map((item) => (
                    <RigRow key={item.id} item={item} canManage={canManage} onEdit={() => setEditing(item)} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}

      <RigItemModal
        scope={scope}
        item={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        memberOptions={memberOptions}
      />
    </section>
  )
}

// ---------- Én linje ----------

function RigRow({ item, canManage, onEdit }: { item: RigItem; canManage: boolean; onEdit: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'taken' | 'returned' | null>(null)
  const status = rigStatus(item)

  const toggle = async (field: 'taken' | 'returned', checked: boolean) => {
    setBusy(field)
    try {
      await setRigCheck({ data: { id: item.id, field, checked } })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="hairline-row flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
      <span className="min-w-0 flex-1 basis-full sm:basis-auto">
        <span
          className={`block text-[0.95rem] font-semibold leading-snug ${
            status === 'returned' ? 'text-ink-faint' : 'text-ink'
          }`}
        >
          {/* Bare en gjenstand som FORTSATT finnes i registeret blir en lenke.
              Er den slettet, står navnesnapshotet igjen som ren tekst. */}
          {item.assetId && item.assetExists ? (
            <Link to="/utstyr/$assetId" params={{ assetId: item.assetId }} className="link-brass">
              {item.name}
            </Link>
          ) : (
            item.name
          )}
        </span>
        <span className="mt-0.5 block text-xs text-ink-faint">
          {[
            item.takenAt ? `Tatt med av ${item.takenByName ?? 'et tidligere medlem'}` : null,
            item.returnedAt ? `tilbake ved ${item.returnedByName ?? 'et tidligere medlem'}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Ikke krysset av'}
        </span>
      </span>

      <span className="flex items-center gap-3">
        <CheckBox
          label="Tatt med"
          checked={item.takenAt !== null}
          busy={busy === 'taken'}
          onChange={(checked) => toggle('taken', checked)}
        />
        <CheckBox
          label="Tilbake"
          checked={item.returnedAt !== null}
          busy={busy === 'returned'}
          onChange={(checked) => toggle('returned', checked)}
        />
        {canManage && (
          <button
            onClick={onEdit}
            className="print-hidden -my-1.5 px-2 py-2.5 font-mono text-[0.64rem] uppercase tracking-wide text-ink-faint transition-colors hover:text-brass-strong"
          >
            Endre
          </button>
        )}
      </span>
    </li>
  )
}

/**
 * Avkryssingen. Et ekte `<input type="checkbox">` med en synlig etikett, ikke en
 * knapp som later som: dette skal treffes med en tommel i en varebil, og det
 * skal virke med tastatur og skjermleser uten at vi må finne opp rollene selv.
 */
function CheckBox({
  label,
  checked,
  busy,
  onChange,
}: {
  label: string
  checked: boolean
  busy: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className={`inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 py-1.5 font-mono text-[0.64rem] uppercase tracking-[0.08em] transition-colors ${
        checked ? 'text-brass-strong' : 'text-ink-faint hover:text-ink-soft'
      }`}
    >
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--brass)]"
        checked={checked}
        disabled={busy}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

// ---------- Legg til / endre ----------

function RigItemModal({
  scope,
  item,
  open,
  onClose,
  memberOptions,
}: {
  scope: RigScopeProps
  item: RigItem | null
  open: boolean
  onClose: () => void
  memberOptions: MemberOption[]
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [assetId, setAssetId] = useState<string | null>(null)
  const [assetName, setAssetName] = useState<string | null>(null)
  const [responsibleUserId, setResponsibleUserId] = useState('')
  const [responsibleName, setResponsibleName] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(item?.name ?? '')
    setAssetId(item?.assetId ?? null)
    setAssetName(item?.assetId ? (item.name ?? null) : null)
    setResponsibleUserId(item?.responsibleUserId ?? '')
    setResponsibleName(item?.responsibleName ?? '')
    setConfirmDelete(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id])

  const submit = async () => {
    setSaving(true)
    try {
      if (item) {
        await updateRigItem({
          data: {
            id: item.id,
            name,
            responsibleUserId: responsibleUserId || null,
            responsibleName: responsibleUserId ? null : responsibleName || null,
          },
        })
        toast('Linja er oppdatert')
      } else {
        await addRigItem({
          data: {
            ...scope,
            assetId,
            // Navnet ignoreres av serveren når en gjenstand er valgt: da tas
            // snapshotet fra registeret, aldri herfra.
            name: assetId ? (assetName ?? '') : name,
            responsibleUserId: responsibleUserId || null,
            responsibleName: responsibleUserId ? null : responsibleName || null,
          },
        })
        toast('Lagt til på riggelista')
      }
      await router.invalidate()
      onClose()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!item) return
    try {
      await removeRigItem({ data: { id: item.id } })
      toast('Linja er fjernet')
      await router.invalidate()
      onClose()
    } catch (err) {
      toastError(err)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={item ? 'Endre linje' : 'Legg til på riggelista'} kicker="Riggeliste">
      <div className="space-y-4">
        {!item && (
          <AssetPicker
            assetId={assetId}
            assetName={assetName}
            onPick={(picked) => {
              setAssetId(picked?.id ?? null)
              setAssetName(picked?.name ?? null)
            }}
          />
        )}

        {!assetId && (
          <Field
            label={item ? 'Hva skal med *' : 'Eller skriv det inn selv *'}
            hint="Ting som ikke står i utstyrsregisteret — «fire muter», «reservestikker», «banner»"
          >
            <input
              className="field-input"
              value={name}
              maxLength={RIG_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fire muter"
            />
          </Field>
        )}

        <Field label="Ansvarlig" hint="Et medlem, eller en gruppe som «riggegruppa». Kan stå tomt.">
          <select
            className="field-input"
            value={responsibleUserId}
            onChange={(e) => setResponsibleUserId(e.target.value)}
          >
            <option value="">— ingen / en gruppe —</option>
            {memberOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>

        {!responsibleUserId && (
          <Field label="… eller en gruppe">
            <input
              className="field-input"
              value={responsibleName}
              maxLength={RIG_RESPONSIBLE_MAX}
              onChange={(e) => setResponsibleName(e.target.value)}
              placeholder="Riggegruppa"
            />
          </Field>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          {item &&
            (confirmDelete ? (
              <Button variant="danger" onClick={remove} className="w-full sm:mr-auto sm:w-auto">
                Bekreft: fjern linja
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="w-full sm:mr-auto sm:w-auto">
                Fjern
              </Button>
            ))}
          <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">
            Avbryt
          </Button>
          <Button variant="primary" onClick={submit} loading={saving} className="w-full sm:w-auto">
            {item ? 'Lagre' : 'Legg til'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Velgeren mot utstyrsregisteret (#13). Riggelista er stedet de to sakene
 * møtes: en linje kan peke på en gjenstand som allerede er registrert, og da
 * blir navnet en lenke inn i registeret i stedet for en tekst noen har skrevet
 * av igjen.
 */
function AssetPicker({
  assetId,
  assetName,
  onPick,
}: {
  assetId: string | null
  assetName: string | null
  onPick: (asset: { id: string; name: string } | null) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string; category: string | null }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (assetId) return
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await searchAssetsForRig({ data: { q: q || undefined } })
        if (!cancelled) setResults(res.assets)
      } catch {
        // Et tomt register eller manglende tilgang er ikke en feil verdt en
        // toast her — fritekstfeltet under virker uansett.
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, assetId])

  if (assetId) {
    return (
      <Field label="Fra utstyrsregisteret">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-paper-sunken px-3 py-2.5">
          <span className="min-w-0 truncate text-sm font-semibold text-ink">{assetName}</span>
          <button
            onClick={() => onPick(null)}
            className="shrink-0 font-mono text-[0.64rem] uppercase tracking-wide text-ink-faint transition-colors hover:text-danger"
          >
            Fjern valg
          </button>
        </div>
      </Field>
    )
  }

  return (
    <Field label="Fra utstyrsregisteret" hint="Søk opp en gjenstand korpset allerede har registrert">
      <input
        type="search"
        className="field-input"
        placeholder="Søk i utstyret …"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
      />
      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
        {loading && results.length === 0 ? (
          <p className="px-1 py-2 text-center text-xs text-ink-faint">Søker …</p>
        ) : results.length === 0 ? (
          <p className="px-1 py-2 text-center text-xs text-ink-faint">
            {q ? `Ingen treff på «${q}»` : 'Ingenting i registeret ennå'}
          </p>
        ) : (
          results.map((a) => (
            <button
              key={a.id}
              onClick={() => onPick({ id: a.id, name: a.name })}
              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-paper-sunken"
            >
              <span className="min-w-0 truncate text-sm text-ink">{a.name}</span>
              {a.category && <Stamp>{a.category}</Stamp>}
            </button>
          ))
        )}
      </div>
    </Field>
  )
}
