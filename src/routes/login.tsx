import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast, toastError } from '../components/toast'
import { Button, Field, Kicker } from '../components/ui'
import { authClient } from '../lib/auth-client'

type LoginMode = 'code' | 'password' | 'link'

export const Route = createFileRoute('/login')({
  beforeLoad: ({ context }) => {
    if (context.me) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [mode, setMode] = useState<LoginMode>('code')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const normalizedEmail = email.trim().toLowerCase()

  const completeLogin = async () => {
    await router.invalidate()
    await router.navigate({ to: '/' })
  }

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!normalizedEmail) {
      toast('Skriv inn e-postadressen din', 'error')
      return
    }
    setBusy(true)
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email: normalizedEmail,
        type: 'sign-in',
      })
      if (error) throw new Error(error.message ?? 'Kunne ikke sende kode')
      setCodeSent(true)
      setOtp('')
      toast('Innloggingskode sendt')
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const { error } = await authClient.signIn.emailOtp({ email: normalizedEmail, otp: otp.trim() })
      if (error) throw new Error(error.message ?? 'Koden er ugyldig eller utløpt')
      await completeLogin()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const signInWithPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const { error } = await authClient.signIn.email({ email: normalizedEmail, password })
      if (error) throw new Error(error.message ?? 'Feil e-post eller passord')
      await completeLogin()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!normalizedEmail) {
      toast('Skriv inn e-postadressen din', 'error')
      return
    }
    setBusy(true)
    try {
      const { error } = await authClient.signIn.magicLink({ email: normalizedEmail, callbackURL: '/' })
      if (error) throw new Error(error.message ?? 'Kunne ikke sende lenke')
      toast('Innloggingslenke sendt – sjekk e-posten din')
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const chooseMode = (next: LoginMode) => {
    setMode(next)
    setCodeSent(false)
    setOtp('')
    setPassword('')
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-12 sm:py-14">
      <div className="staff-rule absolute left-1/2 top-10 w-[min(520px,80vw)] -translate-x-1/2 opacity-30" aria-hidden />
      <div className="staff-rule absolute bottom-10 left-1/2 w-[min(520px,80vw)] -translate-x-1/2 opacity-30" aria-hidden />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[640px] -translate-x-1/2 rounded-full opacity-50"
        style={{ background: 'radial-gradient(closest-side, var(--brass-soft), transparent)' }}
      />

      <header className="rise relative mb-8 text-center">
        <Kicker className="mb-4">Tertnes Brass · siden 1969</Kicker>
        <h1 className="display-title text-[clamp(3rem,9vw,5.5rem)] font-semibold italic leading-[0.95] text-ink">
          Notearkivet
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[0.95rem] leading-relaxed text-ink-soft">
          Finn notene dine, kommende konserter og lytteeksempler.
        </p>
      </header>

      <section className="sheet rise relative w-full max-w-md px-6 py-7 sm:px-7 sm:py-8" style={{ animationDelay: '120ms' }}>
        <div className="mb-6 grid grid-cols-3 gap-1 rounded-xl border border-line bg-paper-sunken p-1">
          {(
            [
              ['code', 'E-postkode'],
              ['password', 'Passord'],
              ['link', 'Lenke'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => chooseMode(value)}
              className={`min-h-10 cursor-pointer rounded-lg px-2 font-mono text-[0.62rem] uppercase tracking-[0.08em] transition-all ${
                mode === value
                  ? 'bg-paper-raised font-medium text-ink shadow-sm'
                  : 'text-ink-faint hover:text-ink-soft'
              }`}
              aria-pressed={mode === value}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'code' && codeSent ? (
          <form onSubmit={verifyCode} className="space-y-5">
            <div>
              <Kicker className="mb-2">Steg 2 av 2</Kicker>
              <h2 className="display-title text-2xl font-semibold text-ink">Skriv inn koden</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                Vi sendte en sekssifret kode til <strong className="text-ink">{normalizedEmail}</strong>.
              </p>
            </div>
            <Field label="Engangskode" hint="Gyldig i 5 minutter og kan brukes én gang">
              <input
                className="field-input !py-3 text-center font-mono !text-2xl tracking-[0.35em]"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
              />
            </Field>
            <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={otp.length !== 6}>
              Logg inn
            </Button>
            <div className="flex items-center justify-between gap-3 text-xs">
              <button
                type="button"
                onClick={() => setCodeSent(false)}
                className="cursor-pointer text-ink-soft hover:text-ink"
              >
                Endre e-post
              </button>
              <button
                type="button"
                onClick={() => void sendCode()}
                className="cursor-pointer text-brass-strong hover:underline"
              >
                Send ny kode
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={mode === 'code' ? sendCode : mode === 'password' ? signInWithPassword : sendMagicLink}
            className="space-y-4"
          >
            <div className="mb-5">
              <Kicker className="mb-2">
                {mode === 'code' ? 'Anbefalt' : mode === 'password' ? 'Alternativ' : 'På denne enheten'}
              </Kicker>
              <h2 className="display-title text-2xl font-semibold text-ink">
                {mode === 'code' ? 'Logg inn med kode' : mode === 'password' ? 'Logg inn med passord' : 'Send innloggingslenke'}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {mode === 'code'
                  ? 'Du trenger ikke huske noe passord.'
                  : mode === 'password'
                    ? 'Bruk passordet du har opprettet på profilen din.'
                    : 'Åpne lenken i den samme nettleseren som du bruker nå.'}
              </p>
            </div>
            <Field label="E-post">
              <input
                type="email"
                className="field-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="deg@example.com"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                autoFocus
              />
            </Field>
            {mode === 'password' && (
              <Field label="Passord">
                <input
                  type="password"
                  className="field-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
            )}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              {mode === 'code' ? 'Send kode' : mode === 'password' ? 'Logg inn' : 'Send lenke'}
            </Button>
            {mode === 'password' && (
              <p className="text-center">
                <Link
                  to="/glemt-passord"
                  className="text-xs text-ink-soft underline-offset-2 hover:text-brass-strong hover:underline"
                >
                  Glemt eller ikke opprettet passord?
                </Link>
              </p>
            )}
          </form>
        )}
      </section>

      <p
        className="rise relative mt-9 max-w-sm text-center font-mono text-[0.62rem] uppercase leading-relaxed tracking-[0.16em] text-ink-faint"
        style={{ animationDelay: '300ms' }}
      >
        Kun for inviterte medlemmer
      </p>
    </main>
  )
}
