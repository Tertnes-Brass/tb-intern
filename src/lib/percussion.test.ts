import { describe, expect, it } from 'vitest'
import {
  PERCUSSION_MAX_LENGTH,
  type PercussionViewer,
  parsePercussionSetup,
  percussionLines,
  sharedPartsSeePercussion,
  showPercussionFor,
} from './percussion'

function viewer(permissions: string[], sections: string[]): PercussionViewer {
  return { permissions, parts: sections.map((section) => ({ section })) }
}

describe('showPercussionFor', () => {
  it('viser linjen for et medlem med en stemme i slagverksseksjonen', () => {
    expect(showPercussionFor(viewer(['scores.view'], ['perc']))).toBe(true)
  })

  it('skjuler linjen for en kornettist', () => {
    expect(showPercussionFor(viewer(['scores.view'], ['cornet']))).toBe(false)
  })

  it('skjuler linjen for et styremedlem uten slagverksstemme', () => {
    expect(showPercussionFor(viewer(['scores.view', 'board.manage', 'posts.publish'], ['tuba']))).toBe(false)
  })

  it('viser linjen for arkivar, dirigent og prosjektansvarlig uten slagverksstemme', () => {
    expect(showPercussionFor(viewer(['archive.viewAll'], ['cornet']))).toBe(true)
    expect(showPercussionFor(viewer(['works.manage'], []))).toBe(true)
    expect(showPercussionFor(viewer(['projects.manage'], ['horn']))).toBe(true)
  })

  it('viser linjen for admin (jokerrettigheten)', () => {
    expect(showPercussionFor(viewer(['*'], []))).toBe(true)
  })

  it('viser ingenting uten innlogget bruker', () => {
    expect(showPercussionFor(null)).toBe(false)
  })

  it('holder seg til seksjonen, ikke til navnet på stemmen', () => {
    // En stemme som *heter* noe slagverksaktig, men ligger i en annen seksjon,
    // skal ikke gi innsyn — seksjonen er sannheten (`taxonomy.ts`).
    expect(showPercussionFor(viewer([], ['euph-bari']))).toBe(false)
  })
})

describe('sharedPartsSeePercussion', () => {
  it('gjelder når vikarens tildelte stemmer inkluderer slagverk', () => {
    expect(sharedPartsSeePercussion([{ section: 'perc' }])).toBe(true)
    expect(sharedPartsSeePercussion([{ section: 'cornet' }, { section: 'perc' }])).toBe(true)
  })

  it('gjelder ikke for en vikar på kornett', () => {
    expect(sharedPartsSeePercussion([{ section: 'cornet' }])).toBe(false)
    expect(sharedPartsSeePercussion([])).toBe(false)
  })
})

describe('parsePercussionSetup', () => {
  it('gjør tom tekst til null', () => {
    expect(parsePercussionSetup('')).toBeNull()
    expect(parsePercussionSetup('   \n  \n ')).toBeNull()
    expect(parsePercussionSetup(null)).toBeNull()
    expect(parsePercussionSetup(undefined)).toBeNull()
  })

  it('trimmer hver linje og fjerner blanke linjer i endene', () => {
    expect(parsePercussionSetup('\n  Timpani – Silje  \n Trommesett – Karim \n\n')).toBe(
      'Timpani – Silje\nTrommesett – Karim',
    )
  })

  it('beholder blanke linjer inne i teksten', () => {
    expect(parsePercussionSetup('Timpani – Silje\n\nCymbal – Ole')).toBe('Timpani – Silje\n\nCymbal – Ole')
  })

  it('normaliserer CRLF', () => {
    expect(parsePercussionSetup('Pauker\r\nCymbal\rTriangel')).toBe('Pauker\nCymbal\nTriangel')
  })

  it('kutter på maks lengde', () => {
    const long = 'a'.repeat(PERCUSSION_MAX_LENGTH + 500)
    expect(parsePercussionSetup(long)).toHaveLength(PERCUSSION_MAX_LENGTH)
  })
})

describe('percussionLines', () => {
  it('deler opp i linjer og hopper over de tomme', () => {
    expect(percussionLines('Timpani – Silje\n\n  Cymbal – Ole  ')).toEqual(['Timpani – Silje', 'Cymbal – Ole'])
  })

  it('gir tom liste uten oppsett', () => {
    expect(percussionLines(null)).toEqual([])
    expect(percussionLines('')).toEqual([])
  })
})
