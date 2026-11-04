import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { formatDate, formatDateShort, formatTime, formatWeekday, toOsloDate } from '../lib/format'
import { type MentionUser, mentionPlainText, toMarkers } from '../lib/mentions'
import { ChatText } from './ChatText'
import { MentionTextarea } from './MentionTextarea'
import { toast, toastError } from './toast'
import { Avatar, BottomSheet, Button, EmptyState, Field, Kicker, Modal } from './ui'

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
 *
 * ## Arbeidsflaten (november 2026)
 *
 * `ChatPanel` er en meldingsapp, ikke en side: den fyller plassen mellom
 * toppen av seg selv og fanelinjen (eller bunnen av skjermen), og det ENESTE
 * som ruller er meldingshistorikken. Skrivefeltet står fast nederst. Høyden
 * måles i JS (`useFillHeight`), fordi det som står over flaten (områdemenyen)
 * og under den (fanelinjen, tastaturet) varierer med enhet og input. Siden
 * selv ruller da ikke — heller ikke i installert app på iOS, der det er
 * `.app-shell` og ikke vinduet som ville ha rullet (se `html.ios-app`).
 *
 * Fra 768 px er det to ruter: kanalliste til venstre og samtalen til høyre.
 * Under det er kanalvalget en knapp i samtalens topplinje som åpner et bunnark.
 */
const POLL_MS = 12_000

/** Hvor lenge en melding man har hoppet til blir stående markert. */
const HIGHLIGHT_MS = 1_800

/** Meldinger fra samme person innen dette vinduet vises som én bolk. */
const RUN_GAP_MS = 5 * 60_000

/** Langt trykk på en melding (berøring) åpner handlingsarket. */
const LONG_PRESS_MS = 450

/** Hvor nær bunnen man må være for at nye meldinger skal rulle tråden med. */
const STICK_PX = 96

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

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function dayHeading(date: string, today: string): string {
  if (date === today) return 'I dag'
  const yesterday = toOsloDate(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000)
  if (date === yesterday) return 'I går'
  return `${formatWeekday(date)} ${formatDate(date)}`
}

/** «14:32» i dag, ellers «3. nov.» — som sist-aktiv i en meldingsapp. */
function lastActivity(ms: number | null): string {
  if (ms === null) return ''
  const date = toOsloDate(ms)
  return date === toOsloDate(Date.now()) ? formatTime(ms) : formatDateShort(date)
}

/** Det man svarer på, slik skrivefeltet viser det før meldingen er sendt. */
type ReplyDraft = { id: string; authorName: string | null; excerpt: string }

/**
 * Gir elementet en høyde som når nøyaktig ned til fanelinjen (eller bunnen av
 * det synlige vinduet når fanelinjen er skjult, f.eks. når tastaturet er oppe).
 *
 * Skrives som CSS-variabelen `--chat-h`, så CSS-en har en fornuftig fallback
 * før første måling (SSR). Måles i vinduskoordinater: `visualViewport` krymper
 * når tastaturet kommer opp på iOS, og flaten krymper med den, slik at
 * skrivefeltet blir stående rett over tastaturet. Elementet skal selv ikke
 * animeres (`transform` ville forskjøvet målingen) — animer et barn.
 *
 * `bottomGap` er luft under en innrammet flate (iPad/desktop); på telefon
 * går flaten helt ned til fanelinjen.
 */
function useFillHeight(ref: React.RefObject<HTMLElement | null>) {
  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const measure = () => {
      const vv = window.visualViewport
      const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight
      const bar = document.querySelector<HTMLElement>('.tab-bar')
      const barShown = !!bar && getComputedStyle(bar).display !== 'none'
      const barTop = barShown ? bar.getBoundingClientRect().top : Number.POSITIVE_INFINITY
      const framed = window.matchMedia('(min-width: 768px)').matches
      const gap = framed ? 16 : 0
      const top = el.getBoundingClientRect().top
      const bottom = Math.min(viewBottom, barTop) - gap
      const keyboard = vv ? window.innerHeight - vv.height > 120 : false
      el.style.setProperty('--chat-h', `${Math.max(260, Math.floor(bottom - top))}px`)
      el.dataset.tabbar = barShown ? 'shown' : 'hidden'
      el.dataset.keyboard = keyboard ? 'open' : 'closed'
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    const vv = window.visualViewport
    vv?.addEventListener('resize', schedule)
    vv?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    // Fanelinjen skjules (CSS) når et tekstfelt får fokus; målingen må følge.
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    // Det som står over flaten kan endre høyde (frakoblet-banner, områdemenyen).
    const ro = new ResizeObserver(schedule)
    if (el.parentElement) ro.observe(el.parentElement)
    ro.observe(document.body)
    return () => {
      cancelAnimationFrame(frame)
      vv?.removeEventListener('resize', schedule)
      vv?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      ro.disconnect()
    }
  }, [ref])
}

