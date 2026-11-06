import { describe, expect, it } from 'vitest'
import { effectiveForumSort, forumSortOptions, sortForumTopics } from './forum-search'

describe('forum-sortering', () => {
  const t = (id: string, activityAt: number, createdAt: number, replyCount: number) => ({ id, activityAt, createdAt, replyCount })
  const topics = [t('a', 30, 1, 0), t('b', 10, 3, 5), t('c', 20, 2, 5)]
  const ids = (list: Array<{ id: string }>) => list.map((x) => x.id)

  it('siste aktivitet, nye tråder og flest svar', () => {
    expect(ids(sortForumTopics(topics, 'aktivitet'))).toEqual(['a', 'c', 'b'])
    expect(ids(sortForumTopics(topics, 'nye'))).toEqual(['b', 'c', 'a'])
    // Like mange svar: siste aktivitet avgjør.
    expect(ids(sortForumTopics(topics, 'aktive'))).toEqual(['c', 'b', 'a'])
  })

  it('«Beste treff» beholder rekkefølgen, og lista sorteres som kopi', () => {
    expect(ids(sortForumTopics(topics, 'treff'))).toEqual(['a', 'b', 'c'])
    sortForumTopics(topics, 'nye')
    expect(ids(topics)).toEqual(['a', 'b', 'c'])
  })

  it('lik aktivitet faller tilbake på id, som i SQL-en (desc)', () => {
    expect(ids(sortForumTopics([t('x', 5, 1, 0), t('y', 5, 1, 0)], 'aktivitet'))).toEqual(['y', 'x'])
  })

  it('standarden er siste aktivitet, og «Beste treff» bare under søk', () => {
    expect(effectiveForumSort(undefined, false)).toBe('aktivitet')
    expect(effectiveForumSort(undefined, true)).toBe('treff')
    expect(effectiveForumSort('treff', false)).toBe('aktivitet')
    expect(effectiveForumSort('aktive', true)).toBe('aktive')
    expect(forumSortOptions(false).map((o) => o.value)).toEqual(['aktivitet', 'nye', 'aktive'])
    expect(forumSortOptions(true)[0].value).toBe('treff')
  })
})
