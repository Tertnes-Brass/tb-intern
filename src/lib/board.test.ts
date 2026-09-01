import { describe, expect, it } from 'vitest'
import {
  CHANNEL_NAME_MAX,
  GENERAL_CHANNEL,
  REPLY_EXCERPT_MAX,
  type SortableBoardProject,
  type SortableTask,
  boardAreaNote,
  channelCustomId,
  channelNameError,
  channelNameKey,
  channelProjectId,
  customChannel,
  dueLabel,
  groupMessagesByDay,
  groupTasks,
  isOverdue,
  isProjectOverdue,
  normalizeChannelName,
  overdueByAssignee,
  parseChannel,
  projectChannel,
  projectProgress,
  replyExcerpt,
  replyReference,
  shouldRunReminders,
  sortBoardProjects,
  sortChannels,
  sortTasks,
  totalUnread,
  unreadCount,
  wantsTaskEmail,
} from './board'

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

describe('projectProgress', () => {
  it('teller ferdige av totalt', () => {
    expect(projectProgress(2, 5)).toEqual({
      done: 2,
      total: 5,
      percent: 40,
      label: '2 av 5 oppgaver ferdig',
    })
  })

  it('gir 0 % og egen tekst uten oppgaver', () => {
    expect(projectProgress(0, 0)).toEqual({ done: 0, total: 0, percent: 0, label: 'Ingen oppgaver ennå' })
  })

  it('gir 100 % når alt er gjort', () => {
    expect(projectProgress(4, 4).percent).toBe(100)
  })

  it('klemmer urimelige tall i stedet for å regne feil', () => {
    expect(projectProgress(9, 3)).toMatchObject({ done: 3, total: 3, percent: 100 })
    expect(projectProgress(-2, 4)).toMatchObject({ done: 0, percent: 0 })
  })
})

describe('isProjectOverdue', () => {
  it('er forfalt når et aktivt prosjekt har passert fristen', () => {
    expect(isProjectOverdue({ status: 'active', dueDate: '2026-08-01' }, TODAY)).toBe(true)
  })

  it('er ikke forfalt på fristdagen', () => {
    expect(isProjectOverdue({ status: 'active', dueDate: TODAY }, TODAY)).toBe(false)
  })

  it('er aldri forfalt når prosjektet er ferdig eller arkivert', () => {
    expect(isProjectOverdue({ status: 'done', dueDate: '2026-01-01' }, TODAY)).toBe(false)
    expect(isProjectOverdue({ status: 'archived', dueDate: '2026-01-01' }, TODAY)).toBe(false)
  })
})

function project(id: string, patch: Partial<SortableBoardProject> = {}): SortableBoardProject {
  return { id, title: id, status: 'active', dueDate: null, createdAt: 1_000, doneTasks: 0, totalTasks: 0, ...patch }
}

describe('sortBoardProjects', () => {
  it('setter aktive først, så ferdige, så arkiverte', () => {
    const sorted = sortBoardProjects([
      project('arkivert', { status: 'archived' }),
      project('ferdig', { status: 'done' }),
      project('aktivt'),
    ])
    expect(sorted.map((p) => p.id)).toEqual(['aktivt', 'ferdig', 'arkivert'])
  })

  it('sorterer aktive på frist, uten frist bakerst', () => {
    const sorted = sortBoardProjects([
      project('uten'),
      project('sen', { dueDate: '2026-12-01' }),
      project('tidlig', { dueDate: '2026-09-10' }),
    ])
    expect(sorted.map((p) => p.id)).toEqual(['tidlig', 'sen', 'uten'])
  })

  it('viser nyeste ferdige først', () => {
    const sorted = sortBoardProjects([
      project('gammel', { status: 'done', createdAt: 1_000 }),
      project('ny', { status: 'done', createdAt: 5_000 }),
    ])
    expect(sorted.map((p) => p.id)).toEqual(['ny', 'gammel'])
  })

  it('lar inndata være urørt', () => {
    const input = [project('b', { dueDate: '2026-12-01' }), project('a', { dueDate: '2026-09-10' })]
    sortBoardProjects(input)
    expect(input.map((p) => p.id)).toEqual(['b', 'a'])
  })
})

describe('kanalnøkler', () => {
  it('bygger og leser prosjekt-tråder', () => {
    expect(projectChannel('abc')).toBe('project:abc')
    expect(channelProjectId('project:abc')).toBe('abc')
  })

  it('gir null for fellesekanalen', () => {
    expect(channelProjectId(GENERAL_CHANNEL)).toBeNull()
    expect(channelProjectId('project:')).toBeNull()
  })

  it('bygger og leser egendefinerte kanaler', () => {
    expect(customChannel('abc')).toBe('custom:abc')
    expect(channelCustomId('custom:abc')).toBe('abc')
    expect(channelCustomId('project:abc')).toBeNull()
    expect(channelCustomId('custom:')).toBeNull()
  })

  it('tolker alle tre kanaltypene', () => {
    expect(parseChannel(GENERAL_CHANNEL)).toEqual({ kind: 'general', id: null })
    expect(parseChannel('project:abc')).toEqual({ kind: 'project', id: 'abc' })
    expect(parseChannel('custom:abc')).toEqual({ kind: 'custom', id: 'abc' })
  })

  it('avviser nøkler som ikke er kanaler', () => {
    // Gaten på serveren hviler på dette: en oppdiktet kanal skal aldri kunne
    // brukes til å lese eller skrive noe.
    expect(parseChannel('tilfeldig')).toBeNull()
    expect(parseChannel('custom:')).toBeNull()
    expect(parseChannel('project:')).toBeNull()
    expect(parseChannel('')).toBeNull()
  })
})

