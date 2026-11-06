import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/d1'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ me: null as null | { id: string; name?: string; permissions: string[] }, db: null as any, pushes: [] as Array<{ to: string[]; title: string; url: string }> }))
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({ validator(schema: any) { return { handler: (fn: any) => async (arg: any) => fn({ data: schema.parse(arg.data) }) } } }) }))
vi.mock('../db', () => ({ db: () => state.db }))
vi.mock('./push-send', () => ({
  sendPushToUsers: async (to: string[], message: { title: string; url: string }) => {
    state.pushes.push({ to: [...to].sort(), title: message.title, url: message.url })
    return { sent: to.length, failed: 0, removed: 0 }
  },
}))
vi.mock('./access', () => ({
  requireMe: async () => { if (!state.me) throw new Error('Login'); return state.me },
  requirePermission: async (permission: string) => {
    if (!state.me || !state.me.permissions.some((p) => p === '*' || p === permission)) throw new Error('Forbidden')
    return state.me
  },
}))
import { createForumTopic, editForumText, getForumTopic, listForum, markForumRepliesRead, replyToForum, searchForum, searchForumMentions, setForumFollow, setForumLock } from './forum'

let sqlite: DatabaseSync
beforeEach(() => {
  sqlite?.close()
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE user (id text primary key, name text);
    CREATE TABLE member_profiles (auth_user_id text primary key, is_active integer);
    CREATE TABLE roles (id text primary key);
    CREATE TABLE role_permissions (role_id text references roles(id), permission text, primary key(role_id, permission));
    CREATE TABLE notification_preferences (user_id text primary key references user(id) on delete cascade,
      mentions text not null default 'all', rsvp_reminders text not null default 'all');
    INSERT INTO user VALUES ('one', 'Ingrid'), ('two', 'Jonas'), ('three', 'Karim');
    INSERT INTO member_profiles VALUES ('one', 1), ('two', 1), ('three', 1);`)
  sqlite.exec(readFileSync(new URL('../../migrations/0016_diskusjonsforum.sql', import.meta.url), 'utf8'))
  sqlite.exec(readFileSync(new URL('../../migrations/0017_forum-ulest.sql', import.meta.url), 'utf8'))
  sqlite.exec(readFileSync(new URL('../../migrations/0027_forum-varsler.sql', import.meta.url), 'utf8'))
  // 0029 legger også til kolonner i veggens kommentarer; tabellen må bare finnes.
  sqlite.exec('CREATE TABLE post_comments (id text primary key, post_id text, author_id text, body text, created_at integer, updated_at integer)')
  sqlite.exec(readFileSync(new URL('../../migrations/0029_svar-pa-svar.sql', import.meta.url), 'utf8'))
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
  state.me = { id: 'one', name: 'Ingrid', permissions: [] }
  state.pushes = []
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
      expect(await replyToForum({ data: { topicId: id, body: `Svar ${n}` } })).toEqual({ id: expect.any(String), page: 0 })
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

describe('forum push', () => {
  // Hvert kall får sitt eget millisekund, som i virkeligheten.
  let tick = 1800000000000
  beforeEach(() => { vi.spyOn(Date, 'now').mockImplementation(() => ++tick) })
  afterEach(() => { vi.restoreAllMocks() })
  const as = (id: 'one' | 'two' | 'three') => { state.me = { id, name: { one: 'Ingrid', two: 'Jonas', three: 'Karim' }[id], permissions: [] } }
  const readAll = async (id: string) => {
    const detail = await getForumTopic({ data: { id, page: 0 } })
    const ids = detail.replies.flatMap((r) => [r, ...r.children]).filter((r) => r.unread).map((r) => r.reply.id)
    if (ids.length) await markForumRepliesRead({ data: { topicId: id, replyIds: ids } })
  }

  it('notifies the starter and earlier repliers, never the author, and once until they have read', async () => {
    const { id } = await topic()
    as('two'); await replyToForum({ data: { topicId: id, body: 'Jeg blir med' } })
    expect(state.pushes).toEqual([{ to: ['one'], title: 'Jonas svarte i «Hvem blir med på fest?»', url: expect.stringMatching(new RegExp(`^/forum/${id}\\?svar=`)) }])
    as('three'); await replyToForum({ data: { topicId: id, body: 'Jeg også' } })
    // Ingrid har ikke lest Jonas sitt svar ennå → ingen ny ping. Jonas har ikke uleste fra før.
    expect(state.pushes[1].to).toEqual(['two'])
    as('one'); await readAll(id)
    as('two'); await replyToForum({ data: { topicId: id, body: 'Tar med kake' } })
    // Karim har ingen uleste fra andre etter sitt eget svar → får varsel.
    expect(state.pushes[2].to).toEqual(['one', 'three'])
  })

  it('respects muting, explicit following and the profile switch', async () => {
    const { id } = await topic()
    as('two'); await setForumFollow({ data: { topicId: id, following: true } })
    expect((await getForumTopic({ data: { id, page: 0 } })).following).toBe(true)
    as('three'); await replyToForum({ data: { topicId: id, body: 'Hei' } })
    expect(state.pushes[0].to).toEqual(['one', 'two'])
    as('one'); await readAll(id); await setForumFollow({ data: { topicId: id, following: false } })
    expect((await getForumTopic({ data: { id, page: 0 } })).following).toBe(false)
    as('two'); await readAll(id)
    sqlite.exec("INSERT INTO notification_preferences (user_id, forum_replies) VALUES ('three', 'off')")
    as('two'); await replyToForum({ data: { topicId: id, body: 'Svar' } })
    expect(state.pushes).toHaveLength(1)
    // Å svare igjen opphever ikke en bevisst demping.
    as('one'); await replyToForum({ data: { topicId: id, body: 'Mitt svar' } })
    as('three'); sqlite.exec("UPDATE notification_preferences SET forum_replies = 'all' WHERE user_id = 'three'")
    await readAll(id); await replyToForum({ data: { topicId: id, body: 'Enda et' } })
    expect(state.pushes.at(-1)!.to).toEqual(['two'])
  })

  it('does not let old unread replies from before you joined hold notifications back', async () => {
    const { id } = await topic()
    as('two'); await replyToForum({ data: { topicId: id, body: 'Gammelt svar Karim aldri leste' } })
    as('three'); await replyToForum({ data: { topicId: id, body: 'Karim blander seg inn' } })
    as('one'); await readAll(id)
    as('two'); await readAll(id)
    state.pushes = []
    as('one'); await replyToForum({ data: { topicId: id, body: 'Nytt' } })
    expect(state.pushes[0].to).toEqual(['three', 'two'])
  })

  it('pushes mentions once, instead of the reply push, and never for everyone', async () => {
    const { id } = await topic()
    as('two'); await replyToForum({ data: { topicId: id, body: '@[u:one] @[u:three] kommer dere?' } })
    expect(state.pushes).toEqual([{ to: ['one', 'three'], title: 'Jonas nevnte deg i forumet', url: expect.stringMatching(new RegExp(`^/forum/${id}\\?svar=`)) }])
    state.pushes = []
    as('three'); await replyToForum({ data: { topicId: id, body: '@[all] fest!' } })
    // Ingrid har uleste og er ikke omtalt med navn; Jonas er oppdatert.
    expect(state.pushes).toEqual([expect.objectContaining({ to: ['two'], title: expect.stringContaining('svarte i') })])
    state.pushes = []
    sqlite.exec("INSERT INTO notification_preferences (user_id, mentions) VALUES ('one', 'off')")
    as('two'); await createForumTopic({ data: { title: 'Ny', body: '@[u:one] @[u:two] @[u:three]' } })
    expect(state.pushes).toEqual([expect.objectContaining({ to: ['three'] })])
  })

  it('pushes only mentions added by an edit', async () => {
    const { id } = await createForumTopic({ data: { title: 'Fest', body: '@[u:two] hei' } })
    state.pushes = []
    await editForumText({ data: { id, kind: 'topic', body: '@[u:two] hei @[u:three]' } })
    expect(state.pushes).toEqual([expect.objectContaining({ to: ['three'] })])
    state.pushes = []
    await editForumText({ data: { id, kind: 'topic', body: '@[u:two] hei @[u:three]!' } })
    expect(state.pushes).toEqual([])
  })

  it('requires a login and an existing thread to follow', async () => {
    await expect(setForumFollow({ data: { topicId: 'missing', following: true } })).rejects.toThrow('Emnet finnes ikke.')
    state.me = null
    await expect(setForumFollow({ data: { topicId: 'x', following: true } })).rejects.toThrow('Login')
  })
})

describe('replies to replies', () => {
  let tick = 1800000000000
  beforeEach(() => { vi.spyOn(Date, 'now').mockImplementation(() => ++tick) })
  afterEach(() => { vi.restoreAllMocks() })
  const as = (id: 'one' | 'two' | 'three') => { state.me = { id, name: { one: 'Ingrid', two: 'Jonas', three: 'Karim' }[id], permissions: [] } }
  const row = (id: string) => sqlite.prepare('SELECT parent_id, reply_to_id FROM forum_replies WHERE id = ?').get(id)

  it('keeps every reply one level deep under the reply it started from, and remembers who it answered', async () => {
    const { id } = await topic()
    as('two'); const root = await replyToForum({ data: { topicId: id, body: 'Jeg blir med' } })
    as('three'); const child = await replyToForum({ data: { topicId: id, body: 'Jeg òg', replyToId: root.id } })
    as('one'); const grandchild = await replyToForum({ data: { topicId: id, body: 'Flott, Karim!', replyToId: child.id } })
    expect(row(root.id)).toEqual({ parent_id: null, reply_to_id: null })
    expect(row(child.id)).toEqual({ parent_id: root.id, reply_to_id: root.id })
    // Svar på et svar havner under SAMME rot, ikke dypere.
    expect(row(grandchild.id)).toEqual({ parent_id: root.id, reply_to_id: child.id })
    const detail = await getForumTopic({ data: { id, page: 0 } })
    expect(detail.replies).toHaveLength(1)
    expect(detail.replies[0].children.map((c) => [c.reply.body, c.author])).toEqual([['Jeg òg', 'Karim'], ['Flott, Karim!', 'Ingrid']])
    expect(detail.replies[0].children[0].canEdit).toBe(false)
    expect(detail.replies[0].children[1].canEdit).toBe(true)
  })

  it('never lets a raw call pick the placement or reach into another thread', async () => {
    const { id } = await topic()
    const other = await createForumTopic({ data: { title: 'Annen tråd', body: 'Hei' } })
    const foreign = await replyToForum({ data: { topicId: other.id, body: 'Der borte' } })
    await expect(replyToForum({ data: { topicId: id, body: 'Hit', replyToId: foreign.id } })).rejects.toThrow('finnes ikke i denne tråden')
    await expect(replyToForum({ data: { topicId: id, body: 'Hit', replyToId: 'missing' } })).rejects.toThrow('finnes ikke i denne tråden')
    // Et ukjent felt som `parentId` strippes av valideringen og kan ikke brukes.
    const own = await replyToForum({ data: { topicId: id, body: 'Rot', parentId: foreign.id } as never })
    expect(row(own.id)).toEqual({ parent_id: null, reply_to_id: null })
    expect((await getForumTopic({ data: { id: other.id, page: 0 } })).replies[0].children).toEqual([])
  })

  it('respects the lock for replies to replies too', async () => {
    const { id } = await topic()
    const root = await replyToForum({ data: { topicId: id, body: 'Rot' } })
    state.me!.permissions = ['forum.moderate']
    await setForumLock({ data: { id, locked: true } })
    state.me!.permissions = []
    await expect(replyToForum({ data: { topicId: id, body: 'Svar', replyToId: root.id } })).rejects.toThrow('låst')
  })

  it('pages by replies to the thread, keeps sub-replies with their root, and finds the page of a linked reply', async () => {
    const { id } = await topic()
    const first = await replyToForum({ data: { topicId: id, body: 'Eldste rot' } })
    for (let n = 0; n < 30; n++) await replyToForum({ data: { topicId: id, body: `Rot ${n}` } })
    const late = await replyToForum({ data: { topicId: id, body: 'Sent svar på eldste', replyToId: first.id } })
    // 31 røtter (svaret teller ikke): den eldste står alene på side 1, med svaret sitt.
    expect(late.page).toBe(1)
    const pageZero = await getForumTopic({ data: { id, page: 0 } })
    expect(pageZero.replies).toHaveLength(30)
    expect(pageZero.hasMore).toBe(true)
    expect(pageZero.focus).toBeNull()
    const linked = await getForumTopic({ data: { id, page: 0, svar: late.id } })
    expect(linked.page).toBe(1)
    expect(linked.focus).toBe(late.id)
    expect(linked.replies.map((r) => r.reply.id)).toEqual([first.id])
    expect(linked.replies[0].children.map((c) => c.reply.id)).toEqual([late.id])
    // En gammel eller fremmed lenke ignoreres stille.
    const stale = await getForumTopic({ data: { id, page: 0, svar: 'missing' } })
    expect([stale.page, stale.focus, stale.replies.length]).toEqual([0, null, 30])
    expect((await listForum({ data: { page: 0 } })).topics[0].replyCount).toBe(32)
  })

  it('counts and clears unread sub-replies like any other reply', async () => {
    const { id } = await topic()
    as('two'); const root = await replyToForum({ data: { topicId: id, body: 'Rot' } })
    as('three'); const child = await replyToForum({ data: { topicId: id, body: '@[u:one] svar', replyToId: root.id } })
    as('one')
    expect((await listForum({ data: { page: 0 } })).topics[0]).toMatchObject({ unreadCount: 2, unreadMentionCount: 1 })
    const detail = await getForumTopic({ data: { id, page: 0 } })
    expect(detail.replies[0].children[0].unread).toBe(1)
    expect(detail.mentions).toEqual([{ id: 'one', name: 'Ingrid' }])
    await markForumRepliesRead({ data: { topicId: id, replyIds: [child.id] } })
    expect((await listForum({ data: { page: 0 } })).topics[0]).toMatchObject({ unreadCount: 1, unreadMentionCount: 0 })
  })

  it('pushes the person replied to directly — even when behind or muted — and links to the reply', async () => {
    const { id } = await topic()
    as('two'); const root = await replyToForum({ data: { topicId: id, body: 'Jeg blir med' } })
    as('three'); await replyToForum({ data: { topicId: id, body: 'Et svar på tråden' } })
    as('two'); await setForumFollow({ data: { topicId: id, following: false } })
    state.pushes = []
    // Jonas har uleste svar og har dempet tråden, men svaret er rettet til ham.
    as('one'); const answer = await replyToForum({ data: { topicId: id, body: 'Så bra, Jonas!', replyToId: root.id } })
    expect(state.pushes).toEqual([
      { to: ['two'], title: 'Ingrid svarte deg i «Hvem blir med på fest?»', url: `/forum/${id}?svar=${answer.id}` },
      // Karim følger fortsatt tråden og har ingen uleste fra andre etter sitt eget svar.
      { to: ['three'], title: 'Ingrid svarte i «Hvem blir med på fest?»', url: `/forum/${id}?svar=${answer.id}` },
    ])
  })

  it('lets a mention win over the direct reply push, falls back to the thread push when mentions are off, and never pings yourself', async () => {
    const { id } = await topic()
    as('two'); const root = await replyToForum({ data: { topicId: id, body: 'Rot' } })
    state.pushes = []
    as('one'); await replyToForum({ data: { topicId: id, body: '@[u:two] ja!', replyToId: root.id } })
    expect(state.pushes).toEqual([expect.objectContaining({ to: ['two'], title: 'Ingrid nevnte deg i forumet' })])
    state.pushes = []
    as('two'); await replyToForum({ data: { topicId: id, body: 'Svarer meg selv', replyToId: root.id } })
    expect(state.pushes.some((p) => p.title.includes('svarte deg'))).toBe(false)
    state.pushes = []
    sqlite.exec("INSERT INTO notification_preferences (user_id, mentions) VALUES ('two', 'off')")
    as('one'); await replyToForum({ data: { topicId: id, body: 'Ok', replyToId: root.id } })
    expect(state.pushes).toEqual([expect.objectContaining({ to: ['two'], title: expect.stringContaining('svarte i') })])
  })

  it('does not push the person replied to again when the reply is edited', async () => {
    const { id } = await topic()
    as('two'); const root = await replyToForum({ data: { topicId: id, body: 'Rot' } })
    as('one'); const answer = await replyToForum({ data: { topicId: id, body: 'Svar', replyToId: root.id } })
    state.pushes = []
    await editForumText({ data: { id: answer.id, kind: 'reply', body: 'Svar, rettet' } })
    expect(state.pushes).toEqual([])
    await editForumText({ data: { id: answer.id, kind: 'reply', body: 'Svar, rettet @[u:three]' } })
    expect(state.pushes).toEqual([{ to: ['three'], title: 'Ingrid nevnte deg i forumet', url: `/forum/${id}?svar=${answer.id}` }])
  })
})

describe('forum search and sorting', () => {
  let tick = 1800000000000
  beforeEach(() => { vi.spyOn(Date, 'now').mockImplementation(() => ++tick) })
  afterEach(() => { vi.restoreAllMocks() })
  const as = (id: 'one' | 'two' | 'three') => { state.me = { id, name: { one: 'Ingrid', two: 'Jonas', three: 'Karim' }[id], permissions: [] } }

  it('finds threads by title, opening post and replies, and links a reply hit to the reply', async () => {
    const party = await createForumTopic({ data: { title: 'Sommerfest', body: 'Vi griller i parken.' } })
    as('two')
    const keys = await createForumTopic({ data: { title: 'Hvem har nøkkelen?', body: 'Til lageret.' } })
    as('three')
    const answer = await replyToForum({ data: { topicId: keys.id, body: 'Den henger i slagverkskassa.' } })

    const byTitle = await searchForum({ data: { q: 'sommer' } })
    expect(byTitle.topics.map((t) => t.id)).toEqual([party.id])
    expect(byTitle.topics[0].hit).toBeNull()

    const byBody = await searchForum({ data: { q: 'griller' } })
    expect(byBody.topics[0].hit).toMatchObject({ kind: 'body', snippet: 'Vi griller i parken.' })

    const byReply = await searchForum({ data: { q: 'slagverkskassa' } })
    expect(byReply.topics.map((t) => t.id)).toEqual([keys.id])
    expect(byReply.topics[0].hit).toEqual({ kind: 'comment', author: 'Karim', snippet: 'Den henger i slagverkskassa.', commentId: answer.id })
    // Samme tall som lista: Karim har svart, Ingrid har ikke lest det.
    as('one')
    expect((await searchForum({ data: { q: 'nøkkelen' } })).topics[0]).toMatchObject({ replyCount: 1, unreadCount: 1 })
  })

  it('searches mentions by the current name, never by the marker', async () => {
    const { id } = await createForumTopic({ data: { title: 'Notestativ', body: 'Spør @[u:two] om stativene.' } })
    expect((await searchForum({ data: { q: 'jonas' } })).topics.map((t) => t.id)).toEqual([id])
    expect((await searchForum({ data: { q: 'u:two' } })).topics).toEqual([])
  })

  it('requires a login and at least two characters', async () => {
    await expect(searchForum({ data: { q: 'a' } })).rejects.toThrow()
    state.me = null
    await expect(searchForum({ data: { q: 'fest' } })).rejects.toThrow('Login')
  })

  it('sorts the list by activity, new threads or most replies', async () => {
    const quiet = await createForumTopic({ data: { title: 'Stille tråd', body: 'Ingen svarer.' } })
    const busy = await createForumTopic({ data: { title: 'Livlig tråd', body: 'Mange svar.' } })
    const newest = await createForumTopic({ data: { title: 'Ny tråd', body: 'Helt ny.' } })
    as('two')
    await replyToForum({ data: { topicId: busy.id, body: 'En' } })
    await replyToForum({ data: { topicId: busy.id, body: 'To' } })
    await replyToForum({ data: { topicId: quiet.id, body: 'Likevel et svar' } })
    const order = async (sort?: 'aktivitet' | 'nye' | 'aktive' | 'treff') => (await listForum({ data: { page: 0, sort } })).topics.map((t) => t.id)
    expect(await order()).toEqual([quiet.id, busy.id, newest.id])
    expect(await order('treff')).toEqual(await order())
    expect(await order('nye')).toEqual([newest.id, busy.id, quiet.id])
    expect(await order('aktive')).toEqual([busy.id, quiet.id, newest.id])
    // Søketreffene sorteres med samme regel.
    expect((await searchForum({ data: { q: 'tråd', sort: 'aktive' } })).topics.map((t) => t.id)).toEqual([busy.id, quiet.id, newest.id])
  })
})
