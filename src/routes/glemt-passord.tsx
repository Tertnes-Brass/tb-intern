import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast, toastError } from '../components/toast'
import { Button, Field, Kicker } from '../components/ui'
import { authClient } from '../lib/auth-client'
import { PASSWORD_MIN_LENGTH, passwordSchema } from '../lib/profile'

export const Route = createFileRoute('/glemt-passord')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const normalizedEmail = email.trim().toLowerCase()

  const requestCode = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!normalizedEmail) {
      toast('Skriv inn e-postadressen din', 'error')
      return
    }
    setBusy(true)
    try {
      const { error } = await authClient.emailOtp.requestPasswordReset({ email: normalizedEmail })
      if (error) throw new Error(error.message ?? 'Kunne ikke sende kode')
      setSent(true)
      setOtp('')
      toast('Hvis adressen er registrert, kommer det en kode på e-post')
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = passwordSchema.safeParse(password)
    if (!parsed.success) {
      toast(parsed.error.issues[0]?.message ?? 'Ugyldig passord', 'error')
      return
    }
    if (password !== confirmPassword) {
      toast('Passordene er ikke like', 'error')
      return
    }
    setBusy(true)
    try {
      const { error } = await authClient.emailOtp.resetPassword({
        email: normalizedEmail,
        otp: otp.trim(),
        password,
      })
      if (error) throw new Error(error.message ?? 'Koden er ugyldig eller utløpt')
      toast('Passordet er oppdatert – du kan logge inn nå')
      await router.navigate({ to: '/login' })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-14">
      <div className="staff-rule absolute left-1/2 top-10 w-[min(520px,80vw)] -translate-x-1/2 opacity-30" aria-hidden />
      <section className="sheet rise w-full max-w-md px-6 py-7 sm:px-8 sm:py-8">
        <Kicker className="mb-3">Sikker innlogging</Kicker>
        <h1 className="display-title text-3xl font-semibold italic text-ink">
          {sent ? 'Velg nytt passord' : 'Opprett eller nullstill passord'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          {sent
            ? `Skriv inn engangskoden vi sendte til ${normalizedEmail}.`
            : 'Vi sender en engangskode til den registrerte e-postadressen din.'}
        </p>

        {sent ? (
          <form onSubmit={resetPassword} className="mt-6 space-y-4">
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
            <Field label="Nytt passord" hint={`Minst ${PASSWORD_MIN_LENGTH} tegn – bruk gjerne en liten setning`}>
              <input
                type="password"
                className="field-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Gjenta passordet">
              <input
                type="password"
                className="field-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={busy}
              disabled={otp.length !== 6}
            >
              Lagre passord
            </Button>
            <div className="flex items-center justify-between gap-3 text-xs">
              <button type="button" onClick={() => setSent(false)} className="cursor-pointer text-ink-soft hover:text-ink">
                Endre e-post
              </button>
              <button type="button" onClick={() => void requestCode()} className="cursor-pointer text-brass-strong hover:underline">
                Send ny kode
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={requestCode} className="mt-6 space-y-4">
            <Field label="E-post">
              <input
                type="email"
                className="field-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
            </Field>
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              Send engangskode
            </Button>
          </form>
        )}

        <p className="mt-6 border-t border-line pt-4 text-center text-xs">
          <Link to="/login" className="text-ink-soft underline-offset-2 hover:text-brass-strong hover:underline">
            Tilbake til innlogging
          </Link>
        </p>
      </section>
    </main>
  )
}
