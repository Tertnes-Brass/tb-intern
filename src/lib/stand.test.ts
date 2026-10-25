import { describe, expect, it } from 'vitest'
import { type StandWork, standEntries, startIndex } from './stand'

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
