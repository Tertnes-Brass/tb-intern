import { describe, expect, it } from 'vitest'
import {
  PRACTICE_COMMENT_MAX,
  PRACTICE_LABELS,
  canSeeMemberPractice,
  countPractice,
  isPracticeStatus,
  normalizePracticeComment,
  practiceScope,
  practiceSummary,
  type PracticeViewer,
} from './practice'

const musician: PracticeViewer = { id: 'u1', permissions: ['scores.view'], leadsPartIds: [] }
const leader: PracticeViewer = { id: 'u2', permissions: ['members.manage.section'], leadsPartIds: ['solo-cornet', 'second-cornet'] }
const conductor: PracticeViewer = { id: 'u3', permissions: ['calendar.manage'], leadsPartIds: [] }
const programmer: PracticeViewer = { id: 'u4', permissions: ['projects.manage'], leadsPartIds: [] }
const admin: PracticeViewer = { id: 'u5', permissions: ['*'], leadsPartIds: [] }

describe('practiceScope', () => {
  it('gir hele oversikten til dirigenten og til den som forvalter programmet', () => {
    expect(practiceScope(conductor)).toEqual({ kind: 'all' })
    expect(practiceScope(programmer)).toEqual({ kind: 'all' })
    expect(practiceScope(admin)).toEqual({ kind: 'all' })
  })

  it('gir gruppelederen sine egne stemmer', () => {
    expect(practiceScope(leader)).toEqual({ kind: 'sections', partIds: ['solo-cornet', 'second-cornet'] })
  })

  it('gir et vanlig medlem bare sin egen rad', () => {
    expect(practiceScope(musician)).toEqual({ kind: 'self' })
    expect(practiceScope(null)).toEqual({ kind: 'self' })
  })

  it('lar rettigheten gå foran leiarbindingen', () => {
    const both: PracticeViewer = { id: 'u6', permissions: ['projects.manage'], leadsPartIds: ['tuba'] }
    expect(practiceScope(both)).toEqual({ kind: 'all' })
  })
})

describe('canSeeMemberPractice', () => {
  it('lar alle se sin egen status', () => {
    expect(canSeeMemberPractice(musician, { id: 'u1', partIds: ['euphonium'] })).toBe(true)
  })

  it('skjuler andres status for et vanlig medlem', () => {
    expect(canSeeMemberPractice(musician, { id: 'annen', partIds: ['euphonium'] })).toBe(false)
  })

  it('lar gruppelederen se sine egne stemmer, men ikke andres', () => {
    expect(canSeeMemberPractice(leader, { id: 'annen', partIds: ['second-cornet'] })).toBe(true)
    expect(canSeeMemberPractice(leader, { id: 'annen', partIds: ['euphonium'] })).toBe(false)
  })

  it('lar dirigenten se alle', () => {
    expect(canSeeMemberPractice(conductor, { id: 'annen', partIds: ['euphonium'] })).toBe(true)
  })

  it('lar et medlem uten stemme være usynlig for en gruppeleder', () => {
    expect(canSeeMemberPractice(leader, { id: 'annen', partIds: [] })).toBe(false)
  })
})

describe('countPractice', () => {
  it('teller per status', () => {
    expect(
      countPractice([
        { status: 'practicing' },
        { status: 'practicing' },
        { status: 'looked_at' },
        { status: 'needs_help' },
      ]),
    ).toEqual({ lookedAt: 1, practicing: 2, needsHelp: 1, total: 4 })
  })

  it('teller BARE dem som har markert noe — det finnes ingen «uten status»', () => {
    const counts = countPractice([{ status: 'looked_at' }])
    expect(counts.total).toBe(1)
    expect(Object.keys(counts)).not.toContain('noReply')
  })

  it('tåler en tom liste', () => {
    expect(countPractice([])).toEqual({ lookedAt: 0, practicing: 0, needsHelp: 0, total: 0 })
  })
})

describe('practiceSummary', () => {
  it('utelater tomme ledd', () => {
    expect(practiceSummary({ lookedAt: 0, practicing: 3, needsHelp: 0, total: 3 })).toBe('3 øver på den')
  })

  it('setter «øver på» først — det er det folk vil vite', () => {
    expect(practiceSummary({ lookedAt: 2, practicing: 4, needsHelp: 1, total: 7 })).toBe(
      '4 øver på den · 2 har sett på den · 1 vil øve med noen',
    )
  })

  it('sier aldri noe om hvem som mangler', () => {
    const text = practiceSummary({ lookedAt: 0, practicing: 0, needsHelp: 0, total: 0 })
    expect(text).toBe('Ingen har markert noe ennå')
    expect(text).not.toMatch(/mangler|uten svar|ikke svart/i)
  })
})

describe('status og kommentar', () => {
  it('kjenner igjen de tre statusene', () => {
    expect(isPracticeStatus('needs_help')).toBe(true)
    expect(isPracticeStatus('done')).toBe(false)
  })

  it('har en støttende etikett på «trenger hjelp»', () => {
    expect(PRACTICE_LABELS.needs_help).toBe('Vil øve med noen')
  })

  it('trimmer og kutter kommentaren', () => {
    expect(normalizePracticeComment('  takt   40  ')).toBe('takt 40')
    expect(normalizePracticeComment('   ')).toBeNull()
    expect(normalizePracticeComment(null)).toBeNull()
    expect(normalizePracticeComment('x'.repeat(PRACTICE_COMMENT_MAX + 50))).toHaveLength(PRACTICE_COMMENT_MAX)
  })
})
