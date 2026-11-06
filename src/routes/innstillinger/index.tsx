import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast, toastError } from '../../components/toast'
import { ActionMenu } from '../../components/ActionMenu'
import { Icon } from '../../components/Icons'
import { Button, Field, Modal, PageHeader } from '../../components/ui'
import { ConfirmDialog } from '../../components/admin/ConfirmDialog'
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

  const sections = [
    { id: 'besetning', label: 'Besetning', count: data.parts.length },
    { id: 'roller', label: 'Roller og tilgang', count: data.roles.length },
  ]

  return (
    <div className="space-y-6">
      {/*
        Filtilganger er ikke lenger i toppmenyen (docs/designprinsipper.md §6).
        Området har fortsatt eget inngangspunkt — herfra og fra «Områder» på
        hub-en. URL-en er uendret, så gamle lenker virker.
      */}
      <PageHeader
        className="rise"
        title="Innstillinger"
        summary="Besetning og roller for korpset. Endringer gjelder umiddelbart."
        action={
          canViewDownloads && (
            <Link
              to="/innstillinger/nedlastinger"
              className="inline-flex min-h-10 items-center gap-1 rounded-[9px] border border-line-strong bg-paper-raised px-3.5 text-sm font-medium text-ink transition-colors hover:border-brass hover:text-brass-strong pointer-coarse:min-h-11 lg:hidden"
            >
              Filtilganger
              <Icon name="chevronRight" size={15} />
            </Link>
          )
        }
      />

      <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-10">
        {/* Innholdsfortegnelse: sidekolonne fra lg, en rad med hopp under det —
            Besetning er 21 rader, og rollene skal ikke ligge gjemt under dem. */}
        <aside className="hidden lg:block" aria-label="Innhold">
          <nav className="aside-sticky space-y-0.5">
            {sections.map((sec) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => jumpTo(sec.id)}
                className="flex min-h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink pointer-coarse:min-h-11"
              >
                {sec.label}
                <span className="text-[0.8rem] font-normal tabular-nums text-ink-faint">{sec.count}</span>
              </button>
            ))}
            {canViewDownloads && <div aria-hidden className="!my-2 mx-3 h-px bg-line" />}
            {canViewDownloads && (
              <Link
                to="/innstillinger/nedlastinger"
                className="flex min-h-10 items-center justify-between gap-2 rounded-lg px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-sunken hover:text-brass-strong pointer-coarse:min-h-11"
              >
                Filtilganger
                <Icon name="chevronRight" size={15} />
              </Link>
            )}
          </nav>
        </aside>

        <div className="min-w-0 space-y-10">
          <nav className="rise -mt-1 flex flex-wrap gap-2 lg:hidden" aria-label="Hopp til" style={{ animationDelay: '40ms' }}>
            {sections.map((sec) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => jumpTo(sec.id)}
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-paper-raised px-3.5 text-[0.85rem] font-medium text-ink-soft transition-colors hover:border-brass hover:text-ink pointer-coarse:min-h-11 pointer-coarse:px-4"
              >
                {sec.label}
                <span className="tabular-nums text-ink-faint">{sec.count}</span>
              </button>
            ))}
          </nav>

          <PartsSection data={data} />
          <RolesSection data={data} />
        </div>
      </div>
    </div>
  )
}

/** Hopp til en seksjon — virker både i vinduet og i `.app-shell` (installert iOS-app). */
function jumpTo(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}

// ---------- Besetning ----------

