import { describe, expect, it } from 'vitest'
import { winAnsi, wrapText } from './stage-pdf'

// Fast bredde per tegn er nok til å teste brytingen.
const mono = { widthOfTextAtSize: (text: string, size: number) => text.length * size * 0.5 }

describe('winAnsi', () => {
  it('beholder norsk tekst og typografiske tegn som finnes i WinAnsi', () => {
    expect(winAnsi('Rørklokker – «æøå» … €')).toBe('Rørklokker – «æøå» … €')
  })

  it('dropper emoji og symboler, og markerer bokstaver som mangler', () => {
    expect(winAnsi('Pauker ♥ 🎺')).toBe('Pauker  ')
    expect(winAnsi('Ωmega')).toBe('?mega')
    expect(winAnsi('32″ → scene')).toBe('32" -> scene')
  })
})

describe('wrapText', () => {
  it('bryter på ord og beholder linjeskift', () => {
    expect(wrapText('en to tre fire\nfem', mono, 10, 40)).toEqual(['en to', 'tre fire', 'fem'])
  })

  it('deler ord som er lengre enn linjen', () => {
    expect(wrapText('Slagverksbord', mono, 10, 30)).toEqual(['Slagve', 'rksbor', 'd'])
  })

  it('beholder tomme linjer', () => {
    expect(wrapText('a\n\nb', mono, 10, 100)).toEqual(['a', '', 'b'])
  })
})
