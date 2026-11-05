import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, type ReactNode } from 'react'

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

  // Aktiv pille inn i bildet. Ikke `scrollIntoView`: den ruller også siden
  // (eller `.app-shell` i iOS-appen) loddrett.
  useEffect(() => {
    const nav = ref.current
    const active = nav?.querySelector<HTMLElement>('[data-status="active"]')
    if (!nav || !active) return
    const left = active.offsetLeft - nav.offsetLeft
    const right = left + active.offsetWidth
    const pad = 24
    if (left - pad < nav.scrollLeft) nav.scrollLeft = Math.max(0, left - pad)
    else if (right + pad > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right + pad - nav.clientWidth
  }, [pathname])

  useEffect(() => {
    const nav = ref.current
    if (!nav) return
    const update = () => {
      const max = nav.scrollWidth - nav.clientWidth
      const start = nav.scrollLeft > 2
      const end = nav.scrollLeft < max - 2
      const value = start && end ? 'both' : start ? 'start' : end ? 'end' : null
      if (value) nav.dataset.overflow = value
      else delete nav.dataset.overflow
    }
    update()
    nav.addEventListener('scroll', update, { passive: true })
    // Raden selv (rotasjon, vindu) og hver pille (ulest-merket på Chat kommer og går).
    const ro = new ResizeObserver(update)
    ro.observe(nav)
    for (const child of Array.from(nav.children)) ro.observe(child)
    return () => {
      nav.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  return (
    <div className="area-nav-wrap print-hidden">
      <nav ref={ref} className="area-nav" aria-label={label}>
        {children}
      </nav>
    </div>
  )
}
