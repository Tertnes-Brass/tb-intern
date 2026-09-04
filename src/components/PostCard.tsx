import { Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { formatDateTime } from '../lib/format'
import { postImageUrl } from '../lib/post-images-client'
import { commentCountLabel, reactionLabel, toggleReaction as nextReactionState } from '../lib/posts'
import type { PostImage, PostListItem } from '../server/posts'
import { toggleReaction } from '../server/posts'
import { toastError } from './toast'
import { Avatar, Stamp } from './ui'

/**
 * Kortet på veggen (#28) og de små delene det er bygget av — også brukt på
 * detaljsiden, så et innlegg ser likt ut uansett hvor du møter det.
 *
 * Skillet er tydelig med vilje: et «Fra styret»-innlegg får messingkant og
 * stempel, et medlemsinnlegg får forfatterens avatar og navn.
 */

/** Miniatyrer i feeden; klikk åpner bildet i ny fane (ingen egen lightbox). */
export function PostImageGrid({ images, total }: { images: PostImage[]; total: number }) {
  if (images.length === 0) return null
  const extra = total - images.length
  return (
    <ul className="mt-3 grid grid-cols-3 gap-1.5">
      {images.map((image, i) => (
        <li key={image.id} className="relative">
          <a href={postImageUrl(image.id)} target="_blank" rel="noopener noreferrer">
            <img
              src={postImageUrl(image.id)}
              alt={image.fileName}
              loading="lazy"
              className="aspect-square w-full rounded-[9px] border border-line object-cover"
            />
          </a>
          {extra > 0 && i === images.length - 1 && (
            <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-[9px] bg-ink/45 font-mono text-sm font-semibold text-paper">
              +{extra}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

export function LikeButton({
  postId,
  count,
  mine,
  className = '',
}: {
  postId: string
  count: number
  mine: boolean
  className?: string
}) {
  const router = useRouter()
  // Optimistisk: samme regel som serveren (`toggleReaction` i lib/posts.ts).
  const [state, setState] = useState({ count, mine })
  const [busy, setBusy] = useState(false)

  const click = async () => {
    const optimistic = nextReactionState(state)
    setState(optimistic)
    setBusy(true)
    try {
      const result = await toggleReaction({ data: { postId } })
      setState({ count: result.count, mine: result.mine })
      await router.invalidate()
    } catch (err) {
      setState({ count, mine })
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void click()}
      disabled={busy}
      aria-pressed={state.mine}
      title={reactionLabel(state)}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${
        state.mine
          ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
          : 'border-line text-ink-soft hover:border-brass hover:text-brass-strong'
      } ${className}`}
    >
      <span aria-hidden>👍</span>
      <span>Liker</span>
      {state.count > 0 && <span className="tabular font-mono text-[0.68rem]">{state.count}</span>}
    </button>
  )
}

export function PostCard({ post, draft }: { post: PostListItem; draft?: boolean }) {
  const when = draft ? `Sist endret ${formatDateTime(post.updatedAt)}` : formatDateTime(post.publishedAt ?? post.createdAt)
  return (
    <article
      className={`sheet px-4 py-4 sm:px-5 ${post.official ? 'border-brass/45 shadow-[inset_3px_0_0_var(--brass)]' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        {post.official ? (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-brass/40 bg-[var(--brass-soft)] font-mono text-[0.6rem] font-semibold uppercase tracking-wide text-brass-strong">
            TB
          </span>
        ) : (
          <Avatar name={post.author.name} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.85rem] font-semibold text-ink">
            {post.official ? 'Styret' : post.author.name}
          </p>
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink-faint">{when}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {draft && <Stamp tone="oxblood">Utkast</Stamp>}
          {post.official && <Stamp tone="brass">Fra styret</Stamp>}
          {post.importance === 'important' && <Stamp tone="oxblood">Viktig</Stamp>}
          {post.audience === 'board' && <Stamp>Kun styret</Stamp>}
          {/* Målrettingen (#28): en beskjed til en stemmegruppe eller et
              prosjekt skal se annerledes ut enn en til hele korpset. */}
          {post.targetLabel && <Stamp>{post.targetLabel}</Stamp>}
        </div>
      </div>

      <Link to="/beskjeder/$postId" params={{ postId: post.id }} className="link-quiet mt-3 block">
        {post.title && (
          <span className="display-title block text-[1.1rem] font-semibold leading-snug text-ink sm:text-[1.22rem]">
            {post.title}
          </span>
        )}
        <span className="mt-1 block text-sm leading-relaxed text-ink-soft">{post.excerpt}</span>
      </Link>

      <PostImageGrid images={post.images} total={post.imageCount} />

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <LikeButton postId={post.id} count={post.likeCount} mine={post.likedByMe} />
        <Link
          to="/beskjeder/$postId"
          params={{ postId: post.id }}
          className="link-brass text-xs"
        >
          {commentCountLabel(post.commentCount)}
        </Link>
      </div>
    </article>
  )
}
