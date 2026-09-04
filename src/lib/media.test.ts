import { describe, expect, it } from 'vitest'
import {
  MAX_MEDIA_BYTES,
  type MediaSummary,
  assignableVisibilities,
  canEditMedia,
  canViewMedia,
  compareMedia,
  contentRangeHeader,
  filterMedia,
  matchesMediaQuery,
  mediaExtension,
  mediaKindFor,
  mediaRejectionReason,
  parseByteRange,
  sanitizeMediaInput,
  unsatisfiableRangeHeader,
} from './media'

/** Kortform for et element i lista — testene bryr seg bare om noen få felt. */
function item(over: Partial<MediaSummary> = {}): MediaSummary {
  return {
    id: 'm1',
    title: 'Julekonsert 2025',
    kind: 'lyd',
    visibility: 'intern',
    recordedOn: '2025-12-14',
    description: null,
    projectName: null,
    workTitle: null,
    ...over,
  }
}

const medlem = { canManageBoard: false }
const styret = { canManageBoard: true }

describe('canViewMedia', () => {
  it('lar alle medlemmer se interne elementer', () => {
    expect(canViewMedia({ visibility: 'intern' }, medlem)).toBe(true)
  })

  it('skjuler styre-elementer for den uten board.manage', () => {
    expect(canViewMedia({ visibility: 'styre' }, medlem)).toBe(false)
    expect(canViewMedia({ visibility: 'styre' }, styret)).toBe(true)
  })

  it('behandler «offentlig-kandidat» nøyaktig som «intern» — merkingen er ikke en tilgang', () => {
    expect(canViewMedia({ visibility: 'offentlig-kandidat' }, medlem)).toBe(
      canViewMedia({ visibility: 'intern' }, medlem),
    )
    expect(canViewMedia({ visibility: 'offentlig-kandidat' }, medlem)).toBe(true)
  })
})

describe('assignableVisibilities', () => {
  it('gir «styre» kun til den som selv har styretilgang', () => {
    expect(assignableVisibilities(medlem)).toEqual(['intern', 'offentlig-kandidat'])
    expect(assignableVisibilities(styret)).toEqual(['intern', 'styre', 'offentlig-kandidat'])
  })
})

describe('canEditMedia', () => {
  it('krever media.manage', () => {
    expect(canEditMedia({ visibility: 'intern' }, { canManageMedia: false, canManageBoard: true })).toBe(false)
    expect(canEditMedia({ visibility: 'intern' }, { canManageMedia: true, canManageBoard: false })).toBe(true)
  })

  it('lar ikke media.manage alene røre et styre-element leseren ikke ser', () => {
    expect(canEditMedia({ visibility: 'styre' }, { canManageMedia: true, canManageBoard: false })).toBe(false)
    expect(canEditMedia({ visibility: 'styre' }, { canManageMedia: true, canManageBoard: true })).toBe(true)
  })
})

describe('mediaKindFor', () => {
  it('utleder typen av innholdstypen', () => {
    expect(mediaKindFor('audio/mpeg')).toBe('lyd')
    expect(mediaKindFor('image/jpeg')).toBe('bilde')
    expect(mediaKindFor('video/mp4')).toBe('video')
  })

  it('tåler parametre og store bokstaver', () => {
    expect(mediaKindFor('AUDIO/MPEG; charset=binary')).toBe('lyd')
  })

  it('avviser alt annet — den er hele allowlisten', () => {
    expect(mediaKindFor('application/pdf')).toBeNull()
    expect(mediaKindFor('text/html')).toBeNull()
    expect(mediaKindFor('image/svg+xml')).toBeNull()
    expect(mediaKindFor('')).toBeNull()
  })
})

describe('mediaRejectionReason', () => {
  it('godtar en vanlig lydfil', () => {
    expect(mediaRejectionReason({ type: 'audio/mpeg', size: 5_000_000 })).toBeNull()
  })

  it('avviser feil filtype', () => {
    expect(mediaRejectionReason({ type: 'application/zip', size: 10 })).toMatch(/støttes ikke/)
  })

  it('avviser tom fil', () => {
    expect(mediaRejectionReason({ type: 'audio/mpeg', size: 0 })).toBe('Tom fil')
  })

  it('avviser over 95 MB med en melding som sier hva man gjør i stedet', () => {
    const reason = mediaRejectionReason({ type: 'video/mp4', size: MAX_MEDIA_BYTES + 1 })
    expect(reason).toMatch(/95 MB/)
    expect(mediaRejectionReason({ type: 'video/mp4', size: MAX_MEDIA_BYTES })).toBeNull()
  })
})

