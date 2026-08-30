import { createFileRoute, redirect } from '@tanstack/react-router'

/** Gammel sti — se `src/routes/prosjekter/index.tsx`. */
export const Route = createFileRoute('/prosjekter/$projectId')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/noter/prosjekter/$projectId', params, statusCode: 301 })
  },
})
