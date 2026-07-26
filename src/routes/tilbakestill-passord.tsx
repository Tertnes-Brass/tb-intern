import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast, toastError } from '../components/toast'
import { Button, Field, Kicker } from '../components/ui'
import { authClient } from '../lib/auth-client'
import { PASSWORD_MIN_LENGTH, passwordSchema } from '../lib/profile'

export const Route = createFileRoute('/tilbakestill-passord')({
  validateSearch: (search) => ({
    token: typeof search.token === 'string' ? search.token : '',
    error: typeof search.error === 'string' ? search.error : '',
  }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token, error } = Route.useSearch()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
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
      const { error: resetError } = await authClient.resetPassword({ newPassword: password, token })
      if (resetError) throw new Error(resetError.message ?? 'Lenken er ugyldig eller utløpt')
      toast('Passordet er oppdatert – du kan logge inn nå')
      await router.navigate({ to: '/login' })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const invalid = !token || Boolean(error)

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-14">
      <div className="staff-rule absolute left-1/2 top-10 w-[min(520px,80vw)] -translate-x-1/2 opacity-30" aria-hidden />
      <section className="sheet rise w-full max-w-md px-6 py-7 sm:px-8 sm:py-8">
        <Kicker className="mb-3">Kontogjenoppretting</Kicker>
        <h1 className="display-title text-3xl font-semibold italic text-ink">
          {invalid ? 'Lenken kan ikke brukes' : 'Velg nytt passord'}
        </h1>
        {invalid ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Tilbakestillingslenken er ugyldig eller utløpt. Be om en ny kode fra innloggingssiden.
            </p>
            <Link
              to="/glemt-passord"
              className="mt-6 inline-flex min-h-10 items-center rounded-[9px] bg-brass px-4 text-sm font-medium text-paper-raised hover:bg-brass-strong"
            >
              Be om ny kode
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Nytt passord" hint={`Minst ${PASSWORD_MIN_LENGTH} tegn – bruk gjerne en liten setning`}>
              <input
                type="password"
                className="field-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
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
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              Lagre passord
            </Button>
          </form>
        )}
      </section>
    </main>
  )
}
