import { describe, expect, it } from 'vitest'
import {
  type AssetProjectLink,
  type AssetSummary,
  assetImageExtension,
  assetImageRejectionReason,
  compareAssets,
  filterAssets,
  lastUsedLink,
  loanStatus,
  matchesAssetQuery,
  ownerLabel,
  plannedLinks,
  sanitizeAssetInput,
} from './utstyr'

function summary(over: Partial<AssetSummary> = {}): AssetSummary {
  return {
    id: 'a1',
    name: 'Konsertskarptromme',
    category: 'Slagverk',
    manufacturer: 'Yamaha',
    model: 'CSM-1440',
    serialNumber: 'SN-2291',
    ownerKind: 'band',
    ownerName: null,
    memberName: null,
    loanedFrom: null,
    ...over,
  }
}

function link(over: Partial<AssetProjectLink> = {}): AssetProjectLink {
  return {
    projectId: 'p1',
    projectName: 'Julekonsert',
    eventDate: '2026-12-13',
    usage: 'planned',
    note: null,
    ...over,
  }
}

describe('ownerLabel', () => {
  it('viser organisasjonsnavnene for korpset og Trommelaget', () => {
    expect(ownerLabel({ ownerKind: 'band' })).toBe('Tertnes Brass')
    expect(ownerLabel({ ownerKind: 'trommelaget' })).toBe('Trommelaget')
  })

  it('viser medlemmets navn slik det er i dag', () => {
    expect(ownerLabel({ ownerKind: 'member', memberName: 'Ingrid Vik' })).toBe('Ingrid Vik')
  })

  // owner_user_id er ON DELETE SET NULL: en slettet konto skal aldri gjøre en
  // privateid gjenstand om til korpsets eiendom.
  it('faller ikke tilbake til korpset når medlemmet er borte', () => {
    expect(ownerLabel({ ownerKind: 'member', memberName: null })).toBe('Privat eier (ukjent)')
    expect(ownerLabel({ ownerKind: 'member', memberName: null, ownerName: 'Ingrid Vik' })).toBe('Ingrid Vik')
  })

  it('viser fritekstnavnet for en eier utenfor korpset', () => {
    expect(ownerLabel({ ownerKind: 'external', ownerName: 'Bergen Musikkorps' })).toBe('Bergen Musikkorps')
  })
})

describe('loanStatus', () => {
  const today = '2026-09-02'

  it('er ikke lånt uten utlåner', () => {
    expect(loanStatus({ loanedFrom: null, loanFrom: null, loanUntil: null }, today)).toEqual({ onLoan: false })
  })

  it('tar med perioden når begge datoene finnes', () => {
    expect(loanStatus({ loanedFrom: 'Krohnengen Brass', loanFrom: '2026-08-01', loanUntil: '2026-10-01' }, today))
      .toEqual({ onLoan: true, from: 'Krohnengen Brass', period: '2026-08-01 – 2026-10-01', expired: false })
  })

  it('tåler at bare én dato er kjent', () => {
    expect(loanStatus({ loanedFrom: 'Nabokorpset', loanFrom: '2026-08-01', loanUntil: null }, today).onLoan).toBe(true)
    expect(loanStatus({ loanedFrom: 'Nabokorpset', loanFrom: '2026-08-01', loanUntil: null }, today))
      .toMatchObject({ period: 'fra 2026-08-01' })
    expect(loanStatus({ loanedFrom: 'Nabokorpset', loanFrom: null, loanUntil: '2026-10-01' }, today))
      .toMatchObject({ period: 'til 2026-10-01' })
  })

  it('uten datoer er lånet fortsatt et lån', () => {
    expect(loanStatus({ loanedFrom: 'Onkel Per', loanFrom: null, loanUntil: null }, today))
      .toEqual({ onLoan: true, from: 'Onkel Per', period: null, expired: false })
  })

  it('merker et lån som er gått ut på dato', () => {
    expect(loanStatus({ loanedFrom: 'Krohnengen Brass', loanFrom: null, loanUntil: '2026-08-01' }, today).onLoan).toBe(
      true,
    )
    expect(loanStatus({ loanedFrom: 'Krohnengen Brass', loanFrom: null, loanUntil: '2026-08-01' }, today))
      .toMatchObject({ expired: true })
    // Siste dag i perioden er ikke utløpt.
    expect(loanStatus({ loanedFrom: 'Krohnengen Brass', loanFrom: null, loanUntil: today }, today))
      .toMatchObject({ expired: false })
  })
})

