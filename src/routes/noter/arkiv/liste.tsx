import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Button, EmptyState, Field, Kicker, Stamp } from '../../../components/ui'
import { ArchiveImport } from '../../../components/ArchiveImport'
import { formatDate } from '../../../lib/format'
import { listLegacyArchive } from '../../../server/legacy-archive'

export const Route = createFileRoute('/noter/arkiv/liste')({
  beforeLoad: ({ context }) => {
    if (!context.me) throw redirect({ to: '/login' })
    if (!context.me.permissions.some((p) => ['*', 'archive.viewAll', 'works.manage'].includes(p))) throw redirect({ to: '/noter' })
  },
  loader: () => listLegacyArchive(),
  component: ArchiveListPage,
})

function ArchiveListPage() {
  const { entries } = Route.useLoaderData()
  const { me } = Route.useRouteContext()
  const canManage = me.permissions.some((p) => p === '*' || p === 'works.manage')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const q = query.trim().toLocaleLowerCase('nb-NO')
  const matches = entries.filter((e) => {
    const textMatches = [e.title, e.archiveNumber, e.composer, e.arranger, e.notes, e.missingParts, e.loanedTo].some((v) => v?.toLocaleLowerCase('nb-NO').includes(q))
    return textMatches && (filter === 'all' || (filter === 'no-number' && e.archiveNumber === null) || (filter === 'digitized' && e.markedDigitized) || (filter === 'missing' && !!e.missingParts) || (filter === 'loaned' && !!e.loanedTo))
  })
  const pages = Math.max(1, Math.ceil(matches.length / 50))
  const currentPage = Math.min(page, pages - 1)
  const shown = matches.slice(currentPage * 50, (currentPage + 1) * 50)
  return (
    <div className="space-y-6">
      <header>
        <Link to="/noter/arkiv" className="link-quiet text-sm text-ink-soft">← Arkivet</Link>
        <Kicker className="mb-2 mt-5">Det fysiske notearkivet</Kicker>
        <h1 className="display-title text-4xl font-semibold italic sm:text-5xl">Arkivliste</h1>
        <p className="mt-3 max-w-3xl text-sm text-ink-soft">{entries.length} oppføringer fra den gamle arkivlisten. Arkivnumrene er bevart, og oppføringer uten nummer er fortsatt uten nummer. Listen endrer ikke verkene eller notefilene i det digitale arkivet.</p>
      </header>
      {canManage && <ArchiveImport numbers={entries.map((e) => e.archiveNumber)} />}
      <div className="sheet space-y-3 p-4 sm:p-5">
        <p className="text-sm text-ink-soft">Dette er historiske registreringer, ikke en ny kontroll av hva som står i skapet. «Digitalisert i gammel liste» betyr ikke at filene er lastet opp her.</p>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label="Søk i arkivlisten"><input type="search" className="field-input" placeholder="Tittel, arkivnummer, komponist eller merknad …" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} /></Field>
          <Field label="Vis"><select className="field-input" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0) }}>
            <option value="all">Alle oppføringer</option>
            <option value="no-number">Uten arkivnummer</option>
            <option value="digitized">Merket digitalisert</option>
            <option value="missing">Registrerte mangler</option>
            <option value="loaned">Registrerte utlån</option>
          </select></Field>
        </div>
        <p className="text-xs text-ink-faint" role="status">{matches.length} av {entries.length} oppføringer · side {currentPage + 1} av {pages}</p>
      </div>
      {shown.length === 0 ? <div className="sheet"><EmptyState title="Ingen treff">Prøv et annet søk eller filter.</EmptyState></div> : <ul className="sheet divide-y divide-line">
        {shown.map((e) => <li key={e.id} className="space-y-2 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h2 className="display-title text-xl font-semibold">{e.title}</h2><p className="text-sm text-ink-soft">{[e.composer, e.arranger ? `arr. ${e.arranger}` : null].filter(Boolean).join(' · ') || 'Komponist og arrangør ikke registrert'}</p></div>
            <Stamp tone={e.archiveNumber ? 'brass' : 'neutral'}>{e.archiveNumber ? `Arkivnr. ${e.archiveNumber}` : 'Uten arkivnummer'}</Stamp>
          </div>
          <div className="flex flex-wrap gap-2">{e.markedDigitized && <Stamp>Digitalisert i gammel liste</Stamp>}{e.categoryCode && <Stamp>Kategorikode {e.categoryCode}</Stamp>}</div>
          {e.notes && <p className="whitespace-pre-wrap text-sm">{e.notes}</p>}
          {e.missingParts && <p className="text-sm text-oxblood"><span className="font-semibold">Registrerte mangler: </span>{e.missingParts}</p>}
          {e.loanedTo && <p className="text-sm text-ink-soft"><span className="font-semibold">Registrert utlån: </span>{e.loanedTo}</p>}
          {e.lastChecked && <p className="text-xs text-ink-faint">Sist kontrollert i gammel liste: {formatDate(e.lastChecked)}</p>}
        </li>)}
      </ul>}
      {pages > 1 && <div className="flex items-center justify-between gap-3">
        <Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Forrige</Button>
        <span className="text-sm text-ink-soft">Side {currentPage + 1} av {pages}</span>
        <Button disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Neste</Button>
      </div>}
    </div>
  )
}
