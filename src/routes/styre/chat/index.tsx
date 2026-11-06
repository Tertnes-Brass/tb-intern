import { createFileRoute, useRouter } from '@tanstack/react-router'
import { type ChatApi, type ChatChannelApi, ChatPanel } from '../../../components/ChatPanel'
import { GENERAL_CHANNEL } from '../../../lib/board'
import {
  createChannel,
  deleteMessage,
  listChannels,
  listMessages,
  markChannelRead,
  postMessage,
  renameChannel,
  searchMentionableMembers,
  setChannelArchived,
} from '../../../server/board'

type ChatSearch = { kanal?: string }

/**
 * Styrets kanaler. Alt under her går mot `src/server/board.ts`, som gater hver
 * eneste funksjon på `board.manage` — også lesing. `ChatPanel` er delt med
 * gruppelederområdet, men API-et er ikke: komponenten kjenner bare funksjonene
 * den får inn.
 */
const BOARD_CHAT_API: ChatApi = { listMessages, postMessage, deleteMessage, markChannelRead, searchMentionableMembers }
const BOARD_CHANNEL_API: ChatChannelApi = { createChannel, renameChannel, setChannelArchived }

export const Route = createFileRoute('/styre/chat/')({
  // Kanalen ligger i URL-en, så en tråd kan lenkes til fra et møte eller en
  // melding uten at man må lete den opp igjen. Samme format som kanalnøkkelen:
  // `?kanal=project:<id>` og `?kanal=custom:<id>`.
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

  const active = data.channels.find((c) => c.channel === search.kanal) ?? data.channels[0]

  const openChannel = (channel: string) => {
    void navigate({ search: channel === GENERAL_CHANNEL ? {} : { kanal: channel }, replace: true })
  }

  // Ingen sideoverskrift: chatten er en arbeidsflate som fyller skjermen
  // (`ChatPanel`), og navnet står i kanallista og som h1 for skjermlesere.
  return (
    <ChatPanel
      title="Styrechat"
      kicker="Styrearbeidet"
      channels={data.channels}
      meId={data.meId}
      active={active}
      onOpenChannel={openChannel}
      api={BOARD_CHAT_API}
      channelApi={BOARD_CHANNEL_API}
      onRefresh={() => router.invalidate()}
      missingGeneralNote="Fellesekanalen mangler — det skal ikke kunne skje."
      emptyFor={(channel) =>
        channel.channel === GENERAL_CHANNEL
          ? {
              title: 'Ingen meldinger ennå',
              body: 'Dette er styrets felles kanal. Skriv den første meldingen.',
            }
          : {
              title: 'Ingen meldinger i tråden',
              body: 'Diskuter temaet her i stedet for i en chat ingen finner igjen.',
            }
      }
    />
  )
}
