import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Skrivefeltet som ligger fast nederst — kommentarfeltet på et innlegg og
 * svarfeltet i en forumtråd (`.comment-dock` i styles.css).
 *
 * På berøringsskjerm (`appnav`) er det `position: fixed` mot SKJERMEN, ikke
 * klistret (`sticky`) i siden: en sticky linje følger sin egen beholder, og
 * havnet derfor bak fanelinjen øverst på siden og et stykke over den når man
 * hadde rullet ned. Nå står det alltid rett over fanelinjen — i en
 * nettleserfane og i den installerte appen, der det er `.app-shell` som ruller.
 *
 * - Mens et tekstfelt har fokus er fanelinjen skjult; da står feltet nederst,
 *   over tastaturet. Tastaturets høyde måles med `visualViewport` (iOS legger
 *   tastaturet OVER siden i stedet for å krympe den) og settes som
 *   `--dock-kb` på feltet.
 * - Høyden settes som `--comment-dock-h` på `<html>`. Et tomrom med samme
 *   høyde står der feltet ville stått, så den siste kommentaren aldri blir
 *   liggende bak feltet, og toastene legger seg over det.
 * - Med mus fra 1024 px (`desknav`) står feltet bare under tråden, som før.
 */
export function Dock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    let frame = 0
    const measure = () => {
      const vv = window.visualViewport
      const covered = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0
      // Under ~80 px er det verktøylinjer og avrunding, ikke et tastatur.
      const keyboard = covered > 80
      el.style.setProperty('--dock-kb', `${keyboard ? covered : 0}px`)
      el.dataset.keyboard = keyboard ? 'open' : 'closed'
      root.style.setProperty('--comment-dock-h', `${Math.ceil(el.getBoundingClientRect().height)}px`)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    resize?.observe(el)
    const vv = window.visualViewport
    vv?.addEventListener('resize', schedule)
    vv?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    // Fokus skjuler fanelinjen og åpner tastaturet — mål på nytt når det har skjedd.
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    return () => {
      cancelAnimationFrame(frame)
      resize?.disconnect()
      vv?.removeEventListener('resize', schedule)
      vv?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      root.style.removeProperty('--comment-dock-h')
    }
  }, [])

  return (
    <>
      <div className="comment-dock-spacer" aria-hidden />
      <div ref={ref} className="comment-dock" data-keyboard="closed">
        <div className="comment-dock-inner">{children}</div>
      </div>
    </>
  )
}
