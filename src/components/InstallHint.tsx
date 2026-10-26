import { useEffect, useState } from 'react'
import { getInstallPrompt, isIos, isStandalone, onInstallPromptChange, promptInstall } from '../lib/pwa'
import { Button } from './ui'

const DISMISS_KEY = 'tb-install-hint-dismissed'
/** «Ikke nå» gjelder en måned; deretter spør vi én gang til. */
const DISMISS_DAYS = 30

function dismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0)
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

type Mode = 'hidden' | 'ios' | 'prompt'

/**
 * Kortet som foreslår å legge Intern på Hjem-skjermen. Vises bare på telefon,
 * bare når appen ikke allerede er installert, og aldri igjen på en måned etter
 * «Ikke nå».
 *
 * iOS har ingen installasjonsknapp en nettside kan trykke på, så der forklarer
 * kortet veien via Del-menyen. Android/Chrome gir en ekte forespørsel
 * (`beforeinstallprompt`), som `src/lib/pwa.ts` har fanget opp.
 */
export function InstallHint() {
  const [mode, setMode] = useState<Mode>('hidden')

  useEffect(() => {
    const decide = () => {
      const phone = window.matchMedia('(max-width: 767px) and (pointer: coarse)').matches
      if (!phone || isStandalone() || dismissedRecently()) return setMode('hidden')
      if (getInstallPrompt()) return setMode('prompt')
      setMode(isIos() ? 'ios' : 'hidden')
    }
    decide()
    return onInstallPromptChange(decide)
  }, [])

  if (mode === 'hidden') return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {}
    setMode('hidden')
  }

  return (
    <aside className="sheet fadein flex gap-4 px-4 py-4" aria-label="Installer appen">
      <img src="/icons/icon-192.png" alt="" width={52} height={52} className="h-13 w-13 shrink-0 rounded-[12px] border border-line" />
      <div className="min-w-0">
        <p className="display-title text-[1.05rem] font-semibold text-ink">Legg Intern på Hjem-skjermen</p>
        {mode === 'ios' ? (
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Da åpner den i fullskjerm som en vanlig app. Trykk <ShareGlyph /> <b className="font-semibold text-ink">Del</b>{' '}
            nederst i Safari, og velg «Legg til på Hjem-skjerm».
          </p>
        ) : (
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Da åpner den i fullskjerm som en vanlig app, rett fra hjemskjermen.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {mode === 'prompt' && (
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                if (await promptInstall()) setMode('hidden')
              }}
            >
              Installer
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Ikke nå
          </Button>
        </div>
      </div>
    </aside>
  )
}

/** Safaris Del-ikon, så beskrivelsen peker på det man faktisk ser. */
function ShareGlyph() {
  return (
    <svg
      width="14"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="-mt-1 inline text-brass-strong"
    >
      <path d="M12 3.5v12M8 7.5l4-4 4 4" />
      <path d="M7.5 11H6a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V12a1 1 0 0 0-1-1h-1.5" />
    </svg>
  )
}
