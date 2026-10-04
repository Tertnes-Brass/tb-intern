import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Button } from './ui'
import { parseArchiveWorkbook, type ArchiveImport as ImportData } from '../lib/legacy-archive'
import { importLegacyArchive } from '../server/legacy-archive'

export function ArchiveImport({ numbers }: { numbers: (string | null)[] }) {
  const router = useRouter()
  const [preview, setPreview] = useState<ImportData | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const existing = new Set(numbers.filter((n) => n !== null))
  const duplicates = preview?.entries.filter((e) => e.archiveNumber !== null && existing.has(e.archiveNumber)).length ?? 0
  return <section className="sheet space-y-4 p-4 sm:p-5">
    <h2 className="display-title text-xl font-semibold">Importer gammel arkivliste</h2>
    <p className="text-sm text-ink-soft">Velg Excel-filen (.xlsx). Bruk den nyeste listen først hvis du har flere versjoner. Arkivnumrene beholdes. Eksisterende arkivnummer hoppes over, uten at opplysningene overskrives. Filen tolkes i nettleseren; oppføringene lagres på internsiden når du bekrefter.</p>
    <label className="block text-sm">Velg arkivliste<input className="field-input mt-2" type="file" accept=".xlsx" disabled={busy} onChange={async (event) => {
      const file = event.target.files?.[0]
      setPreview(null); setMessage('')
      if (!file) return
      setBusy(true)
      try { setPreview(parseArchiveWorkbook(new Uint8Array(await file.arrayBuffer()), file.name)) }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Kunne ikke lese Excel-filen') }
      finally { setBusy(false); event.target.value = '' }
    }} /></label>
    {preview && <div className="space-y-3">
      <p className="text-sm">{preview.filename}: {preview.entries.length} oppføringer · {preview.entries.filter((e) => e.archiveNumber === null).length} uten arkivnummer · {duplicates} med arkivnummer som finnes fra før.</p>
      <p className="text-sm text-ink-soft">Kontroller et utdrag før import:</p>
      <ul className="space-y-1 text-sm">{preview.entries.slice(0, 8).map((e) => <li key={e.sourceRow}>{e.archiveNumber ?? 'Uten nummer'} · {e.title} · {[e.composer, e.arranger].filter(Boolean).join(' / ')}</li>)}</ul>
      <Button disabled={busy} onClick={async () => {
        setBusy(true); setMessage('')
        try { const result = await importLegacyArchive({ data: preview }); setMessage(`${result.imported} oppføringer importert. ${result.skipped} eksisterende oppføringer hoppet over.`); setPreview(null); await router.invalidate() }
        catch (error) { setMessage(error instanceof Error ? error.message : 'Importen feilet') }
        finally { setBusy(false) }
      }}>{busy ? 'Importerer …' : 'Bekreft import'}</Button>
      <Button disabled={busy} onClick={() => setPreview(null)}>Avbryt</Button>
    </div>}
    {message && <p role="status" className="text-sm whitespace-pre-wrap">{message}</p>}
  </section>
}
