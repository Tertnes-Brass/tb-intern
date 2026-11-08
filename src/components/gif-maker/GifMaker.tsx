import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type BandMediaItem, MAX_BAND_MEDIA_TITLE, bandMediaTitleRejection } from '../../lib/band-media'
import { uploadBandMedia } from '../../lib/band-media-client'
import { formatBytes } from '../../lib/format'
import { encodeGif } from '../../lib/gif-encode'
import {
  CAPTURE_MAX_SIDE,
  CROP_ASPECTS,
  CROP_ASPECT_LABEL,
  type CropAspect,
  type CropView,
  FRAME_DELAY_CS,
  GIF_SIZES,
  GIF_SIZE_LABEL,
  GIF_SIZE_SIDE,
  type GifSize,
  INITIAL_VIEW,
  LOOP_MODES,
  LOOP_MODE_LABEL,
  type LoopMode,
  MAX_ZOOM,
  type Rect,
  SPEEDS,
  SPEED_LABEL,
  type Speed,
  TRACK_SPAN_SECONDS,
  type Trim,
  cropRect,
  fitTrim,
  formatClipTime,
  formatSeconds,
  frameOrder,
  frameTimes,
  gifSeconds,
  initialTrim,
  maxClipSeconds,
  outputSize,
  smallerSize,
  speedValue,
  trackWindow,
  withAspect,
  zoomView,
} from '../../lib/gif-maker'
import { MAX_MESSAGE_MEDIA_BYTES } from '../../lib/message-media'
import { captureFrames, createFrameReader, seekVideo, videoReady } from '../../lib/video-frames'
import { BandMediaConsent } from '../BandMediaConsent'
import { Icon } from '../Icons'
import { Segmented } from '../Segmented'
import { Button, FieldGroup, Modal } from '../ui'
import { CropStage } from './CropStage'
import { GifPreview, PauseGlyph } from './GifPreview'
import { TrimBar } from './TrimBar'

/**
 * «Lag GIF fra video» — fra «+ Legg til» i Tertnes-fanen, når man velger en
 * video. To steg i samme dialog:
 *
 * 1. **Klipp:** utsnitt (form, zoom, dra), start og slutt på tidslinjen, fart.
 *    Forhåndsvisningen spiller klippet i loop mens man justerer.
 * 2. **GIF-en:** bildene hentes, og man ser resultatet: loop (vanlig, frem og
 *    tilbake, baklengs), størrelse og filstørrelse, navn — og «Legg til».
 *
 * Alt skjer i nettleseren; videoen forlater aldri enheten. Bare GIF-en lastes
 * opp, med samme `uploadBandMedia` som en ferdig GIF. Reglene står i
 * src/lib/gif-maker.ts, kodingen i src/lib/gif-encode.ts.
 *
 * Lastes lat fra `PickerButton` (src/components/MediaPicker.tsx): velgeren
 * lukkes mens dialogen er oppe, og åpnes igjen på Tertnes-fanen etterpå.
 */

type Meta = { width: number; height: number; duration: number }
type Captured = { frames: Blob[]; crop: Rect }
type Encoded =
  | { status: 'working'; progress: number }
  | { status: 'ready'; bytes: Uint8Array<ArrayBuffer>; width: number; height: number }
  | { status: 'too-big'; size: number; width: number; height: number }
  | { status: 'error' }

/** «2,9 MB» — med komma, som resten av teksten her. */
const sizeLabel = (bytes: number) => formatBytes(bytes).replace('.', ',')

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

