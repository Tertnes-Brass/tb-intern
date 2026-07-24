import { describe, expect, it } from 'vitest'
import { BRASS_BAND_PARTS, SECTION_LABELS, SECTION_ORDER, guessPartFromFilename } from './taxonomy'

const guess = (name: string) => guessPartFromFilename(name, BRASS_BAND_PARTS)

describe('brass band-seksjoner', () => {
  it('har eksakte etiketter og rekkefølge', () => {
    expect(SECTION_ORDER.map((id) => SECTION_LABELS[id])).toEqual([
      'Dirigent',
      'Kornetter',
      'Horn/Flugel',
      'Euph/Bari',
      'Trombone',
      'Tuba',
      'Slagverk',
    ])
  })

  it('plasserer standardstemmene i riktig seksjon', () => {
    const sectionByPart = new Map(BRASS_BAND_PARTS.map((part) => [part.id, part.section]))
    expect(sectionByPart.get('score')).toBe('score')
    expect(sectionByPart.get('flugel')).toBe('horn')
    expect(sectionByPart.get('first-baritone')).toBe('euph-bari')
    expect(sectionByPart.get('second-baritone')).toBe('euph-bari')
    expect(sectionByPart.get('euphonium')).toBe('euph-bari')
    expect(sectionByPart.get('first-trombone')).toBe('trombone')
    expect(sectionByPart.get('bass-trombone')).toBe('trombone')
    expect(sectionByPart.get('eb-bass')).toBe('tuba')
    expect(sectionByPart.get('bb-bass')).toBe('tuba')
  })

  it('sorterer Partitur først og standardstemmene seksjonsvis', () => {
    const sectionPositions = BRASS_BAND_PARTS.map((part) => SECTION_ORDER.indexOf(part.section))
    expect(BRASS_BAND_PARTS[0]?.id).toBe('score')
    expect(sectionPositions).toEqual([...sectionPositions].sort((a, b) => a - b))
  })
})

describe('guessPartFromFilename', () => {
  it('matches standard «Verk - 2nd Cornet.pdf»-mønster', () => {
    expect(guess('Gaelforce - 2nd Cornet.pdf')).toBe('second-cornet')
    expect(guess('Gaelforce - Solo Cornet.pdf')).toBe('solo-cornet')
    expect(guess('Gaelforce - Soprano Cornet.pdf')).toBe('soprano-cornet')
  })

  it('takler tonart (Bb/Eb) midt i filnavnet — den gamle delstreng-buggen', () => {
    // Britiske brass-band-sett: «1st Bb Baritone», «2nd Eb Horn» osv.
    expect(guess('Estancia - I Los trabajadores agrícolas BB - 11 - 1st Bb Baritone.pdf')).toBe('first-baritone')
    expect(guess('Estancia - I Los trabajadores agrícolas BB - 12 - 2nd Bb Baritone.pdf')).toBe('second-baritone')
    expect(guess('Estancia - I Los trabajadores agrícolas BB - 10 - 2nd Eb Horn.pdf')).toBe('second-horn')
    expect(guess('Estancia - I Los trabajadores agrícolas BB - 13 - 1st Bb Trombone.pdf')).toBe('first-trombone')
    expect(guess('Estancia - I Los trabajadores agrícolas BB - 14 - 2nd Bb Trombone.pdf')).toBe('second-trombone')
  })

  it('skiller fortsatt Eb-bass og Bb-bass (tonart er del av aliaset)', () => {
    expect(guess('Estancia - Eb Bass.pdf')).toBe('eb-bass')
    expect(guess('Estancia - Bb Bass.pdf')).toBe('bb-bass')
  })

  it('rangerer mest spesifikke treff først', () => {
    expect(guess('Gaelforce - Full Score.pdf')).toBe('score')
    expect(guess('Test - Solo Horn.pdf')).toBe('solo-horn')
  })

  it('lar publikasjonsnummer (BB - 24 -) ikke forstyrre ordenstall', () => {
    // «24» er ikke «2», så dette skal ikke bli 2. kornett e.l.
    expect(guess('Estancia - I Los trabajadores agrícolas BB - 24 - Marimba (Optional).pdf')).toBeNull()
  })

  it('treffer egendefinerte stemmer på navn og alias', () => {
    // Slik en bruker legger inn slagverk via Innstillinger.
    const custom = [
      { id: 'marimba', aliases: ['marimba'], nameNo: 'Marimba', nameEn: 'Marimba' },
      { id: 'stortromme', aliases: ['cassa', 'bass drum', 'gran cassa'], nameNo: 'Stortromme', nameEn: 'Bass Drum' },
    ]
    expect(guessPartFromFilename('Estancia - BB - 24 - Marimba (Optional).pdf', custom)).toBe('marimba')
    expect(guessPartFromFilename('Estancia - BB - 23 - Cassa (Bass Drum).pdf', custom)).toBe('stortromme')
  })

  it('returnerer null når ingenting matcher', () => {
    expect(guess('Estancia - Tittelside.pdf')).toBeNull()
  })
})
