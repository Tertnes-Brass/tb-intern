import { describe, expect, it } from 'vitest'
import {
  MAX_MENTIONS,
  type MentionCandidate,
  UNKNOWN_MENTION,
  codeRanges,
  commentPlainText,
  findMentionQuery,
  insertMention,
  mentionMatches,
  mentionRecipients,
  mentionableMembers,
  normalizeForSearch,
  parseMentions,
  rankMentionCandidates,
  renderCommentHtml,
  toMarkers,
} from './mentions'

/**
 * Testene for medlemsomtaler (#83). To slag: at omtalen overlever et navnebytte
 * og en slettet bruker, og — viktigere — at ingenting brukerstyrt kan bli
 * markering eller en omtale det ikke skulle blitt. Sikkerhetstestene er skrevet
 * som angrepsforsøk: faller en av dem, er det et hull.
 */

const OLA = { id: 'u1', name: 'Ola Nordmann' }
const ASE = { id: 'u2', name: 'Åse Bø' }

describe('parseMentions', () => {
  it('finner markørene i rekkefølge', () => {
    expect(parseMentions('Hei @[u:u1] og @[u:u2]!')).toEqual(['u1', 'u2'])
  })

  it('teller samme person én gang uansett hvor mange ganger navnet står', () => {
    expect(parseMentions('@[u:u1] @[u:u1] @[u:u1]')).toEqual(['u1'])
  })

  it('ser bort fra tekst som bare LIGNER en markør', () => {
    expect(parseMentions('@[u:] @[user:u1] @u1 [u:u1] @[u:ola nordmann]')).toEqual([])
  })

  it('finner ingenting i en vanlig kommentar', () => {
    expect(parseMentions('Send det til ola@epost.no, så fikser jeg det.')).toEqual([])
  })
})

