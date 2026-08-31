import { useCallback, useEffect, useRef, useState } from 'react'
import { type ChatMessage, groupMessagesByDay, unreadCount } from '../lib/board'
import { formatDate, formatTime, formatWeekday, toOsloDate } from '../lib/format'
import { deleteMessage, listMessages, markChannelRead, postMessage } from '../server/board'
import { toastError } from './toast'
import { Button, EmptyState } from './ui'

/**
 * Chat-tråden for én kanal. Brukes både på `/styre/chat` og nederst på et
 * styreprosjekt.
 *
 * Oppdatering uten websockets: mens fanen er synlig spør klienten hvert
 * POLL_MS om det har kommet noe etter den nyeste meldingen den har. Er fanen
 * skjult, stopper pollingen helt — en telefon i lomma skal ikke ligge og
 * hamre på serveren. Ingen Durable Objects.
 */
const POLL_MS = 12_000

function dayHeading(date: string, today: string): string {
  if (date === today) return 'I dag'
  const yesterday = toOsloDate(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000)
  if (date === yesterday) return 'I går'
  return `${formatWeekday(date)} ${formatDate(date)}`
}

export function BoardChat({
  channel,
  meId,
  emptyTitle = 'Ingen meldinger ennå',
  emptyBody = 'Skriv den første — dette er styrets egen tråd.',
  onRead,
}: {
  channel: string
  meId: string
  emptyTitle?: string
  emptyBody?: string
  /** Kalles når kanalen er lest, så ulest-tellere utenfor kan oppdateres. */
  onRead?: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // Hvor langt brukeren hadde lest da kanalen ble åpnet. Fryses bevisst: skillet
  // «nye meldinger» skal stå stille mens man leser, ikke flytte seg.
  const [readMarker, setReadMarker] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
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

  const send = async () => {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await postMessage({ data: { channel, body: text } })
      setBody('')
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

  const today = toOsloDate(Date.now())
  const days = groupMessagesByDay(messages, (ms) => toOsloDate(ms))
  // Samme regel som ulest-telleren på serveren, men her på de meldingene vi
  // faktisk har: hvor mange kom fra andre etter der brukeren slapp?
  const newFromOthers = unreadCount(messages, readMarker, meId)
  const firstUnreadId =
    newFromOthers > 0
      ? messages.find((m) => m.authorId !== meId && m.createdAt > (readMarker ?? 0))?.id
      : undefined

  return (
    <div className="sheet flex max-h-[70dvh] min-h-[320px] flex-col overflow-hidden">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
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
              {day.messages.map((m) => (
                <div key={m.id}>
                  {m.id === firstUnreadId && (
                    <div className="mb-2.5 flex items-center gap-3">
                      <div className="h-px flex-1 bg-brass/50" aria-hidden />
                      <span className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-brass">
                        Nye meldinger
                      </span>
                      <div className="h-px flex-1 bg-brass/50" aria-hidden />
                    </div>
                  )}
                  <Bubble message={m} mine={m.authorId === meId} onDeleted={(id) => setMessages((prev) => prev.filter((x) => x.id !== id))} />
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-line bg-paper-sunken/40 px-3 py-3 sm:px-4">
        <div className="flex items-end gap-2">
          <textarea
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
            }}
            placeholder="Skriv en melding… (Enter sender, Shift+Enter gir linjeskift)"
            aria-label="Ny melding"
            maxLength={4000}
          />
          <Button variant="primary" onClick={send} loading={sending} disabled={!body.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

function Bubble({
  message,
  mine,
  onDeleted,
}: {
  message: ChatMessage
  mine: boolean
  onDeleted: (id: string) => void
}) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`group max-w-[85%] sm:max-w-[72%] ${mine ? 'text-right' : ''}`}>
        <div className="mb-0.5 flex items-baseline gap-2 px-1 text-[0.68rem] text-ink-faint">
          {!mine && <span className="font-semibold text-ink-soft">{message.authorName ?? 'Ukjent'}</span>}
          <span className="font-mono tabular-nums">{formatTime(message.createdAt)}</span>
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
        <p
          className={`whitespace-pre-wrap break-words rounded-[12px] px-3.5 py-2 text-left text-[0.92rem] leading-relaxed ${
            mine
              ? 'bg-[var(--brass-soft)] text-ink ring-1 ring-brass/30'
              : 'bg-paper-sunken text-ink ring-1 ring-line'
          }`}
        >
          {message.body}
        </p>
      </div>
    </div>
  )
}
