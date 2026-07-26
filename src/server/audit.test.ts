import { describe, expect, it } from 'vitest'
import { serializeAuditDetails } from './audit'

describe('serializeAuditDetails', () => {
  it('serialiserer ufarlige, strukturerte detaljer', () => {
    expect(
      serializeAuditDetails({
        changedFields: ['name', 'phone'],
        from: { roleId: 'member' },
        to: { roleId: 'admin' },
      }),
    ).toBe('{"changedFields":["name","phone"],"from":{"roleId":"member"},"to":{"roleId":"admin"}}')
  })

  it.each(['password', 'newPassword', 'otp', 'resetToken', 'authorization', 'cookie'])(
    'avviser hemmelig nøkkel %s',
    (key) => {
      expect(() => serializeAuditDetails({ nested: { [key]: 'hemmelig' } })).toThrow(/Hemmelig felt/)
    },
  )

  it('avviser urimelig store detaljer', () => {
    expect(() => serializeAuditDetails({ value: 'x'.repeat(4_100) })).toThrow(/for store/)
  })
})