/**
 * Chat-tråden for én kanal. Brukes både i arbeidsflaten (`layout="fill"`, som
 * fyller ruten den står i) og alene nederst på et styreprosjekt
 * (`layout="card"`, et kort med egen makshøyde). Komponenten kjenner ikke til
 * hvem som eier kanalen — den får en kanalnøkkel, en `meId` og et `api`.
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
  layout = 'card',
  placeholder = 'Skriv en melding…',
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
  /** `card`: eget kort med makshøyde. `fill`: fyller forelderen (arbeidsflaten). */
  layout?: 'card' | 'fill'
  placeholder?: string
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
  /**
   * Første lasting: `loading` → `ready`, eller `error` med «Prøv igjen». Før
   * ble en feil her bare en toast, og tråden sto og sa «Henter meldinger…» for
   * alltid.
   */
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  /** Meldingen handlingsarket (berøring) er åpnet for. */
  const [actionFor, setActionFor] = useState<ChatMessage | null>(null)
  /** Nye meldinger som kom mens man leste lenger opp. */
  const [unseenBelow, setUnseenBelow] = useState(0)
  // Hvor langt brukeren hadde lest da kanalen ble åpnet. Fryses bevisst: skillet
  // «nye meldinger» skal stå stille mens man leser, ikke flytte seg.
  const [readMarker, setReadMarker] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Meldingsboksene, så en svarreferanse kan hoppe til originalen.
  const nodeRefs = useRef(new Map<string, HTMLDivElement>())
  const latestRef = useRef(0)
  const loadedRef = useRef(false)
  /** Står man (nesten) nederst? Da følger tråden med når det kommer noe nytt. */
  const stickRef = useRef(true)
  /** Neste endring i lista skal rulle til bunnen uansett (egen melding, første lasting). */
  const forceBottomRef = useRef(true)
  const countRef = useRef(0)

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

  // Bytte av kanal er en ny start: tøm, hent på nytt, marker som lest. «Prøv
  // igjen» (`attempt`) går samme vei.
  useEffect(() => {
    let cancelled = false
    setMessages([])
    setLoadState('loading')
    setReadMarker(null)
    setReplyTo(null)
    setMentionNames({})
    setUnseenBelow(0)
    nodeRefs.current.clear()
    latestRef.current = 0
    loadedRef.current = false
    stickRef.current = true
    forceBottomRef.current = true
    countRef.current = 0

    const load = async () => {
      try {
        const res = await apiRef.current.listMessages({ data: { channel } })
        if (cancelled) return
        setMessages(res.messages)
        setMentionNames(res.mentionNames)
        setLoadState('ready')
        loadedRef.current = true
        latestRef.current = res.messages[res.messages.length - 1]?.createdAt ?? 0
        await markRead(res.serverTime, true)
      } catch {
        if (!cancelled) setLoadState('error')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [channel, markRead, attempt])

  // Polling: kun mens fanen er synlig — og først når første lasting har lyktes
  // (ellers ville `after: 0` hentet hele kanalen bak feilmeldingen).
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (stopped || document.visibilityState !== 'visible' || !loadedRef.current) return
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

  // Rull meldingsboksen til bunnen når det kommer noe nytt — men bare når man
  // står nederst (eller selv sendte). Leser man lenger opp, blir man stående,
  // og en knapp sier at det har kommet noe. Bare boksen rulles, aldri siden:
  // scrollIntoView ville dratt hele skallet med seg.
  useIsoLayoutEffect(() => {
    const box = scrollRef.current
    const added = messages.length - countRef.current
    countRef.current = messages.length
    if (!box || added <= 0) return
    if (forceBottomRef.current || stickRef.current) {
      box.scrollTop = box.scrollHeight
      forceBottomRef.current = false
      setUnseenBelow(0)
    } else {
      setUnseenBelow((n) => n + added)
    }
  }, [messages.length])

  // Når boksen krymper (tastaturet kommer opp, svar-linjen dukker opp), skal
  // den som sto nederst fortsatt stå nederst.
  useEffect(() => {
    const box = scrollRef.current
    if (!box) return
    const ro = new ResizeObserver(() => {
      if (stickRef.current) box.scrollTop = box.scrollHeight
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  const onScroll = () => {
    const box = scrollRef.current
    if (!box) return
    stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < STICK_PX
    if (stickRef.current && unseenBelow > 0) setUnseenBelow(0)
  }

  const scrollToBottom = () => {
    const box = scrollRef.current
    if (!box) return
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
    setUnseenBelow(0)
  }

  useEffect(() => {
    if (!highlightId) return
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightId])

  // Skrivefeltet vokser med teksten, opp til et tak — så ruller det selv.
  useIsoLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 168)}px`
  }, [body])

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
      forceBottomRef.current = true
      // Sendt fra feiltilstanden: da finnes ingen historikk å bygge videre på,
      // så hele kanalen lastes på nytt i stedet for «alt etter 0».
      if (!loadedRef.current) {
        setAttempt((n) => n + 1)
        return
      }
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

  const mentionUsers = useMemo(
    () => Object.entries(mentionNames).map(([id, name]) => ({ id, name })),
    [mentionNames],
  )

  /** Meldingsteksten slik et menneske leser den: `@Navn`, ingen markører. */
  const plainText = (message: ChatMessage) => mentionPlainText(chatPlainText(message.body), mentionUsers)

  const startReply = (message: ChatMessage) => {
    setReplyTo({
      id: message.id,
      authorName: message.authorName,
      // Utdraget viser «@Navn», aldri markøren — som svarreferansen serveren lager.
      excerpt: replyExcerpt(plainText(message)),
    })
    inputRef.current?.focus()
  }

  const removeMessage = async (id: string) => {
    try {
      await api.deleteMessage({ data: { id } })
      setMessages((prev) =>
        prev
          .filter((x) => x.id !== id)
          // Svarene på den slettede meldingen skal si det samme som serveren
          // gjør ved neste lasting.
          .map((x) =>
            x.replyTo && !x.replyTo.deleted && x.replyTo.id === id ? { ...x, replyTo: { deleted: true } as ChatReply } : x,
          ),
      )
      countRef.current = Math.max(0, countRef.current - 1)
      return true
    } catch (err) {
      toastError(err)
      return false
    }
  }

  const today = toOsloDate(Date.now())
  const days = groupMessagesByDay(messages, (ms) => toOsloDate(ms))
  // Samme regel som ulest-telleren på serveren, men her på de meldingene vi
  // faktisk har: hvor mange kom fra andre etter der brukeren slapp?
  const newFromOthers = unreadCount(messages, readMarker, meId)
  const firstUnreadId =
    newFromOthers > 0 ? messages.find((m) => m.authorId !== meId && m.createdAt > (readMarker ?? 0))?.id : undefined
  const known = useMemo(() => new Set(messages.map((m) => m.id)), [messages])

  const frame =
    layout === 'fill'
      ? 'chat-thread chat-thread-fill flex min-h-0 flex-1 flex-col'
      : 'chat-thread sheet flex max-h-[min(70dvh,36rem)] min-h-[320px] flex-col overflow-hidden'

  return (
    <div className={frame} data-chat-loaded={loadState === 'ready' ? '' : undefined}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 sm:px-5"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {/* Luften oppe og nede bor INNI den fulle høyden (`min-h-full` + padding),
              ellers ville boksen alltid kunne rulles litt, og dagsetiketten ville
              lagt seg oppå det første som står under den. */}
          {loadState === 'loading' ? (
            <ChatSkeleton />
          ) : loadState === 'error' ? (
            <EmptyState
              title="Kunne ikke hente meldingene"
              action={
                <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
                  Prøv igjen
                </Button>
              }
            >
              Sjekk nettforbindelsen. Ingenting er borte — meldingene ligger trygt på serveren.
            </EmptyState>
          ) : messages.length === 0 ? (
            <div className="flex min-h-full items-center justify-center py-4">
              <EmptyState title={emptyTitle}>{emptyBody}</EmptyState>
            </div>
          ) : (
            <div className="flex min-h-full flex-col justify-end pb-4 pt-1">
              {days.map((day) => (
                <section key={day.date} aria-label={dayHeading(day.date, today)}>
                  <div className="flex justify-center py-2">
                    <span className="chat-day-label">{dayHeading(day.date, today)}</span>
                  </div>
                  {day.messages.map((m, i) => {
                    const prev = day.messages[i - 1]
                    // En bolk: samme avsender, tett i tid, og ingen «nye meldinger»-
                    // strek imellom. Navn, avatar og klokkeslett står bare på den første.
                    const startsRun =
                      !prev ||
                      prev.authorId !== m.authorId ||
                      m.createdAt - prev.createdAt > RUN_GAP_MS ||
                      m.id === firstUnreadId
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
                        className={startsRun ? 'pt-3 first:pt-1' : 'pt-[3px]'}
                      >
                        {m.id === firstUnreadId && (
                          <div className="mb-3 flex items-center gap-3" role="separator">
                            <div className="h-px flex-1 bg-brass/50" aria-hidden />
                            <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-brass-strong">
                              Nye meldinger
                            </span>
                            <div className="h-px flex-1 bg-brass/50" aria-hidden />
                          </div>
                        )}
                        <MessageRow
                          message={m}
                          mentions={mentionUsers}
                          mine={m.authorId === meId}
                          startsRun={startsRun}
                          highlighted={highlightId === m.id}
                          canReply={writable}
                          onReply={() => startReply(m)}
                          onDelete={() => void removeMessage(m.id)}
                          onActions={() => setActionFor(m)}
                          onJump={replyId && known.has(replyId) ? () => jumpTo(replyId) : undefined}
                        />
                      </div>
                    )
                  })}
                </section>
              ))}
            </div>
          )}
        </div>

        {unseenBelow > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="chat-jump absolute bottom-3 left-1/2 z-[2] flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[0.78rem] font-medium text-paper shadow-[var(--shadow-lift)] pointer-coarse:min-h-11"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 1.5v9M2 6.5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {unseenBelow === 1 ? '1 ny melding' : `${unseenBelow} nye meldinger`}
          </button>
        )}
      </div>

      {writable ? (
        <div className="chat-composer shrink-0 border-t border-line bg-paper-raised px-3 pb-3 pt-2.5 sm:px-4">
          {replyTo && (
            <div className="mb-2 flex items-center gap-2 rounded-[10px] bg-paper-sunken py-1.5 pl-3 pr-1">
              <span className="h-7 w-[3px] shrink-0 rounded-full bg-brass" aria-hidden />
              <p className="min-w-0 flex-1 text-[0.78rem] leading-snug text-ink-soft">
                <span className="block font-semibold text-ink">Svarer {replyTo.authorName ?? 'Ukjent'}</span>
                {replyTo.excerpt && <span className="block truncate text-ink-faint">{replyTo.excerpt}</span>}
              </p>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                aria-label="Avbryt svaret"
                className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-ink-faint transition-colors hover:bg-paper hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
              >
                <CloseGlyph />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <MentionTextarea
              textareaRef={inputRef}
              wrapperClassName="min-w-0 flex-1"
              className="chat-input field-input block w-full resize-none"
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
              placeholder={placeholder}
              aria-label={replyTo ? `Svar til ${replyTo.authorName ?? 'Ukjent'}` : 'Ny melding'}
              maxLength={4000}
              enterKeyHint="send"
            />
            <button
              type="button"
              // Fokus skal bli i feltet: ellers lukkes tastaturet (og fanelinjen
              // kommer tilbake og flytter knappen) midt i trykket.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void send()}
              disabled={!body.trim() || sending}
              aria-label="Send"
              className="chat-send grid h-[42px] w-[42px] shrink-0 cursor-pointer place-items-center rounded-full bg-brass text-paper-raised transition-[background-color,opacity,transform] hover:bg-brass-strong active:scale-95 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-brass dark:text-paper pointer-coarse:h-11 pointer-coarse:w-11"
            >
              {sending ? (
                <span className="chat-spinner" aria-hidden />
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                  <path d="M9 15V3.5M4 8l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
          <p className="mt-1.5 hidden px-1 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-ink-faint desknav:block">
            Enter sender · Shift+Enter gir linjeskift · @ nevner noen · `kode`
          </p>
        </div>
      ) : (
        <div className="chat-composer shrink-0 border-t border-line bg-paper-sunken/50 px-4 py-3">
          <p className="text-center text-[0.8rem] text-ink-faint">{readOnlyNote}</p>
        </div>
      )}

      <MessageActionsSheet
        message={actionFor}
        mine={actionFor?.authorId === meId}
        canReply={writable}
        excerpt={actionFor ? replyExcerpt(plainText(actionFor)) : ''}
        onClose={() => setActionFor(null)}
        onReply={(sheet) => {
          // Arket lukkes FØR feltet får fokus, og i samme trykk: iOS åpner bare
          // tastaturet for et fokus som skjer direkte i en brukerhandling, og en
          // åpen modal dialog gjør alt utenfor seg utilgjengelig.
          sheet?.close()
          if (actionFor) startReply(actionFor)
          setActionFor(null)
        }}
        onCopy={async () => {
          if (!actionFor) return
          try {
            await navigator.clipboard.writeText(plainText(actionFor))
            toast('Kopiert')
          } catch {
            toast('Kunne ikke kopiere')
          }
          setActionFor(null)
        }}
        onDelete={async () => {
          if (!actionFor) return
          if (await removeMessage(actionFor.id)) setActionFor(null)
        }}
      />
    </div>
  )
}

function CloseGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function MoreGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  )
}

function ReplyGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6.5 3.5 2.5 7.5l4 4M3 7.5h6.5a4 4 0 0 1 4 4v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrashGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Tre grå «meldinger» mens den første lastingen pågår. */
function ChatSkeleton() {
  return (
    <div className="flex min-h-full flex-col justify-end gap-3 py-4" aria-label="Henter meldinger…" role="status">
      <span className="chat-skeleton w-[58%]" />
      <span className="chat-skeleton w-[42%]" />
      <span className="chat-skeleton ml-auto w-[48%]" />
      <span className="sr-only">Henter meldinger…</span>
    </div>
  )
}

/**
 * Én melding. Handlingene finnes på to måter, etter input:
 *
 * - **Mus:** små ikonknapper (Svar, Slett) ved siden av boblen når man holder
 *   over meldingen eller tabber inn i den.
 * - **Berøring:** en synlig «…»-knapp ved siden av boblen (44 pt trykkflate via
 *   `.hit`), og langt trykk på boblen — begge åpner handlingsarket. Hover
 *   finnes ikke på en iPad, så det som før var `opacity-0` til man holdt over,
 *   fantes rett og slett ikke der.
 */
function MessageRow({
  message,
  mentions,
  mine,
  startsRun,
  highlighted,
  canReply,
  onReply,
  onDelete,
  onActions,
  onJump,
}: {
  message: ChatMessage
  /** Dagens navn på de omtalte i sida — markørene blir chips. */
  mentions: MentionUser[]
  mine: boolean
  /** Første melding i en bolk fra samme avsender: viser navn, avatar og tid. */
  startsRun: boolean
  highlighted: boolean
  canReply: boolean
  onReply: () => void
  onDelete: () => void
  /** Åpner handlingsarket (berøring). */
  onActions: () => void
  /** Satt kun når originalen finnes i den lastede lista. */
  onJump?: () => void
}) {
  const press = useLongPress(onActions)
  const time = formatTime(message.createdAt)
  const author = message.authorName ?? 'Ukjent'

  return (
    <div className={`group flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
      {/* Avatar-kolonnen for de andre: bare på første melding i bolken. */}
      {!mine && (
        <div className="w-7 shrink-0 self-start pt-[18px]" aria-hidden>
          {startsRun && <Avatar name={author} size="sm" />}
        </div>
      )}

      <div className={`flex min-w-0 max-w-[82%] flex-col sm:max-w-[70%] ${mine ? 'items-end' : 'items-start'}`}>
        {startsRun && (
          <div className="mb-1 flex items-baseline gap-2 px-1 text-[0.7rem] text-ink-faint">
            {!mine && <span className="font-semibold text-ink-soft">{author}</span>}
            <span className="font-mono tabular-nums">{time}</span>
          </div>
        )}
        <div
          {...press}
          title={startsRun ? undefined : time}
          className={`chat-bubble chat-msg min-w-0 max-w-full rounded-[16px] px-3.5 py-2 text-left text-[0.94rem] leading-relaxed ${
            highlighted ? 'chat-bubble-marked ' : ''
          }${mine ? 'chat-bubble-mine' : 'chat-bubble-theirs'} ${
            startsRun ? (mine ? 'rounded-tr-[6px]' : 'rounded-tl-[6px]') : ''
          }`}
        >
          {message.replyTo && <ReplyReference reply={message.replyTo} onJump={onJump} />}
          <div className="whitespace-pre-wrap break-words">
            <ChatText text={message.body} mentions={mentions} />
          </div>
        </div>
      </div>

      {/* Mus: hover-verktøy. Berøring: «…» som alltid synes. */}
      <div className="flex shrink-0 items-center gap-0.5 self-center pointer-coarse:hidden">
        {canReply && (
          <button
            type="button"
            onClick={onReply}
            aria-label={`Svar ${author}`}
            title="Svar"
            className="grid h-7 w-7 cursor-pointer place-items-center rounded-full text-ink-faint opacity-0 transition-[opacity,color,background-color] hover:bg-paper-sunken hover:text-brass-strong focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <ReplyGlyph />
          </button>
        )}
        {mine && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Slett meldingen"
            title="Slett"
            className="grid h-7 w-7 cursor-pointer place-items-center rounded-full text-ink-faint opacity-0 transition-[opacity,color,background-color] hover:bg-paper-sunken hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <TrashGlyph />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onActions}
        aria-label={`Valg for meldingen fra ${mine ? 'deg' : author} kl. ${time}`}
        aria-haspopup="dialog"
        className="hit hidden h-7 w-7 shrink-0 cursor-pointer place-items-center self-center rounded-full text-ink-faint transition-colors active:bg-paper-sunken active:text-ink pointer-coarse:grid"
      >
        <MoreGlyph />
      </button>
    </div>
  )
}

/**
 * Langt trykk med finger (eller penn) → `onLongPress`. Avbrytes hvis fingeren
 * flytter seg (da ruller man) eller slippes for tidlig. Mus påvirkes ikke;
 * der er det hover-knappene som gjelder.
 */
function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }
  useEffect(() => cancel, [])
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return
      fired.current = false
      origin.current = { x: e.clientX, y: e.clientY }
      timer.current = setTimeout(() => {
        fired.current = true
        timer.current = null
        onLongPress()
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const o = origin.current
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 8) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // Android åpner sin egen meny på langt trykk; den skal ikke komme i tillegg.
    onContextMenu: (e: React.MouseEvent) => {
      if (fired.current || matchMedia('(pointer: coarse)').matches) e.preventDefault()
    },
    // Et langt trykk på en svarreferanse skal ikke også hoppe.
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        e.stopPropagation()
        e.preventDefault()
        fired.current = false
      }
    },
  }
}

