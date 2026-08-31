import { eq } from 'drizzle-orm'
import { db } from '../db'
import { postImages, posts } from '../db/schema'
import { canEditPost, canReadPost } from '../lib/posts'
import { type Me, hasPermission } from './access'

/**
 * Gaten for veggbilder, i en egen modul med vilje.
 *
 * `src/server/posts.ts` består av serverfunksjoner, som vite-pluginen fjerner
 * fra klientbygget. Disse to er vanlige eksporter kalt fra API-rutene
 * `/api/post-images/*`, og et *levende* eksport i en modul rutene importerer
 * ville dratt `cloudflare:workers` inn i klientbygget (samme grunn som
 * `calendar-feed.ts` er skilt fra `calendar.ts`).
 */

const PUBLISH_PERMISSION = 'posts.publish'

/**
 * Felles gate for bilderuta: leser innlegget bak bildet og avviser det leseren
 * ikke skal se. Eksporteres fordi `/api/post-images/*` ikke er en serverfunksjon.
 */
export async function postImageAccess(
  imageId: string,
  me: Me,
): Promise<{ r2Key: string; contentType: string; fileName: string } | null> {
  const canPublish = hasPermission(me, PUBLISH_PERMISSION)
  const row = (
    await db()
      .select({
        r2Key: postImages.r2Key,
        contentType: postImages.contentType,
        fileName: postImages.fileName,
        audience: posts.audience,
        publishedAt: posts.publishedAt,
        authorId: posts.authorId,
      })
      .from(postImages)
      .innerJoin(posts, eq(postImages.postId, posts.id))
      .where(eq(postImages.id, imageId))
      .limit(1)
  )[0]
  if (!row) return null
  const publishedAt = row.publishedAt?.getTime() ?? null
  // Utkast: forfatteren skal se sine egne bilder mens hen skriver.
  const own = row.authorId !== null && row.authorId === me.id
  if (!canReadPost({ audience: row.audience, publishedAt }, canPublish) && !own) return null
  return { r2Key: row.r2Key, contentType: row.contentType, fileName: row.fileName }
}

/** Kan `me` legge til eller fjerne bilder på dette innlegget? */
export async function canAttachImages(postId: string, me: Me): Promise<boolean> {
  const canPublish = hasPermission(me, PUBLISH_PERMISSION)
  const row = (
    await db()
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1)
  )[0]
  if (!row) return false
  // Eieren (også mens innlegget er et utkast) eller en moderator. Andre
  // roller trenger ingen egen synlighetssjekk: `canEditPost` er strengere.
  return canEditPost(me, row, canPublish)
}
