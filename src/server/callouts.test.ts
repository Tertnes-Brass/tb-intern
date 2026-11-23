import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * «Kan du?» mot ekte SQLite med alle migrasjoner. Det som skal bevises: hvem
 * som får se hva, at et «Kan» ikke gir noter, og at et rått kall ikke kommer
 * forbi reglene.
 */

type TestMe = { id: string; name: string; permissions: string[]; effectivePartIds: string[]; parts: never[]; leadsPartIds: string[]; leadsLeafPartIds: string[]; roleName: string }
const state = vi.hoisted(() => ({ db: undefined as unknown, me: null as unknown, push: vi.fn() }))
vi.mock('../db', () => ({ db: () => state.db }))
vi.mock('cloudflare:workers', () => ({ env: { BETTER_AUTH_URL: 'https://intern.example.invalid' } }))
vi.mock('@tanstack/react-start', () => ({ createServerFn: () => ({
  handler: (fn: () => unknown) => fn,
  validator: (schema: { parse: (data: unknown) => unknown }) => ({ handler: (fn: (args: { data: unknown }) => unknown) =>
    async ({ data }: { data: unknown }) => fn({ data: schema.parse(data) }) }),
}) }))
vi.mock('./access', () => {
  const has = (me: TestMe | null, permission: string) => !!me && (me.permissions.includes('*') || me.permissions.includes(permission))
  return {
    requireMe: async () => state.me,
    currentUser: async () => state.me,
    requirePermission: async (permission: string) => {
      if (!has(state.me as TestMe, permission)) throw new Error('Ingen tilgang')
      return state.me
    },
    hasPermission: has,
    hasFullArchiveAccess: () => false,
    memberFileAccessContext: () => ({}),
  }
})
vi.mock('./email', () => ({ sendEmail: vi.fn(), postEmail: vi.fn(), mentionEmail: vi.fn(), postMentionEmail: vi.fn() }))
vi.mock('./push-send', () => ({ sendPushToUsers: state.push, unreadCountsFor: async () => new Map() }))

import { respondToCallout, setCalloutClosed } from './callouts'
import { dugnadEvents, unansweredCallouts } from './callout-store'
import { getCrewOptions, setProjectCrew } from './project-crew'
import { otherScreen } from './mobile-other-screens'
import { runMobileAction } from './mobile-actions'
import { createPost, deletePost, getPost, listPosts, publishPost, updatePost } from './posts'

const me = (id: string, permissions: string[] = []): TestMe => ({
  id, name: id, roleName: 'Musiker', permissions, effectivePartIds: ['cornet'], parts: [], leadsPartIds: [], leadsLeafPartIds: [],
})
const asMember = (id: string) => { state.me = me(id) }
const asBoard = () => { state.me = me('styret', ['posts.publish']) }
const asManager = () => { state.me = me('stab', ['projects.manage']) }

let sqlite: DatabaseSync
const FUTURE = '2099-12-12'

