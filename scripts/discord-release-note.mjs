#!/usr/bin/env node
/**
 * Poster utgivelsesnotatet til Discord-kanalen #dev.
 *
 * Kjøres av deploy-workflowene (staging og prod) og av «Utgivelsesnotat»-
 * workflowen (manuelt). Innholdet er `docs/utgivelser/neste.md` — det som
 * ligger på staging og venter på verifisering før prod. Finnes ikke fila,
 * eller er den tom, brukes lista over commits utover `main` i stedet.
 *
 * Miljøvariabler:
 *   DISCORD_DEV_WEBHOOK_URL  webhooken til #dev (mangler den, hoppes det over)
 *   MODE                     'staging' | 'prod'
 *   SHA, BRANCH              det som ble deployet
 *   NOTE_PATH                (valgfri) sti til notatet, standard docs/utgivelser/neste.md
 *   COMMITS_PATH             (valgfri) fil med én commit-tittel per linje
 *   RUN_URL                  (valgfri) lenke til workflow-kjøringen
 *
 * Discord tar maks 2000 tegn per melding; lengre notat deles på linjeskift og
 * sendes som flere meldinger i rekkefølge.
 */
import { readFileSync, existsSync } from 'node:fs'

const webhook = process.env.DISCORD_DEV_WEBHOOK_URL
if (!webhook) {
  console.log('::warning::DISCORD_DEV_WEBHOOK_URL er ikke satt; utgivelsesnotatet hoppes over.')
  process.exit(0)
}

const mode = process.env.MODE === 'prod' ? 'prod' : 'staging'
const sha = (process.env.SHA ?? '').slice(0, 8)
const branch = process.env.BRANCH ?? ''
const notePath = process.env.NOTE_PATH ?? 'docs/utgivelser/neste.md'
const commitsPath = process.env.COMMITS_PATH
const runUrl = process.env.RUN_URL

function readNote() {
  if (!existsSync(notePath)) return ''
  return readFileSync(notePath, 'utf8').trim()
}

function readCommits() {
  if (!commitsPath || !existsSync(commitsPath)) return []
  return readFileSync(commitsPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

const note = readNote()
const commits = readCommits()
const ref = branch ? `\`${branch}\` @ \`${sha}\`` : `\`${sha}\``

const parts = []
if (mode === 'staging') {
  parts.push(`🧪 **Klar for testing på staging** — test.tertnesbrass.com kjører nå ${ref}.`)
} else {
  parts.push(`🚀 **Ute i prod** — intern.tertnesbrass.com kjører nå ${ref}.`)
}
parts.push('')

if (note) {
  parts.push(note)
} else if (commits.length > 0) {
  const shown = commits.slice(0, 20)
  parts.push('**Endringer utover prod:**')
  for (const c of shown) parts.push(`• ${c}`)
  if (commits.length > shown.length) parts.push(`… og ${commits.length - shown.length} til`)
} else {
  parts.push('_(Ingen utgivelsesnotat — se commit-loggen.)_')
}

parts.push('')
if (mode === 'staging') {
  parts.push(
    '⚠️ **Dette må testes og verifiseres på staging før det merges til `main` og går til prod.** ' +
      'Staging har egen kopi av databasen, så test fritt — og si fra her hvis noe ikke stemmer.',
  )
} else {
  parts.push('Si fra her hvis noe oppfører seg annerledes enn på staging.')
}
if (runUrl) parts.push(`<${runUrl}>`)

// Del opp på linjeskift innenfor Discords grense på 2000 tegn.
const LIMIT = 1900
const chunks = []
let current = ''
for (const line of parts.join('\n').split('\n')) {
  const candidate = current ? `${current}\n${line}` : line
  if (candidate.length > LIMIT && current) {
    chunks.push(current)
    current = line
  } else {
    current = candidate
  }
}
if (current) chunks.push(current)

for (const [i, content] of chunks.entries()) {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, username: 'tb-intern utgivelser', allowed_mentions: { parse: [] } }),
  })
  if (!res.ok) {
    console.error(`Discord svarte ${res.status} på del ${i + 1}/${chunks.length}: ${await res.text()}`)
    process.exit(1)
  }
  // Webhooks er ratebegrenset (~5/s); en liten pause mellom delene holder.
  if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 600))
}
console.log(`Utgivelsesnotat (${mode}) sendt til #dev i ${chunks.length} del(er).`)
