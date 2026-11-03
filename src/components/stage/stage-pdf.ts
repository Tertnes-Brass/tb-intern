/**
 * PDF-en som sendes til arrangøren: tegningen på et liggende A4-ark, med
 * prosjekt, dato og sted øverst, og kontaktperson, utstyrsliste, slagverket i
 * riggerekkefølge og merknadene i en spalte til høyre. Bygges i nettleseren med pdf-lib, som lastes først når noen
 * trykker på knappen.
 *
 * Standardfonten (Helvetica) har bare WinAnsi-tegnsettet — æøå er med, men
 * ikke emoji og pilene i Unicode. `winAnsi` bytter ut det som mangler, så en
 * merknad med et hjerte ikke stopper hele utskriften.
 */
import type { PDFFont, PDFPage } from 'pdf-lib'
import type { EquipmentLine } from '../../lib/stage-components'

export type StagePdfInput = {
  png: Blob
  title: string
  projectName: string
  /** «Konsert · fredag 12. desember 2026 · Grieghallen» */
  subtitle: string
  stageSize: string | null
  equipment: EquipmentLine[]
  /** Slagverket fra venstre mot høyre, sett fra slagverket mot salen (`percussionRigOrder`). */
  percussion: string[]
  contact: { name: string; email: string; phone: string } | null
  notes: string | null
  /** «2. november 2026» */
  printedOn: string
}

const A4_LANDSCAPE: [number, number] = [841.89, 595.28]
const MARGIN = 36
const COLUMN = 196
const GAP = 22

// Tegn i WinAnsi utenfor Latin-1 (0x80–0x9F i cp1252).
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'

export function winAnsi(text: string): string {
  let out = ''
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!
    if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRA.includes(ch)) {
      out += ch
    } else if (ch === '\t') out += ' '
    else if (ch === '″') out += '"'
    else if (ch === '→') out += '->'
    // Bokstaver og tall vi ikke kan vise blir «?», så det synes at noe mangler;
    // symboler og emoji faller bare bort.
    else if (/[\p{L}\p{N}]/u.test(ch)) out += '?'
  }
  return out
}

/** Bryter tekst i linjer som får plass i `width`. Lange ord deles. */
export function wrapText(text: string, font: Pick<PDFFont, 'widthOfTextAtSize'>, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let current = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate
        continue
      }
      if (current) lines.push(current)
      current = word
      while (font.widthOfTextAtSize(current, size) > width && current.length > 1) {
        let cut = current.length - 1
        while (cut > 1 && font.widthOfTextAtSize(current.slice(0, cut), size) > width) cut--
        lines.push(current.slice(0, cut))
        current = current.slice(cut)
      }
    }
    lines.push(current)
  }
  return lines
}

