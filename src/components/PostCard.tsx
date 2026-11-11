import { Link } from '@tanstack/react-router'
import { postImageUrl } from '../lib/post-images-client'
import { seenThisSession } from '../lib/read-posts-client'
import type { SearchHit } from '../lib/post-search'
import { commentCountLabel } from '../lib/posts'
import type { PostImage, PostListItem } from '../server/posts'
import { ReactionBar } from './Reactions'
import { Glyph } from './compose/Composer'
import { Icon } from './Icons'
import { type ViewerImage, useImageViewer } from './ImageViewer'
import { shortWhen } from './compose/when'
import { Highlight, SearchHitLine } from './Search'
import { Avatar, Stamp } from './ui'

/**
 * Kortet på veggen (#28) og de små delene det er bygget av — også brukt på
 * detaljsiden, så et innlegg ser likt ut uansett hvor du møter det.
 *
 * Kortet er bevisst stille: avsender og én metadatalinje (navn · tid) øverst,
 * tittel og utdrag som er lenken, og to brikker nederst (Liker · kommentarer)
 * med 44 pt trykkflate på berøring. En beskjed fra styret eller notearkivaren
 * kjennes på messingmerket «TB» og avsendernavnet — ikke på kant og stempel i
 * tillegg. Bare «Viktig» og «Kun styret» er stempler, for de sier noe man ikke
 * ser ellers.
 */

/** Bildene i et innlegg slik bildeviseren vil ha dem. */
export function postViewerImages(images: readonly PostImage[]): ViewerImage[] {
  return images.map((image) => ({ key: image.id, src: postImageUrl(image.id), alt: image.fileName }))
}

/**
 * Miniatyrer i feeden. Trykk åpner bildeviseren over veggen — aldri selve
 * bildefila, som er en blindvei i installert app. Feeden har bare de første
 * bildene; flisen med «+N» går til innlegget, der alle står.
 */
export function PostImageGrid({ postId, images, total }: { postId: string; images: PostImage[]; total: number }) {
  const { open, viewer } = useImageViewer(postViewerImages(images))
  if (images.length === 0) return null
  const extra = total - images.length
  return (
    <>
      <ul className="mt-3 grid grid-cols-3 gap-1.5">
        {images.map((image, i) => {
          const thumb = (
            <img
              src={postImageUrl(image.id)}
              alt={image.fileName}
              loading="lazy"
              className="aspect-square w-full rounded-[9px] border border-line object-cover"
            />
          )
          return (
            <li key={image.id} className="relative">
              {extra > 0 && i === images.length - 1 ? (
                <Link to="/beskjeder/$postId" params={{ postId }} className="block" aria-label={`Se alle ${total} bildene i innlegget`}>
                  {thumb}
                  <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-[9px] bg-ink/45 font-mono text-sm font-semibold text-paper">
                    +{extra}
                  </span>
                </Link>
              ) : (
                <button type="button" className="block w-full cursor-zoom-in" onClick={() => open(i)} aria-label={`Vis ${image.fileName} i full størrelse`}>
                  {thumb}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {viewer}
    </>
  )
}

/** Avsenderen slik den står på kortet og på detaljsiden. */
export function postSender(post: Pick<PostListItem, 'official' | 'fromArchive' | 'author'>): string {
  return post.fromArchive ? 'Notearkivar' : post.official ? 'Styret' : post.author.name
}

/** Avatar for avsenderen: messingmerket for styret og notearkivaren, initialer ellers. */
export function SenderMark({ post, size = 'md' }: { post: Pick<PostListItem, 'official' | 'fromArchive' | 'author'>; size?: 'sm' | 'md' }) {
  if (post.official || post.fromArchive) {
    return (
      <span
        aria-hidden
        className={`${size === 'sm' ? 'h-7 w-7 text-[0.55rem]' : 'h-9 w-9 text-[0.6rem]'} grid shrink-0 place-items-center rounded-full bg-brass font-mono font-semibold uppercase tracking-wide text-paper-raised dark:text-paper`}
      >
        TB
      </span>
    )
  }
  return <Avatar name={post.author.name} size={size} />
}

export function PostCard({ post, terms, hit }: { post: PostListItem; terms?: string[]; hit?: SearchHit }) {
  const unread = post.unread && !seenThisSession(post.id)
  const institutional = post.official || post.fromArchive
  return (
    <article className="post-card">
      <div className="flex items-center gap-3">
        <SenderMark post={post} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[0.9rem] font-semibold leading-tight text-ink">
            <span className="truncate">
              <Highlight text={postSender(post)} terms={terms} />
            </span>
            {/* Samme messingprikk som uleste svar i forumet. */}
            {unread && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-brass" title="Ulest">
                <span className="sr-only">Ulest</span>
              </span>
            )}
          </p>
          <p className="mt-0.5 truncate text-[0.78rem] text-ink-faint">
            {institutional && (
              <>
                <Highlight text={post.author.name} terms={terms} />
                {' · '}
              </>
            )}
            {shortWhen(post.publishedAt ?? post.createdAt)}
            {post.pinned && (
              <span className="whitespace-nowrap">
                {' · '}
                <Icon name="pushpin" size={12} className="-mt-0.5 inline align-middle" />
                {' Festet'}
              </span>
            )}
          </p>
        </div>
        {(post.importance === 'important' || post.audience === 'board') && (
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {post.importance === 'important' && <Stamp tone="oxblood">Viktig</Stamp>}
            {post.audience === 'board' && <Stamp>Kun styret</Stamp>}
          </div>
        )}
      </div>

      <Link to="/beskjeder/$postId" params={{ postId: post.id }} className="link-quiet mt-2.5 block">
        {post.title && (
          <span
            className={`display-title block wrap-anywhere text-[1.12rem] leading-snug text-ink sm:text-[1.22rem] ${unread ? 'font-bold' : 'font-semibold'}`}
          >
            <Highlight text={post.title} terms={terms} />
          </span>
        )}
        <span className={`block wrap-anywhere text-[0.92rem] leading-relaxed text-ink-soft ${post.title ? 'mt-1 line-clamp-3' : 'line-clamp-5'}`}>
          <Highlight text={post.excerpt} terms={terms} />
        </span>
        {hit && terms && (
          <SearchHitLine
            label={hit.kind === 'comment' ? `Kommentar fra ${hit.author}` : 'Lenger ned i teksten'}
            snippet={hit.snippet}
            terms={terms}
          />
        )}
      </Link>

      <PostImageGrid postId={post.id} images={post.images} total={post.imageCount} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ReactionBar kind="post" targetId={post.id} reactions={post.reactions} size="md" />
        <Link to="/beskjeder/$postId" params={{ postId: post.id }} className="post-chip hit">
          <Glyph name="comment" size={15} />
          {post.commentCount === 0 ? 'Kommenter' : commentCountLabel(post.commentCount)}
        </Link>
      </div>
    </article>
  )
}
