import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAX_STAGE_ELEMENTS,
  STAGE_ELEMENT_BUTTON_LABELS,
  STAGE_ELEMENT_TYPES,
  STAGE_HEIGHT,
  STAGE_LABEL_MAX,
  STAGE_ROTATION_STEP,
  STAGE_SVG_TOKENS,
  STAGE_WIDTH,
  type StageElement,
  type StageElementType,
  type StageSvgTokens,
  addStageElement,
  clampToStage,
  countStageElements,
  labelStageElement,
  moveStageElement,
  removeStageElement,
  rotateStageElement,
  stageElementSize,
  stagePlotFileName,
  standaloneStageSvg,
  usesLabel,
} from '../lib/scene'
import { toastError } from './toast'
import { Button, Field } from './ui'

/**
 * Tegneflaten for sceneoppsettet (#11) — bygget selv i SVG med pointer events.
 *
 * **Ingen ny avhengighet.** Et lerret-bibliotek ville dratt inn drag-lag,
 * transformasjonsmatriser og en egen hendelsesmodell for noe som her er tre
 * ting: gjør om skjermkoordinater til scenekoordinater, sett x/y, tegn på nytt.
 * Formatet (`{ type, x, y, rotation, label }`) er uansett vårt eget, og reglene
 * ligger i `src/lib/scene.ts` med tester.
 *
 * **Pointer events, ikke mouse/touch.** Én kodevei for mus, finger og penn;
 * `setPointerCapture` gjør at et drag ikke mistes når fingeren går utenfor
 * elementet — som den alltid gjør på en telefon.
 *
 * **Fargene er design-tokens.** SVG-en bruker `var(--ink)` og venner og arver
 * verdiene fra sida, så tegningen følger lyst/mørkt tema og utskrifts-CSS-en
 * uten en eneste egen farge. Ved nedlasting leses de samme tokenene ut av
 * `:root` og skrives inn i fila (`standaloneStageSvg`), slik at den frittstående
 * SVG-en ser lik ut uten å hardkode noe her.
 */

// ---------- Selve tegningen ----------

/** Ett element, tegnet rundt sitt eget midtpunkt slik at rotasjon blir riktig. */
function ElementShape({ type }: { type: StageElementType }) {
  switch (type) {
    case 'chair':
      return (
        <>
          <rect
            x={-18}
            y={-12}
            width={36}
            height={28}
            rx={5}
            fill="var(--paper-raised)"
            stroke="var(--ink-soft)"
            strokeWidth={2}
          />
          {/* Ryggen peker bort fra publikum — retningen er hele poenget med rotasjon. */}
          <rect x={-18} y={-20} width={36} height={7} rx={3} fill="var(--ink-soft)" />
        </>
      )
    case 'stand':
      return (
        <>
          <path
            d="M -17 -16 L 17 -16 L 13 -4 L -13 -4 Z"
            fill="var(--paper-raised)"
            stroke="var(--ink-soft)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path d="M 0 -4 L 0 14" stroke="var(--ink-soft)" strokeWidth={2} strokeLinecap="round" />
          <path d="M -9 16 L 9 16" stroke="var(--ink-soft)" strokeWidth={2} strokeLinecap="round" />
        </>
      )
    case 'podium':
      return (
        <>
          <rect
            x={-52}
            y={-38}
            width={104}
            height={76}
            rx={6}
            fill="var(--brass-soft)"
            stroke="var(--brass)"
            strokeWidth={2.5}
          />
          <rect x={-38} y={-24} width={76} height={48} rx={4} fill="none" stroke="var(--brass)" strokeWidth={1.5} />
        </>
      )
    case 'percussion':
      return (
        <>
          <circle r={36} fill="var(--paper-raised)" stroke="var(--ink)" strokeWidth={2.5} />
          <circle r={26} fill="none" stroke="var(--ink-faint)" strokeWidth={1.5} />
        </>
      )
    case 'other':
      return (
        <rect
          x={-45}
          y={-28}
          width={90}
          height={56}
          rx={5}
          fill="var(--paper-sunken)"
          stroke="var(--ink-faint)"
          strokeWidth={2}
          strokeDasharray="7 5"
        />
      )
  }
}

