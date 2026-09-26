import { mentionDraft, renderCommentHtml, toMarkers, type MentionUser } from './mentions'

export const FORUM_ALL = { id: 'forum:all', name: 'Alle i korpset' }
export const FORUM_ALL_MARKER = '@[all]'

export function forumMarkers(text: string, chosen: MentionUser[]): string {
  return toMarkers(text, chosen).replaceAll('@[u:forum:all]', FORUM_ALL_MARKER)
}

export function forumMentionDraft(body: string, users: MentionUser[]) {
  const chosen: MentionUser[] = []
  const text = body.split(FORUM_ALL_MARKER).map((part, index) => {
    if (index) chosen.push(FORUM_ALL)
    const draft = mentionDraft(part, users)
    chosen.push(...draft.chosen)
    return draft.text
  }).join(`@${FORUM_ALL.name}`)
  return { text, chosen }
}

export function forumMentionHtml(body: string, users: MentionUser[]) {
  return body.split(FORUM_ALL_MARKER).map((part) => renderCommentHtml(part, users))
    .join('<span class="mention">@Alle i korpset</span>')
}