beforeEach(() => {
  state.push.mockReset()
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'))
  }
  sqlite.exec(`
    INSERT OR IGNORE INTO roles (id, name) VALUES ('member', 'Musiker');
    INSERT INTO user (id, name, email, created_at, updated_at) VALUES
      ('ola', 'Ola', 'ola@example.invalid', 1, 1), ('kari', 'Kari', 'kari@example.invalid', 1, 1),
      ('per', 'Per', 'per@example.invalid', 1, 1), ('borte', 'Borte', 'borte@example.invalid', 1, 1),
      ('styret', 'Styret', 'styret@example.invalid', 1, 1), ('stab', 'Stab', 'stab@example.invalid', 1, 1);
    INSERT INTO member_profiles (auth_user_id, role_id, is_active, created_at) VALUES
      ('ola', 'member', 1, 1), ('kari', 'member', 1, 1), ('per', 'member', 1, 1), ('borte', 'member', 0, 1),
      ('styret', 'member', 1, 1), ('stab', 'member', 1, 1);
    INSERT OR IGNORE INTO parts (id, name_no, name_en, section, sort_order) VALUES
      ('cornet', 'Kornett', 'Cornet', 'cornet', 1), ('bass', 'Bass', 'Bass', 'bass', 2);
    INSERT INTO user_parts (user_id, part_id) VALUES ('ola', 'cornet'), ('kari', 'bass'), ('per', 'cornet');
    INSERT INTO projects (id, name, kind, created_at, is_published, event_date, start_time, venue) VALUES
      ('gig', 'Julebord', 'spilleoppdrag', 1, 1, '${FUTURE}', '18:00', 'Scandic'),
      ('concert', 'Julekonsert', 'konsert', 1, 1, '${FUTURE}', NULL, NULL);
  `)
  state.db = drizzle(
    async (sql, params, method) => {
      const stmt = sqlite.prepare(sql)
      if (method === 'run') { stmt.run(...params as SQLInputValue[]); return { rows: [] } }
      ;(stmt as unknown as { setReturnArrays: (on: boolean) => void }).setReturnArrays(true)
      return { rows: stmt.all(...params as SQLInputValue[]) as unknown as unknown[][] }
    },
    async (queries) => {
      sqlite.exec('BEGIN')
      try {
        for (const q of queries) sqlite.prepare(q.sql).run(...q.params as SQLInputValue[])
        sqlite.exec('COMMIT')
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
      return queries.map(() => ({ rows: [] }))
    },
  )
})
afterEach(() => sqlite.close())

const post = { title: 'Dugnad', body: 'Vi rydder', format: 'plain_text', audience: 'all', importance: 'normal', official: false } as const
const dugnad = { kind: 'dugnad', eventDate: FUTURE, startTime: '11:00', location: 'Øvingslokalet', needed: 2 } as const

async function publishDugnad(extra: Record<string, unknown> = {}) {
  asBoard()
  const { id } = await createPost({ data: { ...post, callout: { ...dugnad, ...extra } } })
  await publishPost({ data: { id, sendEmail: false } })
  return id
}
async function publishGig() {
  asManager()
  const { id } = await createPost({ data: { ...post, title: 'Julebord', callout: { kind: 'spilleoppdrag', projectId: 'gig' } } })
  await publishPost({ data: { id, sendEmail: false } })
  return id
}
const answer = (postId: string, who: string, status: 'yes' | 'maybe' | 'no' | null, note?: string | null) => {
  asMember(who)
  return respondToCallout({ data: { postId, status, ...(note === undefined ? {} : { note }) } })
}
const detailFor = async (postId: string) => (await getPost({ data: { id: postId } })).callout!

describe('innsyn', () => {
  it('viser medlemmer bare hvem som kan, og sitt eget svar', async () => {
    const id = await publishDugnad()
    await answer(id, 'ola', 'yes', 'tar med kaffe')
    await answer(id, 'kari', 'no', 'er bortreist')
    await answer(id, 'per', 'maybe')

    asMember('per')
    const seen = await detailFor(id)
    expect(seen.yes.map((p) => p.name)).toEqual(['Ola'])
    expect(seen.manage).toBeNull()
    expect(seen.mine).toEqual({ status: 'maybe', note: null })
    // Ingenting om Kari, og ikke Olas merknad, i det som faktisk sendes.
    const wire = JSON.stringify(seen)
    expect(wire).not.toContain('Kari')
    expect(wire).not.toContain('bortreist')
    expect(wire).not.toContain('kaffe')
  })

  it('gir samme grense på veggen', async () => {
    const id = await publishDugnad()
    await answer(id, 'kari', 'no', 'er bortreist')
    asMember('per')
    const card = (await listPosts()).posts.find((p) => p.id === id)!
    expect(card.callout?.yesCount).toBe(0)
    expect(JSON.stringify(card.callout)).not.toContain('bortreist')
  })

  it('viser den ansvarlige alle svar, merknader og hvem som ikke har svart', async () => {
    const id = await publishDugnad()
    await answer(id, 'ola', 'yes', 'tar med kaffe')
    await answer(id, 'kari', 'no', 'er bortreist')
    asBoard()
    const { manage } = await detailFor(id)
    expect(manage!.yes.map((p) => p.note)).toEqual(['tar med kaffe'])
    expect(manage!.no.map((p) => p.name)).toEqual(['Kari'])
    expect(manage!.unanswered.map((p) => p.name)).toContain('Per')
  })

  it('teller ikke deaktiverte medlemmer', async () => {
    const id = await publishDugnad()
    await answer(id, 'borte', 'yes')
    asBoard()
    const detail = await detailFor(id)
    expect(detail.yesCount).toBe(0)
    expect(detail.manage!.unanswered.map((p) => p.name)).not.toContain('Borte')
  })

  it('skjuler prosjektlenken for den som ikke er med på oppdraget', async () => {
    const id = await publishGig()
    asMember('ola')
    expect((await detailFor(id)).projectId).toBeNull()
  })
})

