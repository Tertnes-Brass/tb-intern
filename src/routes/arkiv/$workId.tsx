import { createFileRoute, redirect } from '@tanstack/react-router'

/** Gammel sti — se `src/routes/arkiv/index.tsx`. */
export const Route = createFileRoute('/arkiv/$workId')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/noter/arkiv/$workId', params, statusCode: 301 })
  },
})
