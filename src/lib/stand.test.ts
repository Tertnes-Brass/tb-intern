import { describe, expect, it } from 'vitest'
import {
  POSITION_MAX_AGE_MS,
  type StandEntry,
  type StandWork,
  parseStandPosition,
  resolveStart,
  resumeLabel,
  serializeStandPosition,
  standEntries,
  standPositionKey,
  startIndex,
} from './stand'

function work(id: string, extra: Partial<StandWork> = {}): StandWork {
  return {
    workId: id,
    title: `Verk ${id}`,
    composer: null,
    arranger: null,
    myFiles: [],
    partFiles: [],
    scoreFileId: null,
    links: [],
    audioFiles: [],
    ...extra,
  }
}

const horn = (id: string, name = '1. horn') => ({ id, partName: name, fileName: `${id}.pdf`, pageCount: 2 })

describe('standEntries', () => {
  it('følger programmet og nummererer verkene', () => {
    const entries = standEntries([work('a', { myFiles: [horn('a1')] }), work('b', { myFiles: [horn('b1')] })], {
      hasParts: true,
    })
    expect(entries.map((e) => [e.number, e.fileId])).toEqual([
      ['I.', 'a1'],
      ['II.', 'b1'],
    ])
  })

  it('gir begge stemmene til en med to stemmer', () => {
    const entries = standEntries([work('a', { myFiles: [horn('a1'), horn('a2', '2. horn')] })], { hasParts: true })
    expect(entries.map((e) => e.label)).toEqual(['1. horn', '2. horn'])
  })

  it('hopper over verk uten egen stemme, men beholder nummereringen', () => {
    const entries = standEntries([work('a'), work('b', { myFiles: [horn('b1')] })], { hasParts: true })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.number).toBe('II.')
  })

  it('tar bare PDF-er', () => {
    const entries = standEntries(
      [work('a', { myFiles: [{ id: 'a1', partName: '1. horn', fileName: 'a1.mscz', pageCount: null }] })],
      { hasParts: true },
    )
    expect(entries).toHaveLength(0)
  })

  it('gir partituret til den som ikke har noen stemme', () => {
    const entries = standEntries([work('a', { scoreFileId: 's1' })], { hasParts: false })
    expect(entries.map((e) => [e.fileId, e.label])).toEqual([['s1', 'Partitur']])
  })

  it('gir ikke partituret til en musiker uten stemme i akkurat dette verket', () => {
    expect(standEntries([work('a', { scoreFileId: 's1' })], { hasParts: true })).toHaveLength(0)
  })

  it('lar en bestemt fil ta verkets plass når stativet åpnes fra den', () => {
    const works = [
      work('a', { myFiles: [horn('a1')], scoreFileId: 's1' }),
      work('b', { myFiles: [horn('b1')], partFiles: [{ id: 'b9', partName: 'Tuba', pageCount: 1 }] }),
    ]
    expect(standEntries(works, { hasParts: true, focusFileId: 's1' }).map((e) => e.fileId)).toEqual(['s1', 'b1'])
    expect(standEntries(works, { hasParts: true, focusFileId: 'b9' }).map((e) => e.fileId)).toEqual(['a1', 'b9'])
  })

  it('merker verk med lytteeksempler', () => {
    const entries = standEntries([work('a', { myFiles: [horn('a1')], audioFiles: [{ id: 'x' }] })], { hasParts: true })
    expect(entries[0]!.canListen).toBe(true)
  })
})

describe('startIndex', () => {
  const entries = standEntries([work('a', { myFiles: [horn('a1')] }), work('b', { myFiles: [horn('b1')] })], {
    hasParts: true,
  })

  it('starter på fila man ba om', () => {
    expect(startIndex(entries, 'b1')).toBe(1)
  })

  it('starter på første stykke ellers', () => {
    expect(startIndex(entries, null)).toBe(0)
    expect(startIndex(entries, 'finnes-ikke')).toBe(0)
  })
})

