import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 15

export const memberNameSchema = z
  .string()
  .trim()
  .min(2, 'Navnet må ha minst 2 tegn')
  .max(100, 'Navnet kan ikke være lengre enn 100 tegn')

export const phoneSchema = z
  .string()
  .trim()
  .max(32, 'Telefonnummeret er for langt')
  .refine(
    (value) => value === '' || /^[+0-9][0-9 ()-]*$/.test(value),
    'Telefonnummeret inneholder ugyldige tegn',
  )

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Passordet må ha minst ${PASSWORD_MIN_LENGTH} tegn`)
  .max(128, 'Passordet kan ikke være lengre enn 128 tegn')

export function normalizePhone(value: string): string | null {
  const trimmed = phoneSchema.parse(value)
  return trimmed || null
}
