import { type ChatApi, ChatThread } from './ChatPanel'
import { deleteMessage, listMessages, markChannelRead, postMessage, searchMentionableMembers } from '../server/board'

/**
 * Styrechatten: `ChatThread` bundet til serverfunksjonene i
 * `src/server/board.ts`. Selve tråden bor i `ChatPanel.tsx` og deles med
 * gruppelederområdet (#81) — men bare komponenten. Dataene er adskilte fordi
 * API-et er det, og hver serverfunksjon gater seg selv på `board.manage`.
 *
 * Skallet finnes fordi det er ett sted styrechatten kobles til styrets data:
 * hverken `/styre/chat` eller prosjektsiden skal måtte kjenne til api-formen.
 */
const BOARD_CHAT_API: ChatApi = { listMessages, postMessage, deleteMessage, markChannelRead, searchMentionableMembers }

export function BoardChat(props: Omit<React.ComponentProps<typeof ChatThread>, 'api'>) {
  return <ChatThread api={BOARD_CHAT_API} {...props} />
}
