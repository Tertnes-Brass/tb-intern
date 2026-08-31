import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { BoardChat } from '../../../components/BoardChat'
import { EmptyState, Kicker } from '../../../components/ui'
import { GENERAL_CHANNEL } from '../../../lib/board'
import { listChannels } from '../../../server/board'

type ChatSearch = { kanal?: string }

export const Route = createFileRoute('/styre/chat/')({
  // Kanalen ligger i URL-en, så en tråd kan lenkes til fra et møte eller en
  // melding uten at man må lete den opp igjen.
  validateSearch: (search: Record<string, unknown>): ChatSearch =>
    typeof search.kanal === 'string' && search.kanal ? { kanal: search.kanal } : {},
  loader: () => listChannels(),
  component: ChatPage,
})

function ChatPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  const active = data.channels.find((c) => c.channel === search.kanal) ?? data.channels[0]

  const refreshUnread = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await router.invalidate()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="rise">
        <Kicker className="mb-2">Styrearbeidet</Kicker>
        <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Chat</h1>
      </header>

      {!active ? (
        <div className="sheet rise">
          <EmptyState title="Ingen kanaler">Fellesekanalen mangler — det skal ikke kunne skje.</EmptyState>
        </div>
      ) : (
        <div className="rise grid gap-5 lg:grid-cols-[220px_1fr]" style={{ animationDelay: '60ms' }}>
          {/* Mobil: kanalene som en scrollbar stripe over tråden. Desktop: en kolonne ved siden av. */}
          <nav
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Kanaler"
          >
            {data.channels.map((c) => {
              const isActive = c.channel === active.channel
              return (
                <button
                  key={c.channel}
                  type="button"
                  onClick={() => navigate({ search: c.channel === GENERAL_CHANNEL ? {} : { kanal: c.channel }, replace: true })}
                  aria-current={isActive ? 'true' : undefined}
                  className={`flex shrink-0 items-center gap-2 rounded-[9px] border px-3 py-2 text-left text-sm transition-colors lg:shrink lg:w-full ${
                    isActive
                      ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
                      : 'border-line bg-paper-raised text-ink-soft hover:border-line-strong hover:text-ink'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                  {c.unread > 0 && (
                    <span
                      className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-brass px-1 font-mono text-[0.58rem] font-semibold tabular-nums text-paper-raised dark:text-paper"
                      aria-label={c.unread === 1 ? '1 ulest melding' : `${c.unread} uleste meldinger`}
                    >
                      {c.unread > 9 ? '9+' : c.unread}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>

          <div className="min-w-0">
            <BoardChat
              key={active.channel}
              channel={active.channel}
              meId={data.meId}
              emptyTitle={active.channel === GENERAL_CHANNEL ? 'Ingen meldinger ennå' : 'Ingen meldinger i tråden'}
              emptyBody={
                active.channel === GENERAL_CHANNEL
                  ? 'Dette er styrets felles kanal. Skriv den første meldingen.'
                  : 'Diskuter prosjektet her i stedet for i en chat ingen finner igjen.'
              }
              onRead={refreshUnread}
            />
          </div>
        </div>
      )}
    </div>
  )
}
