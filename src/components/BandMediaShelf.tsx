import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type BandMediaItem,
  type BandMediaListItem,
  MAX_BAND_MEDIA_TITLE,
  bandMediaTitleRejection,
  bandMediaUrl,
  filterBandMedia,
} from '../lib/band-media'
import { uploadBandMedia } from '../lib/band-media-client'
import { isVideoFile } from '../lib/gif-maker'
import { MESSAGE_MEDIA_ACCEPT, mediaRejectionReason } from '../lib/message-media'
import { listBandMedia, removeBandMedia } from '../server/band-media'
import { BandMediaConsent } from './BandMediaConsent'
import { Icon } from './Icons'
import { toast, toastError } from './toast'
import { Button } from './ui'

/**
 * Tertnes-fanen i GIF-velgeren: korpsets egne GIF-er og memes (se
 * src/lib/band-media.ts). Alle medlemmer kan velge, legge til og fjerne sine
 * egne; med `gifs.manage` kan man fjerne alle — rett her i fanen, som en egen
 * visning i panelet (ikke en dialog oppå: velgeren lukkes ved et trykk utenfor
 * seg selv).
 *
 * Velger man en video i «Legg til», går den til `onVideo` («Lag GIF fra
 * video», src/components/gif-maker/GifMaker.tsx): den trenger hele skjermen,
 * så eieren lukker velgeren og åpner editoren i stedet.
 */

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: BandMediaListItem[]; canModerate: boolean }
type View = { kind: 'list' } | { kind: 'add' } | { kind: 'remove'; item: BandMediaListItem }

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}

