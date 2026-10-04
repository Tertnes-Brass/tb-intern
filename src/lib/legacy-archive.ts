import { unzipSync, strFromU8 } from 'fflate'
import { z } from 'zod'

const optionalText = z.string().max(10000).nullable()
export const archiveImportSchema = z.object({
  filename: z.string().min(1).max(255),
  entries: z.array(z.object({
    sourceRow: z.number().int().positive(), archiveNumber: z.string().min(1).max(100).nullable(),
    title: z.string().min(1).max(10000), composer: optionalText, arranger: optionalText,
    missingParts: optionalText, lastChecked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    categoryCode: optionalText, notes: optionalText, loanedTo: optionalText, markedDigitized: z.boolean(),
  })).min(1).max(5000),
})
export type ArchiveImport = z.infer<typeof archiveImportSchema>

// Run locally in the browser. No workbook or extracted values go to a third party.
export function parseArchiveWorkbook(bytes: Uint8Array, filename: string): ArchiveImport {
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Filen er for stor (maks 10 MB)')
  let total = 0
  const files = unzipSync(bytes, { filter: (f) => {
    const keep = /^xl\/(sharedStrings\.xml|workbook\.xml|worksheets\/sheet\d+\.xml)$/.test(f.name)
    if (keep) { total += f.originalSize; if (total > 32 * 1024 * 1024) throw new Error('Regnearket er for stort') }
    return keep
  } })
  const xml = (name: string) => {
    if (!files[name]) throw new Error('Filen er ikke et støttet Excel-regneark (.xlsx)')
    const doc = new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml')
    if (doc.querySelector('parsererror')) throw new Error('Ugyldig XML i regnearket')
    return doc
  }
  const strings = files['xl/sharedStrings.xml'] ? Array.from(xml('xl/sharedStrings.xml').getElementsByTagName('si'), (s) => Array.from(s.getElementsByTagName('t'), (t) => t.textContent ?? '').join('')) : []
  const date1904 = xml('xl/workbook.xml').getElementsByTagName('workbookPr')[0]?.getAttribute('date1904')
  const entries: ArchiveImport['entries'] = []
  let found = false
  for (const name of Object.keys(files).filter((n) => n.startsWith('xl/worksheets/'))) {
    const rows = Array.from(xml(name).getElementsByTagName('row'))
    const cells = (row: Element) => new Map(Array.from(row.getElementsByTagName('c'), (c) => {
      const col = c.getAttribute('r')?.replace(/\d/g, '') ?? ''
      const raw = c.getElementsByTagName('v')[0]?.textContent ?? ''
      const type = c.getAttribute('t')
      let value = type === 's' ? strings[Number(raw)] ?? '' : type === 'inlineStr' ? Array.from(c.getElementsByTagName('t'), (t) => t.textContent ?? '').join('') : raw
      if (!type || type === 'n') { if (value && Number.isFinite(Number(value))) value = String(Number(value)) }
      return [col, value] as const
    }))
    const headerIndex = rows.findIndex((r) => { const v = [...cells(r).values()]; return v.includes('MusicID') && v.includes('Title') })
    if (headerIndex < 0) continue
    if (found) throw new Error('Flere arkivlister i samme fil. Last opp én liste om gangen.')
    found = true
    const headers = new Map([...cells(rows[headerIndex])].map(([col, h]) => [h, col]))
    for (const row of rows.slice(headerIndex + 1)) {
      const values = cells(row)
      const read = (h: string) => values.get(headers.get(h) ?? '')?.trim() || null
      if (![...values.values()].some((v) => v.trim())) continue
      const title = read('Title')
      if (!title) throw new Error(`Tittel mangler på rad ${row.getAttribute('r')}`)
      const checked = read('Last_check')
      let lastChecked: string | null = null
      if (checked) {
        if (!Number.isFinite(Number(checked))) throw new Error(`Ukjent datoformat på rad ${row.getAttribute('r')}`)
        const base = date1904 === '1' || date1904 === 'true' ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
        lastChecked = new Date(base + Math.floor(Number(checked)) * 86400000).toISOString().slice(0, 10)
      }
      entries.push({ sourceRow: Number(row.getAttribute('r')), archiveNumber: read('MusicID'), title,
        composer: read('Composer'), arranger: read('Arranger'), missingParts: read('What_missing'),
        lastChecked, categoryCode: read('CategoryID'), notes: read('Notes'), loanedTo: read('Who_loan'),
        markedDigitized: !!read('Digitalisert'),
      })
    }
  }
  if (!found) throw new Error('Fant ikke kolonnene MusicID og Title i regnearket')
  const numbers = entries.flatMap((e) => e.archiveNumber === null ? [] : [e.archiveNumber])
  if (new Set(numbers).size !== numbers.length) throw new Error('Filen inneholder duplikate arkivnummer. Kontroller listen før import.')
  return archiveImportSchema.parse({ filename, entries })
}