function PartsSection({ data }: { data: Data }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Part | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Part | null>(null)
  // Rekkefølgen endres sjelden; pilene og «Flytt til…» vises bare i denne modusen.
  const [reorder, setReorder] = useState(false)
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
  const sectionLabel = (p: Part) => SECTION_LABELS[p.section as keyof typeof SECTION_LABELS] ?? p.section

  return (
    <section id="besetning" className="rise admin-anchor" style={{ animationDelay: '80ms' }}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-3 gap-y-3">
        <div className="min-w-0">
          <h2 className="display-title text-xl font-semibold text-ink">Besetning</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {reorder
              ? 'Flytt med pilene, eller velg «Flytt til …». Hver flytting lagres med en gang.'
              : `${data.parts.length} stemmer. Aliasene avgjør hvordan filnavn gjenkjennes ved opplasting.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {reorder ? (
            <Button size="sm" variant="primary" onClick={() => setReorder(false)}>
              Ferdig
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={() => setReorder(true)}>
                <Icon name="list" size={15} />
                Endre rekkefølge
              </Button>
              <Button size="sm" onClick={() => setCreating(true)}>
                + Ny stemme
              </Button>
            </>
          )}
        </div>
      </div>

      <ul className={`list-group ${reorder ? 'border-brass/50' : ''}`}>
        {data.parts.map((p) => {
          // Søsken = rader på samme nivå: rot-stemmer seg imellom, understemmer innenfor forelderen
          const peers = data.parts.filter((x) => (x.parentId ?? null) === (p.parentId ?? null))
          const peerIdx = peers.findIndex((x) => x.id === p.id)
          const indent = p.parentId ? 'pl-9 sm:pl-11' : 'pl-4 sm:pl-5'
          const identity = (
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-baseline gap-2">
                {p.parentId && (
                  <span aria-hidden className="shrink-0 text-ink-faint">
                    ↳
                  </span>
                )}
                <span className="shrink-0 text-[0.95rem] font-semibold text-ink">{p.nameNo}</span>
                <span className="truncate text-[0.8rem] text-ink-soft">{p.nameEn}</span>
              </span>
              {!reorder && (
                <span className="mt-0.5 block truncate text-[0.8rem] text-ink-soft">
                  {p.parentId ? `Under ${partName.get(p.parentId) ?? '?'} · ` : ''}
                  {sectionLabel(p)}
                  {p.inUse > 0 ? ` · ${p.inUse} i bruk` : ''}
                  {p.aliases.length > 0 ? ` · alias: ${p.aliases.join(', ')}` : ' · ingen alias'}
                </span>
              )}
            </span>
          )

          if (reorder) {
            return (
              <li key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 pr-3 sm:pr-4 ${indent}`}>
                {identity}
                <span className="flex shrink-0 items-center gap-1.5">
                  <MoveButton
                    dir="up"
                    label={`Flytt «${p.nameNo}» opp`}
                    disabled={busy !== null || peerIdx <= 0}
                    onClick={() => act(p.id, () => movePart({ data: { id: p.id, direction: 'up' } }))}
                  />
                  <MoveButton
                    dir="down"
                    label={`Flytt «${p.nameNo}» ned`}
                    disabled={busy !== null || peerIdx === peers.length - 1}
                    onClick={() => act(p.id, () => movePart({ data: { id: p.id, direction: 'down' } }))}
                  />
                </span>
                <select
                  className="field-input compact-select w-full sm:!w-44"
                  value=""
                  disabled={busy !== null || peers.length <= 1}
                  aria-label={`Flytt «${p.nameNo}» til`}
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) return
                    act(p.id, () => movePartTo({ data: { id: p.id, afterId: v === '__first' ? null : v } }))
                  }}
                >
                  <option value="" disabled>
                    Flytt til …
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
              </li>
            )
          }

          return (
            <li key={p.id} className={`flex items-center gap-2 py-2.5 pr-2 sm:pr-3 ${indent}`}>
              {identity}
              <ActionMenu
                iconOnly
                label={`Mer for ${p.nameNo}`}
                title={p.nameNo}
                items={[
                  { label: 'Rediger stemmen', hint: 'Navn, seksjon og alias', icon: 'sliders', onSelect: () => setEditing(p) },
                  { label: 'Endre rekkefølge', hint: 'Flytt stemmene i besetningen', icon: 'list', onSelect: () => setReorder(true) },
                  {
                    label: 'Slett stemmen',
                    hint:
                      p.fileCount > 0
                        ? `I bruk på ${p.fileCount} fil${p.fileCount === 1 ? '' : 'er'} – kan ikke slettes`
                        : 'Du bekrefter i neste steg',
                    icon: 'close',
                    tone: 'danger',
                    disabled: busy === p.id || p.fileCount > 0,
                    onSelect: () => setDeleting(p),
                  },
                ]}
              />
            </li>
          )
        })}
      </ul>

      {reorder && (
        <div className="mt-3 flex justify-end">
          <Button variant="primary" onClick={() => setReorder(false)} className="w-full sm:w-auto">
            Ferdig med rekkefølgen
          </Button>
        </div>
      )}

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

      <ConfirmDialog
        open={deleting !== null}
        kicker="Besetning"
        title={`Slette «${deleting?.nameNo ?? ''}»?`}
        confirmLabel="Slett stemmen"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          try {
            await deletePart({ data: { id: deleting.id } })
          } catch (err) {
            toastError(err)
            throw err
          }
          toast('Stemmen er slettet')
          await router.invalidate()
        }}
      >
        <p>
          Stemmen forsvinner fra besetningen, og aliasene slutter å gjenkjenne filnavn ved opplasting.
          {deleting && deleting.inUse > 0
            ? ` ${deleting.inUse} ${deleting.inUse === 1 ? 'medlem har' : 'medlemmer har'} den og mister den.`
            : ''}
        </p>
      </ConfirmDialog>
    </section>
  )
}

