import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./discord-release-note.mjs', import.meta.url))

// Kjør det faktiske CLI-skriptet med fetch erstattet før modulen lastes.
// Ingen nettverkstilgang eller ekte webhook brukes i testene.
function run(note, env = {}, status = 204) {
  const dir = mkdtempSync(join(tmpdir(), 'tb-release-test-'))
  try {
    if (note !== undefined) writeFileSync(join(dir, 'note.md'), note)
    writeFileSync(join(dir, 'commits.txt'), 'Endring A\nEndring B\n')
    const mock = `globalThis.fetch = async (url, options) => {
      console.log('PAYLOAD ' + options.body);
      return { ok: ${status < 300}, status: ${status}, text: async () => 'mock error' };
    }; globalThis.setTimeout = (callback) => callback();`
    const result = spawnSync(process.execPath, [
      '--import', `data:text/javascript,${encodeURIComponent(mock)}`, script,
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DISCORD_DEV_WEBHOOK_URL: 'https://example.invalid/mock',
        MODE: 'staging', SHA: '7c1297a55a2a394c', BRANCH: 'test',
        NOTE_PATH: join(dir, 'note.md'), COMMITS_PATH: join(dir, 'commits.txt'),
        RUN_URL: 'https://example.invalid/run', ...env,
      },
    })
    assert.ifError(result.error)
    const messages = result.stdout.split('\n').filter(l => l.startsWith('PAYLOAD '))
      .map(l => JSON.parse(l.slice(8)))
    for (const message of messages) {
      assert.deepEqual(message.allowed_mentions, { parse: [] })
      assert.ok(message.content.length <= 1900)
      assert.ok(message.content.length > 0)
      assert.ok(message.content.isWellFormed())
    }
    return { ...result, messages, text: messages.map(m => m.content).join('\n') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('lange enkeltlinjer deles uten tap av tekst eller ødelagte emoji', () => {
  for (const note of ['x'.repeat(6000), 'a' + '🎺'.repeat(3000)]) {
    const result = run(note)
    assert.equal(result.status, 0)
    assert.ok(result.messages.length > 3)
    assert.ok(result.text.replaceAll('\n', '').includes(note))
  }
})

test('lange notat med linjeskift beholder rekkefølgen', () => {
  const note = Array.from({ length: 100 }, (_, i) => `Linje ${i}: prøv denne funksjonen.`).join('\n')
  const result = run(note)
  assert.equal(result.status, 0)
  assert.ok(result.messages.length > 1)
  assert.ok(result.text.includes(note))
  assert.match(result.text, /Klar for testing på staging/)
  assert.match(result.text, /må testes og verifiseres/)
  assert.match(result.text, /`test` @ `7c1297a5`/)
})

test('prod får riktig overskrift og ingen staging-påminnelse', () => {
  const result = run('Nytt i prod', { MODE: 'prod', BRANCH: 'main' })
  assert.equal(result.status, 0)
  assert.match(result.text, /Ute i prod/)
  assert.doesNotMatch(result.text, /må testes og verifiseres/)
})

test('manglende webhook hopper over sendingen', () => {
  const result = run('Notat', { DISCORD_DEV_WEBHOOK_URL: '' })
  assert.equal(result.status, 0)
  assert.equal(result.messages.length, 0)
  assert.match(result.stdout, /warning/)
})

test('manglende og tomt notat bruker commit-listen', () => {
  for (const note of [undefined, '   ']) {
    const result = run(note)
    assert.equal(result.status, 0)
    assert.match(result.text, /• Endring A\n• Endring B/)
  }
})

test('Discord-feil avslutter med feil før neste del sendes', () => {
  const result = run('x'.repeat(6000), {}, 500)
  assert.equal(result.status, 1)
  assert.equal(result.messages.length, 1)
  assert.match(result.stderr, /Discord svarte 500/)
})
