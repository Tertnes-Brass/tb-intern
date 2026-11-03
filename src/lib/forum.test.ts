import { describe, expect, it } from 'vitest'
import { followsForumTopic, forumNotifyPlan, type ForumNotifyCandidate } from './forum'
import { forumPlainText } from './forum-mentions'
import { forumDirectReplyPushMessage, forumMentionPushMessage, forumReplyPushMessage } from './push'

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
    expect(plan).toEqual({ mention: [], direct: [], reply: ['ok', 'follower'] })
  })
  it('gives a mentioned member one mention push, even when muted or behind, unless mentions are off', () => {
    const plan = forumNotifyPlan({ authorId: 'me', mentioned: ['behind', 'quiet', 'me', 'gone', 'behind'], candidates: [
      c('behind', { caughtUp: false, explicit: false }), c('quiet', { mentions: 'off' }), c('me'),
    ] })
    expect(plan).toEqual({ mention: ['behind'], direct: [], reply: ['quiet'] })
  })
  it('pushes the person replied to like a mention: past muting and unread replies, but not twice and not to yourself', () => {
    const candidates = [c('muted', { explicit: false, caughtUp: false }), c('other'), c('me')]
    expect(forumNotifyPlan({ authorId: 'me', mentioned: [], repliedTo: 'muted', candidates }))
      .toEqual({ mention: [], direct: ['muted'], reply: ['other'] })
    expect(forumNotifyPlan({ authorId: 'me', mentioned: ['muted'], repliedTo: 'muted', candidates }))
      .toEqual({ mention: ['muted'], direct: [], reply: ['other'] })
    expect(forumNotifyPlan({ authorId: 'me', mentioned: [], repliedTo: 'me', candidates }).direct).toEqual([])
    expect(forumNotifyPlan({ authorId: 'me', mentioned: [], repliedTo: 'gone', candidates }).direct).toEqual([])
    expect(forumNotifyPlan({ authorId: 'me', mentioned: [], repliedTo: 'other', candidates: [c('other', { isActive: false })] }).direct).toEqual([])
  })
  it('falls back to the ordinary thread push when the person replied to has turned mentions off', () => {
    const plan = forumNotifyPlan({ authorId: 'me', mentioned: [], repliedTo: 'quiet', candidates: [c('quiet', { mentions: 'off' })] })
    expect(plan).toEqual({ mention: [], direct: [], reply: ['quiet'] })
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
  it('links straight to the reply when there is one', () => {
    expect(forumReplyPushMessage({ topicId: 't', replyId: 'r 1', topicTitle: 'Fest', authorName: 'Kim', excerpt: 'Ja' }).url).toBe('/forum/t?svar=r%201')
    expect(forumDirectReplyPushMessage({ topicId: 't', replyId: 'r1', topicTitle: 'Fest', authorName: 'Kim', excerpt: 'Ja' }))
      .toEqual({ title: 'Kim svarte deg i «Fest»', body: 'Ja', url: '/forum/t?svar=r1', tag: 'forum-reply-to:t' })
  })
})
