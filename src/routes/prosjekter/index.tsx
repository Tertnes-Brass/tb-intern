import { createFileRoute, redirect } from '@tanstack/react-router'
import { parseProjectSearch } from '../../server/project-list'

/**
 * Gammel sti. Prosjektene bor under `/noter` fra 30. august 2026, men lenker i
 * e-post og chat lever videre — derfor en permanent redirect som tar med seg
 * filteret fra URL-en.
 */
export const Route = createFileRoute('/prosjekter/')({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/noter/prosjekter', search: parseProjectSearch(search), statusCode: 301 })
  },
})