/**
 * Handlingsarket for én melding (berøring): Svar, Kopier tekst og — for egne
 * meldinger — Slett, med en ekstra bekreftelse. Sletting er det eneste i
 * chatten som ikke kan angres, og et bomtrykk på en telefon er lett gjort.
 * Hvem som faktisk FÅR slette, avgjør `deleteMessage` på serveren.
 */
function MessageActionsSheet({
  message,
  mine,
  canReply,
  excerpt,
  onClose,
  onReply,
  onCopy,
  onDelete,
}: {
  message: ChatMessage | null
  mine: boolean
  canReply: boolean
  excerpt: string
  onClose: () => void
  /** Får arket (dialogen) med, så det kan lukkes før tekstfeltet får fokus. */
  onReply: (sheet: HTMLDialogElement | null) => void
  onCopy: () => void
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [shownId, setShownId] = useState<string | null>(null)
  // Nytt ark = ingen halvferdig bekreftelse fra forrige gang.
  if ((message?.id ?? null) !== shownId) {
    setShownId(message?.id ?? null)
    setConfirming(false)
  }

  return (
    <BottomSheet
      open={message !== null}
      onClose={onClose}
      label="Valg for meldingen"
      header={
        message && (
          <div className="pb-1">
            <p className="text-[0.74rem] text-ink-faint">
              <span className="font-semibold text-ink-soft">{mine ? 'Du' : (message.authorName ?? 'Ukjent')}</span>
              <span className="font-mono tabular-nums"> · {formatTime(message.createdAt)}</span>
            </p>
            <p className="mt-0.5 line-clamp-2 text-[0.9rem] text-ink">{excerpt}</p>
          </div>
        )
      }
    >
      {confirming ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">Meldingen slettes for alle. Det kan ikke angres.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setConfirming(false)}>Avbryt</Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={async () => {
                setDeleting(true)
                try {
                  await onDelete()
                } finally {
                  setDeleting(false)
                }
              }}
            >
              Slett
            </Button>
          </div>
        </div>
      ) : (
        <ul className="chat-action-list">
          {canReply && (
            <li>
              <button
                type="button"
                onClick={(e) => onReply(e.currentTarget.closest('dialog'))}
                className="chat-action"
              >
                <ReplyGlyph />
                Svar
              </button>
            </li>
          )}
          <li>
            <button type="button" onClick={onCopy} className="chat-action">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" stroke="currentColor" strokeWidth="1.4" />
              </svg>
              Kopier tekst
            </button>
          </li>
          {mine && (
            <li>
              <button type="button" onClick={() => setConfirming(true)} className="chat-action chat-action-danger">
                <TrashGlyph />
                Slett meldingen
              </button>
            </li>
          )}
        </ul>
      )}
    </BottomSheet>
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
      <span className="block font-semibold text-ink-soft">{reply.authorName ?? 'Ukjent'}</span>
      <span className="block truncate text-ink-faint">{reply.excerpt}</span>
    </>
  )

  const className =
    'chat-reply-ref mb-1.5 flex w-full min-w-0 items-stretch gap-2 rounded-[8px] py-1 pl-2 pr-2.5 text-[0.76rem] leading-snug'
  if (!onJump) {
    return (
      <div className={className}>
        <span className="w-[2px] shrink-0 rounded-full bg-brass/70" aria-hidden />
        <span className="min-w-0 flex-1">{content}</span>
      </div>
    )
  }
  return (
    <button type="button" onClick={onJump} title="Gå til meldingen" className={`${className} cursor-pointer text-left`}>
      <span className="w-[2px] shrink-0 rounded-full bg-brass/70" aria-hidden />
      <span className="min-w-0 flex-1">{content}</span>
    </button>
  )
}

