import { createFileRoute, redirect } from '@tanstack/react-router'
import { parseArchiveSearch } from '../../lib/work-filter'

/**
 * Gammel sti. Arkivet bor under `/noter` fra 30. august 2026. Filteret i
 * søkeparametrene tolkes med samme validator som målruten, slik at en delt
 * lenke til en filtrert visning fortsatt lander riktig.
 */
export const Route = createFileRoute('/arkiv/')({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/noter/arkiv', search: parseArchiveSearch(search), statusCode: 301 })
  },
})
