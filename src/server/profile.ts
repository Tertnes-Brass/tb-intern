import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { account, memberProfiles } from '../db/schema'
import { normalizePhone, phoneSchema } from '../lib/profile'
import { requireMe } from './access'
import { auditInsert } from './audit'

export const getMyProfile = createServerFn().handler(async () => {
  const me = await requireMe()
  const d = db()
  const [profileRows, credentialRows] = await Promise.all([
    d
      .select({ phone: memberProfiles.phone })
      .from(memberProfiles)
      .where(eq(memberProfiles.authUserId, me.id))
      .limit(1),
    d
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, me.id), eq(account.providerId, 'credential')))
      .limit(1),
  ])

  return {
    name: me.name,
    email: me.email,
    phone: profileRows[0]?.phone ?? '',
    roleName: me.roleName,
    parts: me.parts.map((part) => part.nameNo),
    hasPassword: credentialRows.length > 0,
  }
})

export const updateMyPhone = createServerFn({ method: 'POST' })
  .validator(z.object({ phone: phoneSchema }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const phone = normalizePhone(data.phone)
    const d = db()
    const current = await d
      .select({ phone: memberProfiles.phone })
      .from(memberProfiles)
      .where(eq(memberProfiles.authUserId, me.id))
      .limit(1)
    if (!current[0]) throw new Error('Fant ikke medlemsprofilen din')
    if ((current[0].phone ?? null) === phone) return { ok: true, changed: false }

    await d.batch([
      d.update(memberProfiles).set({ phone }).where(eq(memberProfiles.authUserId, me.id)),
      auditInsert(d, {
        action: 'member.profile_updated',
        actorUserId: me.id,
        targetUserId: me.id,
        details: { changedFields: ['phone'] },
      }),
    ])
    return { ok: true, changed: true }
  })