describe('kanalnavn', () => {
  it('normaliserer mellomrom', () => {
    expect(normalizeChannelName('  Uniformer   2027 ')).toBe('Uniformer 2027')
  })

  it('regner samme navn med ulik skrivemåte som likt', () => {
    expect(channelNameKey('Uniformer 2027')).toBe(channelNameKey('  uniformer  2027 '))
    expect(channelNameKey('Uniformer')).not.toBe(channelNameKey('Uniformar'))
  })

  it('krever navn og setter en øvre grense', () => {
    expect(channelNameError('Uniformer')).toBeNull()
    expect(channelNameError('   ')).toBe('Kanalen må ha et navn')
    expect(channelNameError('x'.repeat(CHANNEL_NAME_MAX))).toBeNull()
    expect(channelNameError('x'.repeat(CHANNEL_NAME_MAX + 1))).toBe('Navnet kan være maks 60 tegn')
  })
})

describe('sortChannels', () => {
  const ch = (title: string, kind: 'general' | 'project' | 'custom', archived = false) => ({
    title,
    kind,
    archived,
  })

  it('setter Styret først, så prosjekter, så egne kanaler', () => {
    const sorted = sortChannels([
      ch('Uniformer 2027', 'custom'),
      ch('Sommerkonsert', 'project'),
      ch('Styret', 'general'),
      ch('Nye uniformer', 'project'),
    ])
    expect(sorted.map((c) => c.title)).toEqual(['Styret', 'Nye uniformer', 'Sommerkonsert', 'Uniformer 2027'])
  })

  it('legger arkiverte kanaler nederst uansett type', () => {
    const sorted = sortChannels([ch('Avlyst tur', 'custom', true), ch('Styret', 'general'), ch('Dugnad', 'custom')])
    expect(sorted.map((c) => c.title)).toEqual(['Styret', 'Dugnad', 'Avlyst tur'])
  })
})

describe('totalUnread', () => {
  it('summerer uleste i aktive kanaler', () => {
    expect(
      totalUnread([
        { archived: false, unread: 2 },
        { archived: false, unread: 1 },
      ]),
    ).toBe(3)
  })

  it('teller ikke arkiverte kanaler', () => {
    // En teller man ikke kan nullstille ved å lese noe, er en teller ingen
    // stoler på.
    expect(
      totalUnread([
        { archived: true, unread: 5 },
        { archived: false, unread: 1 },
      ]),
    ).toBe(1)
  })
})

describe('replyExcerpt', () => {
  it('lar korte meldinger stå urørt', () => {
    expect(replyExcerpt('Kort svar')).toBe('Kort svar')
  })

  it('gjør flere linjer til én', () => {
    expect(replyExcerpt('to\nlinjer')).toBe('to linjer')
  })

  it('kutter lange meldinger på ordgrense', () => {
    const excerpt = replyExcerpt(`${'ord '.repeat(40)}slutt`)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt.length).toBeLessThanOrEqual(REPLY_EXCERPT_MAX + 1)
    expect(excerpt).not.toMatch(/ …$/)
  })

  it('kutter rått når det ikke finnes en ordgrense', () => {
    const excerpt = replyExcerpt('x'.repeat(200))
    expect(excerpt).toBe(`${'x'.repeat(REPLY_EXCERPT_MAX)}…`)
  })
})

