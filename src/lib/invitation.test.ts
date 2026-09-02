import { describe, expect, it } from 'vitest'
import {
  MAX_INVITE_PARTS,
  addInvitePart,
  inviteDeliveryMessage,
  invitePayloadSchema,
  orderPartsWithPrimary,
  removeInvitePart,
  roleIdsSchema,
} from './invitation'

describe('roleIdsSchema', () => {
  it('krever minst én rolle — null roller ville gitt et medlem uten rettigheter', () => {
    expect(roleIdsSchema.safeParse([]).success).toBe(false)
    expect(roleIdsSchema.safeParse(['member']).success).toBe(true)
  })

  it('tar imot flere roller samtidig (#48)', () => {
    expect(roleIdsSchema.safeParse(['member', 'board']).success).toBe(true)
  })

  it('avviser samme rolle to ganger', () => {
    expect(roleIdsSchema.safeParse(['member', 'member']).success).toBe(false)
  })
})

const payload = (over: Record<string, unknown> = {}) => ({
  email: 'ola@example.com',
  roleIds: ['member'],
  ...over,
})

describe('invitasjonsvalidering', () => {
  it('normaliserer e-post og gjør tomt navn til «ikke oppgitt»', () => {
    const parsed = invitePayloadSchema.parse(payload({ email: '  Ola@Example.COM ', name: '   ' }))
    expect(parsed.email).toBe('ola@example.com')
    expect(parsed.name).toBeUndefined()
  })

  it('trimmer navn når det er oppgitt, men avviser for korte navn', () => {
    expect(invitePayloadSchema.parse(payload({ name: '  Ola Nordmann ' })).name).toBe('Ola Nordmann')
    expect(() => invitePayloadSchema.parse(payload({ name: 'O' }))).toThrow()
  })

  it('inviterer uten stemme og med e-post som standard', () => {
    const parsed = invitePayloadSchema.parse(payload())
    expect(parsed.partIds).toEqual([])
    expect(parsed.sendEmail).toBe(true)
  })

  it('avviser ugyldig e-post, for mange stemmer og duplikater', () => {
    expect(() => invitePayloadSchema.parse(payload({ email: 'ikke-en-epost' }))).toThrow()
    expect(() =>
      invitePayloadSchema.parse(payload({ partIds: ['a', 'b', 'c', 'd', 'e'] })),
    ).toThrow()
    expect(() => invitePayloadSchema.parse(payload({ partIds: ['solo-cornet', 'solo-cornet'] }))).toThrow()
  })

  // #48: invitasjonen bærer et SETT av roller, ikke én.
  it('tar imot flere roller, men krever minst én', () => {
    expect(invitePayloadSchema.parse(payload({ roleIds: ['member', 'board'] })).roleIds).toEqual(['member', 'board'])
    expect(() => invitePayloadSchema.parse(payload({ roleIds: [] }))).toThrow()
    expect(() => invitePayloadSchema.parse(payload({ roleIds: ['member', 'member'] }))).toThrow()
  })

  it('krever at hovedstemmen er én av de valgte stemmene', () => {
    expect(() =>
      invitePayloadSchema.parse(payload({ partIds: ['solo-cornet'], primaryPartId: 'euphonium' })),
    ).toThrow()
    expect(
      invitePayloadSchema.parse(payload({ partIds: ['solo-cornet', 'flugel'], primaryPartId: 'flugel' }))
        .primaryPartId,
    ).toBe('flugel')
  })
})

describe('hovedstemme', () => {
  it('flytter hovedstemmen først, ellers beholdes rekkefølgen', () => {
    expect(orderPartsWithPrimary(['solo-cornet', 'flugel', 'euphonium'], 'euphonium')).toEqual([
      'euphonium',
      'solo-cornet',
      'flugel',
    ])
    expect(orderPartsWithPrimary(['solo-cornet', 'flugel'])).toEqual(['solo-cornet', 'flugel'])
    expect(orderPartsWithPrimary(['solo-cornet', 'flugel'], 'eb-bass')).toEqual(['solo-cornet', 'flugel'])
  })

  it('fjerner duplikater slik at nøyaktig én stemme kan være primær', () => {
    expect(orderPartsWithPrimary(['flugel', 'solo-cornet', 'flugel'], 'flugel')).toEqual([
      'flugel',
      'solo-cornet',
    ])
  })

  it('lar første valgte stemme være primær, og neste arve rollen', () => {
    let ids = addInvitePart([], 'solo-cornet')
    ids = addInvitePart(ids, 'flugel')
    expect(ids[0]).toBe('solo-cornet')
    expect(removeInvitePart(ids, 'solo-cornet')[0]).toBe('flugel')
  })

  it('ignorerer duplikater og stopper på grensen', () => {
    expect(addInvitePart(['flugel'], 'flugel')).toEqual(['flugel'])
    const full = ['a', 'b', 'c', 'd']
    expect(full).toHaveLength(MAX_INVITE_PARTS)
    expect(addInvitePart(full, 'e')).toEqual(full)
  })
})

describe('tilbakemelding om e-post', () => {
  it('påstår bare «sendt» når e-posten faktisk gikk ut', () => {
    expect(inviteDeliveryMessage('sent', 'ola@example.com').message).toMatch(/invitasjon sendt/i)
    for (const delivery of ['logged', 'failed', 'skipped'] as const) {
      const { message, kind } = inviteDeliveryMessage(delivery, 'ola@example.com')
      expect(message).not.toMatch(/invitasjon sendt/i)
      expect(message).toContain('ola@example.com')
      expect(kind).toBe(delivery === 'skipped' ? 'ok' : 'error')
    }
  })
})
