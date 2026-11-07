import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type BandMediaItem, MAX_BAND_MEDIA_TITLE, bandMediaTitleRejection, bandMediaUrl, filterBandMedia } from '../lib/band-media'
import { uploadBandMedia } from '../lib/band-media-client'
import { MESSAGE_MEDIA_ACCEPT, mediaRejectionReason } from '../lib/message-media'
import { listBandMedia, removeBandMedia } from '../server/band-media'
import { Icon } from './Icons'
import { toast, toastError } from './toast'
import { Button } from './ui'

/**
 * Tertnes-fanen i GIF-velgeren: korpsets egne GIF-er og memes (se
 * src/lib/band-media.ts). Alle medlemmer kan velge; med `gifs.manage` kan man
 * også legge til og fjerne — rett her i fanen, som en egen visning i panelet
 * (ikke en dialog oppå: velgeren lukkes ved et trykk utenfor seg selv).
 */

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: BandMediaItem[]; canManage: boolean }
type View = { kind: 'list' } | { kind: 'add' } | { kind: 'remove'; item: BandMediaItem }

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

export function BandMediaShelf({ busy, coarse, onPick }: { busy: boolean; coarse: boolean; onPick: (item: BandMediaItem) => void }) {
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
  const canManage = state.status === 'ready' && state.canManage
  const shown = useMemo(() => filterBandMedia(items, query), [items, query])
  const setItems = (fn: (items: BandMediaItem[]) => BandMediaItem[]) =>
    setState((s) => (s.status === 'ready' ? { ...s, items: fn(s.items) } : s))

  if (view.kind === 'add') {
    return (
      <AddForm
        onCancel={() => setView({ kind: 'list' })}
        onAdded={(item) => {
          setItems((list) => [item, ...list.filter((i) => i.id !== item.id)])
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
          if (left.length === 0) setEditing(false)
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
        {canManage && items.length > 0 && (
          <Button type="button" size="sm" variant={editing ? 'secondary' : 'ghost'} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
            {editing ? 'Ferdig' : 'Rediger'}
          </Button>
        )}
        {canManage && !editing && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setView({ kind: 'add' })} disabled={state.status !== 'ready'}>
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
            {canManage && (
              <button type="button" onClick={() => setView({ kind: 'add' })} className="link-brass mt-1 cursor-pointer text-sm">
                Legg til den første
              </button>
            )}
          </div>
        )}
        {state.status === 'ready' && items.length > 0 && shown.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-ink-soft">Ingen GIF-er heter det.</p>
        )}
        {editing && shown.length > 0 && <p className="mb-1.5 px-0.5 text-[0.78rem] text-ink-soft">Trykk på en GIF for å fjerne den.</p>}
        <div className={`columns-2 gap-1.5 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          {shown.map((item) => (
            <ShelfTile
              key={item.id}
              item={item}
              editing={editing}
              onClick={() => (editing ? setView({ kind: 'remove', item }) : onPick(item))}
            />
          ))}
        </div>
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
function ShelfTile({ item, editing, onClick }: { item: BandMediaItem; editing: boolean; onClick: () => void }) {
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
      aria-label={editing ? `Fjern ${item.title}` : item.title}
      className={`group mb-1.5 block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-[8px] bg-paper-sunken text-left outline-offset-2 ${
        editing ? 'ring-2 ring-danger/40 hover:ring-danger/70' : 'hover:ring-2 hover:ring-brass/60'
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
        {editing && (
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

/** «Legg til i Tertnes»: fil + navn, som en egen visning i panelet. */
function AddForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: (item: BandMediaItem) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const nameField = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const choose = (picked: File | undefined) => {
    if (!picked) return
    const reason = mediaRejectionReason({ type: picked.type, size: picked.size })
    if (reason) {
      setError(reason)
      return
    }
    setError(null)
    setFile(picked)
    requestAnimationFrame(() => nameField.current?.focus())
  }

  const titleError = title ? bandMediaTitleRejection(title) : null
  const ready = !!file && !!title.trim() && !titleError

  const save = async () => {
    if (!file || !ready || saving) return
    setSaving(true)
    setError(null)
    try {
      onAdded(await uploadBandMedia(file, title))
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
          accept={MESSAGE_MEDIA_ACCEPT}
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
          {preview ? (
            <img src={preview} alt="Valgt fil" className="h-full w-full object-contain" />
          ) : (
            <span className="flex items-center gap-2">
              <Icon name="image" size={17} /> Velg GIF eller bilde
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
        <p className="mt-3 rounded-[8px] bg-[var(--brass-soft)] px-2.5 py-2 text-[0.75rem] leading-snug text-ink-soft">
          Alle medlemmer kan se og bruke GIF-ene her. Legg bare til bilder av folk som er med på det.
        </p>
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
function RemoveConfirm({ item, onCancel, onRemoved }: { item: BandMediaItem; onCancel: () => void; onRemoved: () => void }) {
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