const KIND_LABEL: Record<ChannelSummary['kind'], string> = {
  general: 'Felles kanal',
  project: 'Prosjekttråd',
  custom: 'Temakanal',
}

/**
 * Hele chat-skjermen: kanalvalg + tråden, som én arbeidsflate som fyller
 * plassen ned til fanelinjen. Kanalvalget bor i URL-en hos kalleren
 * (`?kanal=…`), så en tråd kan lenkes til; `active` og `onOpenChannel` er
 * derfor inn- og utgangen for det valget.
 */
export function ChatPanel({
  title,
  kicker,
  channels,
  meId,
  active,
  onOpenChannel,
  api,
  channelApi,
  onRefresh,
  emptyFor,
  missingGeneralNote,
}: {
  /** Sidens navn («Styrechat»): h1 for skjermlesere, overskrift i kanallista. */
  title: string
  /** Området over navnet i kanallista («Styrearbeidet»). */
  kicker: string
  channels: ChannelSummary[]
  meId: string
  /** Kanalen som vises nå. `undefined` når lista er tom. */
  active: ChannelSummary | undefined
  onOpenChannel: (channel: string) => void
  api: ChatApi
  channelApi: ChatChannelApi
  /** Henter loaderdataene på nytt — som regel `router.invalidate()`. */
  onRefresh: () => Promise<void>
  /** Tomteksten for en kanal; fellesekanalen sier noe annet enn en temakanal. */
  emptyFor: (channel: ChannelSummary) => { title: string; body: string }
  /** Vises når selv fellesekanalen mangler — noe som ikke skal kunne skje. */
  missingGeneralNote: string
}) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  useFillHeight(workspaceRef)
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<ChannelSummary | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [channelMenuOpen, setChannelMenuOpen] = useState(false)

  // Bare egendefinerte kanaler kan få nytt navn eller arkiveres; fellesekanalen
  // og prosjekttrådene eies av noe annet.
  const customId = active ? channelCustomId(active.channel) : null

  // Uleste i ANDRE kanaler — det er dem telefonens kanalknapp må fortelle om,
  // siden lista ikke står på skjermen. Samme regel som prikkene (`unreadBadge`).
  const elsewhere = channels.filter((c) => c.channel !== active?.channel && unreadBadge(c) !== null)
  const elsewhereCount = elsewhere.reduce((sum, c) => sum + c.unread, 0)
  const elsewhereMentioned = elsewhere.some((c) => unreadBadge(c)?.mentioned)

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

  const openChannel = (channel: string) => {
    setSwitcherOpen(false)
    onOpenChannel(channel)
  }

  return (
    <>
      <h1 className="sr-only">{title}</h1>
      <div ref={workspaceRef} className="chat-workspace">
        <div className="chat-frame rise">
          {/* iPad og desktop: kanallista som egen rute. */}
          <aside className="chat-sidebar">
            <div className="flex items-start justify-between gap-2 px-4 pb-3 pt-4">
              <div className="min-w-0">
                <Kicker className="mb-1">{kicker}</Kicker>
                <p className="display-title text-xl font-semibold italic leading-none text-ink">Kanaler</p>
              </div>
              <button
                type="button"
                onClick={() => setCreating(true)}
                aria-label="Ny kanal"
                title="Ny kanal"
                className="-mr-1 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border border-line-strong text-ink-soft transition-colors hover:border-brass hover:text-brass-strong pointer-coarse:h-11 pointer-coarse:w-11"
              >
                <PlusGlyph />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
              <ChannelList channels={channels} activeChannel={active?.channel} onOpen={openChannel} />
            </div>
          </aside>

          <section className="chat-conversation" aria-label={active ? `Samtale: ${active.title}` : 'Samtale'}>
            <header className="chat-header">
              {/* Telefon: kanalnavnet ER kanalvelgeren. */}
              <button
                type="button"
                onClick={() => setSwitcherOpen(true)}
                aria-haspopup="dialog"
                aria-label={`Bytt kanal. Nå: ${active?.title ?? 'ingen'}${
                  elsewhereCount > 0 ? `. ${elsewhereCount} uleste i andre kanaler${elsewhereMentioned ? ', du er nevnt' : ''}` : ''
                }`}
                className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 text-left md:hidden"
              >
                <ChannelHeading channel={active} />
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mt-0.5 shrink-0 text-ink-faint" aria-hidden>
                  <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {elsewhereCount > 0 && (
                  <span className="chat-badge ml-auto" aria-hidden>
                    {elsewhereMentioned && <span>@</span>}
                    {elsewhereCount > 9 ? '9+' : elsewhereCount}
                  </span>
                )}
              </button>
              {/* iPad/desktop: bare navnet; lista står til venstre. */}
              <div className="hidden min-w-0 flex-1 md:block">
                <ChannelHeading channel={active} />
              </div>

              {customId && active && (
                <>
                  <div className="hidden shrink-0 items-center gap-1 md:flex">
                    {!active.archived && (
                      <Button size="sm" variant="ghost" onClick={() => setRenaming(active)}>
                        Gi nytt navn
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setArchived(customId, !active.archived)}>
                      {active.archived ? 'Gjenopprett' : 'Arkiver'}
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChannelMenuOpen(true)}
                    aria-label="Kanalvalg"
                    aria-haspopup="dialog"
                    className="-mr-2 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft transition-colors active:bg-paper-sunken md:hidden"
                  >
                    <MoreGlyph />
                  </button>
                </>
              )}
            </header>

            {!active ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState title="Ingen kanaler">{missingGeneralNote}</EmptyState>
              </div>
            ) : (
              <ChatThread
                key={active.channel}
                layout="fill"
                api={api}
                channel={active.channel}
                meId={meId}
                writable={!active.archived}
                emptyTitle={emptyFor(active).title}
                emptyBody={emptyFor(active).body}
                onRead={refreshUnread}
                placeholder={`Melding i ${active.title}`}
              />
            )}
          </section>
        </div>
      </div>

      {/* Telefon: kanallista som bunnark. */}
      <BottomSheet
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        label="Kanaler"
        header={
          <div className="flex items-center justify-between gap-3 pb-1">
            <div className="min-w-0">
              <Kicker className="mb-1">{kicker}</Kicker>
              <p className="display-title text-xl font-semibold italic leading-none text-ink">Kanaler</p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setSwitcherOpen(false)
                setCreating(true)
              }}
            >
              <PlusGlyph />
              Ny kanal
            </Button>
          </div>
        }
      >
        <ChannelList channels={channels} activeChannel={active?.channel} onOpen={openChannel} />
      </BottomSheet>

      {/* Telefon: valg for den åpne kanalen. */}
      <BottomSheet
        open={channelMenuOpen && !!customId}
        onClose={() => setChannelMenuOpen(false)}
        label="Kanalvalg"
        header={
          active && (
            <div className="pb-1">
              <p className="text-[0.74rem] text-ink-faint">{KIND_LABEL[active.kind]}</p>
              <p className="display-title text-lg font-semibold text-ink">{active.title}</p>
            </div>
          )
        }
      >
        {active && customId && (
          <ul className="chat-action-list">
            {!active.archived && (
              <li>
                <button
                  type="button"
                  className="chat-action"
                  onClick={() => {
                    setChannelMenuOpen(false)
                    setRenaming(active)
                  }}
                >
                  Gi nytt navn
                </button>
              </li>
            )}
            <li>
              <button
                type="button"
                className="chat-action"
                onClick={() => {
                  setChannelMenuOpen(false)
                  void setArchived(customId, !active.archived)
                }}
              >
                {active.archived ? 'Gjenopprett kanalen' : 'Arkiver kanalen'}
              </button>
            </li>
          </ul>
        )}
      </BottomSheet>

      <ChannelNameModal
        open={creating}
        title="Ny kanal"
        submitLabel="Opprett"
        onClose={() => setCreating(false)}
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

function PlusGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** Kanalnavnet i samtalens topplinje, med typen og arkivmerket under. */
function ChannelHeading({ channel }: { channel: ChannelSummary | undefined }) {
  if (!channel) return <span className="text-ink-faint">Ingen kanal</span>
  return (
    <span className="min-w-0">
      <span className="block truncate font-display text-[1.08rem] font-semibold leading-tight text-ink">
        {channel.title}
      </span>
      <span className="block truncate font-mono text-[0.58rem] uppercase tracking-[0.14em] text-ink-faint">
        {KIND_LABEL[channel.kind]}
        {channel.archived && ' · Arkivert'}
      </span>
    </span>
  )
}

/**
 * Kanallista — den samme i sidekolonnen (iPad/desktop) og i bunnarket
 * (telefon). Arkiverte kanaler ligger bak en egen bryter nederst.
 */
function ChannelList({
  channels,
  activeChannel,
  onOpen,
}: {
  channels: ChannelSummary[]
  activeChannel: string | undefined
  onOpen: (channel: string) => void
}) {
  const open = channels.filter((c) => !c.archived)
  const archived = channels.filter((c) => c.archived)
  // Står man i en arkivert kanal, skal den synes i lista uten et ekstra trykk.
  const [showArchived, setShowArchived] = useState(() => archived.some((c) => c.channel === activeChannel))

  return (
    <nav aria-label="Kanaler">
      <ul className="space-y-0.5">
        {open.map((c) => (
          <li key={c.channel}>
            <ChannelRow channel={c} active={c.channel === activeChannel} onOpen={onOpen} />
          </li>
        ))}
      </ul>

      {archived.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            className="mt-3 flex min-h-9 w-full cursor-pointer items-center gap-1.5 rounded-[9px] px-3 text-left font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-faint transition-colors hover:text-ink pointer-coarse:min-h-11"
          >
            Arkiverte
            <span className="tabular-nums">({archived.length})</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              className={`ml-auto transition-transform ${showArchived ? 'rotate-180' : ''}`}
              aria-hidden
            >
              <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {showArchived && (
            <ul className="space-y-0.5">
              {archived.map((c) => (
                <li key={c.channel}>
                  <ChannelRow channel={c} active={c.channel === activeChannel} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </nav>
  )
}

function ChannelRow({
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
  const when = lastActivity(channel.lastMessageAt)
  return (
    <button
      type="button"
      onClick={() => onOpen(channel.channel)}
      aria-current={active ? 'true' : undefined}
      className={`chat-channel ${active ? 'is-active' : ''} ${badge ? 'is-unread' : ''} ${channel.archived ? 'is-archived' : ''}`}
    >
      <span className="min-w-0 flex-1">
        <span className="chat-channel-title block truncate">{channel.title}</span>
        <span className="block truncate font-mono text-[0.58rem] uppercase tracking-[0.12em] text-ink-faint">
          {KIND_LABEL[channel.kind]}
          {when && <span className="normal-case tracking-normal"> · {when}</span>}
        </span>
      </span>
      {badge && (
        <span className="chat-badge" aria-label={badge.label}>
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
