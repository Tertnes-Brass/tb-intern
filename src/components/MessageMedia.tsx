import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  MAX_MEDIA_PER_ITEM,
  MESSAGE_MEDIA_ACCEPT,
  type MessageMediaItem,
  isAnimatedItem,
  isGifItem,
  mediaLabel,
  mediaRejectionReason,
  mediaSrc,
} from '../lib/message-media'
import { discardMessageMedia, imageFilesFrom, uploadMessageMedia } from '../lib/message-media-client'
import { Icon } from './Icons'
import { toast } from './toast'

/**
 * Bilder, GIF-er, stickers og memes i samtalene — visningen og skrivefeltets
 * del. Deles av forumet, kommentarene på veggen og chattene, slik
 * `MentionTextarea` gjør. GIF-velgeren (KLIPY) bor i MediaPicker.tsx.
 *
 * Et bilde lastes opp i det øyeblikket det velges (eller limes inn), og et valg
 * fra GIF-velgeren lagres med en gang, så «Send» bare trenger å nevne id-ene.
 * Til meldingen er sendt, er det et utkast som bare eieren ser; krysses det vekk
 * eller forlates skrivefeltet, slettes det, og det som likevel blir liggende,
 * rydder den daglige cron-en.
 */

// ---------- Visning ----------

/**
 * Bildene i et innlegg, svar, kommentar eller melding. Ett bilde vises i sin
 * egen form (aldri høyere enn skjermen tåler), flere som et rutenett. Trykk
 * åpner bildet i full størrelse i en ny fane — som bildene på veggen.
 */
export function MessageMediaGallery({ items, className = '' }: { items: readonly MessageMediaItem[]; className?: string }) {
  if (items.length === 0) return null
  const single = items.length === 1
  return (
    <ul className={`${single ? 'flex' : 'grid max-w-sm grid-cols-2 gap-1.5'} ${className}`}>
      {items.map((item) => (
        <GalleryItem key={item.id} item={item} single={single} />
      ))}
    </ul>
  )
}

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Ett bilde. Bredde og høyde (fra bytene ved opplasting) holder av plass, så
 * tråden ikke hopper når bildet kommer. En GIF står stille for den som har bedt
 * om redusert bevegelse: bildet tegnes på et lerret, og «Spill av GIF» viser
 * den levende GIF-en.
 */
function GalleryItem({ item, single }: { item: MessageMediaItem; single: boolean }) {
  const isGif = isAnimatedItem(item)
  const external = !!item.externalUrl
  const sticker = item.externalKind === 'sticker'
  const [still, setStill] = useState(false)
  const img = useRef<HTMLImageElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const draw = useCallback(() => {
    const image = img.current
    const target = canvas.current
    if (!image || !target || !image.complete || !image.naturalWidth) return
    target.width = image.naturalWidth
    target.height = image.naturalHeight
    target.getContext('2d')?.drawImage(image, 0, 0)
  }, [])
  // Etter hydrering: på serveren vet vi ikke hva leseren har bedt om.
  useEffect(() => setStill(isGif && reducedMotion()), [isGif])
  useEffect(() => {
    if (still) draw()
  }, [still, draw])

  const label = mediaLabel([item])
  const alt = item.title ? `${label}: ${item.title}` : label
  // En sticker er en figur uten bakgrunn: liten, uten ramme, som i Discord.
  const sizeClass = sticker
    ? 'block h-auto max-h-36 w-auto max-w-full object-contain'
    : single
      ? 'block h-auto max-h-80 w-auto max-w-full'
      : 'block aspect-square h-full w-full object-cover'
  return (
    <li className="relative min-w-0">
      <a
        href={mediaSrc(item)}
        target="_blank"
        // KLIPY skal ikke få vite hvilken tråd GIF-en ble åpnet fra.
        rel="noopener noreferrer"
        className={`block overflow-hidden ${sticker ? '' : 'rounded-[10px] border border-line bg-paper-sunken'}`}
        aria-label={`${alt} i full størrelse`}
      >
        <img
          ref={img}
          src={mediaSrc(item)}
          // Fra KLIPYs CDN: ingen referrer, så KLIPY ser at noen viste GIF-en, ikke hvor.
          referrerPolicy={external ? 'no-referrer' : undefined}
          alt={alt}
          width={item.width ?? undefined}
          height={item.height ?? undefined}
          loading="lazy"
          decoding="async"
          className={`${sizeClass} ${still ? 'sr-only' : ''}`}
          onLoad={() => {
            if (still) draw()
          }}
        />
        {still && (
          <canvas ref={canvas} width={item.width ?? undefined} height={item.height ?? undefined} className={sizeClass} aria-hidden />
        )}
      </a>
      {isGifItem(item) && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-[4px] bg-black/60 px-1 py-px font-mono text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-white"
        >
          GIF
        </span>
      )}
      {still && (
        <button
          type="button"
          onClick={() => setStill(false)}
          className="absolute inset-0 m-auto h-fit w-fit cursor-pointer rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black/75"
        >
          {sticker ? 'Spill av' : 'Spill av GIF'}
        </button>
      )}
    </li>
  )
}