export async function buildStagePdf(input: StagePdfInput): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(winAnsi(`${input.projectName} – ${input.title}`))
  doc.setAuthor('Tertnes Brass')
  doc.setCreator('Tertnes Brass Intern')
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const image = await doc.embedPng(await input.png.arrayBuffer())

  const ink = rgb(0.12, 0.12, 0.12)
  const soft = rgb(0.38, 0.38, 0.38)
  const faint = rgb(0.6, 0.6, 0.6)
  const rule = rgb(0.82, 0.82, 0.82)
  const [pageW, pageH] = A4_LANDSCAPE

  const pages: PDFPage[] = []
  const addPage = () => {
    const page = doc.addPage(A4_LANDSCAPE)
    pages.push(page)
    return page
  }

  // ---------- Topp ----------
  const page = addPage()
  let y = pageH - MARGIN
  page.drawText('TERTNES BRASS  ·  SCENEOPPSETT', { x: MARGIN, y: y - 8, size: 8, font: bold, color: faint })
  y -= 32
  const titleSize = 20
  const titleLines = wrapText(winAnsi(input.title), bold, titleSize, pageW - MARGIN * 2 - 160)
  page.drawText(titleLines[0] ?? '', { x: MARGIN, y, size: titleSize, font: bold, color: ink })
  if (input.stageSize) {
    const label = winAnsi(`Scene ${input.stageSize}`)
    const w = regular.widthOfTextAtSize(label, 10)
    page.drawText(label, { x: pageW - MARGIN - w, y: y + 4, size: 10, font: regular, color: soft })
  }
  y -= 18
  page.drawText(winAnsi(input.projectName), { x: MARGIN, y, size: 11, font: bold, color: soft })
  y -= 14
  if (input.subtitle) {
    for (const line of wrapText(winAnsi(input.subtitle), regular, 10, pageW - MARGIN * 2)) {
      page.drawText(line, { x: MARGIN, y, size: 10, font: regular, color: soft })
      y -= 13
    }
  }
  y -= 4
  page.drawLine({ start: { x: MARGIN, y }, end: { x: pageW - MARGIN, y }, thickness: 0.6, color: rule })
  const bodyTop = y - 12
  const bodyBottom = MARGIN + 18

  // ---------- Spalten: utstyr og merknader ----------
  type Row = { kind: 'heading' | 'item' | 'text' | 'hint' | 'space'; text: string; count?: number }
  const rows: Row[] = []
  const section = (heading: string) => {
    if (rows.length) rows.push({ kind: 'space', text: '' })
    rows.push({ kind: 'heading', text: heading })
  }
  const paragraph = (text: string, kind: 'text' | 'hint' = 'text') => {
    for (const line of wrapText(winAnsi(text), regular, kind === 'hint' ? 8.5 : 9.5, COLUMN)) rows.push({ kind, text: line })
  }
  const contact = input.contact ? [input.contact.name, input.contact.email, input.contact.phone].map((v) => v.trim()).filter(Boolean) : []
  if (contact.length > 0) {
    section('KONTAKTPERSON')
    for (const line of contact) paragraph(line)
  }
  if (input.equipment.length > 0) {
    section('UTSTYR')
    for (const item of input.equipment) rows.push({ kind: 'item', text: winAnsi(item.label), count: item.count })
  }
  if (input.percussion.length > 0) {
    section('SLAGVERK FRA VENSTRE')
    paragraph('Sett fra slagverket, mot salen', 'hint')
    paragraph(input.percussion.join(', '))
  }
  if (input.notes) {
    section('MERKNADER')
    paragraph(input.notes)
  }
  const hasColumn = rows.length > 0
  const drawingRight = hasColumn ? pageW - MARGIN - COLUMN - GAP : pageW - MARGIN

  // ---------- Tegningen ----------
  const areaW = drawingRight - MARGIN
  const areaH = bodyTop - bodyBottom
  const scale = Math.min(areaW / image.width, areaH / image.height)
  const w = image.width * scale
  const h = image.height * scale
  page.drawImage(image, { x: MARGIN + (areaW - w) / 2, y: bodyBottom + (areaH - h) / 2, width: w, height: h })

  if (hasColumn) {
    let colX = pageW - MARGIN - COLUMN
    let colW = COLUMN
    let current = page
    let cy = bodyTop - 4
    current.drawLine({
      start: { x: colX - GAP / 2, y: bodyTop },
      end: { x: colX - GAP / 2, y: bodyBottom },
      thickness: 0.6,
      color: rule,
    })
    for (const row of rows) {
      const height = row.kind === 'heading' ? 16 : row.kind === 'space' ? 10 : row.kind === 'item' ? 15 : row.kind === 'hint' ? 12 : 13
      if (cy - height < bodyBottom) {
        // Fortsetter på et nytt ark, nå i full bredde.
        current = addPage()
        colX = MARGIN
        colW = pageW - MARGIN * 2
        cy = pageH - MARGIN - 4
      }
      cy -= height
      if (row.kind === 'heading') {
        current.drawText(row.text, { x: colX, y: cy + 3, size: 8, font: bold, color: faint })
      } else if (row.kind === 'item') {
        current.drawText(row.text, { x: colX, y: cy, size: 10, font: regular, color: ink })
        const count = String(row.count ?? '')
        const cw = bold.widthOfTextAtSize(count, 10)
        current.drawText(count, { x: colX + colW - cw, y: cy, size: 10, font: bold, color: ink })
        current.drawLine({
          start: { x: colX, y: cy - 4.5 },
          end: { x: colX + colW, y: cy - 4.5 },
          thickness: 0.3,
          color: rule,
        })
      } else if (row.kind === 'text') {
        current.drawText(row.text, { x: colX, y: cy, size: 9.5, font: regular, color: ink })
      } else if (row.kind === 'hint') {
        current.drawText(row.text, { x: colX, y: cy, size: 8.5, font: regular, color: soft })
      }
    }
  }

  // ---------- Bunntekst ----------
  pages.forEach((p, i) => {
    const left = winAnsi(`Tertnes Brass · ${input.printedOn}`)
    p.drawText(left, { x: MARGIN, y: MARGIN - 6, size: 8, font: regular, color: faint })
    if (pages.length > 1) {
      const right = `Side ${i + 1} av ${pages.length}`
      const rw = regular.widthOfTextAtSize(right, 8)
      p.drawText(right, { x: pageW - MARGIN - rw, y: MARGIN - 6, size: 8, font: regular, color: faint })
    }
  })

  const bytes = await doc.save()
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}
