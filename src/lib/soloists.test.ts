import { describe, expect, it } from 'vitest'
import {
  MAX_SOLOISTS_PER_WORK,
  SOLOIST_NAME_MAX,
  SOLOIST_ROLE_MAX,
  parseSoloistInput,
  soloistLabel,
  soloistName,
  soloistSummary,
} from './soloists'

describe('parseSoloistInput', () => {
  it('tar imot et internt medlem', () => {
    expect(parseSoloistInput({ userId: 'u1', role: 'Kornettsolist' })).toEqual({
      userId: 'u1',
      externalName: null,
      role: 'Kornettsolist',
    })
  })

  it('tar imot en ekstern solist som fritekst', () => {
    expect(parseSoloistInput({ externalName: '  Kåre Vik  ' })).toEqual({
      userId: null,
      externalName: 'Kåre Vik',
      role: null,
    })
  })

  it('lar en gruppe registreres som fritekstnavn', () => {
    expect(parseSoloistInput({ externalName: 'Trombonegruppa', role: 'Gruppesolo' })).toEqual({
      userId: null,
      externalName: 'Trombonegruppa',
      role: 'Gruppesolo',
    })
  })

  it('lar medlemmet vinne når begge er fylt ut — én rad kan ikke ha to navn', () => {
    expect(parseSoloistInput({ userId: 'u1', externalName: 'Gammelt navn' })).toEqual({
      userId: 'u1',
      externalName: null,
      role: null,
    })
  })

  it('avviser en solist uten både medlem og navn', () => {
    expect(() => parseSoloistInput({})).toThrow(/Velg et medlem/)
    expect(() => parseSoloistInput({ userId: '   ', externalName: '  ' })).toThrow(/Velg et medlem/)
  })

  it('kutter for lange felt og kollapser mellomrom', () => {
    const value = parseSoloistInput({
      externalName: 'x'.repeat(SOLOIST_NAME_MAX + 40),
      role: 'y'.repeat(SOLOIST_ROLE_MAX + 40),
    })
    expect(value.externalName).toHaveLength(SOLOIST_NAME_MAX)
    expect(value.role).toHaveLength(SOLOIST_ROLE_MAX)
    expect(parseSoloistInput({ externalName: 'Kåre    Vik' }).externalName).toBe('Kåre Vik')
  })

  it('har et tak som ikke er null', () => {
    expect(MAX_SOLOISTS_PER_WORK).toBeGreaterThan(1)
  })
})

describe('visning', () => {
  it('viser medlemmets nåværende navn foran fritekstnavnet', () => {
    expect(soloistName({ memberName: 'Ingrid Hansen', externalName: 'Gammelt' })).toBe('Ingrid Hansen')
    expect(soloistName({ memberName: null, externalName: 'Kåre Vik' })).toBe('Kåre Vik')
  })

  it('blir «Ukjent solist» når raden har mistet begge navnene', () => {
    expect(soloistName({ memberName: null, externalName: null })).toBe('Ukjent solist')
  })

  it('setter rollen i parentes', () => {
    expect(soloistLabel({ memberName: 'Ingrid', externalName: null, role: 'kornett' })).toBe('Ingrid (kornett)')
    expect(soloistLabel({ memberName: 'Ingrid', externalName: null, role: null })).toBe('Ingrid')
  })

  it('bøyer «Solist»/«Solister» etter antall', () => {
    expect(soloistSummary([])).toBeNull()
    expect(soloistSummary([{ memberName: 'Ingrid', externalName: null, role: null }])).toBe('Solist: Ingrid')
    expect(
      soloistSummary([
        { memberName: 'Ingrid', externalName: null, role: null },
        { memberName: null, externalName: 'Kåre Vik', role: 'vikar' },
      ]),
    ).toBe('Solister: Ingrid · Kåre Vik (vikar)')
  })
})