// ---------- Skrivefeltet ----------

export type DraftMedia = {
  key: string
  /** Forhåndsvisningen: en lokal object URL for en opplasting, KLIPY-adressen for et valg derfra. */
  preview: string
  /** Er `preview` en object URL vi må frigjøre? */
  local: boolean
  status: 'uploading' | 'ready' | 'failed'
  item?: MessageMediaItem
  error?: string
}

export type MediaDraft = {
  items: readonly DraftMedia[]
  /** Id-ene som skal sendes med meldingen, i rekkefølgen de ble lagt til. */
  ids: string[]
  uploading: boolean
  failed: boolean
  full: boolean
  add: (files: File[]) => void
  /** Et utkast som allerede er lagret — et valg fra GIF-velgeren. */
  addReady: (item: MessageMediaItem) => void
  remove: (key: string) => void
  /**
   * Etter at meldingen er sendt: de sendte bildene hører til meldingen nå og
   * skal ikke slettes. Bare DE fjernes — et bilde som ble limt inn mens
   * meldingen ble sendt, blir stående til neste melding.
   */
  clear: (sentIds: readonly string[]) => void
  /** Avbrutt (f.eks. «Avbryt» på et svar): utkastene slettes. */
  discardAll: () => void
}

/**
 * Bildene i ett skrivefelt. Lista bor i en ref (sannheten, oppdatert med en
 * gang) og tegnes på nytt med en teller: to raske valg etter hverandre skal
 * ikke kunne slippe forbi taket på fire, slik de kunne med to setState-runder.
 */
const revoke = (d: DraftMedia) => {
  if (d.local) URL.revokeObjectURL(d.preview)
}