describe('mediaExtension', () => {
  it('bygger endelsen av innholdstypen, aldri av filnavnet', () => {
    expect(mediaExtension('audio/mpeg')).toBe('mp3')
    expect(mediaExtension('video/quicktime')).toBe('mov')
    expect(mediaExtension('image/png')).toBe('png')
  })
})

describe('parseByteRange', () => {
  const size = 1000

  it('gir hele filen uten header', () => {
    expect(parseByteRange(null, size)).toEqual({ kind: 'full' })
    expect(parseByteRange('', size)).toEqual({ kind: 'full' })
  })

  it('leser et vanlig område', () => {
    expect(parseByteRange('bytes=0-499', size)).toEqual({ kind: 'range', range: { offset: 0, length: 500 } })
    expect(parseByteRange('bytes=500-999', size)).toEqual({ kind: 'range', range: { offset: 500, length: 500 } })
  })

  it('leser «fra og ut» — det Safari sender først for en <audio>', () => {
    expect(parseByteRange('bytes=0-', size)).toEqual({ kind: 'range', range: { offset: 0, length: 1000 } })
    expect(parseByteRange('bytes=900-', size)).toEqual({ kind: 'range', range: { offset: 900, length: 100 } })
  })

  it('leser suffiks («de siste N bytene»)', () => {
    expect(parseByteRange('bytes=-200', size)).toEqual({ kind: 'range', range: { offset: 800, length: 200 } })
  })

  it('klipper et suffiks som er større enn filen', () => {
    expect(parseByteRange('bytes=-5000', size)).toEqual({ kind: 'range', range: { offset: 0, length: 1000 } })
  })

  it('klipper en slutt som går forbi filen', () => {
    expect(parseByteRange('bytes=900-5000', size)).toEqual({ kind: 'range', range: { offset: 900, length: 100 } })
  })

  it('svarer 416 når starten er utenfor filen', () => {
    expect(parseByteRange('bytes=1000-', size)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange('bytes=2000-3000', size)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange('bytes=-0', size)).toEqual({ kind: 'unsatisfiable' })
  })

  it('svarer 416 for enhver range mot en tom fil', () => {
    expect(parseByteRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it('ignorerer ugyldig syntaks og ukjent enhet (RFC 9110: gi hele filen)', () => {
    expect(parseByteRange('items=0-10', size)).toEqual({ kind: 'full' })
    expect(parseByteRange('bytes=abc', size)).toEqual({ kind: 'full' })
    expect(parseByteRange('bytes=-', size)).toEqual({ kind: 'full' })
    expect(parseByteRange('bytes=500-100', size)).toEqual({ kind: 'full' })
  })

  it('gir hele filen for flere områder i én header — vi svarer ikke multipart', () => {
    expect(parseByteRange('bytes=0-99,200-299', size)).toEqual({ kind: 'full' })
  })

  it('tåler mellomrom rundt likhetstegnet', () => {
    expect(parseByteRange('bytes = 0-9', size)).toEqual({ kind: 'range', range: { offset: 0, length: 10 } })
  })
})

describe('Content-Range', () => {
  it('skriver siste byte inklusivt, slik RFC-en krever', () => {
    expect(contentRangeHeader({ offset: 0, length: 500 }, 1000)).toBe('bytes 0-499/1000')
    expect(contentRangeHeader({ offset: 900, length: 100 }, 1000)).toBe('bytes 900-999/1000')
  })

  it('skriver stjerne på et 416-svar', () => {
    expect(unsatisfiableRangeHeader(1000)).toBe('bytes */1000')
  })
})

describe('matchesMediaQuery', () => {
  const rad = item({ title: 'Gaelforce', description: 'Siste gjennomkjøring', projectName: 'Julekonsert' })

  it('treffer på tittel, beskrivelse og prosjekt', () => {
    expect(matchesMediaQuery(rad, 'gael')).toBe(true)
    expect(matchesMediaQuery(rad, 'gjennomkjøring')).toBe(true)
    expect(matchesMediaQuery(rad, 'julekonsert')).toBe(true)
  })

  it('krever at alle ordene treffer', () => {
    expect(matchesMediaQuery(rad, 'gaelforce julekonsert')).toBe(true)
    expect(matchesMediaQuery(rad, 'gaelforce sommerkonsert')).toBe(false)
  })

  it('tomt søk treffer alt', () => {
    expect(matchesMediaQuery(rad, '   ')).toBe(true)
  })
})

describe('filterMedia', () => {
  const items = [
    item({ id: 'a', kind: 'lyd', visibility: 'intern' }),
    item({ id: 'b', kind: 'video', visibility: 'styre' }),
    item({ id: 'c', kind: 'bilde', visibility: 'offentlig-kandidat' }),
  ]

  it('tomt filter gir hele lista i samme rekkefølge', () => {
    expect(filterMedia(items, {}).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('filtrerer på type og tilgangsnivå', () => {
    expect(filterMedia(items, { kind: 'video' }).map((i) => i.id)).toEqual(['b'])
    expect(filterMedia(items, { visibility: 'offentlig-kandidat' }).map((i) => i.id)).toEqual(['c'])
  })

  it('filtrerer på prosjekt og verk — krysslenkene fra andre områder', () => {
    const linked = [
      { ...item({ id: 'x' }), projectId: 'p1', workId: null },
      { ...item({ id: 'y' }), projectId: 'p2', workId: 'w1' },
    ]
    expect(filterMedia(linked, { projectId: 'p1' }).map((i) => i.id)).toEqual(['x'])
    expect(filterMedia(linked, { workId: 'w1' }).map((i) => i.id)).toEqual(['y'])
  })
})

describe('compareMedia', () => {
  it('sorterer nyeste opptak først', () => {
    const sorted = [
      item({ id: 'gammel', recordedOn: '2019-05-17' }),
      item({ id: 'ny', recordedOn: '2026-01-10' }),
    ].sort(compareMedia)
    expect(sorted.map((i) => i.id)).toEqual(['ny', 'gammel'])
  })

  it('legger de udaterte sist, uansett rekkefølge inn', () => {
    const sorted = [
      item({ id: 'udatert', recordedOn: null }),
      item({ id: 'datert', recordedOn: '2019-05-17' }),
    ].sort(compareMedia)
    expect(sorted.map((i) => i.id)).toEqual(['datert', 'udatert'])
  })

  it('sorterer like datoer på tittel med norsk kollasjon', () => {
    const sorted = [
      item({ id: 'aa', title: 'Åpning', recordedOn: '2025-01-01' }),
      item({ id: 'bb', title: 'Zulu', recordedOn: '2025-01-01' }),
    ].sort(compareMedia)
    expect(sorted.map((i) => i.id)).toEqual(['bb', 'aa'])
  })
})

describe('sanitizeMediaInput', () => {
  it('krever tittel', () => {
    expect(() => sanitizeMediaInput({ title: '   ' }, styret)).toThrow(/tittel/)
  })

  it('trimmer og kollapser mellomrom i tittelen', () => {
    expect(sanitizeMediaInput({ title: '  Julekonsert   2025 ' }, medlem).title).toBe('Julekonsert 2025')
  })

  it('gjør tom tekst til null', () => {
    const value = sanitizeMediaInput({ title: 'T', description: '  ', projectId: '', workId: '' }, medlem)
    expect(value.description).toBeNull()
    expect(value.projectId).toBeNull()
    expect(value.workId).toBeNull()
  })

  it('bevarer linjeskift i beskrivelsen, men ikke tomme blokker', () => {
    const value = sanitizeMediaInput({ title: 'T', description: 'a\n\n\n\nb' }, medlem)
    expect(value.description).toBe('a\n\nb')
  })

  it('standard er «intern»', () => {
    expect(sanitizeMediaInput({ title: 'T' }, medlem).visibility).toBe('intern')
  })

  it('avviser et ukjent tilgangsnivå', () => {
    expect(() => sanitizeMediaInput({ title: 'T', visibility: 'offentlig' }, styret)).toThrow(/tilgangsnivå/)
  })

  it('lar ikke en uten styretilgang sette «Bare styret», heller ikke i et rått kall', () => {
    expect(() => sanitizeMediaInput({ title: 'T', visibility: 'styre' }, medlem)).toThrow(/styretilgang/)
    expect(sanitizeMediaInput({ title: 'T', visibility: 'styre' }, styret).visibility).toBe('styre')
  })

  it('krever ISO-dato når datoen er satt', () => {
    expect(() => sanitizeMediaInput({ title: 'T', recordedOn: '14.12.2025' }, medlem)).toThrow(/ÅÅÅÅ-MM-DD/)
    expect(sanitizeMediaInput({ title: 'T', recordedOn: '2025-12-14' }, medlem).recordedOn).toBe('2025-12-14')
    expect(sanitizeMediaInput({ title: 'T', recordedOn: null }, medlem).recordedOn).toBeNull()
  })
})
