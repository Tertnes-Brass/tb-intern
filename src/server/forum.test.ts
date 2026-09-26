import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/d1'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ me: null as null | { id: string; permissions: string[] }, db: null as any }))
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({ validator(schema: any) { return { handler: (fn: any) => async (arg: any) => fn({ data: schema.parse(arg.data) }) } } }) }))
vi.mock('../db', () => ({ db: () => state.db }))
vi.mock('./access', () => ({
  requireMe: async () => { if (!state.me) throw new Error('Login'); return state.me },
  requirePermission: async (permission: string) => {
    if (!state.me || !state.me.permissions.some((p) => p === '*' || p === permission)) throw new Error('Forbidden')
    return state.me
  },
}))
import { createForumTopic, editForumText, getForumTopic, listForum, markForumRepliesRead, replyToForum, searchForumMentions, setForumLock } from './forum'

let sqlite: DatabaseSync
beforeEach(() => {
  sqlite?.close()
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE user (id text primary key, name text);
    CREATE TABLE member_profiles (auth_user_id text primary key, is_active integer);
    CREATE TABLE roles (id text primary key);
    CREATE TABLE role_permissions (role_id text references roles(id), permission text, primary key(role_id, permission));
    INSERT INTO user VALUES ('one', 'Ingrid'), ('two', 'Jonas');
    INSERT INTO member_profiles VALUES ('one', 1), ('two', 1);`)
  sqlite.exec(readFileSync(new URL('../../migrations/0016_diskusjonsforum.sql', import.meta.url), 'utf8'))
  sqlite.exec(readFileSync(new URL('../../migrations/0017_forum-ulest.sql', import.meta.url), 'utf8'))
  // Exercise real Drizzle D1 queries against SQLite, including conditional writes.
  const prepare = (query: string) => {
    let values: any[] = []
    const statement = {
      bind(...args: any[]) { values = args; return statement },
      async all() { return { results: sqlite.prepare(query).all(...values) } },
      async raw() { const s = sqlite.prepare(query); s.setReturnArrays(true); return s.all(...values) },
      async run() { return { meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } } },
    }
    return statement
  }
  state.db = drizzle({ prepare } as any)
  state.me = { id: 'one', permissions: [] }
})
const topic = () => createForumTopic({ data: { title: 'Hvem blir med på fest?', body: 'På lørdag?' } })

describe('forum access and persistence', () => {
  it('lets any member create a thread and another member reply', async () => {
    const { id } = await topic()
    state.me = { id: 'two', permissions: [] }
    await replyToForum({ data: { topicId: id, body: 'Jeg blir med!' } })
    const detail = await getForumTopic({ data: { id, page: 0 } })
    expect(detail.topic.title).toBe('Hvem blir med på fest?')
    expect(detail.canEdit).toBe(false)
    expect(detail.replies[0].author).toBe('Jonas')
    expect(detail.replies[0].canEdit).toBe(true)
    expect((await listForum({ data: { page: 0 } })).topics[0].replyCount).toBe(1)
  })
  it('rejects unauthenticated reads and writes', async () => {
    state.me = null
    await expect(topic()).rejects.toThrow('Login')
    await expect(listForum({ data: { page: 0 } })).rejects.toThrow('Login')
    await expect(getForumTopic({ data: { id: 'hidden', page: 0 } })).rejects.toThrow('Login')
  })
  it('prevents editing another member’s text and locking without permission', async () => {
    const { id } = await topic()
    await replyToForum({ data: { topicId: id, body: 'Et svar' } })
    const reply = (await getForumTopic({ data: { id, page: 0 } })).replies[0].reply
    state.me = { id: 'two', permissions: [] }
    for (const [kind, target] of [['topic', id], ['reply', reply.id]] as const) {
      await expect(editForumText({ data: { id: target, kind, body: 'Overtatt' } })).rejects.toThrow()
    }
    await expect(setForumLock({ data: { id, locked: true } })).rejects.toThrow('Forbidden')
  })
  it('enforces locks on replies and owner edits, while moderators can edit and reopen', async () => {
    const { id } = await topic()
    state.me!.permissions = ['forum.moderate']
    await setForumLock({ data: { id, locked: true } })
    state.me!.permissions = []
    await expect(replyToForum({ data: { topicId: id, body: 'Svar' } })).rejects.toThrow()
    await expect(editForumText({ data: { id, kind: 'topic', body: 'Endret' } })).rejects.toThrow()
    state.me = { id: 'two', permissions: ['forum.moderate'] }
    await editForumText({ data: { id, kind: 'topic', body: 'Moderert' } })
    await setForumLock({ data: { id, locked: false } })
    await replyToForum({ data: { topicId: id, body: 'Nå åpen' } })
    expect((await getForumTopic({ data: { id, page: 0 } })).topic.body).toBe('Moderert')
  })
  it('rejects blank text and replies to missing threads', async () => {
    await expect(createForumTopic({ data: { title: ' ', body: ' ' } })).rejects.toThrow()
    await expect(replyToForum({ data: { topicId: 'missing', body: 'Hei' } })).rejects.toThrow()
  })
  it('paginates replies and preserves discussions when an account is deleted', async () => {
    const { id } = await topic()
    for (let n = 0; n < 31; n++) await replyToForum({ data: { topicId: id, body: `Svar ${n}` } })
    expect((await getForumTopic({ data: { id, page: 0 } })).replies).toHaveLength(30)
    expect((await getForumTopic({ data: { id, page: 1 } })).replies).toHaveLength(1)
    sqlite.exec("DELETE FROM user WHERE id = 'one'")
    state.me = { id: 'two', permissions: [] }
    const detail = await getForumTopic({ data: { id, page: 0 } })
    expect(detail.author).toBeNull()
    expect(detail.replies[0].author).toBeNull()
    expect(detail.canEdit).toBe(false)
  })
})

describe('unread forum replies', () => {
  it('counts other members replies, keeps GET read-only and stores receipts per member', async () => {
    const { id } = await topic()
    await replyToForum({ data: { topicId: id, body: 'Eget svar' } })
    expect((await listForum({ data: { page: 0 } })).topics[0].unreadCount).toBe(0)
    state.me = { id: 'two', permissions: [] }
    const detail = await getForumTopic({ data: { id, page: 0 } })
    expect(detail.replies[0].unread).toBe(1)
    expect((await listForum({ data: { page: 0 } })).topics[0].unreadCount).toBe(1)
    const receipt = { topicId: id, replyIds: [detail.replies[0].reply.id] }
    await markForumRepliesRead({ data: receipt })
    await markForumRepliesRead({ data: receipt })
    expect((await listForum({ data: { page: 0 } })).topics[0].unreadCount).toBe(0)
    state.me = { id: 'one', permissions: [] }
    await replyToForum({ data: { topicId: id, body: 'Nytt svar etter lesing' } })
    state.me = { id: 'two', permissions: [] }
    expect((await listForum({ data: { page: 0 } })).topics[0].unreadCount).toBe(1)
  })
  it('never clears another page or a reply arriving after the page was loaded', async () => {
    const { id } = await topic()
    for (let n = 0; n < 31; n++) await replyToForum({ data: { topicId: id, body: `Svar ${n}` } })
    state.me = { id: 'two', permissions: [] }
    const first = await getForumTopic({ data: { id, page: 0 } })
    await markForumRepliesRead({ data: { topicId: id, replyIds: first.replies.map((r) => r.reply.id) } })
    expect((await listForum({ data: { page: 0 } })).topics[0].unreadCount).toBe(1)
    const second = await getForumTopic({ data: { id, page: 1 } })
    expect(second.replies[0].unread).toBe(1)
    await markForumRepliesRead({ data: { topicId: 'wrong-topic', replyIds: [second.replies[0].reply.id] } })
    expect((await listForum({ data: { page: 0 } })).topics[0].unreadCount).toBe(1)
    state.me = null
    await expect(markForumRepliesRead({ data: { topicId: id, replyIds: [second.replies[0].reply.id] } })).rejects.toThrow('Login')
  })
})

describe('forum mentions', () => {
  it('offers active members and everyone without exposing email addresses', async () => {
    expect(await searchForumMentions({ data: { query: 'alle' } })).toEqual([{ id: 'forum:all', name: 'Alle i korpset' }])
    expect(await searchForumMentions({ data: { query: 'jon' } })).toEqual([{ id: 'two', name: 'Jonas' }])
    sqlite.exec("UPDATE member_profiles SET is_active = 0 WHERE auth_user_id = 'two'")
    expect(await searchForumMentions({ data: { query: 'jon' } })).toEqual([])
  })
  it('validates mentions on creation, replies and edits, and resolves current names', async () => {
    const { id } = await createForumTopic({ data: { title: 'Fest', body: '@[all] @[u:two] blir dere med?' } })
    expect((await getForumTopic({ data: { id, page: 0 } })).mentions).toEqual([{ id: 'two', name: 'Jonas' }])
    sqlite.exec("UPDATE user SET name = 'Nytt navn' WHERE id = 'two'")
    expect((await getForumTopic({ data: { id, page: 0 } })).mentions[0].name).toBe('Nytt navn')
    sqlite.exec("UPDATE member_profiles SET is_active = 0 WHERE auth_user_id = 'two'")
    for (const marker of ['@[u:two]', '@[u:missing]']) {
      await expect(createForumTopic({ data: { title: 'Fest', body: marker } })).rejects.toThrow('En eller flere omtaler er ikke tilgjengelige i forumet.')
      await expect(replyToForum({ data: { topicId: id, body: marker } })).rejects.toThrow('En eller flere omtaler er ikke tilgjengelige i forumet.')
      await expect(editForumText({ data: { id, kind: 'topic', body: marker } })).rejects.toThrow('En eller flere omtaler er ikke tilgjengelige i forumet.')
    }
  })
})

it('highlights unread mentions of the member or everyone, but not other people', async () => {
  const { id } = await topic()
  await replyToForum({ data: { topicId: id, body: '@[u:two] Hei' } })
  await replyToForum({ data: { topicId: id, body: '@[all] Fest!' } })
  await replyToForum({ data: { topicId: id, body: '@[u:one] Meg selv' } })
  state.me = { id: 'two', permissions: [] }
  expect((await listForum({ data: { page: 0 } })).topics[0].unreadMentionCount).toBe(2)
  const detail = await getForumTopic({ data: { id, page: 0 } })
  await markForumRepliesRead({ data: { topicId: id, replyIds: detail.replies.map((r) => r.reply.id) } })
  expect((await listForum({ data: { page: 0 } })).topics[0].unreadMentionCount).toBe(0)
})

it('shows newest replies first across pages and returns to the first page after replying', async () => {
  const { id } = await topic()
  const clock = vi.spyOn(Date, 'now')
  try {
    for (let n = 0; n < 32; n++) {
      clock.mockReturnValue(1800000000000 + n)
      expect(await replyToForum({ data: { topicId: id, body: `Svar ${n}` } })).toEqual({ page: 0 })
    }
    const newest = await getForumTopic({ data: { id, page: 0 } })
    const older = await getForumTopic({ data: { id, page: 1 } })
    expect(newest.replies[0].reply.body).toBe('Svar 31')
    expect(newest.replies[29].reply.body).toBe('Svar 2')
    expect(older.replies.map((r) => r.reply.body)).toEqual(['Svar 1', 'Svar 0'])
    expect(newest.hasMore).toBe(true)
    expect(older.hasMore).toBe(false)
  } finally { clock.mockRestore() }
})
