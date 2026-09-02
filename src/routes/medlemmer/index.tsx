import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  InterestStamps,
  MemberDetailsFields,
  type MemberDetailsValue,
} from '../../components/MemberDetailsFields'
import { AccessSummary, RolePermissionList, RoleStamps } from '../../components/RoleAccess'
import { toast, toastError } from '../../components/toast'
import { Avatar, Button, Field, Kicker, Modal, Stamp } from '../../components/ui'
import {
  INTEREST_CATALOG,
  type InterestKey,
  countInterests,
  matchesInterests,
  matchesMemberQuery,
} from '../../lib/member-profile'
import {
  type InviteDelivery,
  MAX_INVITE_PARTS,
  addInvitePart,
  inviteDeliveryMessage,
  invitePayloadSchema,
  orderPartsWithPrimary,
  removeInvitePart,
} from '../../lib/invitation'
import { type RoleSummary, roleLabel } from '../../lib/roles'
import { SECTION_LABELS, SECTION_ORDER } from '../../lib/taxonomy'
import {
  inviteMember,
  listMembers,
  revokeInvitation,
  sendMemberPasswordReset,
  setSectionLeaderParts,
  updateMemberParts,
  updateMemberProfile,
  updateMemberRoles,
} from '../../server/members'

type Data = Awaited<ReturnType<typeof listMembers>>
type Member = Data['members'][number]

/**
 * Rollevelgeren (#48). Avkryssing, ikke nedtrekk: et medlem kan ha flere verv
 * samtidig, og valget skal vise HVA hvert kryss gir — ikke bare et navn.
 * Delt av «Roller…»-modalen og invitasjonsskjemaet, så de to aldri kan komme i
 * utakt om hva som er lov å velge.
 */
function RolePicker({
  allRoles,
  selected,
  onToggle,
}: {
  allRoles: RoleSummary[]
  selected: Set<string>
  onToggle: (roleId: string) => void
}) {
  return (
    <div className="divide-y divide-[var(--line)] rounded-xl border border-line">
      {allRoles.map((role) => (
        <label key={role.id} className="flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-paper-sunken">
          <input
            type="checkbox"
            checked={selected.has(role.id)}
            onChange={() => onToggle(role.id)}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[var(--brass)]"
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{role.name}</span>
              {role.isSystem && <Stamp tone="brass">systemrolle</Stamp>}
            </span>
            <span className="mt-1 block">
              <RolePermissionList role={role} />
            </span>
          </span>
        </label>
      ))}
    </div>
  )
}

export const Route = createFileRoute('/medlemmer/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: () => listMembers(),
  component: MembersPage,
})

function MembersPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [leaderFor, setLeaderFor] = useState<Member | null>(null)
  const [editFor, setEditFor] = useState<Member | null>(null)
  const [rolesFor, setRolesFor] = useState<Member | null>(null)
  const [query, setQuery] = useState('')
  const [interestFilter, setInterestFilter] = useState<InterestKey[]>([])

  // Stemmer denne brukeren kan tildele: alle (admin) eller eget omfang (leder).
  const partOptions =
    data.assignablePartIds == null
      ? data.allParts
      : data.allParts.filter((p) => data.assignablePartIds!.includes(p.id))

  // Filtrering er rent en VISNING av det serveren allerede har sluppet gjennom:
  // kontaktfeltene er fjernet server-side for dem den som ser ikke får se.
  const interestCounts = countInterests(data.members)
  const visible = data.members.filter(
    (m) => matchesInterests(m.interests, interestFilter) && matchesMemberQuery(m, query),
  )
  const filtering = interestFilter.length > 0 || query.trim().length > 0

  const toggleInterest = (key: InterestKey) =>
    setInterestFilter((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    )

  // Grupper etter seksjonen til primærstemmen
  const groups = new Map<string, typeof data.members>()
  for (const m of visible) {
    const primary = m.parts[0]
    const section = primary ? (data.allParts.find((p) => p.id === primary.id)?.section ?? 'other') : 'other'
    const list = groups.get(section) ?? []
    list.push(m)
    groups.set(section, list)
  }
  const order = [...SECTION_ORDER, 'other']
  const labels: Record<string, string> = { ...SECTION_LABELS, other: 'Stab og uten stemme' }

  const setPart = async (userId: string, partId: string) => {
    setBusyId(userId)
    try {
      await updateMemberParts({ data: { userId, partIds: partId ? [partId] : [] } })
      toast('Stemme oppdatert')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusyId(null)
    }
  }

  const [inviteOpen, setInviteOpen] = useState(false)

  return (
    <div className="space-y-9">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker className="mb-2">Besetningen</Kicker>
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Medlemmer</h1>
          <p className="mt-2 text-sm text-ink-soft">
            {data.members.length} musikere og stab.{' '}
            {data.canManage
              ? 'Du kan invitere, og endre stemmer og roller.'
              : data.canManageSection
                ? 'Du kan endre stemmer for medlemmer i din seksjon.'
                : 'Stemmer settes av seksjonsleder eller administrator.'}
          </p>
        </div>
        {data.canManage && (
          <Button variant="primary" onClick={() => setInviteOpen(true)}>
            Inviter medlem
          </Button>
        )}
      </header>

      {/* «Hvem kan hjelpe med rigg?» (#25). Filteret snevrer inn: to valgte
          tagger betyr noen som kan begge deler. */}
      <section className="rise sheet p-4 sm:p-5" style={{ animationDelay: '60ms' }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            className="field-input min-h-[44px] sm:max-w-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Søk etter navn, stemme eller nummer…"
            type="search"
            aria-label="Søk i medlemmer"
          />
          <div className="flex flex-wrap gap-1.5">
            {INTEREST_CATALOG.map((interest) => {
              const active = interestFilter.includes(interest.key)
              return (
                <button
                  key={interest.key}
                  type="button"
                  title={interest.hint}
                  aria-pressed={active}
                  onClick={() => toggleInterest(interest.key)}
                  className={`inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                    active
                      ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
                      : 'border-line-strong text-ink-soft hover:border-brass hover:text-brass-strong'
                  }`}
                >
                  {interest.label}
                  <span className="font-mono text-[0.6rem] text-ink-faint">{interestCounts[interest.key]}</span>
                </button>
              )
            })}
          </div>
        </div>
        {filtering && (
          <p className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-soft">
            <span>
              {visible.length} av {data.members.length} medlemmer
            </span>
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setInterestFilter([])
              }}
              className="cursor-pointer font-mono text-[0.62rem] uppercase tracking-[0.1em] text-brass-strong hover:underline"
            >
              Nullstill
            </button>
          </p>
        )}
      </section>

      {data.canManage && data.invites.length > 0 && (
        <section className="rise">
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="kicker">Venter på første innlogging</h2>
            <div className="staff-rule h-[10px] flex-1 opacity-30" aria-hidden />
          </div>
          <ul className="sheet divide-y divide-[var(--line)] overflow-hidden">
            {data.invites.map((inv) => (
              <li key={inv.email} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:px-5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.92rem] font-semibold text-ink">{inv.name ?? inv.email}</span>
                  {inv.name && (
                    <span className="block truncate font-mono text-[0.64rem] text-ink-faint">{inv.email}</span>
                  )}
                  <span className="block font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ink-faint">
                    {roleLabel(inv.roleNames)}
                    {inv.partNames.length > 0 ? ` · ${inv.partNames.join(' · ')}` : ''}
                  </span>
                </span>
                <Stamp tone="oxblood">Invitert</Stamp>
                <button
                  onClick={async () => {
                    try {
                      await revokeInvitation({ data: { email: inv.email } })
                      toast('Invitasjon trukket tilbake')
                      await router.invalidate()
                    } catch (err) {
                      toastError(err)
                    }
                  }}
                  className="-mx-2 -my-1.5 inline-flex items-center px-3 py-2.5 font-mono text-[0.64rem] uppercase tracking-wide text-danger/80 transition-colors hover:text-danger"
                >
                  Trekk tilbake
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {order
        .filter((key) => groups.has(key))
        .map((key, si) => (
          <section key={key} className="rise" style={{ animationDelay: `${80 + si * 50}ms` }}>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="kicker">{labels[key]}</h2>
              <div className="staff-rule h-[10px] flex-1 opacity-30" aria-hidden />
            </div>
            <ul className="sheet divide-y divide-[var(--line)] overflow-hidden">
              {groups.get(key)!.map((m) => {
                const leads = m.leaderPartIds
                  .map((id) => data.allParts.find((p) => p.id === id)?.nameNo)
                  .filter(Boolean)
                return (
                  <li
                    key={m.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2 sm:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-3 sm:flex-1">
                      <Avatar name={m.name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[0.92rem] font-semibold text-ink">{m.name}</span>
                          {m.id === data.meId && <Stamp tone="brass">deg</Stamp>}
                          {!m.isActive && <Stamp tone="oxblood">Sluttet</Stamp>}
                        </span>
                        {/* Kontaktinfo (#14): klikkbar, for det er poenget — å få
                            tak i folk. Tomme felt og deaktiverte medlemmers
                            kontaktinfo er allerede fjernet server-side. */}
                        <span className="flex flex-wrap items-center gap-x-3 font-mono text-[0.64rem] text-ink-faint">
                          {m.email && (
                            <a href={`mailto:${m.email}`} className="truncate hover:text-brass-strong hover:underline">
                              {m.email}
                            </a>
                          )}
                          {m.phone && (
                            <a
                              href={`tel:${m.phone.replace(/[^+0-9]/g, '')}`}
                              className="whitespace-nowrap hover:text-brass-strong hover:underline"
                            >
                              {m.phone}
                            </a>
                          )}
                        </span>
                        {leads.length > 0 && (
                          <span className="mt-0.5 block font-mono text-[0.6rem] uppercase tracking-[0.1em] text-brass-strong">
                            Leder: {leads.join(' · ')}
                          </span>
                        )}
                        {(m.secondaryParts.length > 0 || m.otherInstruments) && (
                          <span className="mt-0.5 block truncate text-[0.7rem] text-ink-soft">
                            Kan også:{' '}
                            {[...m.secondaryParts.map((p) => p.name), ...(m.otherInstruments ? [m.otherInstruments] : [])].join(
                              ' · ',
                            )}
                          </span>
                        )}
                        {m.interests.length > 0 && (
                          <span className="mt-1 block">
                            <InterestStamps interests={m.interests} />
                          </span>
                        )}
                        {m.interestsNote && (
                          <span className="mt-1 block text-[0.7rem] leading-snug text-ink-soft">{m.interestsNote}</span>
                        )}
                      </span>
                    </div>

                    <div className="flex w-full items-center gap-2 sm:contents">
                      {m.canEditParts ? (
                        <select
                          className="field-input min-w-0 flex-1 !py-2 !text-base sm:!w-auto sm:!flex-none sm:!py-1.5 sm:!text-xs"
                          value={m.parts[0]?.id ?? ''}
                          disabled={busyId === m.id}
                          onChange={(e) => setPart(m.id, e.target.value)}
                        >
                          <option value="">Ingen stemme</option>
                          {partOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.parentId ? `↳ ${p.nameNo}` : p.nameNo}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-ink-soft">
                          {m.parts.map((p) => p.name).join(' · ') || '—'}
                        </span>
                      )}

                      {/*
                        Rollene er et sett, ikke ett valg (#48). En <select> kan
                        vise ett; stemplene viser alle, og «Roller…» åpner
                        avkryssingen der man også ser hva hvert valg gir.
                      */}
                      <span className="flex flex-wrap items-center gap-1.5">
                        <RoleStamps roles={m.roles} />
                      </span>

                      {data.canManage && (
                        <>
                          <button
                            onClick={() => setRolesFor(m)}
                            disabled={busyId === m.id}
                            className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center rounded-lg px-2.5 py-1.5 font-mono text-[0.6rem] uppercase tracking-wide text-ink-faint transition-colors hover:bg-paper-sunken hover:text-brass-strong"
                          >
                            Roller…
                          </button>
                          <button
                            onClick={() => setEditFor(m)}
                            className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center rounded-lg px-2.5 py-1.5 font-mono text-[0.6rem] uppercase tracking-wide text-ink-faint transition-colors hover:bg-paper-sunken hover:text-brass-strong"
                          >
                            Rediger…
                          </button>
                          <button
                            onClick={() => setLeaderFor(m)}
                            className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center rounded-lg px-2.5 py-1.5 font-mono text-[0.6rem] uppercase tracking-wide text-ink-faint transition-colors hover:bg-paper-sunken hover:text-brass-strong"
                          >
                            Leder…
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

      {data.canManage && (
        <InviteModal
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          allParts={data.allParts}
          allRoles={data.allRoles}
          onInvited={() => router.invalidate()}
        />
      )}

      {data.canManage && rolesFor && (
        <RolesModal
          key={rolesFor.id}
          member={rolesFor}
          allRoles={data.allRoles}
          isMe={rolesFor.id === data.meId}
          onClose={() => setRolesFor(null)}
          onSaved={() => {
            setRolesFor(null)
            router.invalidate()
          }}
        />
      )}

      {data.canManage && leaderFor && (
        <LeaderModal
          key={leaderFor.id}
          member={leaderFor}
          allParts={data.allParts}
          onClose={() => setLeaderFor(null)}
          onSaved={() => {
            setLeaderFor(null)
            router.invalidate()
          }}
        />
      )}

      {data.canManage && editFor && (
        <AdminProfileModal
          key={editFor.id}
          member={editFor}
          allParts={data.allParts}
          onClose={() => setEditFor(null)}
          onSaved={() => {
            setEditFor(null)
            router.invalidate()
          }}
        />
      )}
    </div>
  )
}

function AdminProfileModal({
  member,
  allParts,
  onClose,
  onSaved,
}: {
  member: Member
  allParts: Data['allParts']
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(member.name)
  const [details, setDetails] = useState<MemberDetailsValue>({
    phone: member.phone ?? '',
    interests: [...member.interests],
    interestsNote: member.interestsNote ?? '',
    otherInstruments: member.otherInstruments ?? '',
    secondaryPartIds: member.secondaryParts.map((part) => part.id),
  })
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await updateMemberProfile({ data: { userId: member.id, name, ...details } })
      toast('Medlemsprofilen er oppdatert')
      onSaved()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  const sendReset = async () => {
    setResetting(true)
    try {
      const result = await sendMemberPasswordReset({ data: { userId: member.id } })
      toast(
        result.throttled
          ? 'En tilbakestillingslenke ble nylig sendt – vent litt før du prøver igjen'
          : `Tilbakestillingslenke sendt til ${member.email}`,
      )
    } catch (err) {
      toastError(err)
    } finally {
      setResetting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Rediger medlem" kicker="Administrasjon">
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-line bg-paper-sunken/50 px-4 py-3">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint">Innloggingsadresse</p>
          <p className="mt-1 truncate text-sm font-semibold text-ink">{member.email}</p>
        </div>
        <Field label="Navn">
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <MemberDetailsFields
          value={details}
          onChange={setDetails}
          allParts={allParts.map((p) => ({ id: p.id, name: p.nameNo, section: p.section, parentId: p.parentId }))}
          assignedPartIds={member.parts.map((p) => p.id)}
          phoneHint="Valgfritt. Synlig for de andre medlemmene i medlemslista."
          idPrefix={`admin-${member.id}`}
        />
        <div className="rounded-xl border border-line px-4 py-4">
          <p className="text-sm font-semibold text-ink">Problemer med innlogging?</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            Send en sikker lenke til den registrerte adressen. Administrator får aldri se eller sette passordet.
          </p>
          <Button type="button" size="sm" className="mt-3" loading={resetting} onClick={() => void sendReset()}>
            Send tilbakestillingslenke
          </Button>
        </div>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
          Profilendringer og passordreset loggføres.
        </p>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} className="w-full sm:w-auto">
            Avbryt
          </Button>
          <Button type="submit" variant="primary" loading={saving} className="w-full sm:w-auto">
            Lagre
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Rollene til ett medlem (#48). Full overskriving: det som står haket av når du
 * lagrer, ER rollene etterpå.
 *
 * «Samlet tilgang» oppdateres mens du huker av, slik at spørsmålet «hva får
 * denne personen egentlig?» besvares FØR lagring — ikke etterpå, ved å lete i
 * rollematrisen.
 */
function RolesModal({
  member,
  allRoles,
  isMe,
  onClose,
  onSaved,
}: {
  member: Member
  allRoles: Data['allRoles']
  isMe: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(member.roleIds))
  const [saving, setSaving] = useState(false)

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const chosen = allRoles.filter((r) => selected.has(r.id))

  const submit = async () => {
    setSaving(true)
    try {
      await updateMemberRoles({ data: { userId: member.id, roleIds: [...selected] } })
      toast('Roller oppdatert')
      onSaved()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Roller" kicker={member.name} mobileFull>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-soft">
          Et medlem kan ha flere roller samtidig — en musiker som også sitter i styret beholder musikertilgangen og får
          styrets på toppen. Tilgangene blir summen av alle rollene.
        </p>
        {isMe ? (
          // Serveren avviser dette uansett; her sier vi hvorfor, i stedet for å
          // la administratoren finne det ut med en feilmelding etter lagring.
          <p className="rounded-xl border border-dashed border-line px-4 py-3 text-xs leading-relaxed text-ink-soft">
            Du kan ikke endre dine egne roller. Be en annen administrator om det — ellers kunne man låst seg selv ute,
            eller gitt seg selv mer.
          </p>
        ) : (
          <RolePicker allRoles={allRoles} selected={selected} onToggle={toggle} />
        )}
        <AccessSummary roles={chosen} />
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} className="min-h-[44px] w-full sm:w-auto">
            Avbryt
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={saving}
            disabled={isMe || selected.size === 0}
            onClick={submit}
            className="min-h-[44px] w-full sm:w-auto"
          >
            Lagre
          </Button>
        </div>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
          Rolleendringer loggføres, og medlemmet må logge inn på nytt.
        </p>
      </div>
    </Modal>
  )
}

function LeaderModal({
  member,
  allParts,
  onClose,
  onSaved,
}: {
  member: Member
  allParts: Data['allParts']
  onClose: () => void
  onSaved: () => void
}) {
  // Man leder seksjoner/topp-stemmer; å lede en forelder gir omfang over barna.
  const leadable = allParts.filter((p) => !p.parentId)
  const [selected, setSelected] = useState<Set<string>>(new Set(member.leaderPartIds))
  const [saving, setSaving] = useState(false)

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const submit = async () => {
    setSaving(true)
    try {
      await setSectionLeaderParts({ data: { userId: member.id, partIds: [...selected] } })
      toast('Seksjonsleder oppdatert')
      onSaved()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Seksjonsleder" kicker={member.name}>
      <p className="mb-4 text-sm leading-relaxed text-ink-soft">
        Velg seksjonene <span className="font-semibold text-ink">{member.name}</span> kan tildele stemmer for. Å lede en
        seksjons-stemme gir omfang over alle understemmene. Krever i tillegg at medlemmets rolle har rettigheten «Lede
        egen seksjon».
      </p>
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {leadable.map((p) => (
          <label
            key={p.id}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-paper-sunken"
          >
            <input
              type="checkbox"
              checked={selected.has(p.id)}
              onChange={() => toggle(p.id)}
              className="h-4 w-4 cursor-pointer accent-[var(--brass)]"
            />
            <span className="text-sm text-ink">{p.nameNo}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="ghost" onClick={onClose}>
          Avbryt
        </Button>
        <Button type="button" variant="primary" loading={saving} onClick={submit}>
          Lagre
        </Button>
      </div>
    </Modal>
  )
}

/** Kvittering etter en lagret invitasjon — beskriver hva som FAKTISK skjedde. */
type InviteReceipt = {
  email: string
  name: string | null
  roleNames: string[]
  partNames: string[]
  delivery: InviteDelivery
}

function InviteModal({
  open,
  onClose,
  allParts,
  allRoles,
  onInvited,
}: {
  open: boolean
  onClose: () => void
  allParts: Data['allParts']
  allRoles: Data['allRoles']
  onInvited: () => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  // «Musiker» er startpunktet, ikke det eneste valget (#48): en ny styreleder
  // som også spiller inviteres med begge rollene med én gang.
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set(['member']))
  // Rekkefølgen bærer hovedstemmen: index 0 er primær, som i `user_parts`.
  const [partIds, setPartIds] = useState<string[]>([])
  const [sendInvite, setSendInvite] = useState(true)
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState<InviteReceipt | null>(null)

  const partById = new Map(allParts.map((p) => [p.id, p]))
  const chosen = partIds.flatMap((id) => {
    const part = partById.get(id)
    return part ? [part] : []
  })
  const atCap = partIds.length >= MAX_INVITE_PARTS

  // Grupper stemmene i seksjoner: 21 like linjer i en <select> er uleselig på
  // telefon, mens <optgroup> gir telefonens egen velger tydelige overskrifter.
  const sectionLabels: Record<string, string> = { ...SECTION_LABELS }
  const knownSections: string[] = [...SECTION_ORDER]
  const bySection = new Map<string, Data['allParts']>()
  for (const part of allParts) {
    const list = bySection.get(part.section) ?? []
    list.push(part)
    bySection.set(part.section, list)
  }
  const availableGroups = [
    ...knownSections.filter((key) => bySection.has(key)),
    // Seksjoner som er lagt til utenfor standardbesetningen havner sist.
    ...[...bySection.keys()].filter((key) => !knownSections.includes(key)),
  ]
    .map((key) => ({ key, parts: (bySection.get(key) ?? []).filter((p) => !partIds.includes(p.id)) }))
    .filter((group) => group.parts.length > 0)

  const clearForm = () => {
    setEmail('')
    setName('')
    setRoleIds(new Set(['member']))
    setPartIds([])
    setReceipt(null)
  }

  const close = () => {
    clearForm()
    onClose()
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Samme skjema som serveren bruker — feilmeldingene blir dermed identiske.
    const parsed = invitePayloadSchema.safeParse({
      email,
      name,
      roleIds: [...roleIds],
      partIds,
      primaryPartId: partIds[0],
      sendEmail: sendInvite,
    })
    if (!parsed.success) {
      toast(parsed.error.issues[0]?.message ?? 'Sjekk feltene', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await inviteMember({ data: parsed.data })
      const { message, kind } = inviteDeliveryMessage(res.delivery, parsed.data.email)
      toast(message, kind)
      setReceipt({
        email: parsed.data.email,
        name: parsed.data.name ?? null,
        roleNames: allRoles.filter((r) => roleIds.has(r.id)).map((r) => r.name),
        partNames: parsed.data.partIds.map((id) => partById.get(id)?.nameNo ?? id),
        delivery: res.delivery,
      })
      onInvited()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  if (receipt) {
    const { message, kind } = inviteDeliveryMessage(receipt.delivery, receipt.email)
    return (
      <Modal open={open} onClose={close} title="Invitasjonen er lagret" kicker="Besetningen" mobileFull>
        <div className="space-y-4">
          <div
            className={`rounded-xl border px-4 py-4 ${
              kind === 'error' ? 'border-danger/40 bg-danger/5' : 'border-line bg-paper-sunken/50'
            }`}
          >
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint">
              Hva skjedde med e-posten
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{message}</p>
            {receipt.delivery === 'logged' && (
              <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                Innholdet ble bare skrevet til serverloggen fordi e-postbindingen ikke er tilgjengelig i dette miljøet.
              </p>
            )}
          </div>
          <div className="rounded-xl border border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{receipt.name ?? receipt.email}</p>
            {receipt.name && <p className="truncate font-mono text-[0.64rem] text-ink-faint">{receipt.email}</p>}
            <p className="mt-1.5 font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ink-faint">
              {roleLabel(receipt.roleNames)}
              {receipt.partNames.length > 0 ? ` · ${receipt.partNames.join(' · ')}` : ' · ingen stemme'}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              Navn, roller og stemmer settes på kontoen ved første innlogging. Medlemmet kan selv oppdatere navn og
              telefon under «Min profil».
            </p>
          </div>
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={clearForm} className="min-h-[44px] w-full sm:w-auto">
              Inviter en til
            </Button>
            <Button type="button" variant="primary" onClick={close} className="min-h-[44px] w-full sm:w-auto">
              Ferdig
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={close} title="Inviter medlem" kicker="Besetningen" mobileFull>
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-post *" hint="Personen logger inn med denne adressen (e-postkode, lenke eller passord)">
          <input
            type="email"
            className="field-input min-h-[44px]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="navn@example.com"
            autoComplete="email"
            inputMode="email"
            enterKeyHint="next"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </Field>
        <Field label="Navn" hint="Valgfritt. Settes på kontoen ved første innlogging – medlemmet kan endre det selv.">
          <input
            className="field-input min-h-[44px]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ola Nordmann"
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
          />
        </Field>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-[0.8rem] font-medium text-ink-soft">Roller *</span>
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
              velg én eller flere
            </span>
          </div>
          <RolePicker
            allRoles={allRoles}
            selected={roleIds}
            onToggle={(id) =>
              setRoleIds((s) => {
                const next = new Set(s)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }
          />
          <div className="mt-2">
            <AccessSummary roles={allRoles.filter((r) => roleIds.has(r.id))} />
          </div>
          <span className="mt-1 block text-xs text-ink-faint">Kan endres senere i medlemslista.</span>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-[0.8rem] font-medium text-ink-soft">Stemmer</span>
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
              {partIds.length}/{MAX_INVITE_PARTS}
            </span>
          </div>
          {chosen.length > 0 ? (
            <ul className="mb-2 divide-y divide-[var(--line)] rounded-xl border border-line">
              {chosen.map((part, i) => (
                <li key={part.id} className="flex items-center gap-1 px-2">
                  <label className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2.5 py-1.5">
                    <input
                      type="radio"
                      name="invite-primary-part"
                      checked={i === 0}
                      onChange={() => setPartIds(orderPartsWithPrimary(partIds, part.id))}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--brass)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{part.nameNo}</span>
                      <span className="block font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
                        {sectionLabels[part.section] ?? 'Annen seksjon'}
                      </span>
                    </span>
                    {i === 0 && <Stamp tone="brass">Hovedstemme</Stamp>}
                  </label>
                  <button
                    type="button"
                    onClick={() => setPartIds(removeInvitePart(partIds, part.id))}
                    aria-label={`Fjern ${part.nameNo}`}
                    className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-faint transition-colors hover:bg-paper-sunken hover:text-danger"
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 rounded-xl border border-dashed border-line px-4 py-3 text-xs leading-relaxed text-ink-soft">
              Ingen stemme valgt. Det kan settes senere, men da havner medlemmet under «Stab og uten stemme» — og får
              ingen stemmefiler.
            </p>
          )}
          <select
            className="field-input min-h-[44px]"
            value=""
            disabled={atCap}
            onChange={(e) => setPartIds(addInvitePart(partIds, e.target.value))}
          >
            <option value="">
              {atCap
                ? `Maks ${MAX_INVITE_PARTS} stemmer er valgt`
                : chosen.length > 0
                  ? 'Legg til én stemme til…'
                  : 'Velg stemme…'}
            </option>
            {availableGroups.map((group) => (
              <optgroup key={group.key} label={sectionLabels[group.key] ?? 'Annen seksjon'}>
                {group.parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.parentId ? `↳ ${p.nameNo}` : p.nameNo}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-faint">
            Seksjon velges ikke separat: hovedstemmen avgjør hvilken seksjon medlemmet vises i, og stemmene styrer
            hvilke filer hen får.
          </span>
        </div>

        <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-line px-4 py-3">
          <input
            type="checkbox"
            checked={sendInvite}
            onChange={(e) => setSendInvite(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--brass)]"
          />
          <span>
            <span className="block text-sm font-medium text-ink">Send invitasjon på e-post</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">
              Sender en velkomst med innloggingslenke som er gyldig i 30 minutter. Du får vite om e-posten faktisk gikk
              ut — den er ikke aktivert i alle miljøer.
            </span>
          </span>
        </label>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={close} className="min-h-[44px] w-full sm:w-auto">
            Avbryt
          </Button>
          <Button type="submit" variant="primary" loading={saving} className="min-h-[44px] w-full sm:w-auto">
            {sendInvite ? 'Inviter og send e-post' : 'Inviter uten e-post'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
