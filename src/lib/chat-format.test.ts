import { describe, expect, it } from 'vitest'
import { chatPlainText, hasCode, parseChatText } from './chat-format'

describe('parseChatText', () => {
  it('lar ren tekst være ren tekst', () => {
    expect(parseChatText('Husk møtet på torsdag')).toEqual([{ type: 'text', value: 'Husk møtet på torsdag' }])
  })

  it('finner inline kode mellom enkle backticks', () => {
    expect(parseChatText('feltet heter `felt_navn` i basen')).toEqual([
      { type: 'text', value: 'feltet heter ' },
      { type: 'code', value: 'felt_navn' },
      { type: 'text', value: ' i basen' },
    ])
  })

  it('bruker doble backticks når koden selv inneholder en backtick', () => {
    expect(parseChatText('skriv `` ` `` for kode')).toEqual([
      { type: 'text', value: 'skriv ' },
      { type: 'code', value: '`' },
      { type: 'text', value: ' for kode' },
    ])
  })

  it('leser en fenced blokk med språkmarkør', () => {
    expect(parseChatText('se her:\n```sql\nselect 1;\n```\nferdig')).toEqual([
      { type: 'text', value: 'se her:\n' },
      { type: 'block', value: 'select 1;', lang: 'sql' },
      { type: 'text', value: '\nferdig' },
    ])
  })

  it('leser en blokk uten språkmarkør og beholder linjeskift inni', () => {
    expect(parseChatText('```\nlinje 1\nlinje 2\n```')).toEqual([
      { type: 'block', value: 'linje 1\nlinje 2', lang: null },
    ])
  })

  it('takler en blokk på én linje', () => {
    expect(parseChatText('```npm i```')).toEqual([{ type: 'block', value: 'npm i', lang: null }])
  })

  it('tolker ikke annen markdown eller rå HTML', () => {
    const input = '**ikke fet** <b>ikke fet</b> [ikke lenke](https://a.b) # ikke overskrift'
    expect(parseChatText(input)).toEqual([{ type: 'text', value: input }])
  })

  it('holder HTML inne i en blokk som tekst', () => {
    const segments = parseChatText('```\n<script>alert(1)</script>\n```')
    expect(segments).toEqual([{ type: 'block', value: '<script>alert(1)</script>', lang: null }])
  })

  it('lar uavsluttede backticks stå som tekst', () => {
    expect(parseChatText('en ` som aldri lukkes')).toEqual([{ type: 'text', value: 'en ` som aldri lukkes' }])
    expect(parseChatText('```\nuavsluttet blokk')).toEqual([{ type: 'text', value: '```\nuavsluttet blokk' }])
  })

  it('lager ikke tom kode av to backticks etter hverandre', () => {
    expect(parseChatText('a `` b')).toEqual([{ type: 'text', value: 'a `` b' }])
  })

  it('finner flere kodespenn i samme melding', () => {
    expect(parseChatText('`a` og `b`')).toEqual([
      { type: 'code', value: 'a' },
      { type: 'text', value: ' og ' },
      { type: 'code', value: 'b' },
    ])
  })

  it('gir tom liste for tom tekst', () => {
    expect(parseChatText('')).toEqual([])
  })
})

describe('hasCode', () => {
  it('skiller meldinger med kode fra vanlige', () => {
    expect(hasCode(parseChatText('vanlig melding'))).toBe(false)
    expect(hasCode(parseChatText('`kode`'))).toBe(true)
  })
})

describe('chatPlainText', () => {
  it('fjerner syntaksen, ikke innholdet', () => {
    expect(chatPlainText('kjør `npm test` før du pusher')).toBe('kjør npm test før du pusher')
    expect(chatPlainText('```sql\nselect 1;\n```')).toBe('select 1;')
  })
})
