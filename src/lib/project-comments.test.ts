import { describe, expect, it } from 'vitest'
import {
  type ProjectCommentRow,
  canAnswerProjectThread,
  canDeleteProjectComment,
  openThreadCount,
  openThreadsLabel,
  replyCountLabel,
  threadStatusLabel,
  threadsFrom,
} from './project-comments'

const row = (over: Partial<ProjectCommentRow> & { id: string }): ProjectCommentRow => ({
  parentId: null,
  body: 'tekst',
  author: { id: 'u1', name: 'Ingrid Vik' },
  createdAt: 1_000,
  resolvedAt: null,
  resolvedByName: null,
  ...over,
})

describe('flate rader blir tråder', () => {
  it('henger svarene under spørsmålet sitt', () => {
    const threads = threadsFrom([
      row({ id: 'q1', createdAt: 100 }),
      row({ id: 'a1', parentId: 'q1', createdAt: 300 }),
      row({ id: 'a2', parentId: 'q1', createdAt: 200 }),
    ])
    expect(threads).toHaveLength(1)
    // Svarene leses forfra: en samtale er kronologisk.
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(['a2', 'a1'])
  })

  it('legger åpne spørsmål først, avklarte etter', () => {
    const threads = threadsFrom([
      row({ id: 'gammelt-apent', createdAt: 100 }),
      row({ id: 'nytt-avklart', createdAt: 400, resolvedAt: 500 }),
      row({ id: 'nytt-apent', createdAt: 300 }),
      row({ id: 'gammelt-avklart', createdAt: 50, resolvedAt: 60 }),
    ])
    expect(threads.map((t) => t.id)).toEqual([
      'nytt-apent',
      'gammelt-apent',
      'nytt-avklart',
      'gammelt-avklart',
    ])
  })

  it('dropper et svar uten tråd i stedet for å lage en tråd av det', () => {
    const threads = threadsFrom([row({ id: 'q1' }), row({ id: 'foreldrelost', parentId: 'finnes-ikke' })])
    expect(threads.map((t) => t.id)).toEqual(['q1'])
    expect(threads[0]!.replies).toEqual([])
  })

  it('svarer tomt på en tom liste', () => {
    expect(threadsFrom([])).toEqual([])
  })

  it('rører ikke de innkommende radene', () => {
    const rows = [row({ id: 'q1' }), row({ id: 'a1', parentId: 'q1' })]
    threadsFrom(rows)
    expect(rows.map((r) => r.id)).toEqual(['q1', 'a1'])
    expect(rows[0]).not.toHaveProperty('replies')
  })
})

describe('hvem får slette', () => {
  const mine = { author: { id: 'u1', name: 'Ingrid' } }
  const others = { author: { id: 'u2', name: 'Jonas' } }
  const me = { id: 'u1' }

  it('lar deg slette din egen kommentar', () => {
    expect(canDeleteProjectComment(me, mine, false)).toBe(true)
  })

  it('lar deg ikke slette andres', () => {
    expect(canDeleteProjectComment(me, others, false)).toBe(false)
  })

  it('lar prosjektansvarlig moderere alt', () => {
    expect(canDeleteProjectComment(me, others, true)).toBe(true)
  })

  it('avviser en utlogget bruker', () => {
    expect(canDeleteProjectComment(null, mine, true)).toBe(false)
  })

  it('regner en kommentar fra en slettet konto som ingens', () => {
    expect(canDeleteProjectComment(me, { author: { id: null } }, false)).toBe(false)
  })
})

describe('hvem får svare og avklare', () => {
  it('krever `projects.manage`', () => {
    expect(canAnswerProjectThread(true)).toBe(true)
    expect(canAnswerProjectThread(false)).toBe(false)
  })
})

describe('etiketter', () => {
  it('viser status på tråden', () => {
    expect(threadStatusLabel({ resolvedAt: null })).toBe('Åpent')
    expect(threadStatusLabel({ resolvedAt: 1 })).toBe('Avklart')
  })

  it('teller svar på norsk', () => {
    expect(replyCountLabel(0)).toBe('Ingen svar ennå')
    expect(replyCountLabel(1)).toBe('1 svar')
    expect(replyCountLabel(3)).toBe('3 svar')
  })

  it('teller åpne spørsmål', () => {
    const threads = [{ resolvedAt: null }, { resolvedAt: 5 }, { resolvedAt: null }]
    expect(openThreadCount(threads)).toBe(2)
    expect(openThreadsLabel(2)).toBe('2 spørsmål venter på svar')
    expect(openThreadsLabel(1)).toBe('1 spørsmål venter på svar')
    expect(openThreadsLabel(0)).toBe('')
  })
})
