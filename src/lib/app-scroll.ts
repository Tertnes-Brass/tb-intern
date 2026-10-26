/**
 * Hva som ruller siden. I en installert app på iOS ruller skallet (`.app-shell`
 * i `Shell.tsx`, se `html.ios-app` i styles.css) og ikke vinduet — ellers
 * ruller innholdet opp bak klokka, der iOS 26 viser det uskarpt. Overalt ellers
 * er det vinduet. Bruk disse i stedet for `window.scrollY`/`window.scrollTo`.
 */

/** Skallet. Ruteren bruker samme selektor for å nullstille og gjenopprette rullingen. */
export const APP_SCROLLER_SELECTOR = '[data-scroll-restoration-id="app"]'

function appScroller(): HTMLElement | null {
  if (!document.documentElement.classList.contains('ios-app')) return null
  return document.querySelector<HTMLElement>(APP_SCROLLER_SELECTOR)
}

export function appScrollTop(): number {
  return appScroller()?.scrollTop ?? window.scrollY
}

export function scrollAppToTop() {
  const options: ScrollToOptions = { top: 0, behavior: 'smooth' }
  const scroller = appScroller()
  if (scroller) scroller.scrollTo(options)
  else window.scrollTo(options)
}