describe('leseposisjonen', () => {
  const entry = (fileId: string, i: number): StandEntry => ({
    fileId,
    workId: `w${i}`,
    number: `${['I', 'II', 'III'][i]}.`,
    title: `Verk ${i}`,
    label: '1. horn',
    pageCount: 3,
    canListen: false,
  })
  const entries = [entry('a', 0), entry('b', 1), entry('c', 2)]
  const now = 1_800_000_000_000
  const saved = (fileId: string, page: number, age = 0) => ({ fileId, page, savedAt: now - age })

  it('nøkkelen er per bruker og prosjekt', () => {
    expect(standPositionKey('u1', 'p1')).toBe('tb-stand-pos:u1:p1')
    expect(standPositionKey('u2', 'p1')).not.toBe(standPositionKey('u1', 'p1'))
  })

  it('tåler søppel fra localStorage', () => {
    expect(parseStandPosition(null)).toBeNull()
    expect(parseStandPosition('')).toBeNull()
    expect(parseStandPosition('{')).toBeNull()
    expect(parseStandPosition('null')).toBeNull()
    expect(parseStandPosition('"b"')).toBeNull()
    expect(parseStandPosition(JSON.stringify({ fileId: 'b', page: 0, savedAt: now }))).toBeNull()
    expect(parseStandPosition(JSON.stringify({ fileId: '', page: 2, savedAt: now }))).toBeNull()
    expect(parseStandPosition(JSON.stringify({ fileId: 'b', page: '2', savedAt: now }))).toBeNull()
    expect(parseStandPosition(JSON.stringify({ fileId: 'b', page: 2 }))).toBeNull()
  })

  it('leser tilbake det som ble lagret', () => {
    const p = saved('b', 3)
    expect(parseStandPosition(serializeStandPosition(p))).toEqual(p)
    expect(parseStandPosition(JSON.stringify({ fileId: 'b', page: 2.7, savedAt: now }))?.page).toBe(2)
  })

  it('fortsetter der man var', () => {
    expect(resolveStart(entries, { saved: saved('b', 3), now })).toEqual({ index: 1, page: 3, resumed: true })
  })

  it('første side i første stykke er ingen fortsettelse', () => {
    expect(resolveStart(entries, { saved: saved('a', 1), now })).toEqual({ index: 0, page: 1, resumed: false })
    expect(resolveStart(entries, { saved: saved('a', 2), now })).toEqual({ index: 0, page: 2, resumed: true })
  })

  it('uten lagret posisjon: forfra', () => {
    expect(resolveStart(entries, { saved: null, now })).toEqual({ index: 0, page: 1, resumed: false })
  })

  it('en fil som ikke lenger ligger på stativet: forfra', () => {
    expect(resolveStart(entries, { saved: saved('borte', 4), now })).toEqual({ index: 0, page: 1, resumed: false })
  })

  it('en gammel posisjon glemmes', () => {
    expect(resolveStart(entries, { saved: saved('b', 3, POSITION_MAX_AGE_MS + 1), now }).resumed).toBe(false)
    expect(resolveStart(entries, { saved: saved('b', 3, POSITION_MAX_AGE_MS), now }).resumed).toBe(true)
  })

  it('?fil= vinner over den lagrede posisjonen', () => {
    expect(resolveStart(entries, { requestedFileId: 'c', saved: saved('b', 3), now })).toEqual({
      index: 2,
      page: 1,
      resumed: false,
    })
  })

  it('?fil= til samme stykke fortsetter på siden', () => {
    expect(resolveStart(entries, { requestedFileId: 'b', saved: saved('b', 3), now })).toEqual({
      index: 1,
      page: 3,
      resumed: true,
    })
  })

  it('?fil= som ikke finnes på stativet teller ikke', () => {
    expect(resolveStart(entries, { requestedFileId: 'x', saved: saved('b', 3), now }).index).toBe(1)
    expect(resolveStart(entries, { requestedFileId: 'x', saved: null, now }).index).toBe(0)
  })

  it('beskriver hvor man fortsetter', () => {
    expect(resumeLabel({ number: 'II.', title: 'Benedictus' }, 3)).toBe('II. Benedictus, side 3')
    expect(resumeLabel({ number: 'II.', title: 'Benedictus' }, 1)).toBe('II. Benedictus')
  })
})
