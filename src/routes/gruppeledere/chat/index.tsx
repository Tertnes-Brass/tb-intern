import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { type ChatApi, type ChatChannelApi, ChatPanel } from '../../../components/ChatPanel'
import { Button, Kicker } from '../../../components/ui'
import { GENERAL_CHANNEL } from '../../../lib/board'
import {
  createChannel,
  deleteMessage,
  listChannels,
  listMessages,
  markChannelRead,
  postMessage,
  renameChannel,
  setChannelArchived,
} from '../../../server/gruppeledere'

type ChatSearch = { kanal?: string }

/**
 * Gruppeledernes chat. Samme komponent som styrechatten (`ChatPanel`), men et
 * helt annet API: alt her går mot `src/server/gruppeledere.ts`, som gater hver
 * funksjon på `requireGroupLeader()` og bare rører `leader_*`-tabellene. Ingen
 * styremelding kan komme hit, uansett hva klienten spør om.
 */
const LEADER_CHAT_API: ChatApi = { listMessages, postMessage, deleteMessage, markChannelRead }
const LEADER_CHANNEL_API: ChatChannelApi = { createChannel, renameChannel, setChannelArchived }

export const Route = createFileRoute('/gruppeledere/chat/')({
  // Kanalen ligger i URL-en, så en tråd kan lenkes til uten at man må lete den
  // opp igjen. Samme format som kanalnøkkelen: `?kanal=custom:<id>`.
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
  const [creating, setCreating] = useState(false)

  const active = data.channels.find((c) => c.channel === search.kanal) ?? data.channels[0]

  const openChannel = (channel: string) => {
    void navigate({ search: channel === GENERAL_CHANNEL ? {} : { kanal: channel }, replace: true })
  }

  return (
    <div className="space-y-6">
      <header className="rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <Kicker className="mb-2">Stemmegruppene</Kicker>
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Chat</h1>
        </div>
        <Button onClick={() => setCreating(true)}>Ny kanal</Button>
      </header>

      <ChatPanel
        channels={data.channels}
        meId={data.meId}
        active={active}
        onOpenChannel={openChannel}
        api={LEADER_CHAT_API}
        channelApi={LEADER_CHANNEL_API}
        onRefresh={() => router.invalidate()}
        creating={creating}
        onCreatingChange={setCreating}
        missingGeneralNote="Fellesekanalen mangler — det skal ikke kunne skje."
        emptyFor={(channel) =>
          channel.channel === GENERAL_CHANNEL
            ? {
                title: 'Ingen meldinger ennå',
                body: 'Dette er gruppeledernes felles kanal. Skriv den første meldingen.',
              }
            : {
                title: 'Ingen meldinger i tråden',
                body: 'Diskuter temaet her i stedet for i en chat ingen finner igjen.',
              }
        }
      />
    </div>
  )
}
