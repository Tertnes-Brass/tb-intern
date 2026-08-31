import { describe, expect, it } from 'vitest'
import { type SortableTask, dueLabel, groupTasks, isOverdue, sortTasks } from './board'

const TODAY = '2026-09-01'

function task(id: string, patch: Partial<SortableTask> = {}): SortableTask {
  return {
    id,
    status: 'open',
    dueDate: null,
    title: id,
    createdAt: 1_000,
    completedAt: null,
    ...patch,
  }
}

describe('isOverdue', () => {
  it('er forfalt når fristen er passert', () => {
    expect(isOverdue(task('a', { dueDate: '2026-08-30' }), TODAY)).toBe(true)
  })

  it('er ikke forfalt på selve fristdagen', () => {
    expect(isOverdue(task('a', { dueDate: TODAY }), TODAY)).toBe(false)
  })

  it('er ikke forfalt uten frist', () => {
    expect(isOverdue(task('a'), TODAY)).toBe(false)
  })

  it('er aldri forfalt når oppgaven er ferdig', () => {
    expect(isOverdue(task('a', { status: 'done', dueDate: '2026-01-01' }), TODAY)).toBe(false)
  })
})

describe('sortTasks', () => {
  it('setter åpne først, så pågående, så ferdige', () => {
    const sorted = sortTasks([
      task('ferdig', { status: 'done', completedAt: 5_000 }),
      task('pagar', { status: 'in_progress' }),
      task('apen'),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['apen', 'pagar', 'ferdig'])
  })

  it('sorterer åpne på frist, tidligst først', () => {
    const sorted = sortTasks([
      task('sen', { dueDate: '2026-10-01' }),
      task('tidlig', { dueDate: '2026-09-02' }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['tidlig', 'sen'])
  })

  it('legger oppgaver uten frist bakerst blant sine egne', () => {
    const sorted = sortTasks([
      task('uten'),
      task('med', { dueDate: '2026-12-24' }),
      task('ferdig', { status: 'done', completedAt: 9_000 }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['med', 'uten', 'ferdig'])
  })

  it('viser sist fullførte ferdig-oppgave øverst blant de ferdige', () => {
    const sorted = sortTasks([
      task('gammel', { status: 'done', completedAt: 1_000 }),
      task('fersk', { status: 'done', completedAt: 8_000 }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['fersk', 'gammel'])
  })

  it('bruker opprettelsestidspunkt som stabil utslagsgiver ved lik frist', () => {
    const sorted = sortTasks([
      task('nyere', { dueDate: '2026-09-10', createdAt: 2_000 }),
      task('eldre', { dueDate: '2026-09-10', createdAt: 1_000 }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['eldre', 'nyere'])
  })

  it('lar inndata være urørt', () => {
    const input = [task('b', { dueDate: '2026-10-01' }), task('a', { dueDate: '2026-09-02' })]
    sortTasks(input)
    expect(input.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('groupTasks', () => {
  it('deler i åpne, pågående og ferdige og teller forfalte', () => {
    const grouped = groupTasks(
      [
        task('forfalt', { dueDate: '2026-08-01' }),
        task('kommer', { dueDate: '2026-09-20' }),
        task('pagar-forfalt', { status: 'in_progress', dueDate: '2026-08-20' }),
        task('ferdig', { status: 'done', completedAt: 4_000, dueDate: '2026-01-01' }),
      ],
      TODAY,
    )
    expect(grouped.open.map((t) => t.id)).toEqual(['forfalt', 'kommer'])
    expect(grouped.inProgress.map((t) => t.id)).toEqual(['pagar-forfalt'])
    expect(grouped.done.map((t) => t.id)).toEqual(['ferdig'])
    // Den ferdige oppgaven hadde frist i januar, men skal ikke telle som forfalt.
    expect(grouped.overdueCount).toBe(2)
  })

  it('gir tomme bolker for en tom liste', () => {
    const grouped = groupTasks([], TODAY)
    expect(grouped).toEqual({ open: [], inProgress: [], done: [], overdueCount: 0 })
  })
})

describe('dueLabel', () => {
  it('beskriver dagen i dag, i morgen og i går', () => {
    expect(dueLabel(TODAY, TODAY)).toBe('I dag')
    expect(dueLabel('2026-09-02', TODAY)).toBe('I morgen')
    expect(dueLabel('2026-08-31', TODAY)).toBe('I går')
  })

  it('teller dager fram og på overtid', () => {
    expect(dueLabel('2026-09-05', TODAY)).toBe('om 4 dager')
    expect(dueLabel('2026-08-25', TODAY)).toBe('7 dager på overtid')
  })

  it('er tom uten frist', () => {
    expect(dueLabel(null, TODAY)).toBe('')
  })
})
