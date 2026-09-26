import { eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { memberProfiles, user } from '../db/schema'
import { FORUM_ALL_MARKER } from '../lib/forum-mentions'
import { mentionRejection, parseMentions, type MentionUser } from '../lib/mentions'

export async function forumMembers() {
  return db().select({ id: user.id, name: user.name }).from(user)
    .innerJoin(memberProfiles, eq(memberProfiles.authUserId, user.id))
    .where(eq(memberProfiles.isActive, true))
}

export async function checkForumMentions(body: string) {
  const ids = parseMentions(body)
  if (!ids.length && !body.includes(FORUM_ALL_MARKER)) return
  const members = await forumMembers()
  const error = mentionRejection(ids, new Set(members.map((m) => m.id)), 'En eller flere omtaler er ikke tilgjengelige i forumet.')
  if (error) throw new Error(error)
}

export async function forumMentionNames(bodies: string[]): Promise<MentionUser[]> {
  const ids = [...new Set(bodies.flatMap(parseMentions))]
  if (!ids.length) return []
  return db().select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))
}
