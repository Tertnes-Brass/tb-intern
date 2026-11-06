import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { PushCard } from '../components/PushCard'
import { toast, toastError } from '../components/toast'
import { Segmented } from '../components/Segmented'
import { Button, Field, PageHeader, Stamp } from '../components/ui'
import { authClient } from '../lib/auth-client'
import {
  PASSWORD_MIN_LENGTH,
  memberNameSchema,
  passwordSchema,
  phoneSchema,
} from '../lib/profile'
import type { BoardTaskNotificationChoice } from '../lib/board'
import type { MentionNotificationChoice } from '../lib/mentions'
import type { PostNotificationChoice } from '../lib/posts'
import {
  getMyProfile,
  updateMyBoardTaskNotifications,
  updateMyMentionNotifications,
  updateMyPhone,
  updateMyPostNotifications,
} from '../server/profile'

export const Route = createFileRoute('/min-profil')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: () => getMyProfile(),
  component: MyProfilePage,
})

function MyProfilePage() {
  const profile = Route.useLoaderData()
  const { me } = Route.useRouteContext()
  const router = useRouter()
  const [name, setName] = useState(profile.name)
  const [phone, setPhone] = useState(profile.phone)
  const [savingProfile, setSavingProfile] = useState(false)

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsedName = memberNameSchema.safeParse(name)
    const parsedPhone = phoneSchema.safeParse(phone)
    if (!parsedName.success || !parsedPhone.success) {
      toast(parsedName.error?.issues[0]?.message ?? parsedPhone.error?.issues[0]?.message ?? 'Ugyldige felt', 'error')
      return
    }
    setSavingProfile(true)
    try {
      if (parsedName.data !== profile.name) {
        const { error } = await authClient.updateUser({ name: parsedName.data })
        if (error) throw new Error(error.message ?? 'Kunne ikke oppdatere navnet')
      }
      await updateMyPhone({ data: { phone: parsedPhone.data } })
      toast('Profilen er oppdatert')
      await router.invalidate({ sync: true })
    } catch (err) {
      toastError(err)
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <div className="space-y-7">
      <PageHeader
        className="rise"
        title="Min profil"
        summary={profile.email}
        action={<Stamp tone="brass">{profile.roleName}</Stamp>}
      />

      {/* Fra md (iPad stående) to kolonner: deg selv til venstre, varsler til høyre. */}
      <div className="grid items-start gap-x-8 gap-y-8 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-8">
          <section className="rise" style={{ animationDelay: '60ms' }} aria-labelledby="profil-heading">
            <h2 id="profil-heading" className="group-label">
              Personopplysninger
            </h2>
            <form onSubmit={saveProfile} className="surface-group space-y-5 p-5 sm:p-6">
              <Field label="Navn">
                <input
                  className="field-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </Field>
              <Field label="Telefon" hint="Valgfritt. Synlig for administratorer.">
                <input
                  type="tel"
                  className="field-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="+47 900 00 000"
                />
              </Field>
              <Field label="E-post" hint="Dette er innloggingsadressen din og kan ikke endres her ennå.">
                <input className="field-input opacity-75" value={profile.email} readOnly aria-readonly />
              </Field>
              {profile.parts.length > 0 && (
                <div>
                  <p className="mb-2 text-[0.8rem] font-medium text-ink-soft">Stemme</p>
                  <div className="flex flex-wrap gap-2">
                    {profile.parts.map((part) => (
                      <Stamp key={part}>{part}</Stamp>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-end pt-1">
                <Button type="submit" variant="primary" loading={savingProfile}>
                  Lagre profil
                </Button>
              </div>
            </form>
          </section>

          <PasswordCard hasPassword={profile.hasPassword} email={profile.email} />
        </div>

        <div className="space-y-8">
          <PushCard userId={me!.id} />
          <section className="rise" style={{ animationDelay: '100ms' }} aria-labelledby="varsler-heading">
            <h2 id="varsler-heading" className="group-label">
              Hva du blir varslet om
            </h2>
            <div className="surface-group divide-y divide-[var(--line)]">
              <NotificationsCard current={profile.notifyPosts} />
              <MentionNotificationsCard current={profile.notifyMentions} />
              {/* Styreoppgaver angår bare styret — valget vises derfor kun for dem
                  som har `board.manage` (avgjort server-side i `getMyProfile`). */}
              {profile.canManageBoard && <BoardTaskNotificationsCard current={profile.notifyBoardTasks} />}
            </div>
            <p className="mt-2.5 px-1 text-xs leading-relaxed text-ink-faint">
              Gjelder e-post og enhetene der du har slått på varsler.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

/**
 * Én rad i varslingsgruppen: hva valget gjelder, én linje forklaring, og valget
 * som segmentert kontroll til høyre (under på smale skjermer). Detaljene står i
 * en sammenfoldet «Mer om dette» — de er sanne, men ikke det man leter etter.
 */
function ChoiceRow<T extends string>({
  title,
  description,
  details,
  value,
  options,
  busy,
  onChange,
}: {
  title: string
  description: string
  details: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  busy: boolean
  onChange: (value: T) => void
}) {
  return (
    <div className="px-5 py-4 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6 md:flex-col md:gap-3 lg:flex-row lg:gap-6">
        <div className="min-w-0">
          <h3 className="text-[0.98rem] font-semibold text-ink">{title}</h3>
          <p className="mt-0.5 text-sm leading-snug text-ink-soft">{description}</p>
        </div>
        <Segmented label={title} value={value} options={options} onChange={onChange} disabled={busy} className="shrink-0 self-start" />
      </div>
      <details className="group mt-2">
        <summary className="hit inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-ink-faint hover:text-ink-soft [&::-webkit-details-marker]:hidden">
          Mer om dette
          <svg width="9" height="6" viewBox="0 0 9 6" fill="none" aria-hidden className="transition-transform group-open:rotate-180">
            <path d="M1 1l3.5 3.5L8 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{details}</p>
      </details>
    </div>
  )
}

const NOTIFY_CHOICES: Array<{ value: PostNotificationChoice; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'important', label: 'Bare viktige' },
  { value: 'off', label: 'Av' },
]

/** Varslingsvalget for Beskjeder (#28). Standarden er «Alle» — ingen rad i databasen. */
function NotificationsCard({ current }: { current: PostNotificationChoice }) {
  const router = useRouter()
  const [choice, setChoice] = useState<PostNotificationChoice>(current)
  const [busy, setBusy] = useState(false)

  const save = async (next: PostNotificationChoice) => {
    const previous = choice
    setChoice(next)
    setBusy(true)
    try {
      await updateMyPostNotifications({ data: { posts: next } })
      toast('Varslingsvalget er lagret')
      await router.invalidate()
    } catch (err) {
      setChoice(previous)
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ChoiceRow
      title="Beskjeder"
      description="Beskjeder fra styret ligger alltid på internsiden — velg hvor mye du vil bli varslet om."
      details="«Bare viktige» betyr de beskjedene styret selv har merket som viktige. «Av» slår av alle varsler om beskjeder — du finner dem fortsatt under Beskjeder."
      value={choice}
      options={NOTIFY_CHOICES}
      busy={busy}
      onChange={(next) => void save(next)}
    />
  )
}

const MENTION_CHOICES: Array<{ value: MentionNotificationChoice; label: string }> = [
  { value: 'all', label: 'På' },
  { value: 'off', label: 'Av' },
]

/**
 * Varslingsvalget for omtaler (#83). Eget valg, ikke en del av «E-post om
 * beskjeder»: en direkte omtale er et spørsmål til deg, ikke en kunngjøring til
 * korpset, og de to valgene skal kunne stå ulikt.
 */
function MentionNotificationsCard({ current }: { current: MentionNotificationChoice }) {
  const router = useRouter()
  const [choice, setChoice] = useState<MentionNotificationChoice>(current)
  const [busy, setBusy] = useState(false)

  const save = async (next: MentionNotificationChoice) => {
    const previous = choice
    setChoice(next)
    setBusy(true)
    try {
      await updateMyMentionNotifications({ data: { mentions: next } })
      toast('Varslingsvalget er lagret')
      await router.invalidate()
    } catch (err) {
      setChoice(previous)
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ChoiceRow
      title="Når noen nevner eller svarer deg"
      description="@-omtaler på veggen og i forumet, og svar på det du har skrevet."
      details="Skriver noen «@» og navnet ditt på veggen, får du én e-post med lenke til innlegget — og et varsel på enhetene der du har slått på varsler. I forumet får du bare varselet, ingen e-post. Trykker noen «Svar» på noe du har skrevet — en kommentar eller et forumsvar — får du også et varsel, også i en tråd du har dempet. Du blir aldri varslet når du nevner eller svarer deg selv, og aldri mer enn én gang per kommentar. «Av» slår det av helt — omtalen og svaret står fortsatt der."
      value={choice}
      options={MENTION_CHOICES}
      busy={busy}
      onChange={(next) => void save(next)}
    />
  )
}

const BOARD_TASK_CHOICES: Array<{ value: BoardTaskNotificationChoice; label: string }> = [
  { value: 'all', label: 'På' },
  { value: 'off', label: 'Av' },
]

/**
 * Ett valg for begge e-postene om styreoppgaver: den du får når noen delegerer
 * en oppgave til deg, og den daglige påminnelsen om forfalte frister. To brytere
 * for to e-poster fra samme sted ville vært én for mye.
 */
function BoardTaskNotificationsCard({ current }: { current: BoardTaskNotificationChoice }) {
  const router = useRouter()
  const [choice, setChoice] = useState<BoardTaskNotificationChoice>(current)
  const [busy, setBusy] = useState(false)

  const save = async (next: BoardTaskNotificationChoice) => {
    const previous = choice
    setChoice(next)
    setBusy(true)
    try {
      await updateMyBoardTaskNotifications({ data: { boardTasks: next } })
      toast('Varslingsvalget er lagret')
      await router.invalidate()
    } catch (err) {
      setChoice(previous)
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ChoiceRow
      title="E-post om styreoppgaver"
      description="Når du får en oppgave, og påminnelse om forfalte frister."
      details="Gjelder både når noen setter deg som ansvarlig for en oppgave, og den daglige påminnelsen om oppgaver du står som ansvarlig for som har gått over fristen. «Av» slår av all e-post om styreoppgaver. Oppgavene ligger fortsatt under Styre."
      value={choice}
      options={BOARD_TASK_CHOICES}
      busy={busy}
      onChange={(next) => void save(next)}
    />
  )
}

function PasswordCard({ hasPassword, email }: { hasPassword: boolean; email: string }) {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const validNewPassword = () => {
    const parsed = passwordSchema.safeParse(newPassword)
    if (!parsed.success) {
      toast(parsed.error.issues[0]?.message ?? 'Ugyldig passord', 'error')
      return false
    }
    if (newPassword !== confirmPassword) {
      toast('Passordene er ikke like', 'error')
      return false
    }
    return true
  }

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validNewPassword()) return
    setBusy(true)
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (error) throw new Error(error.message ?? 'Kunne ikke endre passordet')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast('Passordet er endret. Andre innlogginger er logget ut.')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const sendSetupCode = async () => {
    setBusy(true)
    try {
      const { error } = await authClient.emailOtp.requestPasswordReset({ email })
      if (error) throw new Error(error.message ?? 'Kunne ikke sende kode')
      setCodeSent(true)
      setOtp('')
      toast('Engangskode sendt')
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const createPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validNewPassword()) return
    setBusy(true)
    try {
      const { error } = await authClient.emailOtp.resetPassword({
        email,
        otp: otp.trim(),
        password: newPassword,
      })
      if (error) throw new Error(error.message ?? 'Koden er ugyldig eller utløpt')
      toast('Passordet er opprettet. Logg inn på nytt.')
      await authClient.signOut()
      await router.invalidate()
      await router.navigate({ to: '/login' })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rise" style={{ animationDelay: '130ms' }} aria-labelledby="passord-heading">
      <h2 id="passord-heading" className="group-label">
        Innlogging
      </h2>
      <div className="surface-group overflow-hidden">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[0.98rem] font-semibold text-ink">
            {hasPassword ? 'Endre passord' : 'Opprett passord'}
          </h3>
          <Stamp tone={hasPassword ? 'brass' : 'neutral'}>{hasPassword ? 'Aktivt' : 'Valgfritt'}</Stamp>
        </div>
        <p className="mt-1 text-sm leading-snug text-ink-soft">
          E-postkode fungerer alltid. Passord er et frivillig alternativ når du ikke vil vente på e-post.
        </p>
      </div>

      {hasPassword ? (
        <form onSubmit={changePassword} className="space-y-4 p-5 sm:p-6">
          <Field label="Nåværende passord">
            <input
              type="password"
              className="field-input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <NewPasswordFields
            password={newPassword}
            confirmPassword={confirmPassword}
            onPassword={setNewPassword}
            onConfirm={setConfirmPassword}
          />
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Endre passord
          </Button>
        </form>
      ) : codeSent ? (
        <form onSubmit={createPassword} className="space-y-4 p-5 sm:p-6">
          <Field label="Engangskode" hint="Seks sifre, gyldig i 5 minutter">
            <input
              className="field-input text-center font-mono !text-xl tracking-[0.3em]"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
            />
          </Field>
          <NewPasswordFields
            password={newPassword}
            confirmPassword={confirmPassword}
            onPassword={setNewPassword}
            onConfirm={setConfirmPassword}
          />
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={otp.length !== 6}>
            Opprett passord
          </Button>
          <button
            type="button"
            onClick={() => void sendSetupCode()}
            className="w-full cursor-pointer text-center text-xs text-brass-strong hover:underline"
          >
            Send ny kode
          </button>
        </form>
      ) : (
        <div className="p-5 sm:p-6">
          <p className="mb-5 text-sm leading-relaxed text-ink-soft">
            Vi sender først en engangskode til <strong className="text-ink">{email}</strong>.
          </p>
          <Button type="button" variant="primary" className="w-full" loading={busy} onClick={() => void sendSetupCode()}>
            Send kode og opprett passord
          </Button>
        </div>
      )}
      </div>
    </section>
  )
}

function NewPasswordFields({
  password,
  confirmPassword,
  onPassword,
  onConfirm,
}: {
  password: string
  confirmPassword: string
  onPassword: (value: string) => void
  onConfirm: (value: string) => void
}) {
  return (
    <>
      <Field label="Nytt passord" hint={`Minst ${PASSWORD_MIN_LENGTH} tegn – bruk gjerne en liten setning`}>
        <input
          type="password"
          className="field-input"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <Field label="Gjenta passordet">
        <input
          type="password"
          className="field-input"
          value={confirmPassword}
          onChange={(e) => onConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
    </>
  )
}
