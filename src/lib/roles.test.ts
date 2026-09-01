import { describe, expect, it } from 'vitest'
import { findRoleNameCollision, normalizeRoleName, roleNameCollisionMessage } from './roles'

const ROLES = [
  { id: 'admin', name: 'Administrator', isSystem: true },
  { id: 'board', name: 'Styremedlem', isSystem: true },
  { id: 'member', name: 'Musiker', isSystem: false },
]

describe('normalizeRoleName', () => {
  it('ignorerer store bokstaver og mellomrom rundt og inni navnet', () => {
    expect(normalizeRoleName('  STYRE   medlem ')).toBe('styre medlem')
    expect(normalizeRoleName('Styremedlem')).toBe(normalizeRoleName('styremedlem'))
  })

  it('fjerner diakritika som NFD skiller ut', () => {
    expect(normalizeRoleName('Rådgiver')).toBe('radgiver')
    expect(normalizeRoleName('Réferent')).toBe(normalizeRoleName('Referent'))
  })

  it('beholder ø og æ, som er egne bokstaver og ikke dekomponerer', () => {
    expect(normalizeRoleName('Møter')).not.toBe(normalizeRoleName('Moter'))
    expect(normalizeRoleName('Sælbu')).not.toBe(normalizeRoleName('Salbu'))
  })

  it('gir tom streng for tomt navn', () => {
    expect(normalizeRoleName('   ')).toBe('')
  })
})

describe('findRoleNameCollision', () => {
  it('finner rollen som ville blitt en visuell duplikat — dette er #78', () => {
    expect(findRoleNameCollision('Styremedlem', ROLES)?.id).toBe('board')
    expect(findRoleNameCollision('  styremedlem  ', ROLES)?.id).toBe('board')
  })

  it('slipper gjennom navn som faktisk er nye', () => {
    expect(findRoleNameCollision('Materialforvalter', ROLES)).toBeNull()
  })

  it('lar en rolle beholde sitt eget navn ved omdøping', () => {
    expect(findRoleNameCollision('Styremedlem', ROLES, { excludeId: 'board' })).toBeNull()
    expect(findRoleNameCollision('Musiker', ROLES, { excludeId: 'board' })?.id).toBe('member')
  })

  it('peker på systemrollen når både en system- og en brukerrolle kolliderer', () => {
    const withDuplicate = [...ROLES, { id: 'styremedlem', name: 'Styremedlem', isSystem: false }]
    expect(findRoleNameCollision('Styremedlem', withDuplicate)?.id).toBe('board')
  })

  it('regner tomt navn som ingen kollisjon (valideringen tar det)', () => {
    expect(findRoleNameCollision('  ', ROLES)).toBeNull()
  })
})

describe('roleNameCollisionMessage', () => {
  it('sier fra at rollen er en systemrolle, og navngir den', () => {
    const message = roleNameCollisionMessage({ id: 'board', name: 'Styremedlem', isSystem: true })
    expect(message).toContain('systemrollen «Styremedlem»')
    expect(message).toContain('board')
  })

  it('navngir også en vanlig rolle', () => {
    const message = roleNameCollisionMessage({ id: 'styremedlem', name: 'Styremedlem', isSystem: false })
    expect(message).toContain('rollen «Styremedlem»')
    expect(message).not.toContain('systemrollen')
  })
})
