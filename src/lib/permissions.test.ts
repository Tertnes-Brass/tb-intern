import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, PERMISSION_CATALOG, describePermissions, permissionsInclude } from './permissions'

describe('PERMISSION_CATALOG', () => {
  it('har unike nøkler — to rader med samme nøkkel ville gitt to avkryssinger for samme rettighet', () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('har en norsk etikett og en forklaring på hver rettighet', () => {
    for (const perm of PERMISSION_CATALOG) {
      expect(perm.label.trim().length).toBeGreaterThan(0)
      expect(perm.hint.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('permissionsInclude', () => {
  it('treffer på nøyaktig rettighet', () => {
    expect(permissionsInclude(['scores.view', 'board.manage'], 'board.manage')).toBe(true)
    expect(permissionsInclude(['scores.view'], 'board.manage')).toBe(false)
  })

  it('lar jokeren til administrator dekke alt', () => {
    expect(permissionsInclude([ALL_PERMISSIONS], 'board.manage')).toBe(true)
    expect(permissionsInclude(new Set([ALL_PERMISSIONS]), 'noe.som.ikke.finnes')).toBe(true)
  })

  it('svarer nei på tomt sett', () => {
    expect(permissionsInclude([], 'scores.view')).toBe(false)
  })
})

describe('describePermissions', () => {
  it('beskriver i katalogens rekkefølge, ikke i rekkefølgen rettighetene kom', () => {
    const described = describePermissions(['settings.manage', 'works.manage'])
    expect(described.map((p) => p.key)).toEqual(['works.manage', 'settings.manage'])
  })

  it('gir hele katalogen for administratorjokeren', () => {
    expect(describePermissions(['*'])).toHaveLength(PERMISSION_CATALOG.length)
  })

  it('hopper over nøkler katalogen ikke kjenner — de kan ikke forklares på norsk', () => {
    expect(describePermissions(['scores.view', 'gammel.rettighet']).map((p) => p.key)).toEqual(['scores.view'])
  })
})