export default function GifMaker({ file, onClose, onAdded }: { file: File; onClose: () => void; onAdded: (item: BandMediaItem) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  /** Toppen av innholdet — for å rulle arket dit når steget byttes. */
  const topRef = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [phase, setPhase] = useState<'edit' | 'capturing' | 'result'>('edit')

  const [view, setView] = useState<CropView>(INITIAL_VIEW)
  const [trim, setTrim] = useState<Trim>({ start: 0, end: 0 })
  const [trackFrom, setTrackFrom] = useState(0)
  const [speed, setSpeed] = useState<Speed>('1')
  const [playing, setPlaying] = useState(true)

  const [progress, setProgress] = useState(0)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const captureCtrl = useRef<AbortController | null>(null)
  const [captured, setCaptured] = useState<Captured | null>(null)

  const [loop, setLoop] = useState<LoopMode>('forward')
  const [size, setSize] = useState<GifSize>('medium')
  /** Størrelsen går ned av seg selv til GIF-en er under 10 MB — til man velger selv. */
  const [autoSize, setAutoSize] = useState(true)
  const [shrunk, setShrunk] = useState(false)
  const [encoded, setEncoded] = useState<Encoded>({ status: 'working', progress: 0 })

  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [consent, setConsent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const track = meta ? trackWindow(trackFrom, meta.duration) : { from: 0, to: 0 }
  const maxLen = maxClipSeconds(speed)

  // Siste verdier for løkkene (requestAnimationFrame og hendelser).
  const trimRef = useRef(trim)
  trimRef.current = trim
  const scrubbing = useRef(false)
  const playingRef = useRef(playing)
  playingRef.current = playing

  // ---------- Videoen ----------

  // Adressen settes i koden, ikke som attributt: filen er brukerens egen og
  // vises bare her. Den slippes når dialogen lukkes.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const objectUrl = URL.createObjectURL(file)
    let alive = true
    video.src = objectUrl
    video.load()
    setUrl(objectUrl)
    videoReady(video).then(
      () => {
        if (!alive) return
        const duration = video.duration
        if (!video.videoWidth || !video.videoHeight || !Number.isFinite(duration) || duration <= 0) {
          setLoadError(true)
          return
        }
        setMeta({ width: video.videoWidth, height: video.videoHeight, duration })
        setTrim(initialTrim(duration, '1'))
        video.play().catch(() => setPlaying(false))
      },
      () => alive && setLoadError(true),
    )
    return () => {
      alive = false
      video.pause()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(objectUrl)
    }
  }, [file])

  // Klippet går i loop: tilbake til start når slutten er nådd.
  useEffect(() => {
    if (!meta || phase !== 'edit') return
    const video = videoRef.current
    if (!video) return
    let raf = 0
    const tick = () => {
      const { start, end } = trimRef.current
      if (!scrubbing.current && !video.paused && !video.seeking && (video.currentTime >= end - 0.01 || video.currentTime < start - 0.05)) {
        video.currentTime = start
      }
      raf = requestAnimationFrame(tick)
    }
    // En video som når sin egen slutt, stopper av seg selv.
    const onEnded = () => {
      if (scrubbing.current || !playingRef.current) return
      video.currentTime = trimRef.current.start
      void video.play().catch(() => setPlaying(false))
    }
    video.addEventListener('ended', onEnded)
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      video.removeEventListener('ended', onEnded)
    }
  }, [meta, phase])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.playbackRate = speedValue(speed)
  }, [speed, meta])

  // Nytt steg begynner øverst. Arket beholder ellers rulleposisjonen fra
  // forrige steg, og «Slik blir GIF-en» åpnet med forhåndsvisningen halvt
  // ute av bildet (sett i iOS-simulatoren).
  useEffect(() => {
    if (phase === 'capturing') return
    topRef.current?.closest('.sheet-body')?.scrollTo({ top: 0 })
  }, [phase])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !meta || phase !== 'edit' || scrubbing.current) return
    if (playing) {
      const { start, end } = trimRef.current
      if (video.currentTime < start || video.currentTime >= end) video.currentTime = start
      void video.play().catch(() => setPlaying(false))
    } else {
      video.pause()
    }
  }, [playing, meta, phase])

  // Et håndtak dras: stå stille og vis bildet ved håndtaket. Én spoling om
  // gangen — telefonen henger ikke med på én per fingerbevegelse.
  const pendingSeek = useRef<number | null>(null)
  const seekBusy = useRef(false)
  const onScrub = useCallback((t: number | null) => {
    const video = videoRef.current
    if (!video) return
    if (t === null) {
      scrubbing.current = false
      pendingSeek.current = null
      video.currentTime = trimRef.current.start
      if (playingRef.current) void video.play().catch(() => setPlaying(false))
      return
    }
    if (!scrubbing.current) {
      scrubbing.current = true
      video.pause()
    }
    pendingSeek.current = t
    if (seekBusy.current) return
    const run = async () => {
      seekBusy.current = true
      while (pendingSeek.current !== null && scrubbing.current) {
        const next = pendingSeek.current
        pendingSeek.current = null
        await seekVideo(video, next).catch(() => {})
      }
      seekBusy.current = false
    }
    void run()
  }, [])

  const getTime = useCallback(() => videoRef.current?.currentTime ?? 0, [])

  const changeSpeed = (next: Speed) => {
    setSpeed(next)
    if (meta) setTrim((t) => fitTrim(t, trackWindow(trackFrom, meta.duration), maxClipSeconds(next)))
  }

  const changeTrackFrom = (from: number) => {
    if (!meta) return
    const before = trackWindow(trackFrom, meta.duration)
    const after = trackWindow(from, meta.duration)
    setTrackFrom(after.from)
    const delta = after.from - before.from
    const next = fitTrim({ start: trim.start + delta, end: trim.end + delta }, after, maxLen)
    setTrim(next)
    const video = videoRef.current
    if (video) video.currentTime = next.start
  }

  // ---------- Steg 1 → 2: hent bildene ----------

  const capture = async () => {
    const video = videoRef.current
    if (!video || !meta || phase !== 'edit') return
    setCaptureError(null)
    setPhase('capturing')
    setProgress(0)
    video.pause()
    const crop = cropRect(view, meta.width, meta.height)
    const dims = outputSize(crop, CAPTURE_MAX_SIDE)
    const times = frameTimes(trim, speed)
    const ctrl = new AbortController()
    captureCtrl.current = ctrl
    try {
      const frames = await captureFrames({
        video,
        times,
        crop,
        width: dims.width,
        height: dims.height,
        signal: ctrl.signal,
        onFrame: (i) => setProgress((i + 1) / times.length),
      })
      setCaptured({ frames, crop })
      setEncoded({ status: 'working', progress: 0 })
      setShrunk(false)
      setPhase('result')
    } catch (err) {
      if (!isAbort(err)) setCaptureError('Kunne ikke hente bildene fra videoen. Prøv et kortere klipp, eller prøv igjen.')
      setPhase('edit')
    } finally {
      captureCtrl.current = null
    }
  }

  const backToEdit = () => {
    setPhase('edit')
    setSaveError(null)
    const video = videoRef.current
    if (video) video.currentTime = trim.start
  }

  // ---------- Steg 2: kod GIF-en ----------

  const order = useMemo(() => (captured ? frameOrder(captured.frames.length, loop) : []), [captured, loop])
  const dims = captured ? outputSize(captured.crop, GIF_SIZE_SIDE[size]) : { width: 0, height: 0 }

  useEffect(() => {
    if (phase !== 'result' || !captured) return
    const ctrl = new AbortController()
    const { width, height } = outputSize(captured.crop, GIF_SIZE_SIDE[size])
    setEncoded({ status: 'working', progress: 0 })
    const timer = window.setTimeout(async () => {
      try {
        const read = createFrameReader(width, height)
        let shown = 0
        const bytes = await encodeGif({
          count: captured.frames.length,
          width,
          height,
          getFrame: (i) => read(captured.frames[i]),
          order: frameOrder(captured.frames.length, loop),
          delayCs: FRAME_DELAY_CS,
          signal: ctrl.signal,
          onProgress: (p) => {
            if (p - shown >= 0.04 || p === 1) {
              shown = p
              setEncoded({ status: 'working', progress: p })
            }
          },
        })
        if (ctrl.signal.aborted) return
        if (bytes.byteLength > MAX_MESSAGE_MEDIA_BYTES) {
          const smaller = autoSize ? smallerSize(size) : null
          if (smaller) {
            setShrunk(true)
            setSize(smaller)
            return
          }
          setEncoded({ status: 'too-big', size: bytes.byteLength, width, height })
          return
        }
        setEncoded({ status: 'ready', bytes, width, height })
      } catch (err) {
        if (!isAbort(err)) setEncoded({ status: 'error' })
      }
    }, 200)
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [phase, captured, loop, size, autoSize])

  const titleError = bandMediaTitleRejection(title)
  const canSave = phase === 'result' && encoded.status === 'ready' && consent && !saving

  const save = async () => {
    if (encoded.status !== 'ready' || saving || !consent) return
    if (titleError) {
      setTitleTouched(true)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const gif = new File([encoded.bytes], 'tertnes.gif', { type: 'image/gif' })
      onAdded(await uploadBandMedia(gif, title, consent))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Kunne ikke legge til GIF-en')
      setSaving(false)
    }
  }

  const close = () => {
    captureCtrl.current?.abort()
    onClose()
  }

  // ---------- Visningen ----------

  const crop = meta ? cropRect(view, meta.width, meta.height) : null
  const editing = phase === 'edit' || phase === 'capturing'

  const footer =
    phase === 'result' ? (
      <>
        <Button type="button" variant="ghost" onClick={backToEdit} disabled={saving}>
          ← Juster
        </Button>
        <Button type="button" variant="primary" className="ml-auto" onClick={() => void save()} disabled={!canSave} loading={saving}>
          {saving ? 'Legger til …' : 'Legg til i Tertnes'}
        </Button>
      </>
    ) : phase === 'capturing' ? (
      <Button type="button" variant="ghost" className="ml-auto" onClick={() => captureCtrl.current?.abort()}>
        Avbryt
      </Button>
    ) : (
      <>
        <Button type="button" variant="ghost" onClick={close}>
          Avbryt
        </Button>
        <Button type="button" variant="primary" className="ml-auto" onClick={() => void capture()} disabled={!meta || loadError}>
          Neste
        </Button>
      </>
    )

  return (
    <Modal
      open
      onClose={close}
      kicker="Tertnes"
      title={phase === 'result' ? 'Slik blir GIF-en' : 'Lag GIF fra video'}
      wide
      mobileFull
      footer={footer}
    >
      {/* Videoen vises aldri selv; den tegnes på lerretet i CropStage. Den må
          likevel stå i dokumentet, ellers spiller ikke iOS den av. */}
      <div ref={topRef} aria-hidden />
      <video ref={videoRef} muted playsInline preload="auto" aria-hidden className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0" />

      {loadError && (
        <div role="alert" className="rounded-[10px] border border-line bg-paper-sunken px-4 py-6 text-center text-sm text-ink-soft">
          <p className="font-semibold text-ink">Nettleseren kan ikke spille av denne videoen.</p>
          <p className="mt-1">Prøv på telefonen der den ble tatt opp, eller velg en annen video.</p>
        </div>
      )}

      {!loadError && !meta && (
        <div className="flex h-56 items-center justify-center rounded-[10px] bg-paper-sunken text-sm text-ink-soft">
          <span className="spinner mr-2" aria-hidden /> Åpner videoen …
        </div>
      )}

      {meta && crop && editing && (
        <div className="space-y-4">
          {/* Bildet blir stående øverst mens man ruller ned til klipp, form og
              fart — man skal se hva et valg gjør. */}
          <div className="sticky -top-4 z-20 -mx-6 -mt-4 bg-paper-raised px-6 pt-4 pb-2 sm:-mx-7 sm:px-7">
            <CropStage
              videoRef={videoRef}
              videoWidth={meta.width}
              videoHeight={meta.height}
              view={view}
              onView={setView}
              disabled={phase === 'capturing'}
              overlay={phase === 'capturing' ? <CaptureOverlay progress={progress} /> : null}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                disabled={phase === 'capturing'}
                aria-label={playing ? 'Stopp avspillingen' : 'Spill av klippet'}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line-strong text-ink hover:border-brass hover:text-brass-strong disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11"
              >
                {playing ? <PauseGlyph /> : <Icon name="play" size={15} />}
              </button>
              <label className="flex min-w-0 flex-1 items-center gap-2 text-[0.8rem] text-ink-soft">
                <span className="shrink-0">Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={view.zoom}
                  disabled={phase === 'capturing'}
                  onChange={(e) => setView(zoomView(view, Number(e.target.value), 0.5, 0.5, meta.width, meta.height))}
                  className="h-9 min-w-0 flex-1 cursor-pointer accent-[var(--brass)] pointer-coarse:h-11"
                />
                <span className="w-9 shrink-0 text-right">{view.zoom.toFixed(1).replace('.', ',')}×</span>
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={phase === 'capturing' || (view.zoom === 1 && view.cx === 0.5 && view.cy === 0.5)}
                onClick={() => setView(withAspect(INITIAL_VIEW, view.aspect, meta.width, meta.height))}
              >
                Midtstill
              </Button>
            </div>
          </div>

          <FieldGroup label="Klipp" hint={`Dra i håndtakene. Høyst ${formatSeconds(maxLen).replace(',0', '')} ved ${SPEED_LABEL[speed]} fart.`}>
            {meta.duration > TRACK_SPAN_SECONDS && (
              <label className="mb-2 flex items-center gap-2 text-[0.78rem] text-ink-soft">
                <span className="shrink-0">Del av videoen</span>
                <input
                  type="range"
                  min={0}
                  max={meta.duration - TRACK_SPAN_SECONDS}
                  step={0.1}
                  value={track.from}
                  disabled={phase === 'capturing'}
                  onChange={(e) => changeTrackFrom(Number(e.target.value))}
                  aria-valuetext={`${formatClipTime(track.from)} til ${formatClipTime(track.to)}`}
                  className="h-8 min-w-0 flex-1 cursor-pointer accent-[var(--brass)] pointer-coarse:h-11"
                />
                <span className="shrink-0">
                  {formatClipTime(track.from).replace(/,\d$/, '')}–{formatClipTime(track.to).replace(/,\d$/, '')}
                </span>
              </label>
            )}
            {url && (
              <TrimBar
                url={url}
                videoAspect={meta.width / meta.height}
                track={track}
                trim={trim}
                maxLen={maxLen}
                onTrim={setTrim}
                onScrub={onScrub}
                getTime={getTime}
                disabled={phase === 'capturing'}
              />
            )}
          </FieldGroup>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <FieldGroup label="Form">
              <Segmented<CropAspect>
                label="Form"
                value={view.aspect}
                options={CROP_ASPECTS.map((a) => ({ value: a, label: CROP_ASPECT_LABEL[a] }))}
                onChange={(a) => setView(withAspect(view, a, meta.width, meta.height))}
                disabled={phase === 'capturing'}
                stretch
              />
            </FieldGroup>
            <FieldGroup label="Fart">
              <Segmented<Speed>
                label="Fart"
                value={speed}
                options={SPEEDS.map((s) => ({ value: s, label: SPEED_LABEL[s] }))}
                onChange={changeSpeed}
                disabled={phase === 'capturing'}
                stretch
              />
            </FieldGroup>
          </div>

          {captureError && (
            <p role="alert" className="text-[0.82rem] text-danger">
              {captureError}
            </p>
          )}
          <p className="text-[0.75rem] text-ink-faint">Videoen blir på enheten din. Bare den ferdige GIF-en lastes opp.</p>
        </div>
      )}

      {phase === 'result' && captured && (
        <div className="space-y-4">
          <div>
            <GifPreview
              frames={captured.frames}
              order={order}
              width={outputSize(captured.crop, CAPTURE_MAX_SIDE).width}
              height={outputSize(captured.crop, CAPTURE_MAX_SIDE).height}
              delayMs={FRAME_DELAY_CS * 10}
            />
            <p className="mt-1.5 text-center text-[0.78rem] text-ink-soft" aria-live="polite">
              {dims.width} × {dims.height} · {formatSeconds(gifSeconds(order.length))} ·{' '}
              {encoded.status === 'working'
                ? `regner ut størrelsen … ${Math.round(encoded.progress * 100)} %`
                : encoded.status === 'ready'
                  ? sizeLabel(encoded.bytes.byteLength)
                  : encoded.status === 'too-big'
                    ? sizeLabel(encoded.size)
                    : '–'}
            </p>
            {shrunk && encoded.status !== 'too-big' && (
              <p className="mt-1 text-center text-[0.75rem] text-ink-faint">Gjort mindre for å holde seg under 10 MB.</p>
            )}
            {encoded.status === 'too-big' && (
              <p role="alert" className="mt-1 text-center text-[0.8rem] text-danger">
                GIF-en blir større enn 10 MB. Velg en mindre størrelse, et kortere klipp, høyere fart eller «Vanlig» loop.
              </p>
            )}
            {encoded.status === 'error' && (
              <p role="alert" className="mt-1 text-center text-[0.8rem] text-danger">
                Kunne ikke lage GIF-en. Prøv et kortere klipp eller en mindre størrelse.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup label="Loop">
              <Segmented<LoopMode>
                label="Loop"
                value={loop}
                options={LOOP_MODES.map((m) => ({ value: m, label: LOOP_MODE_LABEL[m] }))}
                onChange={setLoop}
                disabled={saving}
                stretch
              />
            </FieldGroup>
            <FieldGroup label="Størrelse">
              <Segmented<GifSize>
                label="Størrelse"
                value={size}
                options={GIF_SIZES.map((s) => ({ value: s, label: GIF_SIZE_LABEL[s] }))}
                onChange={(s) => {
                  setAutoSize(false)
                  setShrunk(false)
                  setSize(s)
                }}
                disabled={saving}
                stretch
              />
            </FieldGroup>
          </div>

          <div>
            <label className="block text-[0.8rem] font-medium text-ink-soft" htmlFor="gif-maker-title">
              Navn
            </label>
            <input
              id="gif-maker-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTitleTouched(true)}
              maxLength={MAX_BAND_MEDIA_TITLE}
              placeholder="For eksempel «Galleri 69»"
              autoComplete="off"
              enterKeyHint="done"
              aria-invalid={titleTouched && !!titleError}
              className="field-input mt-1.5 w-full"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void save()
                }
              }}
            />
            {titleTouched && titleError ? (
              <p role="alert" className="mt-1 text-[0.75rem] text-danger">
                {titleError}
              </p>
            ) : (
              <p className="mt-1 text-[0.75rem] text-ink-faint">Det man søker på, og det skjermlesere leser opp.</p>
            )}
          </div>

          <BandMediaConsent checked={consent} onChange={setConsent} disabled={saving} />
          {saveError && (
            <p role="alert" className="text-[0.82rem] text-danger">
              {saveError}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

function CaptureOverlay({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100)
  return (
    <div className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-white" aria-live="polite">
      <div className="flex items-center justify-between text-[0.78rem]">
        <span>Henter bildene …</span>
        <span className="tabular-nums">{pct} %</span>
      </div>
      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/25"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Henter bildene"
      >
        <div className="h-full bg-[var(--brass)] transition-[width] duration-150" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
