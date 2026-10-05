import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { postAttachments } from '../db/schema'
import { requireMe } from './access'
import { canAttachPostFiles } from './post-attachment-storage'

export const deletePostAttachment = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const me = await requireMe()
    const row = (await db().select().from(postAttachments).where(eq(postAttachments.id, data.id)).limit(1))[0]
    if (!row || !(await canAttachPostFiles(row.postId, me))) throw new Error('Fant ikke vedlegget eller du mangler tilgang')
    await env.FILES.delete(row.r2Key)
    await db().delete(postAttachments).where(eq(postAttachments.id, data.id))
    return { ok: true }
  })
