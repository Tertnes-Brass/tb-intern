import { describe, expect, it } from 'vitest'
import {
  MAX_UPLOAD_BYTES,
  createPdfPageCounter,
  uploadExtension,
  uploadRejectionReason,
} from './upload'

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

/** Teller sidene i ett jafs, som referanse for den strømmende varianten. */
function countWhole(pdf: string): number | null {
  const counter = createPdfPageCounter()
  counter.push(latin1(pdf))
  return counter.result()
}

/** Samme PDF, men matet inn i biter på `size` byte. */
function countChunked(pdf: string, size: number): number | null {
  const counter = createPdfPageCounter()
  const bytes = latin1(pdf)
  for (let i = 0; i < bytes.length; i += size) counter.push(bytes.subarray(i, i + size))
  return counter.result()
}

// «[^s]» i mønsteret skiller /Page fra /Pages, så hvert objekt trenger et tegn etter seg.
const page = '<< /Type /Page /Parent 1 0 R >>\n'
const pdf = `%PDF-1.7\n<< /Type /Pages /Count 3 >>\n${page.repeat(3)}%%EOF\n`

describe('sidetelling i PDF', () => {
  it('teller sideobjekter og hopper over /Pages-treet', () => {
    expect(countWhole(pdf)).toBe(3)
  })

  it('gir null når ingen sider gjenkjennes', () => {
    expect(countWhole('%PDF-1.7\nikke en ekte pdf\n')).toBeNull()
    expect(countWhole('')).toBeNull()
  })

  it('gir samme svar uansett hvor bitgrensene faller', () => {
    // Små biter tvinger treff til å bli delt på tvers av grensene, som er der
    // overlappet enten kan miste eller dobbelttelle et objekt.
    for (let size = 1; size <= pdf.length + 1; size++) {
      expect(countChunked(pdf, size)).toBe(3)
    }
  })

  it('dobbelttelller ikke objekter som ligger inne i overlappet', () => {
    // Halen som gjentas er 64 tegn, så et objekt tett på grensen ville blitt
    // sett to ganger uten filteret på hvor treffet slutter.
    const dense = `${page.repeat(2)}${' '.repeat(200)}${page}`
    expect(countChunked(dense, 40)).toBe(countWhole(dense))
    expect(countWhole(dense)).toBe(3)
  })
})

describe('avvisning av filer', () => {
  it('slipper gjennom PDF og lyd', () => {
    expect(uploadRejectionReason({ name: 'Coventry – Score.pdf', size: 69 * 1024 * 1024 })).toBeNull()
    expect(uploadRejectionReason({ name: 'opptak.mp3', size: 4_000 })).toBeNull()
  })

  it('begrunner hvorfor en fil ikke går gjennom', () => {
    expect(uploadRejectionReason({ name: 'noter.docx', size: 4_000 })).toMatch(/PDF- eller lydfil/)
    expect(uploadRejectionReason({ name: 'tom.pdf', size: 0 })).toMatch(/tom/)
    expect(uploadRejectionReason({ name: 'diger.pdf', size: MAX_UPLOAD_BYTES + 1 })).toMatch(/over grensen/)
  })
})

describe('filendelse for R2-nøkkel', () => {
  it('normaliserer kjente typer', () => {
    expect(uploadExtension('Score.PDF')).toBe('pdf')
    expect(uploadExtension('opptak.M4A')).toBe('m4a')
  })

  it('faller tilbake når endelsen er rar', () => {
    expect(uploadExtension('uten-endelse')).toBe('bin')
    expect(uploadExtension('rar.navn med mellomrom')).toBe('bin')
  })
})
