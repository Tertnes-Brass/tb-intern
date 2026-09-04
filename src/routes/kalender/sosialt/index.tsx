import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/kalender/sosialt` er ikke en egen oversikt. De sosiale arrangementene bor i
 * kalenderlista sammen med feed-hendelsene (docs/designprinsipper.md §4: ingen
 * miniatyroversikt ved siden av den ekte lista), så navnerommet inneholder bare
 * detaljruta og skjemaene.
 *
 * Ruta finnes likevel, av én grunn: uten den ville `/kalender/sosialt` blitt
 * fanget av `/kalender/$eventId` og endt som en «fant ingen hendelse»-side for
 * en nøkkel som aldri var en hendelse. En redirect er et ærligere svar.
 */
export const Route = createFileRoute('/kalender/sosialt/')({
  beforeLoad: () => {
    throw redirect({ to: '/kalender' })
  },
})
