import { describe, expect, it } from 'vitest'
import { followsForumTopic, forumNotifyPlan, type ForumNotifyCandidate } from './forum'
import { forumPlainText } from './forum-mentions'
import { forumMentionPushMessage, forumReplyPushMessage } from './push'

const base: Omit<ForumNotifyCandidate, 'userId'> = {
  isActive: true, participated: true, explicit: null, caughtUp: true, forumReplies: 'all', mentions: 'all',
}
const c = (userId: string, over: Partial<ForumNotifyCandidate> = {}): ForumNotifyCandidate => ({ ...base, userId, ...over })

describe('followsForumTopic', () => {
  it('lets an explicit choice win over taking part', () => {
    expect(followsForumTopic({ explicit: null, participated: true })).toBe(true)
    expect(followsForumTopic({ explicit: null, participated: false })).toBe(false)
    expect(followsForumTopic({ explicit: false, participated: true })).toBe(false)
    expect(followsForumTopic({ explicit: true, participated: false })).toBe(true)
  })
})

describe('forumNotifyPlan', () => {
  it('sends followers a reply push, skipping the author, the inactive, the muted, the switched-off and those behind', () => {
    const plan = forumNotifyPlan({ authorId: 'me', mentioned: [], candidates: [
      c('me'), c('ok'), c('inactive', { isActive: false }), c('muted', { explicit: false }), c('off', { forumReplies: 'off' }),
      c('behind', { caughtUp: false }), c('outsider', { participated: false }), c('follower', { participated: false, explicit: true }),
    ] })
    expect(plan).toEqual({ mention: [], reply: ['ok', 'follower'] })
  })
  it('gives a mentioned member one mention push, even when muted or behind, unless mentions are off', () => {
    const plan = forumNotifyPlan({ authorId: 'me', mentioned: ['behind', 'quiet', 'me', 'gone', 'behind'], candidates: [
      c('behind', { caughtUp: false, explicit: false }), c('quiet', { mentions: 'off' }), c('me'),
    ] })
    expect(plan).toEqual({ mention: ['behind'], reply: ['quiet'] })
  })
})

describe('forum push text', () => {
  it('shows names instead of markers and links to the thread', () => {
    const excerpt = forumPlainText('@[u:a] og @[all]: øvelse?', [{ id: 'a', name: 'Åslaug' }])
    expect(excerpt).toBe('@Åslaug og @Alle i korpset: øvelse?')
    expect(forumReplyPushMessage({ topicId: 't', topicTitle: 'Tilbakemeldinger', authorName: 'Kim', excerpt }))
      .toEqual({ title: 'Kim svarte i «Tilbakemeldinger»', body: excerpt, url: '/forum/t', tag: 'forum:t' })
    expect(forumMentionPushMessage({ topicId: 't', authorName: 'Kim', excerpt }).title).toBe('Kim nevnte deg i forumet')
  })
})