describe('sanitizeAssetInput', () => {
  it('krever navn', () => {
    expect(() => sanitizeAssetInput({ name: '   ' })).toThrow('navn')
  })

  it('trimmer og kollapser mellomrom', () => {
    const value = sanitizeAssetInput({ name: '  Pauke   nr. 2 ', manufacturer: ' Adams ' })
    expect(value.name).toBe('Pauke nr. 2')
    expect(value.manufacturer).toBe('Adams')
  })

  it('gjør tomme felt til null i stedet for tomme strenger', () => {
    const value = sanitizeAssetInput({ name: 'Notestativ', model: '', serialNumber: '   ' })
    expect(value.model).toBeNull()
    expect(value.serialNumber).toBeNull()
  })

  it('standard eier er korpset', () => {
    expect(sanitizeAssetInput({ name: 'Notestativ' }).ownerKind).toBe('band')
  })

  it('avviser en ukjent eiertype', () => {
    expect(() => sanitizeAssetInput({ name: 'Notestativ', ownerKind: 'kommunen' })).toThrow('Ugyldig eier')
  })

  it('krever medlem ved privat medlemseier, og navn ved ekstern eier', () => {
    expect(() => sanitizeAssetInput({ name: 'Trompet', ownerKind: 'member' })).toThrow('medlem')
    expect(() => sanitizeAssetInput({ name: 'Trompet', ownerKind: 'external' })).toThrow('navnet')
  })

  // Et rått kall skal ikke kunne legge igjen eierfelt som motsier hverandre.
  it('nullstiller eierfeltene etter valget, ikke etter det skjemaet sendte', () => {
    const band = sanitizeAssetInput({
      name: 'Trompet',
      ownerKind: 'band',
      ownerUserId: 'u1',
      ownerName: 'Ingrid Vik',
    })
    expect(band.ownerUserId).toBeNull()
    expect(band.ownerName).toBeNull()

    const member = sanitizeAssetInput({ name: 'Trompet', ownerKind: 'member', ownerUserId: 'u1', ownerName: 'Feil' })
    expect(member).toMatchObject({ ownerUserId: 'u1', ownerName: null })

    const external = sanitizeAssetInput({ name: 'Trompet', ownerKind: 'external', ownerUserId: 'u1', ownerName: 'Per' })
    expect(external).toMatchObject({ ownerUserId: null, ownerName: 'Per' })
  })

  it('avviser en låneperiode uten utlåner', () => {
    expect(() => sanitizeAssetInput({ name: 'Gong', loanFrom: '2026-08-01' })).toThrow('lånt av')
  })

  it('avviser et lån som slutter før det begynner', () => {
    expect(() =>
      sanitizeAssetInput({ name: 'Gong', loanedFrom: 'Nabokorpset', loanFrom: '2026-10-01', loanUntil: '2026-08-01' }),
    ).toThrow('slutte før')
  })

  it('avviser en dato som ikke er en dato', () => {
    expect(() => sanitizeAssetInput({ name: 'Gong', loanedFrom: 'Per', loanFrom: 'i sommer' })).toThrow('dato')
  })

  it('fjerner datoene når utlåneren fjernes', () => {
    const value = sanitizeAssetInput({ name: 'Gong', loanedFrom: '', loanFrom: '', loanUntil: '' })
    expect(value).toMatchObject({ loanedFrom: null, loanFrom: null, loanUntil: null })
  })

  it('beholder avsnitt i notatet, men ikke lange tomme strekk', () => {
    expect(sanitizeAssetInput({ name: 'Gong', notes: 'Sprekk i kanten.\n\n\n\nMå repareres.' }).notes).toBe(
      'Sprekk i kanten.\n\nMå repareres.',
    )
  })
})

