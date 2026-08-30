import { describe, expect, it } from 'vitest'
import { LEGACY_HOSTS, legacyHostRedirect } from './host-redirect'

const CANONICAL = 'https://intern.tertnesbrass.com'

describe('legacyHostRedirect', () => {
  it('tar med sti og query fra det gamle domenet', () => {
    expect(
      legacyHostRedirect('https://noter.tertnesbrass.com/noter/prosjekter?status=kommende', CANONICAL),
    ).toBe('https://intern.tertnesbrass.com/noter/prosjekter?status=kommende')
  })

  it('sender også API- og vikarlenker videre', () => {
    expect(legacyHostRedirect('https://noter.tertnesbrass.com/v/abc123', CANONICAL)).toBe(
      'https://intern.tertnesbrass.com/v/abc123',
    )
    expect(
      legacyHostRedirect('https://noter.tertnesbrass.com/api/auth/magic-link/verify?token=t', CANONICAL),
    ).toBe('https://intern.tertnesbrass.com/api/auth/magic-link/verify?token=t')
  })

  it('oppgraderer http til det kanoniske https-origin', () => {
    expect(legacyHostRedirect('http://noter.tertnesbrass.com/noter', CANONICAL)).toBe(
      'https://intern.tertnesbrass.com/noter',
    )
  })

  it('dekker det aller første domenet også', () => {
    expect(LEGACY_HOSTS).toContain('noter.saynain.com')
    expect(legacyHostRedirect('https://noter.saynain.com/arkiv', CANONICAL)).toBe(
      'https://intern.tertnesbrass.com/arkiv',
    )
  })

  it('rører ikke det kanoniske vertsnavnet', () => {
    expect(legacyHostRedirect('https://intern.tertnesbrass.com/noter', CANONICAL)).toBeNull()
  })

  it('rører ikke localhost eller workers.dev', () => {
    expect(legacyHostRedirect('http://localhost:3000/noter?x=1', CANONICAL)).toBeNull()
    expect(legacyHostRedirect('http://127.0.0.1:3000/noter', CANONICAL)).toBeNull()
    expect(legacyHostRedirect('https://tb-notearkiv.tb-370.workers.dev/noter', CANONICAL)).toBeNull()
  })

  it('lager ingen løkke når kanonisk origin fortsatt er det gamle domenet', () => {
    expect(legacyHostRedirect('https://noter.tertnesbrass.com/noter', 'https://noter.tertnesbrass.com')).toBeNull()
  })

  it('bruker bare origin-delen av den kanoniske URL-en', () => {
    expect(legacyHostRedirect('https://noter.tertnesbrass.com/noter', 'https://intern.tertnesbrass.com/')).toBe(
      'https://intern.tertnesbrass.com/noter',
    )
  })

  it('svarer null på søppel-input i stedet for å kaste', () => {
    expect(legacyHostRedirect('ikke en url', CANONICAL)).toBeNull()
    expect(legacyHostRedirect('https://noter.tertnesbrass.com/noter', '')).toBeNull()
  })
})