export function StageCanvas({
  elements,
  selectedId,
  onSelect,
  onMove,
  svgRef,
  readOnly,
}: {
  elements: StageElement[]
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  onMove?: (id: string, x: number, y: number) => void
  svgRef?: React.RefObject<SVGSVGElement | null>
  readOnly?: boolean
}) {
  const localRef = useRef<SVGSVGElement | null>(null)
  const ref = svgRef ?? localRef
  // Avstanden fra elementets midtpunkt til der fingeren traff. Uten den ville
  // elementet hoppet slik at midtpunktet havnet under fingeren ved første piksel.
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)

  /** Skjermkoordinat → scenekoordinat. `getScreenCTM` tar høyde for at SVG-en er skalert til bredden. */
  const toStage = useCallback(
    (clientX: number, clientY: number) => {
      const svg = ref.current
      if (!svg) return null
      const ctm = svg.getScreenCTM()
      if (!ctm) return null
      const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
      return { x: point.x, y: point.y }
    },
    [ref],
  )

  const onPointerDown = (event: React.PointerEvent, element: StageElement) => {
    if (readOnly || !onMove) return
    event.stopPropagation()
    onSelect?.(element.id)
    const point = toStage(event.clientX, event.clientY)
    if (!point) return
    drag.current = { id: element.id, dx: element.x - point.x, dy: element.y - point.y }
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const state = drag.current
    if (!state || !onMove) return
    const point = toStage(event.clientX, event.clientY)
    if (!point) return
    const next = clampToStage(point.x + state.dx, point.y + state.dy)
    onMove(state.id, next.x, next.y)
  }

  const endDrag = (event: React.PointerEvent) => {
    if (!drag.current) return
    ;(event.target as Element).releasePointerCapture?.(event.pointerId)
    drag.current = null
  }

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
      role="img"
      aria-label="Sceneoppsett"
      className="block w-full touch-none select-none rounded-xl border border-line bg-paper"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={() => onSelect?.(null)}
    >
      {/* Rutenettet er en hjelpelinje for øyet — det følger med i nedlastingen
          og på papir, fordi det er der man faktisk måler opp scenen. */}
      <defs>
        <pattern id="stage-grid" width={50} height={50} patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="var(--line)" strokeWidth={1} />
        </pattern>
      </defs>
      <rect width={STAGE_WIDTH} height={STAGE_HEIGHT} fill="var(--paper)" />
      <rect width={STAGE_WIDTH} height={STAGE_HEIGHT} fill="url(#stage-grid)" opacity={0.55} />
      <rect
        x={1}
        y={1}
        width={STAGE_WIDTH - 2}
        height={STAGE_HEIGHT - 2}
        fill="none"
        stroke="var(--line-strong)"
        strokeWidth={2}
      />
      {/* Uten en retning er en scenetegning tvetydig: to personer leser den
          motsatt vei og setter slagverket i hver sin ende. */}
      <text
        x={STAGE_WIDTH / 2}
        y={STAGE_HEIGHT - 18}
        textAnchor="middle"
        fill="var(--ink-faint)"
        fontFamily="var(--font-mono), monospace"
        fontSize={20}
        letterSpacing={4}
      >
        PUBLIKUM
      </text>

      {elements.map((element) => {
        const selected = element.id === selectedId
        const size = stageElementSize(element.type)
        return (
          <g key={element.id}>
            <g
              transform={`translate(${element.x} ${element.y}) rotate(${element.rotation})`}
              onPointerDown={(event) => onPointerDown(event, element)}
              style={{ cursor: readOnly ? 'default' : 'grab' }}
            >
              <ElementShape type={element.type} />
              {/* Usynlig treffområde: en tynn strek er vanskelig å treffe med en tommel. */}
              <rect
                x={-size.w / 2 - 6}
                y={-size.h / 2 - 6}
                width={size.w + 12}
                height={size.h + 12}
                fill="transparent"
              />
            </g>

            {/* Etiketten roterer IKKE med elementet — en tekst som står på hodet
                er ulesbar, og retningen sier shapen allerede. */}
            {element.label && (
              <text
                x={element.x}
                y={element.y + stageElementSize(element.type).h / 2 + 20}
                textAnchor="middle"
                fill="var(--ink-soft)"
                fontFamily="var(--font-sans), sans-serif"
                fontSize={18}
                pointerEvents="none"
              >
                {element.label}
              </text>
            )}

            {selected && (
              <rect
                data-editor-only
                x={element.x - size.w / 2 - 10}
                y={element.y - size.h / 2 - 10}
                width={size.w + 20}
                height={size.h + 20}
                rx={8}
                fill="none"
                stroke="var(--brass)"
                strokeWidth={2.5}
                strokeDasharray="8 5"
                pointerEvents="none"
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ---------- Nedlasting ----------

/** Leser design-tokenene ut av `:root` slik de er akkurat nå (lyst/mørkt tema). */
function readTokens(): StageSvgTokens {
  const style = getComputedStyle(document.documentElement)
  const tokens: StageSvgTokens = {}
  for (const name of STAGE_SVG_TOKENS) {
    const value = style.getPropertyValue(name).trim()
    if (value) tokens[name] = value
  }
  return tokens
}

/**
 * «Last ned SVG». Ingen serverjobb: SVG-en står allerede på skjermen, og en
 * klone uten redigeringskromet ER fila. Det dekker issue-kravet om en delbar
 * fil — en SVG åpner seg i enhver nettleser og kan legges rett inn i et
 * dokument.
 */
function downloadSvg(svg: SVGSVGElement | null, projectName: string) {
  if (!svg) return
  const clone = svg.cloneNode(true) as SVGSVGElement
  for (const node of clone.querySelectorAll('[data-editor-only]')) node.remove()
  const markup = new XMLSerializer().serializeToString(clone)
  const file = standaloneStageSvg(markup, readTokens())

  const url = URL.createObjectURL(new Blob([file], { type: 'image/svg+xml;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = stagePlotFileName(projectName)
  link.click()
  URL.revokeObjectURL(url)
}

// ---------- Redigering ----------

let nextLocalId = 0

export function StagePlotEditor({
  projectName,
  initialElements,
  initialNote,
  canManage,
  onSave,
}: {
  projectName: string
  initialElements: StageElement[]
  initialNote: string | null
  canManage: boolean
  onSave: (elements: StageElement[], note: string | null) => Promise<void>
}) {
  const [elements, setElements] = useState<StageElement[]>(initialElements)
  const [note, setNote] = useState(initialNote ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const selected = elements.find((el) => el.id === selectedId) ?? null

  const change = useCallback((next: StageElement[]) => {
    setElements(next)
    setDirty(true)
  }, [])

  const add = (type: StageElementType) => {
    try {
      // Nye elementer legges midt på scenen med en liten forskyvning, slik at
      // ti klikk på «Stol» ikke blir én stol med ni usynlige under seg.
      const offset = (elements.length % 8) * 26
      change(
        addStageElement(elements, {
          id: `el-${Date.now().toString(36)}-${nextLocalId++}`,
          type,
          x: STAGE_WIDTH / 2 - 90 + offset,
          y: STAGE_HEIGHT / 2 + offset / 2,
          rotation: 0,
          label: null,
        }),
      )
    } catch (err) {
      toastError(err)
    }
  }

  // Tastatur: pilene flytter, Delete fjerner. En tegneflate som bare kan brukes
  // med mus er en tegneflate halve korpset ikke kan rette opp en skrivefeil i.
  useEffect(() => {
    if (!canManage || !selected) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const step = event.shiftKey ? 1 : 10
      if (event.key === 'ArrowLeft') change(moveStageElement(elements, selected.id, selected.x - step, selected.y))
      else if (event.key === 'ArrowRight') change(moveStageElement(elements, selected.id, selected.x + step, selected.y))
      else if (event.key === 'ArrowUp') change(moveStageElement(elements, selected.id, selected.x, selected.y - step))
      else if (event.key === 'ArrowDown') change(moveStageElement(elements, selected.id, selected.x, selected.y + step))
      else if (event.key === 'Delete' || event.key === 'Backspace') {
        change(removeStageElement(elements, selected.id))
        setSelectedId(null)
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canManage, selected, elements, change])

  const save = async () => {
    setSaving(true)
    try {
      await onSave(elements, note.trim() || null)
      setDirty(false)
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  const counts = countStageElements(elements)

  return (
    <div className="space-y-5">
      {/* Opptellingen står OVER tegningen: det er den som besvarer «hvor mange
          stoler trenger vi», som er første kulepunkt i saken. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {counts.length === 0 ? (
          <p className="text-sm text-ink-faint">Scenen er tom.</p>
        ) : (
          counts.map((count) => (
            <span key={count.type} className="text-sm text-ink-soft">
              <strong className="display-title text-[1.05rem] font-semibold text-ink">{count.count}</strong>{' '}
              {count.label.replace(`${count.count} `, '')}
              {count.labels.length > 0 && (
                <span className="text-ink-faint"> ({count.labels.join(', ')})</span>
              )}
            </span>
          ))
        )}
      </div>

      {canManage && (
        <div className="print-hidden flex flex-wrap gap-2">
          {STAGE_ELEMENT_TYPES.map((type) => (
            <Button key={type} size="sm" variant="secondary" onClick={() => add(type)}>
              + {STAGE_ELEMENT_BUTTON_LABELS[type]}
            </Button>
          ))}
          <span className="self-center font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ink-faint">
            {elements.length}/{MAX_STAGE_ELEMENTS}
          </span>
        </div>
      )}

      <StageCanvas
        elements={elements}
        selectedId={selectedId}
        onSelect={canManage ? setSelectedId : undefined}
        onMove={canManage ? (id, x, y) => change(moveStageElement(elements, id, x, y)) : undefined}
        svgRef={svgRef}
        readOnly={!canManage}
      />

      {canManage && selected && (
        <div className="print-hidden sheet flex flex-wrap items-end gap-3 px-4 py-3">
          <span className="font-mono text-[0.64rem] uppercase tracking-[0.1em] text-ink-faint">
            {STAGE_ELEMENT_BUTTON_LABELS[selected.type]} valgt
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => change(rotateStageElement(elements, selected.id, -STAGE_ROTATION_STEP))}>
              ↺ 45°
            </Button>
            <Button size="sm" onClick={() => change(rotateStageElement(elements, selected.id, STAGE_ROTATION_STEP))}>
              ↻ 45°
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                change(removeStageElement(elements, selected.id))
                setSelectedId(null)
              }}
            >
              Slett
            </Button>
          </div>
          {usesLabel(selected.type) && (
            <Field label="Etikett" className="min-w-[12rem] flex-1">
              <input
                className="field-input"
                value={selected.label ?? ''}
                maxLength={STAGE_LABEL_MAX}
                placeholder={selected.type === 'percussion' ? 'Pauker' : 'Hva står her?'}
                onChange={(e) => change(labelStageElement(elements, selected.id, e.target.value))}
              />
            </Field>
          )}
        </div>
      )}

      {canManage && (
        <Field label="Merknad" hint="Det tegningen ikke kan si — «lån fire stativ av Fana», «podiet står bakerst»">
          <textarea
            className="field-input print-hidden min-h-[4.5rem]"
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              setDirty(true)
            }}
          />
        </Field>
      )}
      {!canManage && note && <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{note}</p>}

      <div className="print-hidden flex flex-wrap gap-2">
        {canManage && (
          <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
            {dirty ? 'Lagre oppsettet' : 'Lagret'}
          </Button>
        )}
        <Button variant="secondary" onClick={() => downloadSvg(svgRef.current, projectName)}>
          Last ned SVG
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          Skriv ut
        </Button>
      </div>

      {canManage && (
        <p className="print-hidden text-xs leading-relaxed text-ink-faint">
          Dra elementene dit de skal stå. Klikk for å velge — da kan du rotere, slette eller gi det en etikett,
          og pilknappene flytter ett hakk (hold Shift for finjustering).
        </p>
      )}
    </div>
  )
}
