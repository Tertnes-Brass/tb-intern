/**
 * Tema: lyst, mørkt eller «følg telefonen». Valget lagres i `localStorage`
 * (`theme`), og ingen verdi betyr «følg telefonen» — samme regel som
 * temainit-skriptet i `src/routes/__root.tsx`, som kjører før første maling.
 *
 * `theme-color` oppdateres sammen med klassene, slik at statuslinjen i en
 * installert app (og adresselinjen i Safari) har samme farge som papiret.
 */
export type ThemeMode = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/** Samme verdier som `--paper` i src/styles.css. */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#f7f1e6',
  dark: '#171310',
}

const STORAGE_KEY = 'theme'

export function readThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'auto') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.setAttribute('data-theme', resolved)
  root.style.colorScheme = resolved
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = THEME_COLORS[resolved]
  }
}

export function setThemeMode(mode: ThemeMode): ResolvedTheme {
  try {
    if (mode === 'auto') window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {}
  const resolved = resolveTheme(mode)
  applyTheme(resolved)
  return resolved
}

/**
 * Følger telefonens innstilling mens valget er «auto». Returnerer en funksjon
 * som stopper lyttingen.
 */
export function followSystemTheme(): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (readThemeMode() === 'auto') applyTheme(query.matches ? 'dark' : 'light')
  }
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