export function BandMediaShelf({
  busy,
  coarse,
  onPick,
  onVideo,
}: {
  busy: boolean
  coarse: boolean
  onPick: (item: BandMediaItem) => void
  /** En video ble valgt i «Legg til». Uten denne tas bare bilder imot. */
  onVideo?: (file: File) => void
}) {
  const [state, setState] = useState<Loaded>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    listBandMedia().then(
      (res) => alive && setState({ status: 'ready', ...res }),
      () => alive && setState({ status: 'error' }),
    )
    return () => {
      alive = false
    }
  }, [attempt])

  const items = state.status === 'ready' ? state.items : []
  const ready = state.status === 'ready'
  const canModerate = state.status === 'ready' && state.canModerate
  /** Egne kan alltid fjernes; andres bare med `gifs.manage`. */
  const canRemove = (item: BandMediaListItem) => canModerate || item.mine
  const anyRemovable = items.some(canRemove)
  const shown = useMemo(() => filterBandMedia(items, query), [items, query])
  const setItems = (fn: (items: BandMediaListItem[]) => BandMediaListItem[]) =>
    setState((s) => (s.status === 'ready' ? { ...s, items: fn(s.items) } : s))

  if (view.kind === 'add') {
    return (
      <AddForm
        onVideo={onVideo}
        onCancel={() => setView({ kind: 'list' })}
        onAdded={(item) => {
          setItems((list) => [{ ...item, mine: true, addedByName: null }, ...list.filter((i) => i.id !== item.id)])
          setQuery('')
          setView({ kind: 'list' })
          toast(`La til «${item.title}» i Tertnes`)
        }}
      />
    )
  }
  if (view.kind === 'remove') {
    return (
      <RemoveConfirm
        item={view.item}
        onCancel={() => setView({ kind: 'list' })}
        onRemoved={() => {
          const left = items.filter((i) => i.id !== view.item.id)
          setItems(() => left)
          if (!left.some(canRemove)) setEditing(false)
          setView({ kind: 'list' })
          toast(`Fjernet «${view.item.title}» fra Tertnes`)
        }}
      />
    )
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 px-3 pt-2.5 pb-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 pt-0.5 text-ink-faint" aria-hidden>
            <Icon name="search" size={15} />
          </span>
          <input
            type="search"
            placeholder="Søk i Tertnes"
            aria-label="Søk i korpsets egne GIF-er"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus={!coarse}
            enterKeyHint="search"
            className="field-input w-full !py-1.5 !pl-8 text-sm"
          />
        </div>
        {anyRemovable && (
          <Button type="button" size="sm" variant={editing ? 'secondary' : 'ghost'} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
            {editing ? 'Ferdig' : 'Rediger'}
          </Button>
        )}
        {!editing && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setView({ kind: 'add' })} disabled={!ready}>
            + Legg til
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
        {state.status === 'loading' && <ShelfSkeleton />}
        {state.status === 'error' && (
          <div className="px-1 py-6 text-center text-sm text-ink-soft">
            <p>Kunne ikke hente korpsets GIF-er.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="link-brass mt-1 cursor-pointer text-sm">
              Prøv igjen
            </button>
          </div>
        )}
        {state.status === 'ready' && items.length === 0 && (
          <div className="px-1 py-6 text-center text-sm text-ink-soft">
            <p>Korpset har ingen egne GIF-er her ennå.</p>
            <button type="button" onClick={() => setView({ kind: 'add' })} className="link-brass mt-1 cursor-pointer text-sm">
              Legg til den første
            </button>
          </div>
        )}
        {state.status === 'ready' && items.length > 0 && shown.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-ink-soft">Ingen GIF-er heter det.</p>
        )}
        {editing && shown.length > 0 && (
          <p className="mb-1.5 px-0.5 text-[0.78rem] text-ink-soft">
            {canModerate ? 'Trykk på en GIF for å fjerne den.' : 'Trykk på en av dine egne for å fjerne den.'}
          </p>
        )}
        <div className={`columns-2 gap-1.5 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          {shown.map((item) => (
            <ShelfTile
              key={item.id}
              item={item}
              editing={editing}
              removable={canRemove(item)}
              onClick={() => (editing ? setView({ kind: 'remove', item }) : onPick(item))}
            />
          ))}
        </div>
        {ready && items.length > 0 && !editing && (
          <p className="px-1 pt-2 pb-1 text-center text-[0.72rem] text-ink-faint">Er du med i en GIF du vil ha fjernet? Si fra til styret.</p>
        )}
      </div>
      <p className="shrink-0 border-t border-line px-3 py-1.5 text-right font-mono text-[0.58rem] uppercase tracking-[0.14em] text-ink-faint">
        Korpsets egne · bare for medlemmer
      </p>
    </>
  )
}

function ShelfSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-1.5" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-[8px] bg-paper-sunken" />
      ))}
    </div>
  )
}

/**
 * Én GIF i fanen, med navnet under. Ved redusert bevegelse står den stille
 * (første bilde tegnet på et lerret), som i samtalene.
 */
function ShelfTile({
  item,
  editing,
  removable,
  onClick,
}: {
  item: BandMediaListItem
  editing: boolean
  /** I «Rediger»: bare dine egne (eller alle, med `gifs.manage`) kan trykkes. */
  removable: boolean
  onClick: () => void
}) {
  const reduced = useReducedMotion()
  const img = useRef<HTMLImageElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const still = reduced && item.contentType === 'image/gif'
  const draw = useCallback(() => {
    const image = img.current
    const target = canvas.current
    if (!image || !target || !image.complete || !image.naturalWidth) return
    target.width = image.naturalWidth
    target.height = image.naturalHeight
    target.getContext('2d')?.drawImage(image, 0, 0)
  }, [])
  useEffect(() => {
    if (still) draw()
  }, [still, draw])

  return (
    <button
      type="button"
      onClick={onClick}
      title={item.title}
      aria-label={editing && removable ? `Fjern ${item.title}` : item.title}
      disabled={editing && !removable}
      className={`group mb-1.5 block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-[8px] bg-paper-sunken text-left outline-offset-2 ${
        editing ? (removable ? 'ring-2 ring-danger/40 hover:ring-danger/70' : 'cursor-default opacity-35') : 'hover:ring-2 hover:ring-brass/60'
      }`}
    >
      <span className="relative block">
        <img
          ref={img}
          src={bandMediaUrl(item.id)}
          alt=""
          width={item.width}
          height={item.height}
          loading="lazy"
          decoding="async"
          onLoad={() => {
            if (still) draw()
          }}
          className={`block h-auto w-full ${still ? 'sr-only' : ''}`}
        />
        {still && <canvas ref={canvas} width={item.width} height={item.height} className="block h-auto w-full" aria-hidden />}
        {editing && removable && (
          <span
            aria-hidden
            className="absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white pointer-coarse:h-9 pointer-coarse:w-9"
          >
            <Icon name="close" size={15} />
          </span>
        )}
      </span>
      <span className="block truncate px-1.5 py-1 text-[0.72rem] font-semibold text-ink-soft group-hover:text-ink">{item.title}</span>
    </button>
  )
}

/** Lengste side på forhåndsvisningen i px (lerretet skaleres ned med CSS). */
const PREVIEW_MAX = 480

/** «Legg til i Tertnes»: fil + navn, som en egen visning i panelet. En video går videre til `onVideo`. */
function AddForm({
  onCancel,
  onAdded,
  onVideo,
}: {
  onCancel: () => void
  onAdded: (item: BandMediaItem) => void
  onVideo?: (file: File) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const nameField = useRef<HTMLInputElement>(null)
  const previewCanvas = useRef<HTMLCanvasElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Forhåndsvisningen tegnes på et lerret (første bilde i en GIF), ikke som
  // <img src="blob:…">: da når ingen adresse avledet av filvalget DOM-en
  // (CodeQL js/xss-through-dom), og et stort telefonbilde blir et lite lerret.
  useEffect(() => {
    if (!file) return
    let alive = true
    createImageBitmap(file).then(
      (bitmap) => {
        const target = previewCanvas.current
        if (alive && target) {
          const scale = Math.min(1, PREVIEW_MAX / Math.max(bitmap.width, bitmap.height))
          target.width = Math.max(1, Math.round(bitmap.width * scale))
          target.height = Math.max(1, Math.round(bitmap.height * scale))
          target.getContext('2d')?.drawImage(bitmap, 0, 0, target.width, target.height)
        }
        bitmap.close()
      },
      () => {
        if (alive) setError('Kunne ikke lese bildet')
      },
    )
    return () => {
      alive = false
    }
  }, [file])

  const choose = (picked: File | undefined) => {
    if (!picked) return
    if (onVideo && isVideoFile(picked)) {
      onVideo(picked)
      return
    }
    const reason = mediaRejectionReason({ type: picked.type, size: picked.size })
    if (reason) {
      setError(reason)
      return
    }
    setError(null)
    setFile(picked)
    requestAnimationFrame(() => nameField.current?.focus())
  }

  // Editoren hentes mens man velger fil, så den åpner med en gang etter et videovalg.
  useEffect(() => {
    if (onVideo) void import('./gif-maker/GifMaker').catch(() => {})
  }, [onVideo])

  const titleError = title ? bandMediaTitleRejection(title) : null
  const [consent, setConsent] = useState(false)
  const ready = !!file && !!title.trim() && !titleError && consent

  const save = async () => {
    if (!file || !ready || saving) return
    setSaving(true)
    setError(null)
    try {
      onAdded(await uploadBandMedia(file, title, consent))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke legge til GIF-en')
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-1.5">
        <button type="button" onClick={onCancel} className="cursor-pointer text-[0.78rem] text-ink-soft hover:text-ink">
          ← Tilbake
        </button>
        <span className="text-[0.78rem] font-semibold text-ink">Legg til i Tertnes</span>
      </div>
      <form
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <input
          ref={input}
          type="file"
          accept={onVideo ? `${MESSAGE_MEDIA_ACCEPT},video/*` : MESSAGE_MEDIA_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            choose(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex h-36 w-full cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border border-dashed border-line-strong bg-paper-sunken text-sm text-ink-soft hover:border-brass hover:text-brass-strong"
        >
          {file ? (
            <canvas ref={previewCanvas} role="img" aria-label="Valgt fil" className="h-full w-full object-contain" />
          ) : (
            <span className="flex flex-col items-center gap-1 px-4 text-center">
              <span className="flex items-center gap-2">
                <Icon name="image" size={17} /> {onVideo ? 'Velg GIF, bilde eller video' : 'Velg GIF eller bilde'}
              </span>
              {onVideo && <span className="text-[0.72rem] text-ink-faint">Fra en video lager du GIF-en selv: klipp, utsnitt og loop.</span>}
            </span>
          )}
        </button>
        {file && (
          <button type="button" onClick={() => input.current?.click()} className="link-brass mt-1 cursor-pointer text-[0.78rem]">
            Velg en annen fil
          </button>
        )}
        <label className="mt-3 block text-[0.78rem] font-semibold text-ink" htmlFor="band-media-title">
          Navn
        </label>
        <input
          ref={nameField}
          id="band-media-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_BAND_MEDIA_TITLE}
          placeholder="For eksempel «Galleri 69»"
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={!!titleError}
          className="field-input mt-1 w-full !py-1.5 text-sm"
        />
        <p className="mt-1 text-[0.72rem] text-ink-faint">Det man søker på, og det skjermlesere leser opp.</p>
        <div className="mt-3">
          <BandMediaConsent checked={consent} onChange={setConsent} disabled={saving} compact />
        </div>
        {(error || titleError) && (
          <p role="alert" className="mt-2 text-[0.78rem] text-danger">
            {error ?? titleError}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
            Avbryt
          </Button>
          <Button type="submit" size="sm" variant="primary" disabled={!ready} loading={saving}>
            {saving ? 'Legger til …' : 'Legg til'}
          </Button>
        </div>
      </form>
    </div>
  )
}

/** Bekreftelsen før en GIF fjernes for alle — aldri et direkte trykk. */
function RemoveConfirm({ item, onCancel, onRemoved }: { item: BandMediaListItem; onCancel: () => void; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false)
  const remove = async () => {
    setRemoving(true)
    try {
      await removeBandMedia({ data: { id: item.id } })
      onRemoved()
    } catch (err) {
      toastError(err)
      setRemoving(false)
    }
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 pt-3 pb-3" aria-labelledby="band-media-remove">
      <div className="mx-auto w-32 overflow-hidden rounded-[8px] bg-paper-sunken">
        <img src={bandMediaUrl(item.id)} alt="" width={item.width} height={item.height} className="block h-auto w-full" />
      </div>
      <h3 id="band-media-remove" className="mt-3 text-center text-[0.95rem] font-semibold text-ink">
        Fjerne «{item.title}» fra Tertnes?
      </h3>
      <p className="mt-1 text-center text-[0.8rem] text-ink-soft">
        Den forsvinner fra velgeren for alle. Meldinger der den allerede er brukt, beholder den.
      </p>
      <p className="mt-1 text-center text-[0.75rem] text-ink-faint">
        {item.mine ? 'Du la den til.' : item.addedByName ? `Lagt til av ${item.addedByName}.` : 'Den som la den til, er ikke lenger medlem.'}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={removing} autoFocus>
          Avbryt
        </Button>
        <Button type="button" size="sm" variant="danger" onClick={() => void remove()} loading={removing}>
          Fjern
        </Button>
      </div>
    </section>
  )
}