describe('groupMessagesByDay', () => {
  const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const at = (iso: string, id: string) => ({ id, createdAt: Date.parse(iso) })

  it('grupperer kronologisk på dag', () => {
    const days = groupMessagesByDay(
      [
        at('2026-09-02T09:00:00Z', 'c'),
        at('2026-09-01T08:00:00Z', 'a'),
        at('2026-09-01T20:00:00Z', 'b'),
      ],
      dateOf,
    )
    expect(days.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02'])
    expect(days[0]!.messages.map((m) => m.id)).toEqual(['a', 'b'])
    expect(days[1]!.messages.map((m) => m.id)).toEqual(['c'])
  })

  it('gir tom liste for ingen meldinger', () => {
    expect(groupMessagesByDay([], dateOf)).toEqual([])
  })

  it('starter en ny dag igjen hvis samme dato dukker opp etter en annen', () => {
    // Kan ikke skje med sortert inndata, men grupperingen skal ikke slå sammen
    // to bolker som ikke ligger inntil hverandre.
    const days = groupMessagesByDay([at('2026-09-01T08:00:00Z', 'a'), at('2026-09-01T09:00:00Z', 'b')], dateOf)
    expect(days).toHaveLength(1)
  })
})

describe('unreadCount', () => {
  const msgs = [
    { authorId: 'meg', createdAt: 100 },
    { authorId: 'andre', createdAt: 200 },
    { authorId: 'andre', createdAt: 300 },
  ]

  it('teller bare andres meldinger etter sist lest', () => {
    expect(unreadCount(msgs, 150, 'meg')).toBe(2)
    expect(unreadCount(msgs, 250, 'meg')).toBe(1)
  })

  it('teller aldri egne meldinger', () => {
    expect(unreadCount([{ authorId: 'meg', createdAt: 900 }], 0, 'meg')).toBe(0)
  })

  it('regner alt fra andre som ulest uten lest-rad', () => {
    expect(unreadCount(msgs, null, 'meg')).toBe(2)
  })
})

describe('replyReference', () => {
  it('viser forfatter og utdrag når originalen finnes', () => {
    expect(
      replyReference({
        replyToDeleted: false,
        replyId: 'm1',
        replyBody: 'Kjør `npm test` før du pusher',
        replyAuthorName: 'Hilde',
      }),
    ).toEqual({ deleted: false, id: 'm1', authorName: 'Hilde', excerpt: 'Kjør npm test før du pusher' })
  })

  it('sier fra når originalen er slettet', () => {
    // Fremmednøkkelen har nullstilt `replyToId`; merket er det eneste som er
    // igjen — og uten det ville svaret sett ut som en helt vanlig melding.
    expect(replyReference({ replyToDeleted: true, replyId: null, replyBody: null, replyAuthorName: null })).toEqual({
      deleted: true,
    })
  })

  it('gir ingen referanse for en vanlig melding', () => {
    expect(
      replyReference({ replyToDeleted: false, replyId: null, replyBody: null, replyAuthorName: null }),
    ).toBeNull()
  })

  it('tåler at forfatteren er borte', () => {
    expect(
      replyReference({ replyToDeleted: false, replyId: 'm1', replyBody: 'hei', replyAuthorName: null }),
    ).toMatchObject({ authorName: null, excerpt: 'hei' })
  })
})

describe('boardAreaNote', () => {
  it('teller åpne oppgaver og forfalte', () => {
    expect(boardAreaNote({ openTasks: 3, overdue: 1 })).toBe('3 åpne oppgaver, 1 forfalt')
    expect(boardAreaNote({ openTasks: 1, overdue: 0 })).toBe('1 åpen oppgave')
  })

  it('er tom når det ikke er noe å melde', () => {
    expect(boardAreaNote({ openTasks: 0, overdue: 0 })).toBeNull()
  })
})

describe('wantsTaskEmail', () => {
  it('sender når medlemmet ikke har valgt noe', () => {
    expect(wantsTaskEmail(undefined)).toBe(true)
    expect(wantsTaskEmail(null)).toBe(true)
    expect(wantsTaskEmail('all')).toBe(true)
  })

  it('respekterer «Av»', () => {
    expect(wantsTaskEmail('off')).toBe(false)
  })
})

describe('overdueByAssignee', () => {
  const tasks = [
    { ...task('sen', { dueDate: '2026-08-01' }), assigneeUserId: 'hilde' },
    { ...task('senere', { dueDate: '2026-08-20' }), assigneeUserId: 'hilde' },
    { ...task('i-tide', { dueDate: '2026-09-30' }), assigneeUserId: 'hilde' },
    { ...task('ferdig', { dueDate: '2026-08-01', status: 'done', completedAt: 2_000 }), assigneeUserId: 'hilde' },
    { ...task('herrelos', { dueDate: '2026-08-01' }), assigneeUserId: null },
    { ...task('anders', { dueDate: '2026-08-10' }), assigneeUserId: 'anders' },
  ]

  it('gir én bolk per ansvarlig, med kun forfalte oppgaver', () => {
    const groups = overdueByAssignee(tasks, TODAY)
    expect(groups.map((g) => g.assigneeUserId).sort()).toEqual(['anders', 'hilde'])
    const hilde = groups.find((g) => g.assigneeUserId === 'hilde')!
    expect(hilde.tasks.map((t) => t.id)).toEqual(['sen', 'senere'])
  })

  it('hopper over oppgaver uten ansvarlig', () => {
    const groups = overdueByAssignee(tasks, TODAY)
    expect(groups.flatMap((g) => g.tasks).map((t) => t.id)).not.toContain('herrelos')
  })

  it('er tom når ingenting er forfalt', () => {
    expect(overdueByAssignee(tasks, '2026-07-01')).toEqual([])
  })
})

describe('shouldRunReminders', () => {
  it('kjører når den ikke har kjørt i dag', () => {
    expect(shouldRunReminders(null, TODAY)).toBe(true)
    expect(shouldRunReminders('2026-08-31', TODAY)).toBe(true)
  })

  it('kjører ikke to ganger samme dag', () => {
    expect(shouldRunReminders(TODAY, TODAY)).toBe(false)
  })
})
