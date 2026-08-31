import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast, toastError } from '../../components/toast'
import { Button, Field, Kicker, Modal, Stamp } from '../../components/ui'
import { SECTION_LABELS } from '../../lib/taxonomy'
import {
  createPart,
  createRole,
  deletePart,
  deleteRole,
  getSettingsData,
  movePart,
  movePartTo,
  renameRole,
  setRolePermission,
  updatePart,
} from '../../server/settings'

export const Route = createFileRoute('/innstillinger/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    const ok = context.me.permissions.includes('*') || context.me.permissions.includes('settings.manage')
    if (!ok) throw redirect({ to: '/' })
  },
  loader: () => getSettingsData(),
  component: SettingsPage,
})

type Data = Awaited<ReturnType<typeof getSettingsData>>
type Part = Data['parts'][number]

function SettingsPage() {
  const data = Route.useLoaderData()
  const me = Route.useRouteContext().me
  // Vis aldri en krysslenke brukeren mangler rettighet til (§4). Serveren
  // avviser uansett; dette er kosmetikk.
  const canViewDownloads = !!me && (me.permissions.includes('*') || me.permissions.includes('downloads.view'))

  return (
    <div className="space-y-12">
      <header className="rise">
        <Kicker className="mb-2">Administrasjon</Kicker>
        <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Innstillinger</h1>
        <p className="mt-2 text-sm text-ink-soft">Besetning og roller for korpset. Endringer gjelder umiddelbart.</p>
        {/*
          Filtilganger er ikke lenger i toppmenyen (docs/designprinsipper.md §6).
          Området har fortsatt eget inngangspunkt — herfra og fra «Områder» på
          hub-en. URL-en er uendret, så gamle lenker virker.
        */}
        {canViewDownloads && (
          <Link to="/innstillinger/nedlastinger" className="mt-5 inline-block">
            <Button variant="secondary">Filtilganger — hvem har åpnet en fil? →</Button>
          </Link>
        )}
      </header>

      <PartsSection data={data} />
      <RolesSection data={data} />
    </div>
  )
}

// ---------- Besetning ----------

