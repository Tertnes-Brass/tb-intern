import { env } from 'cloudflare:workers'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { postAttachments, posts } from '../db/schema'
import { newId } from '../lib/id'
import { attachmentFileName, attachmentRejectionReason, MAX_POST_ATTACHMENTS, MAX_POST_ATTACHMENT_BYTES, type PostAttachment } from '../lib/post-attachments'
import { canEditPost, canReadPost } from '../lib/posts'
import { hasPermission, type Me } from './access'

// This module is only imported by server functions and API handlers.
export async function canAttachPostFiles(postId: string, me: Me): Promise<boolean> {
  if (!hasPermission(me, 'posts.publish')) return false
  const row = (await db().select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, postId)).limit(1))[0]
  return !!row && canEditPost(me, row, true)
}

export async function postAttachmentAccess(id: string, me: Me) {
  const row = (await db().select({
    id: postAttachments.id, r2Key: postAttachments.r2Key, fileName: postAttachments.fileName,
    audience: posts.audience, publishedAt: posts.publishedAt, authorId: posts.authorId,
  }).from(postAttachments).innerJoin(posts, eq(postAttachments.postId, posts.id)).where(eq(postAttachments.id, id)).limit(1))[0]
  if (!row) return null
  const own = row.authorId !== null && row.authorId === me.id
  if (!own && !canReadPost({ audience: row.audience, publishedAt: row.publishedAt?.getTime() ?? null }, hasPermission(me, 'posts.publish'))) return null
  return row
}

/** Consume a bounded stream; Content-Length is never trusted as the real size. */
export async function readAttachmentBody(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > MAX_POST_ATTACHMENT_BYTES) throw new Error('Filen er større enn 25 MB')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Filen er tom')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_POST_ATTACHMENT_BYTES) { await reader.cancel(); throw new Error('Filen er større enn 25 MB') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const reason = attachmentRejectionReason(size)
  if (reason) throw new Error(reason)
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

export async function storePostAttachment(postId: string, rawName: string, bytes: Uint8Array, me: Me): Promise<PostAttachment> {
  const reason = attachmentRejectionReason(bytes.byteLength)
  if (reason) throw new Error(reason)
  const id = newId()
  const key = `post-attachments/${id}`
  const fileName = attachmentFileName(rawName)
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: 'application/octet-stream' } })
  try {
    // Enforce the budget atomically, even if two tabs upload at the same time.
    const result = await db().run(sql`INSERT INTO post_attachments
      (id, post_id, r2_key, file_name, size, uploaded_by, created_at)
      SELECT ${id}, ${postId}, ${key}, ${fileName}, ${bytes.byteLength}, ${me.id}, ${Date.now()}
      WHERE (SELECT count(*) FROM post_attachments WHERE post_id = ${postId}) < ${MAX_POST_ATTACHMENTS}`)
    if (!result.meta.changes) throw new Error(`Maks ${MAX_POST_ATTACHMENTS} vedlegg per beskjed`)
  } catch (error) {
    await env.FILES.delete(key)
    throw error
  }
  return { id, fileName, size: bytes.byteLength }
}
