import { createFileRoute } from '@tanstack/react-router'
import { RepertoireList } from '../../components/Repertoire'
import { Kicker, Stamp } from '../../components/ui'
import { formatDate, formatWeekday, relativeDays } from '../../lib/format'
import { percussionLines } from '../../lib/percussion'
import type { ProjectWorkDetail } from '../../server/projects'
import { getShareView } from '../../server/shares'

export const Route = createFileRoute('/v/$token')({
  loader: ({ params }) => getShareView({ data: { token: params.token } }),
  component: ShareViewPage,
})

const DEAD_MESSAGES: Record<string, { title: string; body: string }> = {
  invalid: {
    title: 'Lenken finnes ikke',
    body: 'Sjekk at hele lenken ble kopiert — eller be om en ny fra den som delte den.',
  },
  expired: {
    title: 'Lenken er utløpt',
    body: 'Tilgangen var tidsbegrenset og har gått ut. Be om en ny lenke om du fortsatt trenger notene.',
  },
  revoked: {
    title: 'Lenken er trukket tilbake',
    body: 'Den som delte notene har stengt denne tilgangen.',
  },
}

function ShareViewPage() {
  const data = Route.useLoaderData()
  const { token } = Route.useParams()

  if (data.status !== 'ok') {
    const msg = DEAD_MESSAGES[data.status] ?? DEAD_MESSAGES.invalid!
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <div className="staff-rule mb-6 w-40 opacity-50" aria-hidden />
        <h1 className="display-title text-3xl font-semibold italic text-ink">{msg.title}</h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">{msg.body}</p>
        <p className="mt-8 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-ink-faint">
          Tertnes Brass · Notearkiv
        </p>
      </main>
    )
  }

  const p = data.project
  // Vikarvisningen gjenbruker repertoarlisten: stemmefilene mappes til «mine»
  const items: ProjectWorkDetail[] = data.repertoire.map((r) => ({
    workId: r.workId,
    title: r.title,
    composer: r.composer,
    arranger: r.arranger,
    genre: null,
    durationSec: r.durationSec,
    position: r.position,
    note: r.note,
    // Serveren har allerede avgjort om vikaren skal se oppsettet: er ingen av
    // de delte stemmene en slagverksstemme, er feltet null.
    percussionSetup: r.percussionSetup,
    links: r.links,
    partFiles: [],
    myFiles: r.files
      .filter((f) => f.kind === 'part')
      .map((f) => ({ id: f.id, partName: f.partName, fileName: f.fileName, pageCount: f.pageCount })),
    // Vikaren har ingen konto, og stemmedeling mellom medlemmer (#16) finnes
    // ikke i denne løypa. Tokenet gir nøyaktig det snapshottet sa, som før.
    sharedFiles: [],
    scoreFileId: null,
    audioFiles: r.files.filter((f) => f.kind === 'audio').map((f) => ({ id: f.id, label: null, fileName: f.fileName })),
  }))

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
      <header className="rise text-center">
        <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-ink">
          Tertnes Brass
        </p>
        <div className="staff-rule mx-auto mt-4 w-44 opacity-50" aria-hidden />
        <Kicker className="mt-6">
          {p.kind === 'konsert' ? 'Konsert' : p.kind}
          {p.eventDate ? ` · ${relativeDays(p.eventDate)}` : ''}
        </Kicker>
        <h1 className="display-title mt-2 break-words [hyphens:auto] text-[clamp(2.6rem,8vw,4.2rem)] font-semibold italic leading-[1] text-ink">
          {p.name}
        </h1>
        <p className="mt-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-soft">
          {p.eventDate ? `${formatWeekday(p.eventDate)} ${formatDate(p.eventDate)}` : ''}
          {p.venue ? ` · ${p.venue}` : ''}
        </p>

        <div className="mx-auto mt-7 max-w-md rounded-2xl border border-brass/30 bg-[var(--brass-soft)] px-6 py-5">
          <p className="text-[0.95rem] text-ink">
            Hei, <strong className="display-title font-semibold">{data.recipientName}</strong> 👋
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Du er satt opp på{' '}
            <strong className="text-ink">{data.partNames.join(' og ')}</strong> for dette prosjektet.
            Notene dine ligger klare under — riktig stemme på riktig verk.
          </p>
        </div>
        {p.description && (
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink-soft">{p.description}</p>
        )}
        {p.percussionNotes && (
          <div className="mx-auto mt-4 max-w-md rounded-2xl border border-line bg-paper-raised px-5 py-4 text-left">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-brass">Slagverksnotater</p>
            <div className="mt-1.5 space-y-1">
              {percussionLines(p.percussionNotes).map((line, i) => (
                <p key={i} className="text-sm leading-relaxed text-ink-soft">
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="staff-rule mt-10 w-full opacity-40" aria-hidden />

      <RepertoireList items={items} shareToken={token} className="rise mt-2" />

      <footer className="mt-12 text-center">
        <Stamp>
          Lenken er personlig og utløper {new Date(data.expiresAt).toLocaleDateString('nb-NO')}
        </Stamp>
        <p className="mt-6 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink-faint">
          Delt via Tertnes Brass Notearkiv
        </p>
      </footer>
    </main>
  )
}
