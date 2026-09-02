import { describe, expect, it } from 'vitest'
import {
  INTEREST_KEYS,
  MAX_SECONDARY_PARTS,
  canSeeContactInfo,
  cleanSecondaryParts,
  countInterests,
  hasProfileDetails,
  interestLabel,
  interestsSchema,
  matchesInterests,
  matchesMemberQuery,
  normalizeInterests,
  normalizeNote,
  parseInterests,
  redactContact,
  secondaryPartsSchema,
  serializeInterests,
} from './member-profile'

describe('interesser', () => {
  it('normaliserer til katalogrekkefølge uansett hvilken rekkefølge det krysses av i', () => {
    expect(normalizeInterests(['social', 'dugnad', 'rigg'])).toEqual(['dugnad', 'rigg', 'social'])
  })

  it('fjerner duplikater og ukjente nøkler — en rå payload lager ikke egne tagger', () => {
    expect(normalizeInterests(['rigg', 'rigg', 'admin', 'sletting'])).toEqual(['rigg'])
  })

  it('leser JSON-kolonnen og tåler tomt, ugyldig og feil form', () => {
    expect(parseInterests('["rigg","transport"]')).toEqual(['rigg', 'transport'])
    expect(parseInterests(null)).toEqual([])
    expect(parseInterests('')).toEqual([])
    expect(parseInterests('ikke json')).toEqual([])
    expect(parseInterests('{"rigg":true}')).toEqual([])
    expect(parseInterests('[1,2,"rigg"]')).toEqual(['rigg'])
  })

  it('går rundt: serialisert og lest tilbake gir det samme', () => {
    expect(parseInterests(serializeInterests(['archive', 'board']))).toEqual(['board', 'archive'])
  })

  it('avviser ukjente nøkler i skjemaet', () => {
    expect(interestsSchema.safeParse(['rigg', 'transport']).success).toBe(true)
    expect(interestsSchema.safeParse(['rigg', 'ikke-en-tagg']).success).toBe(false)
  })

  it('har en norsk etikett for hver nøkkel, og faller tilbake til nøkkelen', () => {
    for (const key of INTEREST_KEYS) expect(interestLabel(key)).not.toBe(key)
    expect(interestLabel('ukjent')).toBe('ukjent')
  })
})

describe('matchesInterests', () => {
  it('slipper alle gjennom uten valgte tagger', () => {
    expect(matchesInterests([], [])).toBe(true)
    expect(matchesInterests(['rigg'], [])).toBe(true)
  })

  it('snevrer inn: flere valgte tagger krever ALLE', () => {
    expect(matchesInterests(['rigg', 'transport'], ['rigg'])).toBe(true)
    expect(matchesInterests(['rigg', 'transport'], ['rigg', 'transport'])).toBe(true)
    expect(matchesInterests(['rigg'], ['rigg', 'transport'])).toBe(false)
  })
})

describe('countInterests', () => {
  it('teller hvert medlem én gang per tagg', () => {
    const counts = countInterests([
      { interests: ['rigg', 'rigg', 'transport'] },
      { interests: ['rigg'] },
      { interests: [] },
    ])
    expect(counts.rigg).toBe(2)
    expect(counts.transport).toBe(1)
    expect(counts.dugnad).toBe(0)
  })
})

describe('cleanSecondaryParts', () => {
  it('fjerner stemmer medlemmet allerede er tildelt — én sannhet om hovedstemmen', () => {
    expect(cleanSecondaryParts(['solo-cornet', 'euphonium'], ['solo-cornet'])).toEqual(['euphonium'])
  })

  it('fjerner duplikater og tomme verdier', () => {
    expect(cleanSecondaryParts(['tuba', 'tuba', ''], [])).toEqual(['tuba'])
  })

  it('kutter ved taket', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(cleanSecondaryParts(many, [])).toHaveLength(MAX_SECONDARY_PARTS)
  })

  it('skjemaet avviser mer enn taket', () => {
    expect(secondaryPartsSchema.safeParse(['a', 'b']).success).toBe(true)
    expect(secondaryPartsSchema.safeParse(['a', 'b', 'c', 'd', 'e']).success).toBe(false)
  })
})

