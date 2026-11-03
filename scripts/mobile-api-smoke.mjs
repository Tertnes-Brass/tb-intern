// Local-only integration test. Never send test posts or alter attendance in prod.
// Start a freshly migrated `pnpm dev` on port 3088 first. The existing dev-login
// route seeds synthetic fixtures; production builds do not contain that route.
import assert from 'node:assert/strict'

const base = 'http://localhost:3088'
async function login(email) {
  const result = await fetch(`${base}/api/dev-login?as=${encodeURIComponent(email)}`, {
    method: 'POST', headers: { Origin: base }, redirect: 'manual',
  })
  assert.equal(result.status, 302)
  const token = result.headers.get('set-auth-token')
  assert.ok(token, 'native login returns a signed session token')
  return token
}
async function request(path, token, method = 'GET', body, headers = {}) {
  return fetch(base + path, {
    method, redirect: 'manual',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function json(path, token, method, body) {
  const result = await request('/api/mobile/v1/' + path, token, method, body)
  assert.ok(result.ok, `${method ?? 'GET'} ${path}: ${result.status} ${result.ok ? '' : await result.text()}`)
  assert.match(result.headers.get('cache-control'), /no-store/)
  return result.json()
}

const member = await login('ingrid@demo.tertnesbrass.no')
const admin = await login('sindre@demo.tertnesbrass.no')
const snapshotPath = '/api/mobile/v1/snapshot'
for (const [token, headers] of [[null, {}], ['invalid', {}], [member + 'tampered', {}], [member.split('.')[0], {}], [member, { Cookie: 'session=ambient' }]]) {
  assert.equal((await request(snapshotPath, token, 'GET', undefined, headers)).status, 401)
}
assert.equal((await request(snapshotPath, member, 'GET', undefined, { Origin: 'https://evil.example' })).status, 403)
const snapshot = await json('snapshot', member)
const privileged = await json('snapshot', admin)
assert.equal(snapshot.member.canSwitchEnvironment, false, 'ordinary members cannot enable development settings')
assert.equal(privileged.member.canSwitchEnvironment, true, 'administrator capability comes from server permissions')
assert.ok(snapshot.events.length > 0)
assert.ok(snapshot.posts.length > 0)
assert.ok(snapshot.scores.length > 0, 'Prepare future-dated local demo projects to exercise PDF access')
for (const score of snapshot.scores.slice(0, 1)) {
  assert.equal((await request(score.path, null)).status, 401)
  const pdf = await request(score.path, member)
  assert.equal(pdf.status, 200)
  assert.match(pdf.headers.get('content-type'), /pdf/)
  assert.equal((await pdf.text()).slice(0, 4), '%PDF')
}
const hiddenFile = privileged.scores.find((file) => !snapshot.scores.some((item) => item.id === file.id))
assert.ok(hiddenFile, 'fixture includes a file outside the member part permissions')
assert.equal((await request(hiddenFile.path, member)).status, 403)
const hiddenPost = privileged.posts.find((post) => !snapshot.posts.some((item) => item.id === post.id))
assert.ok(hiddenPost, 'fixture includes a board-only post')
assert.equal((await request('/api/mobile/v1/posts/' + hiddenPost.id, member)).status, 404)

const event = snapshot.events[0]
await json(`events/${event.id}/attendance`, member, 'PUT', { status: 'attending' })
assert.equal((await json('snapshot', member)).events.find((item) => item.id === event.id).attendance, 'attending')
await json(`events/${event.id}/attendance`, member, 'PUT', { status: event.attendance })
const draft = await json('posts', member, 'POST', { body: 'Local native API integration test' })
assert.ok(!(await json('snapshot', member)).posts.some((post) => post.id === draft.id), 'draft is not in published feed')
await json(`posts/${draft.id}/publish`, member, 'POST', {})
await json(`posts/${draft.id}/publish`, member, 'POST', {})
assert.equal((await json('snapshot', member)).posts.filter((post) => post.id === draft.id).length, 1)
assert.deepEqual(await json(`posts/${draft.id}/like`, member, 'POST', {}), { mine: true, count: 1 })
assert.deepEqual(await json(`posts/${draft.id}/like`, member, 'POST', {}), { mine: false, count: 0 })
const comment = await json(`posts/${draft.id}/comments`, member, 'POST', { body: 'Local comment test' })
const reply = await json(`posts/${draft.id}/comments`, member, 'POST', { body: 'Local reply test', replyToId: comment.id })
const detail = await json(`posts/${draft.id}`, member)
assert.equal(detail.post.body, 'Local native API integration test')
assert.deepEqual(detail.comments.slice(-2).map((c) => [c.body, c.parentId, c.replyToId]), [
  ['Local comment test', null, null],
  ['Local reply test', comment.id, comment.id],
])
assert.equal(reply.ok, true)
assert.equal((await request('/api/auth/sign-out', member, 'POST', {})).status, 200)
assert.equal((await request(snapshotPath, member)).status, 401, 'logout revokes bearer session')
console.log('PASS: signed sessions, invalid/revoked tokens, cookie/CSRF boundary, member/board visibility, PDF permissions, attendance, draft/publish, reactions, comments and replies.')
