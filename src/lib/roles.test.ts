import { describe, expect, it } from 'vitest'
import {
  accessSources,
  effectiveRoleIds,
  findRoleNameCollision,
  normalizeRoleName,
  orderRoles,
  primaryRoleId,
  roleLabel,
  roleNameCollisionMessage,
  unionRolePermissions,
} from './roles'

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

// ---------- Flere roller per medlem (#48) ----------

const MEMBER = { id: 'member', name: 'Musiker', permissions: ['scores.view'] }
const BOARD = { id: 'board', name: 'Styremedlem', permissions: ['scores.view', 'board.manage', 'posts.publish'] }
const ADMIN = { id: 'admin', name: 'Administrator', permissions: ['*'] }

const PERMISSIONS_BY_ROLE = new Map([MEMBER, BOARD, ADMIN].map((r) => [r.id, r.permissions]))

describe('effectiveRoleIds', () => {
  it('bruker koblingsradene når de finnes', () => {
    expect(effectiveRoleIds(['member', 'board'], 'member')).toEqual(['member', 'board'])
  })

  it('fjerner duplikater — samme rolle to ganger er fortsatt én rolle', () => {
    expect(effectiveRoleIds(['board', 'board'], null)).toEqual(['board'])
  })

  // Vinduet mellom migrasjon og deploy: gammel kode skriver bare den deprecated
  // kolonnen. Uten fallbacken ville et slikt medlem logget inn uten rettigheter.
  it('faller tilbake på den deprecated énrolle-kolonnen når koblingsradene mangler', () => {
    expect(effectiveRoleIds([], 'archivist')).toEqual(['archivist'])
  })

  it('gir tom liste når verken koblingsrader eller kolonne finnes', () => {
    expect(effectiveRoleIds([], null)).toEqual([])
  })

  it('ignorerer kolonnen så snart det finnes koblingsrader', () => {
    expect(effectiveRoleIds(['board'], 'member')).toEqual(['board'])
  })
})

describe('unionRolePermissions', () => {
  it('legger sammen rettighetene fra alle rollene — en musiker i styret beholder begge deler', () => {
    expect(unionRolePermissions(['member', 'board'], PERMISSIONS_BY_ROLE)).toEqual([
      'board.manage',
      'posts.publish',
      'scores.view',
    ])
  })

  it('er additiv: å legge til en rolle kan aldri fjerne en rettighet', () => {
    const alone = unionRolePermissions(['board'], PERMISSIONS_BY_ROLE)
    const combined = unionRolePermissions(['board', 'member'], PERMISSIONS_BY_ROLE)
    for (const permission of alone) expect(combined).toContain(permission)
  })

  it('gir samme svar uansett rekkefølge på rollene', () => {
    expect(unionRolePermissions(['board', 'member'], PERMISSIONS_BY_ROLE)).toEqual(
      unionRolePermissions(['member', 'board'], PERMISSIONS_BY_ROLE),
    )
  })

  it('beholder administratorjokeren som den er', () => {
    expect(unionRolePermissions(['admin', 'member'], PERMISSIONS_BY_ROLE)).toContain('*')
  })

  it('gir tom liste for ukjente roller og for ingen roller', () => {
    expect(unionRolePermissions(['finnes-ikke'], PERMISSIONS_BY_ROLE)).toEqual([])
    expect(unionRolePermissions([], PERMISSIONS_BY_ROLE)).toEqual([])
  })
})

describe('primaryRoleId', () => {
  it('beholder dagens hovedrolle når den fortsatt er valgt', () => {
    expect(primaryRoleId(['member', 'board'], 'board')).toBe('board')
  })

  it('arver den første valgte når dagens hovedrolle er tatt bort', () => {
    expect(primaryRoleId(['member', 'board'], 'archivist')).toBe('member')
  })

  it('velger den første når det ikke finnes en hovedrolle fra før', () => {
    expect(primaryRoleId(['conductor', 'member'])).toBe('conductor')
  })

  it('gir null uten roller — kolonnen er NOT NULL, så kalleren må stoppe der', () => {
    expect(primaryRoleId([], 'member')).toBeNull()
  })
})

describe('orderRoles', () => {
  it('følger rollelistas rekkefølge, ikke rekkefølgen krysset ble satt', () => {
    expect(orderRoles(['member', 'admin'], [ADMIN, BOARD, MEMBER]).map((r) => r.id)).toEqual(['admin', 'member'])
  })

  it('hopper over roller som ikke finnes i lista', () => {
    expect(orderRoles(['slettet'], [MEMBER, BOARD])).toEqual([])
  })
})

describe('roleLabel', () => {
  it('setter rollene sammen med skilletegnet resten av UI-et bruker', () => {
    expect(roleLabel(['Musiker', 'Styremedlem'])).toBe('Musiker · Styremedlem')
  })

  it('sier fra i stedet for å bli et tomt felt', () => {
    expect(roleLabel([])).toBe('Ingen rolle')
  })
})

describe('accessSources', () => {
  it('svarer på «hva får personen tilgang til, og hvorfor?»', () => {
    const board = accessSources([MEMBER, BOARD]).find((s) => s.permission.key === 'board.manage')
    expect(board?.permission.label).toBe('Styrearbeid')
    expect(board?.roleNames).toEqual(['Styremedlem'])
  })

  it('navngir BEGGE rollene når to av dem gir den samme rettigheten', () => {
    const scores = accessSources([MEMBER, BOARD]).find((s) => s.permission.key === 'scores.view')
    expect(scores?.roleNames).toEqual(['Musiker', 'Styremedlem'])
  })

  it('lar administratorrollen stå som kilde til hver enkelt rettighet', () => {
    const sources = accessSources([ADMIN])
    expect(sources.length).toBeGreaterThan(1)
    for (const source of sources) expect(source.roleNames).toEqual(['Administrator'])
  })

  it('gir tom liste for en rolle uten rettigheter', () => {
    expect(accessSources([{ name: 'Gjest', permissions: [] }])).toEqual([])
  })
})