export function useMediaDraft(): MediaDraft {
  const ref = useRef<DraftMedia[]>([])
  const mounted = useRef(true)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const update = useCallback((fn: (items: DraftMedia[]) => DraftMedia[]) => {
    ref.current = fn(ref.current)
    if (mounted.current) rerender()
  }, [])

  useEffect(() => {
    mounted.current = true
    // Lukket fane eller ny lasting: React kjører ingen opprydding da, så
    // utkastene slettes her (keepalive overlever at siden forsvinner). Ikke når
    // siden legges i tilbake-bufferen (`persisted`) — da kan den komme tilbake.
    const onPageHide = (e: PageTransitionEvent) => {
      if (e.persisted) return
      for (const d of ref.current) if (d.item) discardMessageMedia(d.item.id)
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      mounted.current = false
      // Forlatt skrivefelt: utkastene slettes. Var meldingen sendt, er lista tom
      // (`clear`) — og serveren nekter uansett å slette et bilde som er sendt.
      for (const d of ref.current) {
        revoke(d)
        if (d.item) discardMessageMedia(d.item.id)
      }
      ref.current = []
    }
  }, [])

  const add = useCallback(
    (files: File[]) => {
      for (const file of files) {
        if (ref.current.length >= MAX_MEDIA_PER_ITEM) {
          toast(`Maks ${MAX_MEDIA_PER_ITEM} bilder per melding`, 'error')
          return
        }
        const reason = mediaRejectionReason({ type: file.type, size: file.size })
        if (reason) {
          toast(file.name ? `${file.name}: ${reason}` : reason, 'error')
          continue
        }
        const key = crypto.randomUUID()
        update((items) => [...items, { key, preview: URL.createObjectURL(file), local: true, status: 'uploading' }])
        uploadMessageMedia(file).then(
          (item) => {
            // Krysset vekk (eller feltet forlatt) mens det lastet opp.
            if (!mounted.current || !ref.current.some((d) => d.key === key)) return discardMessageMedia(item.id)
            update((items) => items.map((d) => (d.key === key ? { ...d, status: 'ready', item } : d)))
          },
          (err: unknown) => {
            const error = err instanceof Error ? err.message : 'Kunne ikke laste opp bildet'
            update((items) => items.map((d) => (d.key === key ? { ...d, status: 'failed', error } : d)))
          },
        )
      }
    },
    [update],
  )

  const addReady = useCallback(
    (item: MessageMediaItem) => {
      // Skrivefeltet ble lukket mens valget ble lagret: ingen skal sende det.
      if (!mounted.current) return discardMessageMedia(item.id)
      if (ref.current.length >= MAX_MEDIA_PER_ITEM) {
        toast(`Maks ${MAX_MEDIA_PER_ITEM} bilder per melding`, 'error')
        return discardMessageMedia(item.id)
      }
      update((items) => [...items, { key: crypto.randomUUID(), preview: mediaSrc(item), local: false, status: 'ready', item }])
    },
    [update],
  )

  const remove = useCallback(
    (key: string) => {
      const d = ref.current.find((x) => x.key === key)
      if (!d) return
      revoke(d)
      if (d.item) discardMessageMedia(d.item.id)
      update((items) => items.filter((x) => x.key !== key))
    },
    [update],
  )

  const clear = useCallback(
    (sentIds: readonly string[]) => {
      const sent = new Set(sentIds)
      const isSent = (d: DraftMedia) => !!d.item && sent.has(d.item.id)
      for (const d of ref.current) if (isSent(d)) revoke(d)
      update((items) => items.filter((d) => !isSent(d)))
    },
    [update],
  )

  const discardAll = useCallback(() => {
    for (const d of ref.current) {
      revoke(d)
      if (d.item) discardMessageMedia(d.item.id)
    }
    update(() => [])
  }, [update])

  const items = ref.current
  return {
    items,
    ids: items.flatMap((d) => (d.status === 'ready' && d.item ? [d.item.id] : [])),
    uploading: items.some((d) => d.status === 'uploading'),
    failed: items.some((d) => d.status === 'failed'),
    full: items.length >= MAX_MEDIA_PER_ITEM,
    add,
    addReady,
    remove,
    clear,
    discardAll,
  }
}

/** Kan meldingen sendes? Tekst eller ferdig opplastede bilder — og ingen som feilet eller venter. */
export function canSendWith(body: string, draft: MediaDraft): boolean {
  if (draft.uploading || draft.failed) return false
  return body.trim().length > 0 || draft.ids.length > 0
}

/**
 * Lim inn et bilde (Cmd+V av et kopiert bilde, eller et GIF-tastatur på
 * Android). Inneholder utklippstavlen også vanlig tekst, vinner teksten — Word
 * og Excel legger et bilde av markeringen ved siden av teksten, og den som
 * limer inn et avsnitt vil ha avsnittet.
 */
export function pasteMedia(draft: MediaDraft) {
  return (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain').trim()
    if (text && !/^https?:\/\/\S+$/.test(text)) return
    const files = imageFilesFrom(e.clipboardData)
    if (files.length === 0) return
    e.preventDefault()
    draft.add(files)
  }
}

/** Dra bilder inn på skrivefeltet (datamaskin). Props til boksen rundt feltet. */
export function dropMedia(draft: MediaDraft) {
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes('Files')
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDrop: (e: React.DragEvent) => {
      const files = imageFilesFrom(e.dataTransfer)
      if (!hasFiles(e)) return
      e.preventDefault()
      if (files.length) draft.add(files)
      else toast('Bare bilder og GIF-er kan legges ved', 'error')
    },
  }
}

