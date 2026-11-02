import { useMemo } from 'react'
import { STAGE_COMPONENTS, STAGE_GROUPS, buildStageComponent } from '../../lib/stage-components'
import { type ElementContext, type SceneElement, bounds } from '../../lib/stage-elements'

/** Dra-og-slipp-typen fra paletten til tegneflaten. */
export const STAGE_DRAG_TYPE = 'application/x-tb-stage-component'

function glyphContext(): ElementContext {
  let n = 0
  return { id: () => `g${++n}`, int: () => 1, now: 0 }
}

/**
 * En liten tegning av komponenten, laget fra de samme elementene som settes
 * inn — så ikonet aldri kan bli ulikt det man får. Bare former; teksten ville
 * vært uleselig i denne størrelsen. Strekene følger tekstfargen (og temaet).
 */
export function StageGlyph({ elements, size = 44 }: { elements: SceneElement[]; size?: number }) {
  const box = bounds(elements)
  const pad = Math.max(box.width, box.height) * 0.08 + 2
  const viewBox = `${box.minX - pad} ${box.minY - pad} ${box.width + pad * 2} ${box.height + pad * 2}`
  return (
    <svg width={size} height={size} viewBox={viewBox} aria-hidden className="shrink-0">
      {elements.map((el) => {
        const fill = el.backgroundColor && el.backgroundColor !== 'transparent' ? (el.backgroundColor as string) : 'none'
        const common = {
          fill,
          stroke: 'currentColor',
          strokeWidth: (el.strokeWidth as number) >= 3 ? 2.4 : 1.2,
          vectorEffect: 'non-scaling-stroke' as const,
          strokeDasharray: el.strokeStyle === 'dashed' ? '3 2' : undefined,
          opacity: typeof el.opacity === 'number' ? el.opacity / 100 : 1,
        }
        if (el.type === 'rectangle') {
          const r = el.roundness ? Math.min(el.width, el.height) * 0.2 : 0
          return <rect key={el.id} x={el.x} y={el.y} width={el.width} height={el.height} rx={r} {...common} />
        }
        if (el.type === 'ellipse') {
          return (
            <ellipse
              key={el.id}
              cx={el.x + el.width / 2}
              cy={el.y + el.height / 2}
              rx={el.width / 2}
              ry={el.height / 2}
              {...common}
            />
          )
        }
        if ((el.type === 'line' || el.type === 'arrow') && Array.isArray(el.points)) {
          const points = (el.points as Array<[number, number]>).map(([x, y]) => `${el.x + x},${el.y + y}`).join(' ')
          return <polyline key={el.id} points={points} {...common} fill="none" strokeLinecap="round" />
        }
        return null
      })}
    </svg>
  )
}

/**
 * Komponentene, gruppert som i et instrumentlager: musikere, slagverk, scene.
 * Trykk setter komponenten inn midt i det man ser på; på en datamaskin kan
 * den også dras dit den skal stå.
 */
export function StagePalette({ onInsert }: { onInsert: (id: string) => void }) {
  const glyphs = useMemo(
    () => new Map(STAGE_COMPONENTS.map((c) => [c.id, buildStageComponent(c.id, { x: 0, y: 0 }, glyphContext())])),
    [],
  )
  return (
    <div className="space-y-5">
      {STAGE_GROUPS.map((group) => (
        <section key={group.id}>
          <h3 className="kicker mb-2">{group.label}</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {STAGE_COMPONENTS.filter((c) => c.group === group.id).map((c) => (
              <button
                key={c.id}
                type="button"
                draggable
                title={c.hint ? `${c.label} — ${c.hint}` : c.label}
                onDragStart={(e) => {
                  e.dataTransfer.setData(STAGE_DRAG_TYPE, c.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onInsert(c.id)}
                className="flex min-h-14 cursor-pointer items-center gap-2 rounded-lg border border-line bg-paper-raised px-2 py-1.5 text-left text-[0.78rem] leading-tight text-ink transition-colors hover:border-brass hover:text-brass-strong active:translate-y-px"
              >
                <span className="text-ink-soft">
                  <StageGlyph elements={glyphs.get(c.id)!} size={32} />
                </span>
                <span className="min-w-0 break-words [hyphens:auto]">{c.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
