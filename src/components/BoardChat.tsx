import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type ChatMessage, type ChatReply, groupMessagesByDay, replyExcerpt, unreadCount } from '../lib/board'
import { chatPlainText } from '../lib/chat-format'
import { formatDate, formatTime, formatWeekday, toOsloDate } from '../lib/format'
import { deleteMessage, listMessages, markChannelRead, postMessage } from '../server/board'
import { ChatText } from './ChatText'
import { toastError } from './toast'
import { Button, EmptyState } from './ui'

/**
 * Chat-tråden for én kanal. Brukes både på `/styre/chat` og nederst på et
 * styreprosjekt. Komponenten kjenner ikke til hvem som eier kanalen — den får
 * en kanalnøkkel og en `meId`, og all tilgangskontroll skjer på serveren.
 *
 * Oppdatering uten websockets: mens fanen er synlig spør klienten hvert
 * POLL_MS om det har kommet noe etter den nyeste meldingen den har. Er fanen
 * skjult, stopper pollingen helt — en telefon i lomma skal ikke ligge og
 * hamre på serveren. Ingen Durable Objects.
 */
const POLL_MS = 12_000

/** Hvor lenge en melding man har hoppet til blir stående markert. */
const HIGHLIGHT_MS = 1_800

function dayHeading(date: string, today: string): string {
  if (date === today) return 'I dag'
  const yesterday = toOsloDate(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000)
  if (date === yesterday) return 'I går'
  return `${formatWeekday(date)} ${formatDate(date)}`
}

/** Det man svarer på, slik skrivefeltet viser det før meldingen er sendt. */
type ReplyDraft = { id: string; authorName: string | null; excerpt: string }

export function BoardChat({
  channel,
  meId,
  emptyTitle = 'Ingen meldinger ennå',
  emptyBody = 'Skriv den første — dette er styrets egen tråd.',
  writable = true,
  readOnlyNote = 'Kanalen er arkivert. Historikken står, men det kan ikke skrives mer her.',
  onRead,
}: {
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
  // ref, og effektene avhenger kun av kanalen.
  const onReadRef = useRef(onRead)
  useEffect(() => {
    onReadRef.current = onRead
  })

  const markRead = useCallback(
    async (at: number, notify: boolean) => {
      try {
        await markChannelRead({ data: { channel, at } })
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
    nodeRefs.current.clear()
    latestRef.current = 0

    const load = async () => {
      try {
        const res = await listMessages({ data: { channel } })
        if (cancelled) return
        setMessages(res.messages)
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
        const res = await listMessages({ data: { channel, after: latestRef.current } })
        if (stopped || res.messages.length === 0) return
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id))
          return [...prev, ...res.messages.filter((m) => !known.has(m.id))]
        })
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
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await postMessage({ data: { channel, body: text, replyToId: replyTo?.id ?? null } })
      setBody('')
      setReplyTo(null)
      const res = await listMessages({ data: { channel, after: latestRef.current } })
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        return [...prev, ...res.messages.filter((m) => !known.has(m.id))]
      })
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
      excerpt: replyExcerpt(chatPlainText(message.body)),
    })
    inputRef.current?.focus()
  }

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
                      message={m}
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
            <textarea
              ref={inputRef}
              className="field-input max-h-40 min-h-[42px] flex-1 resize-y py-2"
              rows={1}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              // Enter sender, Shift+Enter gir linjeskift — som i chatten dette
              // erstatter. På touch gir tastaturet uansett en egen sendeknapp.
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
                if (e.key === 'Escape' && replyTo) setReplyTo(null)
              }}
              placeholder="Skriv en melding… (Enter sender, Shift+Enter gir linjeskift)"
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
  message,
  mine,
  highlighted,
  canReply,
  onReply,
  onJump,
  onDeleted,
}: {
  message: ChatMessage
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
                  await deleteMessage({ data: { id: message.id } })
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
            <ChatText text={message.body} />
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