describe('svar', () => {
  it('kan endres og trekkes', async () => {
    const id = await publishDugnad()
    await answer(id, 'ola', 'yes')
    await answer(id, 'ola', 'maybe')
    asMember('ola')
    expect((await detailFor(id)).mine?.status).toBe('maybe')
    await answer(id, 'ola', null)
    asMember('ola')
    expect((await detailFor(id)).mine).toBeNull()
  })

  it('beholder merknaden når bare svaret endres', async () => {
    const id = await publishDugnad()
    await answer(id, 'ola', 'yes', 'etter kl. 18')
    await answer(id, 'ola', 'maybe')
    asMember('ola')
    expect((await detailFor(id)).mine?.note).toBe('etter kl. 18')
  })

  it('kan ikke gis på et utkast', async () => {
    asBoard()
    const { id } = await createPost({ data: { ...post, callout: dugnad } })
    await expect(answer(id, 'ola', 'yes')).rejects.toThrow('Fant ikke beskjeden')
  })

  it('tillater bare «Kan ikke» etter at svarene er stengt', async () => {
    const id = await publishDugnad()
    await answer(id, 'ola', 'yes')
    asBoard()
    await setCalloutClosed({ data: { postId: id, closed: true } })
    await expect(answer(id, 'kari', 'yes')).rejects.toThrow('stengt')
    await expect(answer(id, 'ola', null)).rejects.toThrow('stengt')
    await answer(id, 'ola', 'no')
    asMember('ola')
    expect((await detailFor(id)).mine?.status).toBe('no')
  })

  it('lar bare den ansvarlige stenge', async () => {
    const id = await publishDugnad()
    asMember('ola')
    await expect(setCalloutClosed({ data: { postId: id, closed: true } })).rejects.toThrow('ansvarlige')
  })

  it('er låst etter datoen', async () => {
    const id = await publishDugnad()
    sqlite.prepare('UPDATE post_callouts SET event_date = ? WHERE post_id = ?').run('2020-01-01', id)
    await expect(answer(id, 'ola', 'no')).rejects.toThrow('Dette har vært')
  })
})