describe('matchesAssetQuery og filterAssets', () => {
  it('treffer på serienummer', () => {
    expect(matchesAssetQuery(summary(), 'sn-2291')).toBe(true)
  })

  it('treffer på produsent og modell', () => {
    expect(matchesAssetQuery(summary(), 'yamaha csm')).toBe(true)
  })

  it('krever at alle ordene treffer', () => {
    expect(matchesAssetQuery(summary(), 'yamaha pauke')).toBe(false)
  })

  it('tomt søk treffer alt', () => {
    expect(matchesAssetQuery(summary(), '  ')).toBe(true)
  })

  it('kombinerer filtrene med OG', () => {
    const assets = [
      summary({ id: 'a1', category: 'Slagverk' }),
      summary({ id: 'a2', name: 'Notestativ', category: 'Notestativ', serialNumber: null }),
      summary({ id: 'a3', name: 'Gong', category: 'Slagverk', ownerKind: 'trommelaget', loanedFrom: 'Nabokorpset' }),
    ]
    expect(filterAssets(assets, { category: 'Slagverk' }).map((a) => a.id)).toEqual(['a1', 'a3'])
    expect(filterAssets(assets, { onLoan: true }).map((a) => a.id)).toEqual(['a3'])
    expect(filterAssets(assets, { category: 'Slagverk', ownerKind: 'band' }).map((a) => a.id)).toEqual(['a1'])
    expect(filterAssets(assets, {}).map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
  })
})

describe('compareAssets', () => {
  it('sorterer på kategori, så navn — og legger de ukategoriserte sist', () => {
    const assets = [
      summary({ id: 'a1', name: 'Åtteliters', category: null }),
      summary({ id: 'a2', name: 'Gong', category: 'Slagverk' }),
      summary({ id: 'a3', name: 'Bassdrum', category: 'Slagverk' }),
      summary({ id: 'a4', name: 'Henger', category: 'Transport' }),
    ]
    expect([...assets].sort(compareAssets).map((a) => a.id)).toEqual(['a3', 'a2', 'a4', 'a1'])
  })
})

describe('lastUsedLink og plannedLinks', () => {
  it('«sist brukt» er den seneste brukte prosjektdatoen', () => {
    const links = [
      link({ projectId: 'p1', usage: 'used', eventDate: '2025-12-13' }),
      link({ projectId: 'p2', usage: 'used', eventDate: '2026-05-17' }),
      link({ projectId: 'p3', usage: 'planned', eventDate: '2026-12-13' }),
    ]
    expect(lastUsedLink(links)?.projectId).toBe('p2')
  })

  it('et prosjekt uten dato kan ikke være «sist brukt»', () => {
    expect(lastUsedLink([link({ usage: 'used', eventDate: null })])).toBeNull()
  })

  it('ingen brukte koblinger gir null', () => {
    expect(lastUsedLink([link({ usage: 'planned' })])).toBeNull()
  })

  it('«skal brukes til» sorteres tidligst først, udaterte sist', () => {
    const links = [
      link({ projectId: 'p1', eventDate: null }),
      link({ projectId: 'p2', eventDate: '2026-12-13' }),
      link({ projectId: 'p3', eventDate: '2026-10-01' }),
      link({ projectId: 'p4', usage: 'used', eventDate: '2025-01-01' }),
    ]
    expect(plannedLinks(links).map((l) => l.projectId)).toEqual(['p3', 'p2', 'p1'])
  })
})

describe('bilder', () => {
  it('avviser alt som ikke er et bilde', () => {
    expect(assetImageRejectionReason({ type: 'application/pdf', size: 100 })).toContain('Bare bilder')
    expect(assetImageRejectionReason({ type: 'image/svg+xml', size: 100 })).toContain('Bare bilder')
  })

  it('avviser for store og tomme filer', () => {
    expect(assetImageRejectionReason({ type: 'image/jpeg', size: 11 * 1024 * 1024 })).toContain('10 MB')
    expect(assetImageRejectionReason({ type: 'image/jpeg', size: 0 })).toBe('Tom fil')
  })

  it('godtar et vanlig telefonbilde', () => {
    expect(assetImageRejectionReason({ type: 'IMAGE/JPEG', size: 2_000_000 })).toBeNull()
  })

  it('utleder endelsen fra innholdstypen, aldri fra filnavnet', () => {
    expect(assetImageExtension('image/png')).toBe('png')
    expect(assetImageExtension('image/heic')).toBe('heic')
    expect(assetImageExtension('noe/rart')).toBe('jpg')
  })
})