describe('renderCommentHtml', () => {
  it('gjør markøren om til en chip med DAGENS navn', () => {
    expect(renderCommentHtml('Hei @[u:u1]!', [OLA])).toBe('Hei <span class="mention">@Ola Nordmann</span>!')
  })

  it('følger navnebytte — markøren er en id, ikke et navn', () => {
    const body = 'Takk @[u:u1]'
    expect(renderCommentHtml(body, [{ id: 'u1', name: 'Ola Nordmann' }])).toContain('@Ola Nordmann')
    expect(renderCommentHtml(body, [{ id: 'u1', name: 'Ola Nordmann-Hansen' }])).toContain('@Ola Nordmann-Hansen')
    // Det gamle navnet finnes ingen steder i teksten, så det kan ikke lekke ut.
    expect(body).not.toContain('Ola')
  })

  it('viser «Ukjent medlem» når brukeren er slettet — aldri rå markørtekst', () => {
    const html = renderCommentHtml('Hei @[u:borte]!', [])
    expect(html).toBe(`Hei <span class="mention mention-unknown">${UNKNOWN_MENTION}</span>!`)
    expect(html).not.toContain('@[u:')
  })

  it('escaper rå HTML i kommentaren', () => {
    expect(renderCommentHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escaper navnet også — et navn er brukerinnhold', () => {
    const html = renderCommentHtml('@[u:u1]', [{ id: 'u1', name: '<img src=x onerror=alert(1)>' }])
    expect(html).toBe('<span class="mention">@&lt;img src=x onerror=alert(1)&gt;</span>')
  })

  it('lar en e-postadresse stå som tekst', () => {
    expect(renderCommentHtml('Send til ola@epost.no')).toBe('Send til ola@epost.no')
  })

  it('lager ikke markering av backticks — kommentarer er ren tekst', () => {
    expect(renderCommentHtml('`@[u:u1]`', [OLA])).toContain('`<span class="mention">')
  })
})

describe('commentPlainText', () => {
  it('skriver navn i stedet for markører — ingen skal lese «@[u:…]» i innboksen', () => {
    expect(commentPlainText('Kan du ta med @[u:u2]?', [ASE])).toBe('Kan du ta med @Åse Bø?')
  })

  it('faller tilbake til «Ukjent medlem»', () => {
    expect(commentPlainText('Hei @[u:borte]', [])).toBe(`Hei ${UNKNOWN_MENTION}`)
  })
})

describe('codeRanges', () => {
  it('finner et inline-spenn', () => {
    expect(codeRanges('a `b` c')).toEqual([[2, 5]])
  })

  it('finner en fenced blokk og lar korte løp inne i den være', () => {
    const body = '```\nen ` to\n```'
    expect(codeRanges(body)).toEqual([[0, body.length]])
  })

  it('regner en uavsluttet backtick som kode ut teksten', () => {
    expect(codeRanges('halvskrevet `kode')).toEqual([[12, 17]])
  })
})

describe('findMentionQuery', () => {
  it('åpner søket rett etter «@»', () => {
    expect(findMentionQuery('Hei @', 5)).toEqual({ start: 4, query: '' })
  })

  it('tar med navn som har mellomrom', () => {
    expect(findMentionQuery('Hei @Ola Nor', 12)).toEqual({ start: 4, query: 'Ola Nor' })
  })

  it('åpner ALDRI inne i en e-postadresse', () => {
    expect(findMentionQuery('ola@epost.no', 12)).toBeNull()
    expect(findMentionQuery('ola@', 4)).toBeNull()
  })

  it('åpner ALDRI inne i backticks', () => {
    expect(findMentionQuery('`npm i @tanstack/react`', 22)).toBeNull()
    expect(findMentionQuery('kode: `ola@', 11)).toBeNull()
  })

  it('gir seg på linjeskift og på to mellomrom', () => {
    expect(findMentionQuery('@Ola\nnesten', 11)).toBeNull()
    expect(findMentionQuery('@Ola  Nordmann', 14)).toBeNull()
  })
})

describe('insertMention', () => {
  it('bytter ut søket med navnet og setter caret etter mellomrommet', () => {
    expect(insertMention('Hei @Ol', 7, 'Ola Nordmann')).toEqual({ body: 'Hei @Ola Nordmann ', caret: 18 })
  })

  it('beholder teksten som står etter caret', () => {
    expect(insertMention('Hei @Ol, ta med noter', 7, 'Ola Nordmann')).toEqual({
      body: 'Hei @Ola Nordmann , ta med noter',
      caret: 18,
    })
  })

  it('setter inn ved caret når det ikke er noe aktivt søk', () => {
    expect(insertMention('Hei ', 4, 'Åse Bø')).toEqual({ body: 'Hei @Åse Bø ', caret: 12 })
  })
})

describe('toMarkers', () => {
  it('gjør et valgt navn om til en markør', () => {
    expect(toMarkers('Hei @Ola Nordmann!', [OLA])).toBe('Hei @[u:u1]!')
  })

  it('lar navn som IKKE er valgt fra lista stå som tekst', () => {
    expect(toMarkers('Hei @Kari Nordmann!', [OLA])).toBe('Hei @Kari Nordmann!')
  })

  it('rører aldri en e-postadresse', () => {
    expect(toMarkers('skriv til ola@Ola Nordmann', [OLA])).toBe('skriv til ola@Ola Nordmann')
  })

  it('rører aldri noe inne i backticks', () => {
    expect(toMarkers('`@Ola Nordmann` er en variabel', [OLA])).toBe('`@Ola Nordmann` er en variabel')
  })

  it('velger det lengste navnet når to navn overlapper', () => {
    const chosen = [
      { id: 'u1', name: 'Ola' },
      { id: 'u3', name: 'Ola Nordmann' },
    ]
    expect(toMarkers('@Ola Nordmann og @Ola', chosen)).toBe('@[u:u3] og @[u:u1]')
  })

  it('stopper på ordgrense, så «@Ola» ikke spiser «@Olafsen»', () => {
    expect(toMarkers('@Olafsen kommer', [{ id: 'u1', name: 'Ola' }])).toBe('@Olafsen kommer')
  })

  it('fordeler to like navn på hver sin id, i den rekkefølgen de ble valgt', () => {
    const chosen = [
      { id: 'a', name: 'Ola Nordmann' },
      { id: 'b', name: 'Ola Nordmann' },
    ]
    expect(toMarkers('@Ola Nordmann og @Ola Nordmann', chosen)).toBe('@[u:a] og @[u:b]')
  })

  it('gjentar siste id når navnet står flere ganger enn det ble valgt', () => {
    expect(toMarkers('@Ola Nordmann @Ola Nordmann', [OLA])).toBe('@[u:u1] @[u:u1]')
  })

  it('lar teksten stå urørt når ingenting er valgt', () => {
    expect(toMarkers('Hei @Ola Nordmann', [])).toBe('Hei @Ola Nordmann')
  })
})

describe('normalizeForSearch / mentionMatches', () => {
  it('bryr seg ikke om store bokstaver eller norske tegn', () => {
    expect(normalizeForSearch('Åse Bø')).toBe('ase bo')
    expect(normalizeForSearch('Ærlig Sæther')).toBe('aerlig saether')
    expect(mentionMatches('Åse Bø', 'ase')).toBe(true)
    expect(mentionMatches('Åse Bø', 'ÅSE')).toBe(true)
    expect(mentionMatches('Ole Kristian Bø', 'bo')).toBe(true)
  })

  it('treffer på ordstart, ikke midt i et ord', () => {
    expect(mentionMatches('Ingrid Marie Dale', 'ma')).toBe(true)
    expect(mentionMatches('Ingrid Marie Dale', 'rie')).toBe(false)
  })

  it('tomt søk treffer alle — hele lista vises rett etter «@»', () => {
    expect(mentionMatches('Hvem som helst', '')).toBe(true)
  })
})

describe('rankMentionCandidates', () => {
  const members = [
    { id: '1', name: 'Ola Nordmann' },
    { id: '2', name: 'Kari Olsen' },
    { id: '3', name: 'Åse Bø' },
  ]

  it('setter treff på fornavn først, så alfabetisk', () => {
    expect(rankMentionCandidates(members, 'ol', 10).map((m) => m.name)).toEqual(['Ola Nordmann', 'Kari Olsen'])
  })

  it('respekterer taket', () => {
    expect(rankMentionCandidates(members, '', 2)).toHaveLength(2)
  })
})

describe('mentionableMembers', () => {
  const members = [
    { userId: 'aktiv', isActive: true, canPublish: false },
    { userId: 'sluttet', isActive: false, canPublish: false },
    { userId: 'styret', isActive: true, canPublish: true },
  ]

  it('utelater deaktiverte medlemmer', () => {
    const out = mentionableMembers({ audience: 'all', publishedAt: 1 }, members)
    expect(out.map((m) => m.userId)).toEqual(['aktiv', 'styret'])
  })

  it('slipper bare styret til på et styre-innlegg', () => {
    const out = mentionableMembers({ audience: 'board', publishedAt: 1 }, members)
    expect(out.map((m) => m.userId)).toEqual(['styret'])
  })
})

describe('mentionRecipients', () => {
  const members: MentionCandidate[] = [
    { userId: 'meg', name: 'Meg Selv', email: 'meg@x.no', isActive: true, canPublish: false },
    { userId: 'ola', name: 'Ola', email: 'ola@x.no', isActive: true, canPublish: false },
    { userId: 'stille', name: 'Stille', email: 'stille@x.no', isActive: true, canPublish: false },
    { userId: 'uten', name: 'Uten E-post', email: null, isActive: true, canPublish: false },
  ]
  const prefs = new Map<string, 'all' | 'off'>([['stille', 'off']])

  it('varsler aldri deg selv', () => {
    expect(mentionRecipients(['meg', 'ola'], members, { commenterId: 'meg', prefs }).map((r) => r.userId)).toEqual([
      'ola',
    ])
  })

  it('sender én e-post selv om samme person er nevnt flere ganger', () => {
    expect(mentionRecipients(['ola', 'ola'], members, { commenterId: 'meg', prefs })).toHaveLength(1)
  })

  it('respekterer «Av» og hopper over dem uten e-postadresse', () => {
    expect(
      mentionRecipients(['stille', 'uten', 'ola'], members, { commenterId: 'meg', prefs }).map((r) => r.userId),
    ).toEqual(['ola'])
  })

  it('varsler som standard når medlemmet ikke har valgt noe', () => {
    expect(mentionRecipients(['ola'], members, { commenterId: 'meg', prefs: new Map() })).toHaveLength(1)
  })
})

describe('taket på antall omtaler', () => {
  it('er ti', () => {
    expect(MAX_MENTIONS).toBe(10)
  })
})
