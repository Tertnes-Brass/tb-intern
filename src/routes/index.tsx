import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Midlertidig forside. `/` skal bli hub-flaten for internsiden (kunngjøringer,
 * kalender, snarveier til områdene) — inntil den finnes, sendes innloggede rett
 * til noteområdet, som er det eneste området med et «hjem» i dag.
 * Erstattes av hub-forsiden i et senere arbeid.
 */
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    throw redirect({ to: '/noter' })
  },
})