describe('å spørre', () => {
  it('krever rettighet, også i et rått kall', async () => {
    asMember('ola')
    await expect(createPost({ data: { ...post, callout: dugnad } })).rejects.toThrow('tilgang')
    asBoard()
    await expect(
      createPost({ data: { ...post, callout: { kind: 'spilleoppdrag', projectId: 'gig' } } }),
    ).rejects.toThrow('tilgang')
  })

  it('krever tittel og hele korpset', async () => {
    asBoard()
    await expect(createPost({ data: { ...post, title: null, callout: dugnad } })).rejects.toThrow('tittel')
    await expect(createPost({ data: { ...post, audience: 'board', callout: dugnad } })).rejects.toThrow('hele korpset')
  })

  it('kan ikke flytte et lagret spørsmål til bare styret', async () => {
    const id = await publishDugnad()
    asBoard()
    await expect(updatePost({ data: { id, ...post, audience: 'board' } })).rejects.toThrow('hele korpset')
  })

  it('lager et nytt lukket oppdrag sammen med innlegget', async () => {
    asManager()
    const { id } = await createPost({
      data: { ...post, title: 'Bryllup', callout: { kind: 'spilleoppdrag', eventDate: FUTURE, startTime: '15:00', location: 'Fana' } },
    })
    const row = sqlite.prepare(`SELECT p.name, p.kind, p.start_time AS time, p.venue FROM post_callouts c JOIN projects p ON p.id = c.project_id WHERE c.post_id = ?`).get(id)
    expect({ ...row }).toEqual({ name: 'Bryllup', kind: 'spilleoppdrag', time: '15:00', venue: 'Fana' })
  })

  it('godtar ikke et vanlig prosjekt som oppdrag', async () => {
    asManager()
    await expect(
      createPost({ data: { ...post, callout: { kind: 'spilleoppdrag', projectId: 'concert' } } }),
    ).rejects.toThrow('Fant ikke spilleoppdraget')
  })

  it('spør bare én gang per oppdrag', async () => {
    await publishGig()
    asManager()
    await expect(
      createPost({ data: { ...post, callout: { kind: 'spilleoppdrag', projectId: 'gig' } } }),
    ).rejects.toThrow('allerede')
  })

  it('låser typen etter at noen har svart', async () => {
    const id = await publishDugnad()
    await answer(id, 'ola', 'yes')
    state.me = me('styret', ['posts.publish', 'projects.manage'])
    await expect(
      updatePost({ data: { id, ...post, callout: { kind: 'spilleoppdrag', projectId: 'gig' } } }),
    ).rejects.toThrow('Typen')
  })

  it('lar en vanlig redigering stå urørt uten feltet, og tar spørsmålet bort med null', async () => {
    const id = await publishDugnad()
    await answer(id, 'ola', 'yes')
    asBoard()
    await updatePost({ data: { id, ...post, body: 'Ny tekst' } })
    expect((await detailFor(id)).yesCount).toBe(1)
    await updatePost({ data: { id, ...post, body: 'Ny tekst', callout: null } })
    expect((await getPost({ data: { id } })).callout).toBeNull()
    expect(sqlite.prepare('SELECT count(*) AS n FROM callout_responses').get()).toEqual({ n: 0 })
  })

  it('rydder svarene når innlegget slettes', async () => {
    const id = await publishDugnad()
    await answer(id, 'ola', 'yes')
    asBoard()
    await deletePost({ data: { id } })
    expect(sqlite.prepare('SELECT count(*) AS n FROM post_callouts').get()).toEqual({ n: 0 })
    expect(sqlite.prepare('SELECT count(*) AS n FROM callout_responses').get()).toEqual({ n: 0 })
  })
})

describe('spilleoppdrag', () => {
  it('gir ingen plass i besetningen av å svare «Kan»', async () => {
    const id = await publishGig()
    await answer(id, 'ola', 'yes')
    expect(sqlite.prepare('SELECT count(*) AS n FROM project_crew').get()).toEqual({ n: 0 })
  })

  it('viser svarene i velgeren, og per stemme', async () => {
    const id = await publishGig()
    await answer(id, 'ola', 'yes', 'kan spille solo')
    await answer(id, 'kari', 'maybe')
    asManager()
    const options = await getCrewOptions({ data: { projectId: 'gig' } })
    expect(options.responses.find((r) => r.userId === 'ola')).toMatchObject({ status: 'yes', note: 'kan spille solo' })
    const { manage } = await detailFor(id)
    expect(manage!.byPart.find((p) => p.id === 'cornet')?.people.map((p) => p.name)).toEqual(['Ola'])
    expect(manage!.byPart.find((p) => p.id === 'bass')?.people[0]).toMatchObject({ name: 'Kari', status: 'maybe' })
  })

  it('varsler bare dem som nettopp ble valgt', async () => {
    await publishGig()
    asManager()
    await setProjectCrew({ data: { projectId: 'gig', members: [{ userId: 'ola', partIds: [] }] } })
    expect(state.push.mock.calls[0]?.[0]).toEqual(['ola'])
    state.push.mockClear()
    await setProjectCrew({ data: { projectId: 'gig', members: [{ userId: 'ola', partIds: [] }, { userId: 'kari', partIds: [] }] } })
    expect(state.push.mock.calls[0]?.[0]).toEqual(['kari'])
  })

  it('respekterer valget om å ikke få slike varsler', async () => {
    sqlite.exec(`INSERT INTO notification_preferences (user_id, mentions) VALUES ('ola', 'off')`)
    await publishGig()
    asManager()
    await setProjectCrew({ data: { projectId: 'gig', members: [{ userId: 'ola', partIds: [] }] } })
    expect(state.push.mock.calls[0]?.[0] ?? []).toEqual([])
  })

  it('varsler den ansvarlige når noen i besetningen faller fra', async () => {
    const id = await publishGig()
    asManager()
    await setProjectCrew({ data: { projectId: 'gig', members: [{ userId: 'ola', partIds: [] }] } })
    state.push.mockClear()
    await answer(id, 'ola', 'no')
    expect(state.push).toHaveBeenCalledTimes(1)
    expect(state.push.mock.calls[0]?.[0]).toEqual(['stab'])
    state.push.mockClear()
    await answer(id, 'per', 'no')
    expect(state.push).not.toHaveBeenCalled()
  })
})

