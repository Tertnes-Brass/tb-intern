import { describe, expect, it } from 'vitest'
import {
  MAX_MENTIONS,
  type MentionCandidate,
  UNKNOWN_MENTION,
  codeRanges,
  findMentionQuery,
  insertMention,
  mentionDraft,
  mentionMarker,
  mentionMatches,
  mentionPlainText,
  mentionRecipients,
  mentionRejection,
  mentionableForAudience,
  mentionableMembers,
  normalizeForSearch,
  parseMentions,
  postLineTokens,
  postMentionRecipients,
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

describe('mentionPlainText', () => {
  it('skriver navn i stedet for markører — ingen skal lese «@[u:…]» i innboksen', () => {
    expect(mentionPlainText('Kan du ta med @[u:u2]?', [ASE])).toBe('Kan du ta med @Åse Bø?')
  })

  it('faller tilbake til «Ukjent medlem»', () => {
    expect(mentionPlainText('Hei @[u:borte]', [])).toBe(`Hei ${UNKNOWN_MENTION}`)
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
    { userId: 'aktiv', isActive: true, canPublish: false, sectionIds: [], projectIds: []  },
    { userId: 'sluttet', isActive: false, canPublish: false, sectionIds: [], projectIds: []  },
    { userId: 'styret', isActive: true, canPublish: true, sectionIds: [], projectIds: []  },
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
    { userId: 'meg', name: 'Meg Selv', email: 'meg@x.no', isActive: true, canPublish: false, sectionIds: [], projectIds: []  },
    { userId: 'ola', name: 'Ola', email: 'ola@x.no', isActive: true, canPublish: false, sectionIds: [], projectIds: []  },
    { userId: 'stille', name: 'Stille', email: 'stille@x.no', isActive: true, canPublish: false, sectionIds: [], projectIds: []  },
    { userId: 'uten', name: 'Uten E-post', email: null, isActive: true, canPublish: false, sectionIds: [], projectIds: []  },
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

// ---------- Omtaler utenfor kommentarene (innlegg og chat) ----------

describe('mentionableForAudience', () => {
  const members = [
    { userId: 'aktiv', isActive: true, canPublish: false, sectionIds: [], projectIds: []  },
    { userId: 'sluttet', isActive: false, canPublish: false, sectionIds: [], projectIds: []  },
    { userId: 'styret', isActive: true, canPublish: true, sectionIds: [], projectIds: []  },
  ]

  it('lar et UTKAST omtale alle som vil kunne lese det når det publiseres', () => {
    // Uten denne regelen ville et nytt innlegg (publishedAt = null) ikke kunnet
    // omtale noen som helst utenom styret.
    expect(mentionableForAudience({ audience: 'all' }, members).map((m) => m.userId)).toEqual(['aktiv', 'styret'])
  })

  it('slipper bare styret til når målgruppen er styret', () => {
    expect(mentionableForAudience({ audience: 'board' }, members).map((m) => m.userId)).toEqual(['styret'])
  })
})

describe('mentionRejection', () => {
  const allowed = new Set(['a', 'b'])

  it('godtar markører som peker på noen med tilgang', () => {
    expect(mentionRejection(['a', 'b'], allowed, 'nei')).toBeNull()
  })

  it('gir SAMME melding for ukjent, deaktivert og uten tilgang', () => {
    expect(mentionRejection(['ukjent'], allowed, 'nei')).toBe('nei')
    expect(mentionRejection(['a', 'ukjent'], allowed, 'nei')).toBe('nei')
  })

  it('håndhever taket før alt annet', () => {
    const many = Array.from({ length: MAX_MENTIONS + 1 }, (_, i) => `id${i}`)
    expect(mentionRejection(many, new Set(many), 'nei')).toBe(`Du kan omtale maks ${MAX_MENTIONS} medlemmer om gangen`)
  })
})

describe('mentionMarker', () => {
  it('er formatet parseMentions leser', () => {
    expect(parseMentions(`Hei ${mentionMarker('u1')}`)).toEqual(['u1'])
  })
})

describe('postLineTokens', () => {
  it('deler linja i omtale, lenke og tekst — i den rekkefølgen de står', () => {
    expect(postLineTokens('Hei @[u:u1], se https://tertnesbrass.no i dag', [OLA])).toEqual([
      { kind: 'text', value: 'Hei ' },
      { kind: 'mention', id: 'u1', name: 'Ola Nordmann' },
      { kind: 'text', value: ', se ' },
      { kind: 'link', value: 'https://tertnesbrass.no', href: 'https://tertnesbrass.no' },
      { kind: 'text', value: ' i dag' },
    ])
  })

  it('lar en markør uten kjent bruker bli «Ukjent medlem», aldri rå markørtekst', () => {
    expect(postLineTokens('Hei @[u:borte]', [])).toEqual([
      { kind: 'text', value: 'Hei ' },
      { kind: 'mention', id: 'borte', name: null },
    ])
  })
})

describe('mentionDraft', () => {
  it('gjør lagret tekst om til noe et tekstfelt kan vise', () => {
    expect(mentionDraft('Hei @[u:u1]!', [OLA])).toEqual({
      text: 'Hei @Ola Nordmann!',
      chosen: [OLA],
    })
  })

  it('er den nøyaktige motsatsen til toMarkers — også med to like navn', () => {
    const users = [
      { id: 'a', name: 'Ola Nordmann' },
      { id: 'b', name: 'Ola Nordmann' },
    ]
    const stored = '@[u:b] snakker med @[u:a]'
    const draft = mentionDraft(stored, users)
    // `chosen` følger TEKSTEN, ikke lista fra databasen.
    expect(draft.chosen.map((c) => c.id)).toEqual(['b', 'a'])
    expect(toMarkers(draft.text, draft.chosen)).toBe(stored)
  })

  it('fjerner markører for slettede brukere, så teksten kan lagres igjen', () => {
    expect(mentionDraft('Hei @[u:borte]!', [])).toEqual({ text: 'Hei !', chosen: [] })
  })
})

describe('postMentionRecipients', () => {
  const members: MentionCandidate[] = [
    { userId: 'forfatter', name: 'Forfatter', email: 'f@x.no', isActive: true, canPublish: true, sectionIds: [], projectIds: []  },
    { userId: 'ola', name: 'Ola', email: 'ola@x.no', isActive: true, canPublish: false, sectionIds: [], projectIds: []  },
    { userId: 'kari', name: 'Kari', email: 'kari@x.no', isActive: true, canPublish: false, sectionIds: [], projectIds: []  },
  ]
  const prefs = new Map<string, 'all' | 'off'>()
  const base = { authorId: 'forfatter', prefs, alreadyNotified: new Set<string>(), postEmailed: new Set<string>() }

  it('sender til de omtalte, aldri til forfatteren selv', () => {
    const out = postMentionRecipients(['forfatter', 'ola'], members, base)
    expect(out.email.map((m) => m.userId)).toEqual(['ola'])
    expect(out.markNotified).toEqual(['ola'])
  })

  it('sender ALDRI to ganger — republisering går til ingen', () => {
    const out = postMentionRecipients(['ola'], members, { ...base, alreadyNotified: new Set(['ola']) })
    expect(out.email).toEqual([])
    expect(out.markNotified).toEqual([])
  })

  it('dobler ikke opp med beskjed-e-posten, men merker mottakeren som varslet', () => {
    const out = postMentionRecipients(['ola', 'kari'], members, { ...base, postEmailed: new Set(['ola']) })
    expect(out.email.map((m) => m.userId)).toEqual(['kari'])
    // Ola fikk hele innlegget i innboksen; han er varslet, og skal ikke få
    // omtale-e-posten senere heller.
    expect(out.markNotified).toEqual(['ola', 'kari'])
  })
})
