import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CHANNEL_NAME_MAX,
  type ChannelSummary,
  type ChatMessage,
  type ChatReply,
  channelCustomId,
  channelNameError,
  groupMessagesByDay,
  replyExcerpt,
  unreadBadge,
  unreadCount,
} from '../lib/board'
import { chatPlainText } from '../lib/chat-format'
import { formatDate, formatTime, formatWeekday, toOsloDate } from '../lib/format'
import { type MentionUser, mentionPlainText, toMarkers } from '../lib/mentions'
import { ChatText } from './ChatText'
import { MentionTextarea } from './MentionTextarea'
import { toast, toastError } from './toast'
import { Button, EmptyState, Field, Modal } from './ui'

/**
 * Chat-flaten, uavhengig av hvem som eier meldingene.
 *
 * Komponentene her kjenner verken styret eller gruppelederne — de får
 * serverfunksjonene inn som `api`/`channelApi` og en kanalnøkkel, og all
 * tilgangskontroll skjer på serveren i den modulen funksjonene kom fra. Det er
 * hele poenget med delingen: `/styre/chat` og `/gruppeledere/chat` deler
 * *utseende og oppførsel*, aldri data. Den rene kanal-logikken (nøkkelformat,
 * sortering, uleste, svarreferanser) ligger i `src/lib/board.ts` og var skrevet
 * generisk fra første stund.
 *
 * Oppdatering uten websockets: mens fanen er synlig spør klienten hvert
 * POLL_MS om det har kommet noe etter den nyeste meldingen den har. Er fanen
 * skjult, stopper pollingen helt — en telefon i lomma skal ikke ligge og
 * hamre på serveren. Ingen Durable Objects.
 */
const POLL_MS = 12_000

/** Hvor lenge en melding man har hoppet til blir stående markert. */
const HIGHLIGHT_MS = 1_800

/** Serverfunksjonene tråden trenger. Ett område = ett sett, aldri delt. */
export type ChatApi = {
  listMessages: (opts: {
    data: { channel: string; after?: number }
  }) => Promise<{
    messages: ChatMessage[]
    meId: string
    serverTime: number
    /**
     * Dagens navn på alle omtalte i sida, `id → navn`. Meldinger har ingen
     * koblingstabell (de kan verken redigeres eller varsles), så navnene
     * følger med svaret i stedet.
     */
    mentionNames: Record<string, string>
  }>
  postMessage: (opts: { data: { channel: string; body: string; replyToId?: string | null } }) => Promise<unknown>
  deleteMessage: (opts: { data: { id: string } }) => Promise<unknown>
  markChannelRead: (opts: { data: { channel: string; at?: number } }) => Promise<unknown>
  /** Forslagslista bak `@`. Gated på området funksjonen kom fra. */
  searchMentionableMembers: (opts: { data: { query: string } }) => Promise<MentionUser[]>
}

/** Serverfunksjonene kanallista trenger for å opprette/omdøpe/arkivere. */
export type ChatChannelApi = {
  createChannel: (opts: { data: { name: string } }) => Promise<{ id: string; channel: string }>
  renameChannel: (opts: { data: { id: string; name: string } }) => Promise<unknown>
  setChannelArchived: (opts: { data: { id: string; archived: boolean } }) => Promise<unknown>
}

function dayHeading(date: string, today: string): string {
  if (date === today) return 'I dag'
  const yesterday = toOsloDate(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000)
  if (date === yesterday) return 'I går'
  return `${formatWeekday(date)} ${formatDate(date)}`
}

/** Det man svarer på, slik skrivefeltet viser det før meldingen er sendt. */
type ReplyDraft = { id: string; authorName: string | null; excerpt: string }

/**
 * Chat-tråden for én kanal. Brukes både i kanalvisningene og alene nederst på
 * et styreprosjekt. Komponenten kjenner ikke til hvem som eier kanalen — den
 * får en kanalnøkkel, en `meId` og et `api`.
 */