function PartsSection({ data }: { data: Data }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Part | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await fn()
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const partName = new Map(data.parts.map((p) => [p.id, p.nameNo]))

  return (
    <section className="rise" style={{ animationDelay: '80ms' }}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display-title text-2xl font-semibold text-ink">Besetning</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {data.parts.length} stemmer. Aliasene avgjør hvordan filnavn gjenkjennes ved opplasting.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Ny stemme
        </Button>
      </div>

      <div className="sheet overflow-hidden">
        <ul className="divide-y divide-[var(--line)]">
          {data.parts.map((p) => {
            // Søsken = rader på samme nivå: rot-stemmer seg imellom, understemmer innenfor forelderen
            const peers = data.parts.filter((x) => (x.parentId ?? null) === (p.parentId ?? null))
            const peerIdx = peers.findIndex((x) => x.id === p.id)
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                style={p.parentId ? { paddingLeft: '2.5rem' } : undefined}
              >
                <span className="flex shrink-0 flex-col">
                  <button
                    className="grid h-8 w-8 cursor-pointer place-items-center rounded text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink disabled:opacity-25 disabled:pointer-events-none sm:h-5 sm:w-6"
                    disabled={busy === p.id || peerIdx <= 0}
                    aria-label="Flytt opp"
                    onClick={() => act(p.id, () => movePart({ data: { id: p.id, direction: 'up' } }))}
                  >
                    <Chevron dir="up" />
                  </button>
                  <button
                    className="grid h-8 w-8 cursor-pointer place-items-center rounded text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink disabled:opacity-25 disabled:pointer-events-none sm:h-5 sm:w-6"
                    disabled={busy === p.id || peerIdx === peers.length - 1}
                    aria-label="Flytt ned"
                    onClick={() => act(p.id, () => movePart({ data: { id: p.id, direction: 'down' } }))}
                  >
                    <Chevron dir="down" />
                  </button>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.95rem] font-semibold text-ink">{p.nameNo}</span>
                    <span className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-ink-faint">{p.nameEn}</span>
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[0.64rem] text-ink-faint">
                    {p.parentId ? `↳ ${partName.get(p.parentId) ?? '?'} · ` : ''}
                    {SECTION_LABELS[p.section as keyof typeof SECTION_LABELS] ?? p.section}
                    {p.aliases.length > 0 ? ` · alias: ${p.aliases.join(', ')}` : ' · ingen alias'}
                  </span>
                </span>

                {p.inUse > 0 && <Stamp>{p.inUse} i bruk</Stamp>}
                <span className="flex w-full min-w-0 items-center gap-1 sm:w-auto sm:shrink-0">
                  <select
                    className="field-input min-w-0 flex-1 !py-2 !text-base sm:!w-auto sm:!flex-none sm:!py-1.5 sm:!text-xs"
                    value=""
                    disabled={busy === p.id || peers.length <= 1}
                    aria-label={`Flytt «${p.nameNo}» til`}
                    onChange={(e) => {
                      const v = e.target.value
                      if (!v) return
                      act(p.id, () => movePartTo({ data: { id: p.id, afterId: v === '__first' ? null : v } }))
                    }}
                  >
                    <option value="" disabled>
                      Flytt til…
                    </option>
                    <option value="__first">{p.parentId ? `Først i «${partName.get(p.parentId) ?? '?'}»` : 'Øverst'}</option>
                    {peers
                      .filter((x) => x.id !== p.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          Etter «{x.nameNo}»
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => setEditing(p)}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink"
                  >
                    Rediger
                  </button>
                  <button
                    disabled={busy === p.id}
                    onClick={() => {
                      if (p.fileCount > 0) {
                        toast(`«${p.nameNo}» er i bruk på ${p.fileCount} fil(er) og kan ikke slettes`, 'error')
                        return
                      }
                      act(p.id, () => deletePart({ data: { id: p.id } }))
                    }}
                    className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-danger/80 transition-colors hover:bg-danger/10 hover:text-danger"
                  >
                    Slett
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      <PartFormModal
        open={creating || editing !== null}
        part={editing}
        sections={data.sections}
        allParts={data.parts}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={async () => {
          setCreating(false)
          setEditing(null)
          await router.invalidate()
        }}
      />
    </section>
  )
}

function PartFormModal({
  open,
  part,
  sections,
  allParts,
  onClose,
  onSaved,
}: {
  open: boolean
  part: Part | null
  sections: readonly string[]
  allParts: Part[]
  onClose: () => void
  onSaved: () => void
}) {
  const [nameNo, setNameNo] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [section, setSection] = useState<string>('cornet')
  const [aliases, setAliases] = useState('')
  const [parentId, setParentId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setNameNo(part?.nameNo ?? '')
    setNameEn(part?.nameEn ?? '')
    setSection(part?.section ?? 'cornet')
    setAliases(part?.aliases.join(', ') ?? '')
    setParentId(part?.parentId ?? '')
  }, [open, part])

  // Kun rot-stemmer (uten egen forelder) kan være forelder — maks to nivåer.
  // En stemme som selv har understemmer kan ikke gjøres til understemme.
  const hasChildren = !!part && allParts.some((p) => p.parentId === part.id)
  const isScore = part?.id === 'score'
  const parentOptions = allParts.filter(
    (p) =>
      !p.parentId &&
      p.id !== part?.id &&
      p.id !== 'score' &&
      (isScore ? p.id === 'conductor' : p.section !== 'score'),
  )
  const canHaveParent = !hasChildren && (section !== 'score' || isScore) && parentOptions.length > 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nameNo.trim() || !nameEn.trim()) {
      toast('Norsk og engelsk navn må fylles ut', 'error')
      return
    }
    setSaving(true)
    try {
      const aliasArr = aliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
      const payload = {
        nameNo,
        nameEn,
        section: section as never,
        aliases: aliasArr,
        parentId: canHaveParent && parentId ? parentId : null,
      }
      if (part) await updatePart({ data: { id: part.id, ...payload } })
      else await createPart({ data: payload })
      toast(part ? 'Stemme oppdatert' : 'Stemme lagt til')
      onSaved()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={part ? 'Rediger stemme' : 'Ny stemme'} kicker="Besetning">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Navn (norsk) *">
            <input className="field-input" value={nameNo} onChange={(e) => setNameNo(e.target.value)} placeholder="2. kornett" autoFocus />
          </Field>
          <Field label="Navn (engelsk) *" hint="Brukes på genererte etiketter">
            <input className="field-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="2nd Cornet" />
          </Field>
        </div>
        <Field label="Seksjon">
          <select className="field-input" value={section} onChange={(e) => setSection(e.target.value)}>
            {sections.map((s) => (
              <option key={s} value={s}>
                {SECTION_LABELS[s as keyof typeof SECTION_LABELS] ?? s}
              </option>
            ))}
          </select>
        </Field>
        {canHaveParent && (
          <Field
            label="Forelder-stemme"
            hint="Gjør denne til en understemme. Den som får forelderen tildelt, får tilgang til alle understemmene — f.eks. «Slagverk» over «Slagverk 1/2/3»."
          >
            <select className="field-input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Ingen — selvstendig stemme / seksjon</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameNo}
                </option>
              ))}
            </select>
          </Field>
        )}
        {hasChildren && (
          <p className="font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ink-faint">
            Denne stemmen har understemmer og er derfor en seksjons-stemme (kan ikke selv få forelder).
          </p>
        )}
        <Field label="Aliaser" hint="Komma-separert. Treff i filnavn → riktig stemme. F.eks: 2nd cornet, cornet 2, kornett 2">
          <input className="field-input" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="2nd cornet, 2. kornett, cornet 2" autoCorrect="off" autoCapitalize="none" spellCheck={false} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {part ? 'Lagre' : 'Legg til'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ---------- Roller og rettigheter ----------

function RolesSection({ data }: { data: Data }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')

  const toggle = async (roleId: string, permission: string, enabled: boolean) => {
    setBusy(`${roleId}:${permission}`)
    try {
      await setRolePermission({ data: { roleId, permission, enabled } })
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rise" style={{ animationDelay: '160ms' }}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display-title text-2xl font-semibold text-ink">Roller og tilgang</h2>
          <p className="mt-1 text-sm text-ink-soft">Hvilke rettigheter hver rolle har. Administrator har alltid full tilgang.</p>
        </div>
        <Button variant="secondary" onClick={() => setCreating(true)}>
          + Ny rolle
        </Button>
      </div>

      <div className="sheet relative overflow-x-auto overscroll-x-contain after:pointer-events-none after:absolute after:inset-y-px after:right-px after:w-8 after:rounded-r-[13px] after:bg-gradient-to-l after:from-[var(--paper-raised)] after:to-transparent md:after:hidden">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="px-4 py-3 text-left font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint sm:px-5">
                Rolle
              </th>
              {data.permissionCatalog.map((perm) => (
                <th key={perm.key} className="px-2 py-3 text-center" title={perm.hint}>
                  <span className="block text-[0.7rem] font-semibold leading-tight text-ink-soft">{perm.label}</span>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {data.roles.map((role) => (
              <tr key={role.id} className="hairline-row">
                <td className="px-4 py-3 sm:px-5">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{role.name}</span>
                    {role.isSystem ? (
                      <Stamp>system</Stamp>
                    ) : (
                      <RenameRole
                        roleId={role.id}
                        current={role.name}
                        onDone={() => router.invalidate()}
                      />
                    )}
                  </span>
                  <span className="mt-0.5 block font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
                    {role.memberCount} medlem{role.memberCount === 1 ? '' : 'mer'}
                  </span>
                </td>
                {data.permissionCatalog.map((perm) => {
                  const on = role.isAdmin || role.permissions.includes(perm.key)
                  return (
                    <td key={perm.key} className="px-2 py-1 text-center">
                      <label className="flex min-h-[40px] cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={role.isAdmin || busy === `${role.id}:${perm.key}`}
                          onChange={(e) => toggle(role.id, perm.key, e.target.checked)}
                          className="h-4 w-4 cursor-pointer accent-[var(--brass)] disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`${role.name}: ${perm.label}`}
                        />
                      </label>
                    </td>
                  )
                })}
                <td className="px-3 py-3 text-right">
                  {!role.isSystem && (
                    <button
                      disabled={busy === role.id}
                      onClick={async () => {
                        setBusy(role.id)
                        try {
                          await deleteRole({ data: { roleId: role.id } })
                          toast('Rolle slettet')
                          await router.invalidate()
                        } catch (err) {
                          toastError(err)
                        } finally {
                          setBusy(null)
                        }
                      }}
                      className="-mx-2 -my-1 inline-flex items-center px-2 py-2 font-mono text-[0.62rem] uppercase tracking-wide text-danger/70 transition-colors hover:text-danger"
                    >
                      Slett
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 font-mono text-[0.64rem] uppercase tracking-[0.12em] text-ink-faint">
        Administrator = full tilgang (kan ikke endres)
      </p>

      <Modal open={creating} onClose={() => setCreating(false)} title="Ny rolle" kicker="Roller">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!newRoleName.trim()) return
            try {
              await createRole({ data: { name: newRoleName.trim() } })
              toast('Rolle opprettet — velg rettigheter i matrisen')
              setNewRoleName('')
              setCreating(false)
              await router.invalidate()
            } catch (err) {
              toastError(err)
            }
          }}
          className="space-y-4"
        >
          <Field label="Navn *" hint="F.eks. «Notearkivar» eller «Materialforvalter»">
            <input className="field-input" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} autoFocus placeholder="Rollenavn" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Avbryt
            </Button>
            <Button type="submit" variant="primary">
              Opprett
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  )
}

function RenameRole({ roleId, current, onDone }: { roleId: string; current: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(current)
  return (
    <>
      <button
        onClick={() => {
          setName(current)
          setOpen(true)
        }}
        className="-mx-2 -my-1.5 inline-flex items-center px-3 py-2.5 font-mono text-[0.58rem] uppercase tracking-wide text-ink-faint transition-colors hover:text-brass-strong"
        aria-label="Gi nytt navn"
      >
        endre navn
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Gi nytt navn" kicker="Rolle">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await renameRole({ data: { roleId, name: name.trim() } })
              setOpen(false)
              onDone()
            } catch (err) {
              toastError(err)
            }
          }}
          className="space-y-4"
        >
          <Field label="Navn">
            <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Avbryt
            </Button>
            <Button type="submit" variant="primary">
              Lagre
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

function Chevron({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg width="9" height="6" viewBox="0 0 9 6" fill="none" aria-hidden style={{ transform: dir === 'down' ? 'rotate(180deg)' : undefined }}>
      <path d="M1 5l3.5-3.5L8 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
