import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

/**
 * En vannrett rullende rad med valg (områdemenyen, veggens filtre): det aktive
 * valget (`activeSelector`) rulles inn i bildet hver gang `key` endres, og
 * `data-overflow` (`start`/`end`/`both`) settes på raden så CSS kan tone ut
 * kanten man kan rulle mot. Ikke `scrollIntoView`: den ruller også siden (eller
 * `.app-shell` i iOS-appen) loddrett.
 */
export function useScrollRow(
  ref: RefObject<HTMLElement | null>,
  key: unknown,
  activeSelector = '[data-status="active"]',
) {
  useEffect(() => {
    const row = ref.current
    const active = row?.querySelector<HTMLElement>(activeSelector)
    if (!row || !active) return
    const left = active.offsetLeft - row.offsetLeft
    const right = left + active.offsetWidth
    const pad = 24
    if (left - pad < row.scrollLeft) row.scrollLeft = Math.max(0, left - pad)
    else if (right + pad > row.scrollLeft + row.clientWidth) row.scrollLeft = right + pad - row.clientWidth
  }, [ref, key, activeSelector])

  useEffect(() => {
    const row = ref.current
    if (!row) return
    const update = () => {
      const max = row.scrollWidth - row.clientWidth
      const start = row.scrollLeft > 2
      const end = row.scrollLeft < max - 2
      const value = start && end ? 'both' : start ? 'start' : end ? 'end' : null
      if (value) row.dataset.overflow = value
      else delete row.dataset.overflow
    }
    update()
    row.addEventListener('scroll', update, { passive: true })
    // Raden selv (rotasjon, vindu) og hvert valg (tellere kommer og går).
    const ro = new ResizeObserver(update)
    ro.observe(row)
    for (const child of Array.from(row.children)) ro.observe(child)
    return () => {
      row.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [ref])
}

/**
 * Områdemenyen (Noter, Styre, Gruppeledere — designprinsipper §6 (a)). Selve
 * lenkene er `<Link className="area-link">` hos kalleren; denne eier raden:
 *
 * - Pillen for siden man står på rulles inn i bildet ved hver navigasjon, så
 *   «Dokumenter» i Styre ikke står skjult utenfor kanten mens man er der.
 * - Når raden er bredere enn skjermen, settes `data-overflow` til `start`,
 *   `end` eller `both`, og styles.css toner ut den kanten man kan rulle mot.
 *   En klippet pille alene var et for svakt hint på en iPhone.
 */
export function AreaNav({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useScrollRow(ref, pathname)

  return (
    <div className="area-nav-wrap print-hidden">
      <nav ref={ref} className="area-nav" aria-label={label}>
        {children}
      </nav>
    </div>
  )
}