function MoveButton({
  dir,
  label,
  disabled,
  onClick,
}: {
  dir: 'up' | 'down'
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-9 w-9 cursor-pointer place-items-center rounded-[9px] border border-line-strong bg-paper-raised text-ink-soft transition-colors hover:border-brass hover:text-brass-strong disabled:pointer-events-none disabled:opacity-30 pointer-coarse:h-11 pointer-coarse:w-11"
    >
      <Chevron dir={dir} />
    </button>
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
          <p className="text-[0.8rem] text-ink-soft">
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

type Role = Data['roles'][number]

function RolesSection({ data }: { data: Data }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')
  const [renaming, setRenaming] = useState<Role | null>(null)
  const [deleting, setDeleting] = useState<Role | null>(null)
  // Telefon: én rolle om gangen, i et ark. Holdes som id, så arket viser
  // ferske data etter hver avkryssing (router.invalidate).
  const [openRoleId, setOpenRoleId] = useState<string | null>(null)
  const openRole = data.roles.find((r) => r.id === openRoleId) ?? null
  const total = data.permissionCatalog.length

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

  const has = (role: Role, key: string) => role.isAdmin || role.permissions.includes(key)
  const countFor = (role: Role) => data.permissionCatalog.filter((p) => has(role, p.key)).length
  const members = (n: number) => `${n} ${n === 1 ? 'medlem' : 'medlemmer'}`

  const roleMenu = (role: Role) =>
    role.isSystem ? null : (
      <ActionMenu
        iconOnly
        label={`Mer for rollen ${role.name}`}
        title={role.name}
        items={[
          { label: 'Gi nytt navn', icon: 'sliders', onSelect: () => setRenaming(role) },
          {
            label: 'Slett rollen',
            hint: role.memberCount > 0 ? `${members(role.memberCount)} har den – flytt dem først` : 'Du bekrefter i neste steg',
            icon: 'close',
            tone: 'danger',
            disabled: busy === role.id || role.memberCount > 0,
            onSelect: () => setDeleting(role),
          },
        ]}
      />
    )

  return (
    <section id="roller" className="rise admin-anchor" style={{ animationDelay: '160ms' }}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="display-title text-xl font-semibold text-ink">Roller og tilgang</h2>
          <p className="mt-1 text-sm text-ink-soft">Hvilke rettigheter hver rolle har. Administrator har alltid full tilgang.</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          + Ny rolle
        </Button>
      </div>

      {/* Telefon: rollene som rader; rettighetene i et ark per rolle. */}
      <ul className="list-group md:hidden">
        {data.roles.map((role) => (
          <li key={role.id} className="flex items-center gap-1 pr-2">
            <button
              type="button"
              onClick={() => setOpenRoleId(role.id)}
              className="list-row-link flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2.5 pl-4 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.95rem] font-semibold text-ink">{role.name}</span>
                <span className="block truncate text-[0.8rem] text-ink-soft">
                  {role.isAdmin ? 'Full tilgang' : `${countFor(role)} av ${total} rettigheter`} · {members(role.memberCount)}
                  {role.isSystem ? ' · systemrolle' : ''}
                </span>
              </span>
              <Icon name="chevronRight" size={16} className="text-ink-faint" />
            </button>
            {roleMenu(role)}
          </li>
        ))}
      </ul>

      {/* iPad og desktop: matrisen, med rettighetene som rader og rollene som
          kolonner. Den er sin egen avgrensede rulleflate, så rollenavnene står
          fast øverst og rettighetene fast til venstre mens man ruller — ellers
          endrer man tilganger (som lagres med en gang) i navnløse kolonner. */}
      <div className="admin-matrix-scroll surface-group relative hidden overflow-auto overscroll-contain md:block">
        <table className="admin-matrix w-full border-collapse text-sm">
          <thead>
            <tr className="admin-matrix-head border-b border-line">
              <th scope="col" className="admin-matrix-sticky px-4 py-3 text-left align-bottom text-[0.8rem] font-medium text-ink-soft lg:px-5">
                Rettighet
              </th>
              {data.roles.map((role) => (
                <th key={role.id} scope="col" className="px-1.5 py-2.5 text-center align-bottom">
                  <span className="block text-[0.82rem] font-semibold leading-tight text-ink">{role.name}</span>
                  <span
                    className="mt-0.5 block whitespace-nowrap text-[0.75rem] font-normal leading-tight text-ink-soft"
                    title={members(role.memberCount)}
                  >
                    {role.memberCount} medl.
                  </span>
                  {!role.isSystem && <span className="mt-1 flex justify-center">{roleMenu(role)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.permissionCatalog.map((perm) => (
              <tr key={perm.key} className="hairline-row">
                <th scope="row" className="admin-matrix-sticky px-4 py-2 text-left font-normal lg:px-5">
                  <span className="block text-[0.88rem] font-medium text-ink">{perm.label}</span>
                  <span className="block text-[0.78rem] leading-snug text-ink-soft">{perm.hint}</span>
                </th>
                {data.roles.map((role) => (
                  <td key={role.id} className="px-1 py-0.5 text-center">
                    <label className="mx-auto flex min-h-10 min-w-10 cursor-pointer items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                      <input
                        type="checkbox"
                        checked={has(role, perm.key)}
                        disabled={role.isAdmin || busy === `${role.id}:${perm.key}`}
                        onChange={(e) => toggle(role.id, perm.key, e.target.checked)}
                        className="h-4 w-4 cursor-pointer accent-[var(--brass)] disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-5 pointer-coarse:w-5"
                        aria-label={`${role.name}: ${perm.label}`}
                      />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[0.8rem] text-ink-soft">Administrator har full tilgang, og det kan ikke endres.</p>

      <Modal
        open={openRole !== null}
        onClose={() => setOpenRoleId(null)}
        title={openRole?.name ?? ''}
        kicker="Rettigheter"
      >
        {openRole && (
          <>
            <p className="mb-3 text-[0.82rem] text-ink-soft">
              {openRole.isAdmin
                ? 'Administrator har full tilgang, og det kan ikke endres.'
                : `${countFor(openRole)} av ${total} rettigheter · ${members(openRole.memberCount)}. Endringer lagres med en gang.`}
            </p>
            <ul className="list-group">
              {data.permissionCatalog.map((perm) => (
                <li key={perm.key}>
                  <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.92rem] font-medium text-ink">{perm.label}</span>
                      <span className="block text-[0.8rem] leading-snug text-ink-soft">{perm.hint}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={has(openRole, perm.key)}
                      disabled={openRole.isAdmin || busy === `${openRole.id}:${perm.key}`}
                      onChange={(e) => toggle(openRole.id, perm.key, e.target.checked)}
                      className="h-5 w-5 shrink-0 cursor-pointer accent-[var(--brass)] disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title="Ny rolle" kicker="Roller">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!newRoleName.trim()) return
            try {
              await createRole({ data: { name: newRoleName.trim() } })
              toast('Rolle opprettet — velg rettighetene')
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
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)} className="w-full sm:w-auto">
              Avbryt
            </Button>
            <Button type="submit" variant="primary" className="w-full sm:w-auto">
              Opprett
            </Button>
          </div>
        </form>
      </Modal>

      {renaming && (
        <RenameRole
          key={renaming.id}
          roleId={renaming.id}
          current={renaming.name}
          onClose={() => setRenaming(null)}
          onDone={() => {
            setRenaming(null)
            router.invalidate()
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        kicker="Roller"
        title={`Slette rollen «${deleting?.name ?? ''}»?`}
        confirmLabel="Slett rollen"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          setBusy(deleting.id)
          try {
            await deleteRole({ data: { roleId: deleting.id } })
          } catch (err) {
            toastError(err)
            throw err
          } finally {
            setBusy(null)
          }
          toast('Rolle slettet')
          await router.invalidate()
        }}
      >
        <p>Rollen og rettighetene den gir, forsvinner. Ingen medlemmer har den nå.</p>
      </ConfirmDialog>
    </section>
  )
}

function RenameRole({
  roleId,
  current,
  onClose,
  onDone,
}: {
  roleId: string
  current: string
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState(current)
  return (
    <Modal open onClose={onClose} title="Gi nytt navn" kicker="Rolle">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await renameRole({ data: { roleId, name: name.trim() } })
            toast('Rollen har fått nytt navn')
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
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} className="w-full sm:w-auto">
            Avbryt
          </Button>
          <Button type="submit" variant="primary" className="w-full sm:w-auto">
            Lagre
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function Chevron({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg width="9" height="6" viewBox="0 0 9 6" fill="none" aria-hidden style={{ transform: dir === 'down' ? 'rotate(180deg)' : undefined }}>
      <path d="M1 5l3.5-3.5L8 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
