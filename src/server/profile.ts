import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { account, memberProfiles, notificationPreferences } from '../db/schema'
import { type PostNotificationChoice } from '../lib/posts'
import { normalizePhone, phoneSchema } from '../lib/profile'
import { requireMe } from './access'
import { auditInsert } from './audit'

export const getMyProfile = createServerFn().handler(async () => {
  const me = await requireMe()
  const d = db()
  const [profileRows, credentialRows, notificationRows] = await Promise.all([
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
    d
      .select({ posts: notificationPreferences.posts })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, me.id))
      .limit(1),
  ])

  return {
    name: me.name,
    email: me.email,
    phone: profileRows[0]?.phone ?? '',
    roleName: me.roleName,
    parts: me.parts.map((part) => part.nameNo),
    hasPassword: credentialRows.length > 0,
    // Ingen rad = alle beskjeder. Standarden er å bli varslet.
    notifyPosts: (notificationRows[0]?.posts ?? 'all') as PostNotificationChoice,
  }
})

/**
 * Varslingsvalget for beskjeder (#28). Raden opprettes først når medlemmet
 * faktisk velger noe; fravær av rad betyr «alle beskjeder».
 */
export const updateMyPostNotifications = createServerFn({ method: 'POST' })
  .validator(z.object({ posts: z.enum(['all', 'important', 'off']) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    await db()
      .insert(notificationPreferences)
      .values({ userId: me.id, posts: data.posts })
      .onConflictDoUpdate({ target: notificationPreferences.userId, set: { posts: data.posts } })
    return { ok: true }
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
