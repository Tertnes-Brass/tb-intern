import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast, toastError } from '../../components/toast'
import { Avatar, Button, Field, Kicker, Modal, Stamp } from '../../components/ui'
import { SECTION_LABELS, SECTION_ORDER } from '../../lib/taxonomy'
import {
  inviteMember,
  listMembers,
  revokeInvitation,
  sendMemberPasswordReset,
  setSectionLeaderParts,
  updateMemberParts,
  updateMemberProfile,
  updateMemberRole,
} from '../../server/members'

type Data = Awaited<ReturnType<typeof listMembers>>
type Member = Data['members'][number]

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

  // Stemmer denne brukeren kan tildele: alle (admin) eller eget omfang (leder).
  const partOptions =
    data.assignablePartIds == null
      ? data.allParts
      : data.allParts.filter((p) => data.assignablePartIds!.includes(p.id))

  // Grupper etter seksjonen til primærstemmen
  const groups = new Map<string, typeof data.members>()
  for (const m of data.members) {
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

  const setRole = async (userId: string, roleId: string) => {
    setBusyId(userId)
    try {
      await updateMemberRole({ data: { userId, roleId } })
      toast('Rolle oppdatert')
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
                  <span className="block truncate text-[0.92rem] font-semibold text-ink">{inv.email}</span>
                  <span className="block font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ink-faint">
                    {inv.roleName}
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
                        </span>
                        <span className="block truncate font-mono text-[0.64rem] text-ink-faint">{m.email}</span>
                        {leads.length > 0 && (
                          <span className="mt-0.5 block font-mono text-[0.6rem] uppercase tracking-[0.1em] text-brass-strong">
                            Leder: {leads.join(' · ')}
                          </span>
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

                      {data.canManage ? (
                        <select
                          className="field-input min-w-0 flex-1 !py-2 !text-base sm:!w-auto sm:!flex-none sm:!py-1.5 sm:!text-xs"
                          value={m.roleId}
                          disabled={busyId === m.id}
                          onChange={(e) => setRole(m.id, e.target.value)}
                        >
                          {data.allRoles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Stamp tone={m.roleId === 'member' ? 'neutral' : 'brass'}>{m.roleName}</Stamp>
                      )}

                      {data.canManage && (
                        <>
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
  onClose,
  onSaved,
}: {
  member: Member
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(member.name)
  const [phone, setPhone] = useState(member.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await updateMemberProfile({ data: { userId: member.id, name, phone } })
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
        <Field label="Telefon" hint="Valgfritt. Nummeret er bare tilgjengelig for administratorer.">
          <input
            type="tel"
            className="field-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder="+47 900 00 000"
          />
        </Field>
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

function InviteModal({
  open,
  onClose,
  allParts,
  allRoles,
  onInvited,
}: {
  open: boolean
  onClose: () => void
  allParts: Array<{ id: string; nameNo: string }>
  allRoles: Array<{ id: string; name: string }>
  onInvited: () => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [roleId, setRoleId] = useState('member')
  const [partId, setPartId] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      toast('Skriv inn en e-post', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await inviteMember({
        data: { email: email.trim(), name: name.trim() || undefined, roleId, partIds: partId ? [partId] : [] },
      })
      toast(
        res.emailSent
          ? `Invitasjon sendt til ${email}`
          : `${email} er invitert — be dem logge inn på noter.tertnesbrass.com`,
      )
      setEmail('')
      setName('')
      setPartId('')
      setRoleId('member')
      onInvited()
      onClose()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Inviter medlem" kicker="Besetningen">
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-post *" hint="Personen logger inn med denne adressen (e-postkode, lenke eller passord)">
          <input
            type="email"
            className="field-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="navn@example.com"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </Field>
        <Field label="Navn">
          <input
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ola Nordmann"
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Rolle">
            <select className="field-input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {allRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stemme">
            <select className="field-input" value={partId} onChange={(e) => setPartId(e.target.value)}>
              <option value="">Ingen / settes senere</option>
              {allParts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameNo}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} className="w-full sm:w-auto">
            Avbryt
          </Button>
          <Button type="submit" variant="primary" loading={saving} className="w-full sm:w-auto">
            Inviter
          </Button>
        </div>
      </form>
    </Modal>
  )
}
