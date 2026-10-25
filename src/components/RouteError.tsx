import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button, EmptyState } from './ui'

/**
 * Standard feilvisning for ruter uten egen `errorComponent` (router.tsx). Den
 * vanligste feilen i en installert app er at nettet er borte — da skal det stå
 * det, på norsk, med en vei videre, og ikke en engelsk stakk.
 */
export function RouteError({ error }: { error: Error }) {
  const router = useRouter()
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const networkError = offline || /failed to fetch|load failed|networkerror/i.test(error.message)

  return (
    <div className="grid min-h-[60dvh] place-items-center px-4">
      <EmptyState
        title={networkError ? 'Du er uten nett' : 'Noe gikk galt'}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => router.invalidate()}>
              Prøv igjen
            </Button>
            {networkError && (
              <a href="/" className="inline-flex min-h-11 items-center px-3 text-sm text-brass-strong underline underline-offset-4">
                Noter lagret offline
              </a>
            )}
          </div>
        }
      >
        {networkError
          ? 'Siden kunne ikke hentes. Notene du har lagret på enheten, kan du fortsatt åpne.'
          : error.message}
      </EmptyState>
    </div>
  )
}
