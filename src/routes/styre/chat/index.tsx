import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { BoardChat } from '../../../components/BoardChat'
import { toast, toastError } from '../../../components/toast'
import { Button, EmptyState, Field, Kicker, Modal } from '../../../components/ui'
import {
  CHANNEL_NAME_MAX,
  type ChannelSummary,
  GENERAL_CHANNEL,
  channelCustomId,
  channelNameError,
} from '../../../lib/board'
import { createChannel, listChannels, renameChannel, setChannelArchived } from '../../../server/board'

type ChatSearch = { kanal?: string }

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
  const [refreshing, setRefreshing] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<ChannelSummary | null>(null)

  const active = data.channels.find((c) => c.channel === search.kanal) ?? data.channels[0]
  const open = data.channels.filter((c) => !c.archived)
  const archived = data.channels.filter((c) => c.archived)
  // Bare egendefinerte kanaler kan få nytt navn eller arkiveres; «Styret» og
  // prosjekttrådene eies av noe annet.
  const customId = active ? channelCustomId(active.channel) : null

  const refreshUnread = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await router.invalidate()
    } finally {
      setRefreshing(false)
    }
  }

  const openChannel = (channel: string) =>
    navigate({ search: channel === GENERAL_CHANNEL ? {} : { kanal: channel }, replace: true })

  const setArchived = async (id: string, archivedNow: boolean) => {
    try {
      await setChannelArchived({ data: { id, archived: archivedNow } })
      toast(archivedNow ? 'Kanalen er arkivert' : 'Kanalen er gjenopprettet')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    }
  }

  return (
    <div className="space-y-6">
      <header className="rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <Kicker className="mb-2">Styrearbeidet</Kicker>
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Chat</h1>
        </div>
        <Button onClick={() => setCreating(true)}>Ny kanal</Button>
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
            {open.map((c) => (
              <ChannelButton key={c.channel} channel={c} active={c.channel === active.channel} onOpen={openChannel} />
            ))}

            {archived.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowArchived((v) => !v)}
                  aria-expanded={showArchived}
                  className="flex shrink-0 items-center gap-1.5 rounded-[9px] px-3 py-2 text-left font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint transition-colors hover:text-ink lg:mt-2 lg:w-full"
                >
                  Arkiverte
                  <span className="tabular">({archived.length})</span>
                  <span aria-hidden>{showArchived ? '−' : '+'}</span>
                </button>
                {showArchived &&
                  archived.map((c) => (
                    <ChannelButton
                      key={c.channel}
                      channel={c}
                      active={c.channel === active.channel}
                      onOpen={openChannel}
                    />
                  ))}
              </>
            )}
          </nav>

          <div className="min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="display-title text-lg font-semibold text-ink">
                {active.title}
                {active.archived && <span className="ml-2 text-[0.7rem] font-normal text-ink-faint">Arkivert</span>}
              </h2>
              {customId && (
                <div className="flex shrink-0 items-center gap-3 font-mono text-[0.62rem] uppercase tracking-[0.12em]">
                  {!active.archived && (
                    <button
                      type="button"
                      onClick={() => setRenaming(active)}
                      className="cursor-pointer text-ink-faint transition-colors hover:text-ink"
                    >
                      Gi nytt navn
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setArchived(customId, !active.archived)}
                    className="cursor-pointer text-ink-faint transition-colors hover:text-ink"
                  >
                    {active.archived ? 'Gjenopprett' : 'Arkiver'}
                  </button>
                </div>
              )}
            </div>

            <BoardChat
              key={active.channel}
              channel={active.channel}
              meId={data.meId}
              writable={!active.archived}
              emptyTitle={active.channel === GENERAL_CHANNEL ? 'Ingen meldinger ennå' : 'Ingen meldinger i tråden'}
              emptyBody={
                active.channel === GENERAL_CHANNEL
                  ? 'Dette er styrets felles kanal. Skriv den første meldingen.'
                  : 'Diskuter temaet her i stedet for i en chat ingen finner igjen.'
              }
              onRead={refreshUnread}
            />
          </div>
        </div>
      )}

      <ChannelNameModal
        open={creating}
        title="Ny kanal"
        submitLabel="Opprett"
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          const res = await createChannel({ data: { name } })
          toast('Kanalen er opprettet')
          await router.invalidate()
          void openChannel(res.channel)
        }}
      />

      <ChannelNameModal
        open={renaming !== null}
        title="Gi kanalen nytt navn"
        submitLabel="Lagre"
        initial={renaming?.title ?? ''}
        onClose={() => setRenaming(null)}
        onSubmit={async (name) => {
          const id = renaming ? channelCustomId(renaming.channel) : null
          if (!id) return
          await renameChannel({ data: { id, name } })
          toast('Kanalen har fått nytt navn')
          await router.invalidate()
        }}
      />
    </div>
  )
}

function ChannelButton({
  channel,
  active,
  onOpen,
}: {
  channel: ChannelSummary
  active: boolean
  onOpen: (channel: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(channel.channel)}
      aria-current={active ? 'true' : undefined}
      className={`flex shrink-0 items-center gap-2 rounded-[9px] border px-3 py-2 text-left text-sm transition-colors lg:w-full lg:shrink ${
        active
          ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
          : 'border-line bg-paper-raised text-ink-soft hover:border-line-strong hover:text-ink'
      } ${channel.archived ? 'opacity-70' : ''}`}
    >
      <span className="min-w-0 flex-1 truncate font-medium">{channel.title}</span>
      {channel.unread > 0 && !channel.archived && (
        <span
          className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-brass px-1 font-mono text-[0.58rem] font-semibold tabular-nums text-paper-raised dark:text-paper"
          aria-label={channel.unread === 1 ? '1 ulest melding' : `${channel.unread} uleste meldinger`}
        >
          {channel.unread > 9 ? '9+' : channel.unread}
        </span>
      )}
    </button>
  )
}

/**
 * Én dialog for både «Ny kanal» og «Gi nytt navn» — samme felt, samme regler.
 * Navnekravet valideres her OG i `src/server/board.ts`; det som står her er
 * hjelp, ikke sikring.
 */
function ChannelNameModal({
  open,
  title,
  submitLabel,
  initial = '',
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  submitLabel: string
  initial?: string
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const error = touched ? channelNameError(name) : null

  // Dialogen gjenbrukes; feltet skal starte på det navnet den ble åpnet med.
  const [seed, setSeed] = useState(initial)
  if (open && seed !== initial) {
    setSeed(initial)
    setName(initial)
    setTouched(false)
  }

  const submit = async () => {
    setTouched(true)
    if (channelNameError(name)) return
    setSaving(true)
    try {
      await onSubmit(name)
      close()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  const close = () => {
    setTouched(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title={title} kicker="Kanal">
      <Field label="Navn" hint={`Maks ${CHANNEL_NAME_MAX} tegn. Navnet må være ledig blant de aktive kanalene.`}>
        <input
          className="field-input"
          value={name}
          autoFocus
          maxLength={CHANNEL_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder="Uniformer 2027"
        />
      </Field>
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={close}>Avbryt</Button>
        <Button variant="primary" onClick={submit} loading={saving}>
          {submitLabel}
        </Button>
      </div>
    </Modal>
  )
}
