import { createServerFn } from '@tanstack/react-start'
import type { ShellCounts } from '../lib/unread'
import { hasPermission, requireMe } from './access'
import { boardCounts, forumHasUnread, unreadPostCount } from './unread'

/**
 * Tellerne i skallet: ulest-tallet på Beskjeder-fanen (og app-ikonet), prikken
 * på Forum og statuslinjen på Styre-flisen i «Meg og mer». Hentes av klienten
 * etter navigasjon og når appen kommer tilbake i forgrunnen — ikke i
 * rotens `beforeLoad`, som ellers ville kostet tre spørringer per klikk.
 */
export const getShellCounts = createServerFn().handler(async (): Promise<ShellCounts> => {
  const me = await requireMe()
  const now = Date.now()
  const canManageBoard = hasPermission(me, 'board.manage')
  const [unreadPosts, forumUnread, board] = await Promise.all([
    unreadPostCount(me, now),
    forumHasUnread(me, now),
    // Et vanlig medlem skal ikke koste en spørring for et område det ikke ser.
    canManageBoard ? boardCounts(new Date(now).toISOString().slice(0, 10)) : Promise.resolve(null),
  ])
  return { unreadPosts, forumUnread, board }
})
