import { getRequest } from '@tanstack/react-start/server'
import type { Db } from '../db'
import { auditLog } from '../db/schema'
import { newId } from '../lib/id'

export type AuditAction =
  | 'auth.password_changed'
  | 'auth.password_reset_completed'
  | 'member.invited'
  | 'member.invitation_revoked'
  | 'member.account_created'
  | 'member.parts_changed'
  | 'member.profile_updated'
  | 'member.profile_updated_by_admin'
  | 'member.role_changed'
  | 'member.section_leadership_changed'
  | 'member.password_reset_requested_by_admin'

type AuditDetails = Record<string, unknown>

const SECRET_KEY = /password|passord|secret|token|otp|authorization|cookie/i
const MAX_DETAILS_LENGTH = 4_000

/** Avviser hemmeligheter ved skrivegrensen, også når detaljer er nøstet. */
export function serializeAuditDetails(details: AuditDetails = {}): string {
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`))
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) throw new Error(`Hemmelig felt kan ikke logges: ${path}${key}`)
      visit(child, `${path}${key}.`)
    }
  }
  visit(details, '')
  const json = JSON.stringify(details)
  if (json.length > MAX_DETAILS_LENGTH) throw new Error('Revisjonsdetaljene er for store')
  return json
}

function requestIp(): string | null {
  try {
    const headers = getRequest().headers
    return headers.get('cf-connecting-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  } catch {
    return null
  }
}

export function auditInsert(
  d: Db,
  input: {
    action: AuditAction
    actorUserId?: string | null
    targetUserId?: string | null
    details?: AuditDetails
    ipAddress?: string | null
    at?: Date
  },
) {
  return d.insert(auditLog).values({
    id: newId(),
    action: input.action,
    actorUserId: input.actorUserId ?? null,
    targetUserId: input.targetUserId ?? null,
    details: serializeAuditDetails(input.details),
    ipAddress: input.ipAddress === undefined ? requestIp() : input.ipAddress,
    createdAt: input.at ?? new Date(),
  })
}

export async function writeAudit(input: Parameters<typeof auditInsert>[1]): Promise<void> {
  // Dynamisk import holder de rene serialiseringstestene uavhengige av
  // Cloudflare-runtime (`cloudflare:workers`).
  const { db } = await import('../db')
  await auditInsert(db(), input)
}