/** Knappen som åpner filvelgeren (bildebiblioteket på telefonen). */
export function MediaButton({
  draft,
  disabled = false,
  compact = false,
}: {
  draft: MediaDraft
  disabled?: boolean
  /** Bare ikonet — i chatten, der plassen ved «Send» er knapp. */
  compact?: boolean
}) {
  const off = disabled || draft.full
  // En <label> rundt en visuelt skjult (ikke `display: none`) filvelger: nettleseren
  // åpner bildebiblioteket selv, uten et programmatisk `.click()` — det er det som
  // virker overalt, også i installert app på iPhone. Fokus og tastatur går til selve
  // feltet, og rammen tegnes på etiketten.
  return (
    <label
      title={draft.full ? 'Maks fire bilder per melding' : 'Last opp bilde eller GIF fra enheten'}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[9px] text-ink-soft transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brass ${
        off ? 'pointer-events-none opacity-40' : 'cursor-pointer hover:bg-paper-sunken hover:text-ink'
      } ${compact ? 'h-[42px] w-10 pointer-coarse:h-11 pointer-coarse:w-11' : 'px-2 py-1.5 text-xs pointer-coarse:min-h-11 pointer-coarse:px-3'}`}
    >
      <input
        type="file"
        accept={MESSAGE_MEDIA_ACCEPT}
        multiple
        disabled={off}
        aria-label="Last opp bilde eller GIF fra enheten"
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          // Samme fil skal kunne velges igjen etter at den er krysset vekk.
          e.target.value = ''
          if (files.length) draft.add(files)
        }}
      />
      <Icon name="image" size={compact ? 20 : 17} />
      {!compact && <span aria-hidden>Bilde</span>}
    </label>
  )
}

/** Miniatyrene i skrivefeltet, med kryss og status for hvert bilde. */
export function MediaDraftStrip({ draft, className = '' }: { draft: MediaDraft; className?: string }) {
  if (draft.items.length === 0) return null
  const errors = draft.items.flatMap((d) => (d.status === 'failed' && d.error ? [d.error] : []))
  return (
    <div className={className}>
      <ul className="flex flex-wrap gap-2" aria-label="Bilder som sendes med">
        {draft.items.map((d) => (
          <li
            key={d.key}
            className={`relative h-16 w-16 overflow-hidden rounded-[8px] border bg-paper-sunken ${
              d.status === 'failed' ? 'border-danger' : 'border-line'
            }`}
          >
            <img src={d.preview} alt="" referrerPolicy={d.local ? undefined : 'no-referrer'} className="h-full w-full object-cover" />
            {d.status === 'uploading' && (
              <span className="absolute inset-0 grid place-items-center bg-paper/60 text-ink" role="status" aria-label="Laster opp">
                <span className="spinner" />
              </span>
            )}
            {d.status === 'failed' && (
              <span className="absolute inset-x-0 bottom-0 bg-danger px-1 py-px text-center text-[0.58rem] font-semibold text-white">
                Feilet
              </span>
            )}
            <button
              type="button"
              onClick={() => draft.remove(d.key)}
              aria-label="Fjern bildet"
              className="absolute right-0.5 top-0.5 grid h-6 w-6 cursor-pointer place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
            >
              <Icon name="close" size={12} strokeWidth={2.2} />
            </button>
          </li>
        ))}
      </ul>
      {errors.length > 0 && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {errors[0]} — fjern bildet for å sende.
        </p>
      )}
    </div>
  )
}

/**
 * Setter inn tekst (en emoji fra velgeren) der markøren står i et tekstfelt, og
 * flytter markøren etter det som ble satt inn. Uten feltet havner det bakerst.
 */
export function insertAtCursor(field: HTMLTextAreaElement | null, value: string, onChange: (value: string) => void, text: string): void {
  const start = field?.selectionStart ?? value.length
  const end = field?.selectionEnd ?? value.length
  onChange(value.slice(0, start) + text + value.slice(end))
  requestAnimationFrame(() => {
    if (!field) return
    field.focus()
    field.setSelectionRange(start + text.length, start + text.length)
  })
}
