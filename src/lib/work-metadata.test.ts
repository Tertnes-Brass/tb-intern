import { describe, expect, it } from 'vitest'
import { normalizeWorkMetadata, workMetadataInput } from './work-metadata'

describe('workMetadataInput', () => {
  it('lar begge metadatafeltene være utelatt', () => {
    expect(workMetadataInput.parse({})).toEqual({})
  })

  it('godtar undertittel og arkivnummer', () => {
    expect(workMetadataInput.parse({ subtitle: 'En suite', archiveNumber: 'A-042' })).toEqual({
      subtitle: 'En suite',
      archiveNumber: 'A-042',
    })
  })
})

describe('normalizeWorkMetadata', () => {
  it('trimmer verdier før lagring', () => {
    expect(normalizeWorkMetadata({ subtitle: '  En suite ', archiveNumber: ' A-042  ' })).toEqual({
      subtitle: 'En suite',
      archiveNumber: 'A-042',
    })
  })

  it('lagrer tomme og utelatte verdier som null', () => {
    expect(normalizeWorkMetadata({ subtitle: '  ' })).toEqual({
      subtitle: null,
      archiveNumber: null,
    })
  })
})
