import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast, toastError } from '../components/toast'
import { Button, Field, Kicker, Stamp } from '../components/ui'
import { authClient } from '../lib/auth-client'
import {
  PASSWORD_MIN_LENGTH,
  memberNameSchema,
  passwordSchema,
  phoneSchema,
} from '../lib/profile'
import type { PostNotificationChoice } from '../lib/posts'
import { getMyProfile, updateMyPhone, updateMyPostNotifications } from '../server/profile'

export const Route = createFileRoute('/min-profil')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
  },
  loader: () => getMyProfile(),
  component: MyProfilePage,
})

function MyProfilePage() {
  const profile = Route.useLoaderData()
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
    <div className="space-y-9">
      <header className="rise">
        <Kicker className="mb-2">Din konto</Kicker>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Min profil</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
              Hold kontaktinformasjonen oppdatert og velg hvordan du vil logge inn.
            </p>
          </div>
          <Stamp tone="brass">{profile.roleName}</Stamp>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section className="sheet rise p-5 sm:p-7" style={{ animationDelay: '70ms' }}>
          <div className="mb-6 border-b border-line pb-4">
            <Kicker className="mb-2">Personopplysninger</Kicker>
            <h2 className="display-title text-2xl font-semibold text-ink">Slik kjenner korpset deg</h2>
          </div>
          <form onSubmit={saveProfile} className="space-y-5">
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
            <div className="flex justify-end border-t border-line pt-5">
              <Button type="submit" variant="primary" loading={savingProfile}>
                Lagre profil
              </Button>
            </div>
          </form>
        </section>

        <div className="space-y-6">
          <NotificationsCard current={profile.notifyPosts} />
          <PasswordCard hasPassword={profile.hasPassword} email={profile.email} />
        </div>
      </div>
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
    <section className="sheet rise overflow-hidden" style={{ animationDelay: '100ms' }}>
      <div className="border-b border-line bg-paper-sunken/50 px-5 py-5 sm:px-6">
        <Kicker className="mb-2">Varsler</Kicker>
        <h2 className="display-title text-2xl font-semibold text-ink">E-post om beskjeder</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Beskjeder fra styret ligger alltid på internsiden. Her velger du hvor mye av det du vil ha på e-post.
        </p>
      </div>
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap gap-2">
          {NOTIFY_CHOICES.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={choice === option.value ? 'primary' : 'secondary'}
              size="sm"
              disabled={busy}
              onClick={() => void save(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          «Bare viktige» betyr de beskjedene styret selv har merket som viktige. «Av» slår av all e-post om beskjeder —
          du finner dem fortsatt under Beskjeder.
        </p>
      </div>
    </section>
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
    <section className="sheet rise overflow-hidden" style={{ animationDelay: '130ms' }}>
      <div className="border-b border-line bg-paper-sunken/50 px-5 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Kicker className="mb-2">Innlogging</Kicker>
            <h2 className="display-title text-2xl font-semibold text-ink">
              {hasPassword ? 'Endre passord' : 'Opprett passord'}
            </h2>
          </div>
          <Stamp tone={hasPassword ? 'brass' : 'neutral'}>{hasPassword ? 'Aktivt' : 'Valgfritt'}</Stamp>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
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
