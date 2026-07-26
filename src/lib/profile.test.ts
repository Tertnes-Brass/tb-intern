import { describe, expect, it } from 'vitest'
import { PASSWORD_MIN_LENGTH, memberNameSchema, normalizePhone, passwordSchema, phoneSchema } from './profile'

describe('profilvalidering', () => {
  it('trimmer navn og telefonnummer', () => {
    expect(memberNameSchema.parse('  Ola Nordmann  ')).toBe('Ola Nordmann')
    expect(normalizePhone('  +47 900 00 000  ')).toBe('+47 900 00 000')
  })

  it('lagrer tomt telefonnummer som null', () => {
    expect(normalizePhone('   ')).toBeNull()
  })

  it('avviser ugyldig navn og telefonnummer', () => {
    expect(() => memberNameSchema.parse('A')).toThrow()
    expect(() => phoneSchema.parse('ring meg!')).toThrow()
  })

  it('krever en lang passfrase ved enkeltfaktorinnlogging', () => {
    expect(() => passwordSchema.parse('x'.repeat(PASSWORD_MIN_LENGTH - 1))).toThrow()
    expect(passwordSchema.parse('x'.repeat(PASSWORD_MIN_LENGTH))).toHaveLength(PASSWORD_MIN_LENGTH)
  })
})
