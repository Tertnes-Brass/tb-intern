import { sql } from 'drizzle-orm'
import { db } from '../db'
import { forumNotifyPlan, type ForumNotifyCandidate, type ForumReplyChoice } from '../lib/forum'
import { forumPlainText } from '../lib/forum-mentions'
import { parseMentions } from '../lib/mentions'
import { PUSH_TTL, forumDirectReplyPushMessage, forumMentionPushMessage, forumReplyPushMessage } from '../lib/push'
import { forumMentionNames } from './forum-mentions'
import { sendPushToUsers } from './push-send'

/**
 * Push fra forumet: nye svar i tråder man følger, og omtaler. Bare hjelpere —
 * modulen drar inn `push-send.ts` (`cloudflare:workers`) og importeres derfor
 * bare fra `forum.ts`, aldri fra en rute. Kun push, aldri e-post.
 *
 * Push er alltid et tillegg: en feil her skal aldri velte svaret som utløste
 * den, så alt fanges og logges.
 */

type CandidateRow = {
  userId: string
  isActive: number | boolean | null
  participated: number
  explicit: number | boolean | null
  caughtUp: number
  forumReplies: ForumReplyChoice | null
  mentions: 'all' | 'off' | null
}

/**
 * Alle som kan være aktuelle for et svar i tråden: de som har startet eller
 * svart i den, de med en rad i `forum_follows`, og de omtalte. Reglene for hvem
 * som faktisk får varsel er den rene `forumNotifyPlan`.
 *
 * «Lest seg opp» måles fra sist man var med i tråden — eget svar, startet
 * tråden, eller begynte å følge den. Eldre uleste svar (side to i en lang tråd
 * man aldri bladde i) skal ikke holde varslene tilbake for alltid.
 */
async function candidates(topicId: string, replyId: string | null, mentioned: string[]): Promise<ForumNotifyCandidate[]> {
  const mentionedSql = mentioned.length ? sql` or u.id in (${sql.join(mentioned.map((id) => sql`${id}`), sql`, `)})` : sql``
  const rows = await db().all<CandidateRow>(sql`
    select u.id as userId, mp.is_active as isActive,
      (u.id = t.author_id or exists (select 1 from forum_replies r where r.topic_id = t.id and r.author_id = u.id)) as participated,
      ff.following as explicit,
      not exists (select 1 from forum_replies r
        where r.topic_id = t.id and r.id <> ${replyId ?? ''} and r.deleted_at is null
          and (r.author_id is null or r.author_id <> u.id)
          and r.created_at > max(
            case when t.author_id = u.id then t.created_at else 0 end,
            coalesce((select max(o.created_at) from forum_replies o where o.topic_id = t.id and o.author_id = u.id), 0),
            coalesce(ff.updated_at, 0))
          and not exists (select 1 from forum_reply_reads rr where rr.reply_id = r.id and rr.user_id = u.id)) as caughtUp,
      np.forum_replies as forumReplies, np.mentions as mentions
    from forum_topics t
    join user u on (u.id = t.author_id
      or exists (select 1 from forum_replies r where r.topic_id = t.id and r.author_id = u.id)
      or exists (select 1 from forum_follows f where f.topic_id = t.id and f.user_id = u.id)${mentionedSql})
    left join member_profiles mp on mp.auth_user_id = u.id
    left join forum_follows ff on ff.topic_id = t.id and ff.user_id = u.id
    left join notification_preferences np on np.user_id = u.id
    where t.id = ${topicId}`)
  return rows.map((r) => ({
    userId: r.userId,
    isActive: !!r.isActive,
    participated: !!r.participated,
    explicit: r.explicit === null || r.explicit === undefined ? null : !!r.explicit,
    caughtUp: !!r.caughtUp,
    forumReplies: r.forumReplies ?? 'all',
    mentions: r.mentions ?? 'all',
  }))
}

/**
 * Etter at et svar, en ny tråd eller en redigering er lagret. `previousBody` er
 * teksten før en redigering: da varsles bare omtaler som er NYE, og verken
 * følgere eller den det ble svart på (en redigering er ikke et nytt svar).
 */
export async function notifyForum(input: {
  topicId: string
  topicTitle: string
  /** Svaret det gjelder (nytt eller redigert), eller null når det gjelder selve tråden. */
  replyId: string | null
  /** Forfatteren av svaret det ble svart på («Svar» under et svar), ellers null. */
  repliedTo?: string | null
  authorId: string
  authorName: string
  body: string
  /** «GIF»/«Bilde» når svaret har bilder (`mediaLabel`) — utdraget i varselet når teksten er tom. */
  mediaLabel?: string
  previousBody?: string
}): Promise<void> {
  try {
    const before = new Set(input.previousBody === undefined ? [] : parseMentions(input.previousBody))
    const mentioned = parseMentions(input.body).filter((id) => !before.has(id))
    const isNewReply = input.replyId !== null && input.previousBody === undefined
    if (!mentioned.length && !isNewReply) return

    const plan = forumNotifyPlan({
      authorId: input.authorId,
      mentioned,
      repliedTo: isNewReply ? input.repliedTo : null,
      candidates: await candidates(input.topicId, input.replyId, mentioned),
    })
    const reply = isNewReply ? plan.reply : []
    if (!plan.mention.length && !plan.direct.length && !reply.length) return

    const excerpt = forumPlainText(input.body, await forumMentionNames([input.body])) || input.mediaLabel || ''
    const about = { topicId: input.topicId, replyId: input.replyId, authorName: input.authorName, excerpt }
    if (plan.mention.length) {
      await sendPushToUsers(plan.mention, forumMentionPushMessage(about), { ttl: PUSH_TTL.mention, urgency: 'high' })
    }
    if (plan.direct.length && input.replyId) {
      await sendPushToUsers(
        plan.direct,
        forumDirectReplyPushMessage({ ...about, replyId: input.replyId, topicTitle: input.topicTitle }),
        { ttl: PUSH_TTL.mention, urgency: 'high' },
      )
    }
    if (reply.length) {
      await sendPushToUsers(reply, forumReplyPushMessage({ ...about, topicTitle: input.topicTitle }), { ttl: PUSH_TTL.forum })
    }
  } catch (err) {
    console.error('[push] forum:', err)
  }
}