describe('normalizeNote', () => {
  it('lagrer tom tekst som null, ikke som tom streng', () => {
    expect(normalizeNote('   ')).toBeNull()
    expect(normalizeNote('')).toBeNull()
    expect(normalizeNote('  har hengerfeste ')).toBe('har hengerfeste')
  })
})

const admin = { canManageMembers: true, viewerId: 'admin' }
const musiker = { canManageMembers: false, viewerId: 'musiker' }

describe('canSeeContactInfo', () => {
  it('gir alle innloggede medlemmer kontaktinfo om AKTIVE medlemmer (#14)', () => {
    expect(canSeeContactInfo(musiker, { id: 'annen', isActive: true })).toBe(true)
  })

  it('skjuler kontaktinfo om deaktiverte medlemmer for vanlige medlemmer', () => {
    expect(canSeeContactInfo(musiker, { id: 'sluttet', isActive: false })).toBe(false)
  })

  it('lar medlemsansvarlig se også de deaktiverte', () => {
    expect(canSeeContactInfo(admin, { id: 'sluttet', isActive: false })).toBe(true)
  })

  it('lar deg alltid se din egen, også om profilen er deaktivert', () => {
    expect(canSeeContactInfo(musiker, { id: 'musiker', isActive: false })).toBe(true)
  })
})

describe('redactContact', () => {
  const sluttet = { id: 'sluttet', isActive: false, email: 'sluttet@tb.no', phone: '+4790000000' }

  it('fjerner e-post og telefon fra payloaden — ikke bare fra skjermen', () => {
    const out = redactContact(musiker, sluttet)
    expect(out.email).toBe('')
    expect(out.phone).toBeNull()
  })

  it('lar raden stå urørt når den som ser har lov', () => {
    expect(redactContact(admin, sluttet)).toEqual(sluttet)
    const aktiv = { ...sluttet, id: 'aktiv', isActive: true }
    expect(redactContact(musiker, aktiv)).toEqual(aktiv)
  })
})

describe('matchesMemberQuery', () => {
  const member = {
    name: 'Ingrid Hansen',
    email: 'ingrid@tb.no',
    phone: '+47 900 12 345',
    parts: [{ name: 'Solokornett' }],
    secondaryParts: [{ name: 'Eufonium' }],
    otherInstruments: 'piano',
  }

  it('treffer navn, e-post, telefon, stemme, bistemme og fritekst', () => {
    for (const q of ['ingrid', 'INGRID@tb', '900 12', 'solokornett', 'eufonium', 'piano']) {
      expect(matchesMemberQuery(member, q)).toBe(true)
    }
  })

  it('slipper alle gjennom ved tomt søk, og avviser det som ikke treffer', () => {
    expect(matchesMemberQuery(member, '   ')).toBe(true)
    expect(matchesMemberQuery(member, 'tuba')).toBe(false)
  })
})

describe('hasProfileDetails', () => {
  const tom = {
    phone: null,
    interests: [],
    interestsNote: null,
    otherInstruments: null,
    secondaryParts: [],
  }

  it('er usann for en profil uten utfylte felt', () => {
    expect(hasProfileDetails(tom)).toBe(false)
  })

  it('er sann så snart ett felt har verdi', () => {
    expect(hasProfileDetails({ ...tom, phone: '90000000' })).toBe(true)
    expect(hasProfileDetails({ ...tom, interests: ['rigg'] })).toBe(true)
    expect(hasProfileDetails({ ...tom, interestsNote: 'kan kjøre' })).toBe(true)
    expect(hasProfileDetails({ ...tom, otherInstruments: 'piano' })).toBe(true)
    expect(hasProfileDetails({ ...tom, secondaryParts: [{}] })).toBe(true)
  })
})