export function ChatThread({
  api,
  channel,
  meId,
  emptyTitle = 'Ingen meldinger ennå',
  emptyBody = 'Skriv den første — dette er styrets egen tråd.',
  writable = true,
  readOnlyNote = 'Kanalen er arkivert. Historikken står, men det kan ikke skrives mer her.',
  onRead,
}: {
  api: ChatApi
  channel: string
  meId: string
  emptyTitle?: string
  emptyBody?: string
  /** Falsk for arkiverte kanaler: tråden leses, men skrivefeltet er borte. */
  writable?: boolean
  readOnlyNote?: string
  /** Kalles når kanalen er lest, så ulest-tellere utenfor kan oppdateres. */
  onRead?: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [body, setBody] = useState('')
  /** Medlemmene som er valgt fra `@`-lista — grunnlaget for `toMarkers`. */
  const [chosen, setChosen] = useState<MentionUser[]>([])
  /**
   * Navnene på alle omtalte vi har sett i denne kanalen. De akkumuleres fordi
   * pollingen bare henter NYE meldinger: navnene fra første lasting må stå igjen
   * når det kommer en melding til.
   */
  const [mentionNames, setMentionNames] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  // Hvor langt brukeren hadde lest da kanalen ble åpnet. Fryses bevisst: skillet
  // «nye meldinger» skal stå stille mens man leser, ikke flytte seg.
  const [readMarker, setReadMarker] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Meldingsboksene, så en svarreferanse kan hoppe til originalen.
  const nodeRefs = useRef(new Map<string, HTMLDivElement>())
  const latestRef = useRef(0)

  // `onRead` er som regel en ny funksjon for hver render (den kaller
  // `router.invalidate()`). Lå den i avhengighetslista, ville effektene under
  // kjørt på nytt hver gang den ble kalt — og lest-markering ⇒ invalidate ⇒ ny
  // render ⇒ lest-markering er en løkke som aldri stopper. Den bor derfor i en
  // ref, og effektene avhenger kun av kanalen. `api` behandles likt: den er som
  // regel et objektliteral hos kalleren, og skal ikke restarte pollingen.
  const onReadRef = useRef(onRead)
  const apiRef = useRef(api)
  useEffect(() => {
    onReadRef.current = onRead
    apiRef.current = api
  })

  const markRead = useCallback(
    async (at: number, notify: boolean) => {
      try {
        await apiRef.current.markChannelRead({ data: { channel, at } })
        // Ulest-tellerne utenfor oppdateres bare når tallet faktisk kan ha
        // endret seg — ikke på hver pollerunde som ikke fant noe nytt.
        if (notify) onReadRef.current?.()
      } catch {
        // Lest-markøren er bekvemmelighet, ikke data. Feil her skal være stille.
      }
    },
    [channel],
  )

  // Bytte av kanal er en ny start: tøm, hent på nytt, marker som lest.
  useEffect(() => {
    let cancelled = false
    setMessages([])
    setLoaded(false)
    setReadMarker(null)
    setReplyTo(null)
    setMentionNames({})
    nodeRefs.current.clear()
    latestRef.current = 0

    const load = async () => {
      try {
        const res = await apiRef.current.listMessages({ data: { channel } })
        if (cancelled) return
        setMessages(res.messages)
        setMentionNames(res.mentionNames)
        setLoaded(true)
        latestRef.current = res.messages[res.messages.length - 1]?.createdAt ?? 0
        await markRead(res.serverTime, true)
      } catch (err) {
        if (!cancelled) toastError(err)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [channel, markRead])

  // Polling: kun mens fanen er synlig.
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (stopped || document.visibilityState !== 'visible') return
      try {
        const res = await apiRef.current.listMessages({ data: { channel, after: latestRef.current } })
        if (stopped || res.messages.length === 0) return
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id))
          return [...prev, ...res.messages.filter((m) => !known.has(m.id))]
        })
        setMentionNames((prev) => ({ ...prev, ...res.mentionNames }))
        latestRef.current = res.messages[res.messages.length - 1]!.createdAt
        await markRead(res.serverTime, true)
      } catch {
        // Nettverket kan svikte i et sekund; neste runde prøver igjen.
      }
    }

    const schedule = () => {
      timer = setTimeout(async () => {
        await tick()
        if (!stopped) schedule()
      }, POLL_MS)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    schedule()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [channel, markRead])

  // Rull meldingsboksen til bunnen når det kommer noe nytt — bare boksen, ikke
  // hele siden: scrollIntoView ville dratt vinduet ned under toppmenyen ved
  // lasting på mobil.
  useEffect(() => {
    const box = bottomRef.current?.parentElement
    if (box) box.scrollTop = box.scrollHeight
  }, [messages.length])

  useEffect(() => {
    if (!highlightId) return
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightId])

  /**
   * Hopp til meldingen et svar peker på. Samme grunn som over til at vi regner
   * ut posisjonen selv: `scrollIntoView` ville flyttet hele vinduet, ikke bare
   * tråden.
   */
  const jumpTo = (id: string) => {
    const box = scrollRef.current
    const node = nodeRefs.current.get(id)
    if (!box || !node) return
    const top = node.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
    box.scrollTo({ top: Math.max(0, top - box.clientHeight / 2), behavior: 'smooth' })
    setHighlightId(id)
  }

  const send = async () => {
    // `@Navn` → markører helt til slutt; serveren validerer hver av dem.
    const text = toMarkers(body.trim(), chosen)
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await api.postMessage({ data: { channel, body: text, replyToId: replyTo?.id ?? null } })
      setBody('')
      setChosen([])
      setReplyTo(null)
      const res = await api.listMessages({ data: { channel, after: latestRef.current } })
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        return [...prev, ...res.messages.filter((m) => !known.has(m.id))]
      })
      setMentionNames((prev) => ({ ...prev, ...res.mentionNames }))
      latestRef.current = res.messages[res.messages.length - 1]?.createdAt ?? latestRef.current
    } catch (err) {
      toastError(err)
    } finally {
      setSending(false)
    }
  }

  const startReply = (message: ChatMessage) => {
    setReplyTo({
      id: message.id,
      authorName: message.authorName,
      // Utdraget viser «@Navn», aldri markøren — som svarreferansen serveren lager.
      excerpt: replyExcerpt(mentionPlainText(chatPlainText(message.body), mentionUsers)),
    })
    inputRef.current?.focus()
  }

  const mentionUsers = useMemo(
    () => Object.entries(mentionNames).map(([id, name]) => ({ id, name })),
    [mentionNames],
  )
  const today = toOsloDate(Date.now())
  const days = groupMessagesByDay(messages, (ms) => toOsloDate(ms))
  // Samme regel som ulest-telleren på serveren, men her på de meldingene vi
  // faktisk har: hvor mange kom fra andre etter der brukeren slapp?
  const newFromOthers = unreadCount(messages, readMarker, meId)
  const firstUnreadId =
    newFromOthers > 0
      ? messages.find((m) => m.authorId !== meId && m.createdAt > (readMarker ?? 0))?.id
      : undefined
  const known = useMemo(() => new Set(messages.map((m) => m.id)), [messages])

  return (
    <div className="sheet flex max-h-[70dvh] min-h-[320px] flex-col overflow-hidden">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        {!loaded ? (
          <p className="py-8 text-center text-sm text-ink-faint">Henter meldinger…</p>
        ) : messages.length === 0 ? (
          <EmptyState title={emptyTitle}>{emptyBody}</EmptyState>
        ) : (
          days.map((day) => (
            <div key={day.date} className="space-y-2.5">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-line" aria-hidden />
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-ink-faint">
                  {dayHeading(day.date, today)}
                </span>
                <div className="h-px flex-1 bg-line" aria-hidden />
              </div>
              {day.messages.map((m) => {
                // Referansen er klikkbar bare når originalen faktisk er lastet;
                // ellers ville knappen løyet om hva den kan gjøre.
                const replyId = m.replyTo && !m.replyTo.deleted ? m.replyTo.id : null
                return (
                  <div
                    key={m.id}
                    ref={(node) => {
                      if (node) nodeRefs.current.set(m.id, node)
                      else nodeRefs.current.delete(m.id)
                    }}
                  >
                    {m.id === firstUnreadId && (
                      <div className="mb-2.5 flex items-center gap-3">
                        <div className="h-px flex-1 bg-brass/50" aria-hidden />
                        <span className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-brass">
                          Nye meldinger
                        </span>
                        <div className="h-px flex-1 bg-brass/50" aria-hidden />
                      </div>
                    )}
                    <Bubble
                      api={api}
                      message={m}
                      mentions={mentionUsers}
                      mine={m.authorId === meId}
                      highlighted={highlightId === m.id}
                      canReply={writable}
                      onReply={() => startReply(m)}
                      onJump={replyId && known.has(replyId) ? () => jumpTo(replyId) : undefined}
                      onDeleted={(id) =>
                        setMessages((prev) =>
                          prev
                            .filter((x) => x.id !== id)
                            // Svarene på den slettede meldingen skal si det samme
                            // som serveren gjør ved neste lasting.
                            .map((x) =>
                              x.replyTo && !x.replyTo.deleted && x.replyTo.id === id
                                ? { ...x, replyTo: { deleted: true } as ChatReply }
                                : x,
                            ),
                        )
                      }
                    />
                  </div>
                )
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {writable ? (
        <div className="shrink-0 border-t border-line bg-paper-sunken/40 px-3 py-3 sm:px-4">
          {replyTo && (
            <div className="mb-2 flex items-start gap-2 rounded-[9px] border border-line bg-paper-raised px-3 py-2">
              <span className="mt-[3px] h-4 w-[3px] shrink-0 rounded-full bg-brass" aria-hidden />
              <p className="min-w-0 flex-1 truncate text-[0.78rem] text-ink-soft">
                <span className="font-semibold">Svarer {replyTo.authorName ?? 'Ukjent'}</span>
                {replyTo.excerpt && <span className="text-ink-faint">: {replyTo.excerpt}</span>}
              </p>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="shrink-0 cursor-pointer font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-faint transition-colors hover:text-ink"
              >
                Avbryt
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <MentionTextarea
              textareaRef={inputRef}
              wrapperClassName="flex-1"
              className="field-input max-h-40 min-h-[42px] w-full resize-y py-2"
              rows={1}
              value={body}
              onChange={setBody}
              chosen={chosen}
              onChosenChange={setChosen}
              // Hvem som kan omtales avgjøres server-side av området funksjonen
              // kom fra — styret og gruppelederne har hver sin liste.
              search={(query) => api.searchMentionableMembers({ data: { query } })}
              // Enter sender, Shift+Enter gir linjeskift — som i chatten dette
              // erstatter. Er forslagslista åpen, tar den Enter først.
              onEnter={() => void send()}
              onKeyDown={(e) => {
                // Escape lukker først lista (i MentionTextarea), så svaret.
                if (e.key === 'Escape' && replyTo) setReplyTo(null)
              }}
              placeholder="Skriv en melding… @ nevner noen, Enter sender"
              aria-label={replyTo ? `Svar til ${replyTo.authorName ?? 'Ukjent'}` : 'Ny melding'}
              maxLength={4000}
            />
            <Button variant="primary" onClick={send} loading={sending} disabled={!body.trim()}>
              Send
            </Button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-t border-line bg-paper-sunken/40 px-4 py-3">
          <p className="text-center text-[0.8rem] text-ink-faint">{readOnlyNote}</p>
        </div>
      )}
    </div>
  )
}

function Bubble({
  api,
  message,
  mentions,
  mine,
  highlighted,
  canReply,
  onReply,
  onJump,
  onDeleted,
}: {
  api: ChatApi
  message: ChatMessage
  /** Dagens navn på de omtalte i sida — markørene blir chips. */
  mentions: MentionUser[]
  mine: boolean
  highlighted: boolean
  canReply: boolean
  onReply: () => void
  /** Satt kun når originalen finnes i den lastede lista. */
  onJump?: () => void
  onDeleted: (id: string) => void
}) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`group max-w-[85%] sm:max-w-[72%] ${mine ? 'text-right' : ''}`}>
        <div className="mb-0.5 flex items-baseline gap-2 px-1 text-[0.68rem] text-ink-faint">
          {!mine && <span className="font-semibold text-ink-soft">{message.authorName ?? 'Ukjent'}</span>}
          <span className="font-mono tabular-nums">{formatTime(message.createdAt)}</span>
          {canReply && (
            <button
              type="button"
              onClick={onReply}
              className="cursor-pointer font-mono uppercase tracking-[0.1em] opacity-0 transition-opacity hover:text-brass focus-visible:opacity-100 group-hover:opacity-100"
            >
              Svar
            </button>
          )}
          {mine && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await api.deleteMessage({ data: { id: message.id } })
                  onDeleted(message.id)
                } catch (err) {
                  toastError(err)
                }
              }}
              className="cursor-pointer font-mono uppercase tracking-[0.1em] opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
            >
              Slett
            </button>
          )}
        </div>
        <div
          className={`chat-bubble rounded-[12px] px-3.5 py-2 text-left text-[0.92rem] leading-relaxed ${
            highlighted ? 'chat-bubble-marked ' : ''
          }${mine ? 'bg-[var(--brass-soft)] text-ink ring-1 ring-brass/30' : 'bg-paper-sunken text-ink ring-1 ring-line'}`}
        >
          {message.replyTo && <ReplyReference reply={message.replyTo} onJump={onJump} />}
          <div className="whitespace-pre-wrap break-words">
            <ChatText text={message.body} mentions={mentions} />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Den kompakte referansen over et svar. Er originalen fortsatt i tråden, er
 * referansen en knapp som hopper dit; er den slettet, sier den det rett ut i
 * stedet for å late som svaret gjelder ingenting.
 */
function ReplyReference({ reply, onJump }: { reply: ChatReply; onJump?: () => void }) {
  const content = reply.deleted ? (
    <span className="italic text-ink-faint">Meldingen er slettet</span>
  ) : (
    <>
      <span className="font-semibold">{reply.authorName ?? 'Ukjent'}</span>
      <span className="text-ink-faint">: {reply.excerpt}</span>
    </>
  )

  const className = 'mb-1.5 flex w-full items-center gap-2 border-l-2 border-brass/60 pl-2 text-[0.74rem] text-ink-soft'
  if (!onJump) {
    return (
      <div className={className}>
        <span className="min-w-0 flex-1 truncate">{content}</span>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onJump}
      title="Gå til meldingen"
      className={`${className} cursor-pointer text-left transition-colors hover:text-ink`}
    >
      <span className="min-w-0 flex-1 truncate">{content}</span>
    </button>
  )
}

/**
 * Kanallista + tråden: hele chat-skjermen minus sidens egen overskrift.
 * Kanalvalget bor i URL-en hos kalleren (`?kanal=…`), så en tråd kan lenkes til;
 * `active` og `onOpenChannel` er derfor inn- og utgangen for det valget.
 */
export function ChatPanel({
  channels,
  meId,
  active,
  onOpenChannel,
  api,
  channelApi,
  onRefresh,
  creating,
  onCreatingChange,
  emptyFor,
  missingGeneralNote,
}: {
  channels: ChannelSummary[]
  meId: string
  /** Kanalen som vises nå. `undefined` når lista er tom. */
  active: ChannelSummary | undefined
  onOpenChannel: (channel: string) => void
  api: ChatApi
  channelApi: ChatChannelApi
  /** Henter loaderdataene på nytt — som regel `router.invalidate()`. */
  onRefresh: () => Promise<void>
  creating: boolean
  onCreatingChange: (open: boolean) => void
  /** Tomteksten for en kanal; fellesekanalen sier noe annet enn en temakanal. */
  emptyFor: (channel: ChannelSummary) => { title: string; body: string }
  /** Vises når selv fellesekanalen mangler — noe som ikke skal kunne skje. */
  missingGeneralNote: string
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [renaming, setRenaming] = useState<ChannelSummary | null>(null)

  const open = channels.filter((c) => !c.archived)
  const archived = channels.filter((c) => c.archived)
  // Bare egendefinerte kanaler kan få nytt navn eller arkiveres; fellesekanalen
  // og prosjekttrådene eies av noe annet.
  const customId = active ? channelCustomId(active.channel) : null

  const refreshUnread = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  const setArchived = async (id: string, archivedNow: boolean) => {
    try {
      await channelApi.setChannelArchived({ data: { id, archived: archivedNow } })
      toast(archivedNow ? 'Kanalen er arkivert' : 'Kanalen er gjenopprettet')
      await onRefresh()
    } catch (err) {
      toastError(err)
    }
  }

  return (
    <>
      {!active ? (
        <div className="sheet rise">
          <EmptyState title="Ingen kanaler">{missingGeneralNote}</EmptyState>
        </div>
      ) : (
        <div className="rise grid gap-5 lg:grid-cols-[220px_1fr]" style={{ animationDelay: '60ms' }}>
          {/* Mobil: kanalene som en scrollbar stripe over tråden. Desktop: en kolonne ved siden av. */}
          <nav
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Kanaler"
          >
            {open.map((c) => (
              <ChannelButton key={c.channel} channel={c} active={c.channel === active.channel} onOpen={onOpenChannel} />
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
                      onOpen={onOpenChannel}
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

            <ChatThread
              key={active.channel}
              api={api}
              channel={active.channel}
              meId={meId}
              writable={!active.archived}
              emptyTitle={emptyFor(active).title}
              emptyBody={emptyFor(active).body}
              onRead={refreshUnread}
            />
          </div>
        </div>
      )}

      <ChannelNameModal
        open={creating}
        title="Ny kanal"
        submitLabel="Opprett"
        onClose={() => onCreatingChange(false)}
        onSubmit={async (name) => {
          const res = await channelApi.createChannel({ data: { name } })
          toast('Kanalen er opprettet')
          await onRefresh()
          onOpenChannel(res.channel)
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
          await channelApi.renameChannel({ data: { id, name } })
          toast('Kanalen har fått nytt navn')
          await onRefresh()
        }}
      />
    </>
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
  // Tallet, hjelpeteksten og «du er nevnt» avgjøres av `unreadBadge` i
  // lib/board.ts — samme regel som ulest-tellingen ellers, testet der.
  const badge = unreadBadge(channel)
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
      {badge && (
        <span
          className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center gap-px rounded-full bg-brass px-1 font-mono text-[0.58rem] font-semibold tabular-nums text-paper-raised dark:text-paper"
          aria-label={badge.label}
        >
          {/* «@» sier at en av de uleste gjelder DEG. Chatten sender ingen
              e-post, så dette er det eneste varselet om en direkte henvendelse. */}
          {badge.mentioned && <span aria-hidden>@</span>}
          {badge.count}
        </span>
      )}
    </button>
  )
}

/**
 * Én dialog for både «Ny kanal» og «Gi nytt navn» — samme felt, samme regler.
 * Navnekravet valideres her OG i serverfunksjonen; det som står her er hjelp,
 * ikke sikring.
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