describe('kalender og Hjem', () => {
  it('viser publiserte dugnader, men ikke utkast eller oppdrag', async () => {
    const id = await publishDugnad()
    await publishGig()
    asBoard()
    await createPost({ data: { ...post, title: 'Utkast', callout: dugnad } })
    const events = await dugnadEvents(state.db as never, '2099-01-01', '2099-12-31')
    expect(events.map((e) => e.postId)).toEqual([id])
    expect(events[0]).toMatchObject({ title: 'Dugnad', location: 'Øvingslokalet', allDay: false })
  })

  it('minner bare om det jeg ikke har svart på', async () => {
    const id = await publishDugnad()
    const gigPost = await publishGig()
    await answer(id, 'ola', 'yes')
    const open = await unansweredCallouts(state.db as never, 'ola', 3)
    expect(open.map((c) => c.postId)).toEqual([gigPost])
    expect(open[0]).toMatchObject({ eventDate: FUTURE, startTime: '18:00', location: 'Scandic' })
  })

  it('slipper stengte spørsmål', async () => {
    const id = await publishDugnad()
    asBoard()
    await setCalloutClosed({ data: { postId: id, closed: true } })
    expect(await unansweredCallouts(state.db as never, 'ola', 3)).toEqual([])
  })
})

describe('iPhone-appen', () => {
  const screen = (id: string) => otherScreen(['posts', id], state.me as never, new URLSearchParams())

  it('gir medlemmet knappene, men ikke andres nei', async () => {
    const id = await publishDugnad()
    await answer(id, 'kari', 'no', 'er bortreist')
    asMember('ola')
    const page = await screen(id)
    const section = page!.sections.find((s) => s.id === 'callout')!
    expect(section.rows[0]!.actions!.map((a) => a.title)).toEqual(['Kan', 'Usikker', 'Kan ikke'])
    expect(JSON.stringify(page)).not.toContain('Kari')
    expect(JSON.stringify(page)).not.toContain('bortreist')
  })

  it('lagrer svaret gjennom app-handlingen', async () => {
    const id = await publishDugnad()
    asMember('ola')
    await runMobileAction('callouts.respondToCallout', { postId: id, status: 'yes' })
    expect((await detailFor(id)).mine?.status).toBe('yes')
  })

  it('viser den ansvarlige alle svarene', async () => {
    const id = await publishDugnad()
    await answer(id, 'kari', 'no', 'er bortreist')
    asBoard()
    const section = (await screen(id))!.sections.find((s) => s.id === 'callout')!
    expect(section.rows.find((r) => r.id === 'callout-no')?.subtitle).toContain('bortreist')
  })

  it('lenker dugnaden i appens kalender til innlegget', async () => {
    const soon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
    const id = await publishDugnad({ eventDate: soon })
    asMember('ola')
    const page = await otherScreen(['calendar'], state.me as never, new URLSearchParams())
    expect(page!.sections[0]!.rows.map((r) => r.path)).toContain(`posts/${id}`)
  })
})
