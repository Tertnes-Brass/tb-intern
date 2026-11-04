import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icons'
import { BottomSheet } from './ui'

export type ActionMenuItem = {
  label: string
  /** Én kort linje under etiketten — hva handlingen gjør. */
  hint?: string
  icon?: IconName
  onSelect: () => void
  /** Ødeleggende handlinger (Slett) står nederst, skilt fra resten, i rødt. */
  tone?: 'danger'
  disabled?: boolean
}

/**
 * «Administrer»-menyen: vedlikehold av en ressurs (rediger, publiser, slett …)
 * samlet bak ÉN knapp, så skjermen kan vise det den er til for. Med mus er det
 * en liten meny under knappen; på berøringsskjerm (`appnav`) et bunnark innen
 * tommelens rekkevidde. Ødeleggende handlinger legges alltid nederst, etter en
 * skillelinje — de skal aldri stå først eller ved siden av primærhandlingen.
 */
export function ActionMenu({
  label = 'Administrer',
  title,
  items,
  className = '',
  buttonClassName,
  iconOnly,
}: {
  label?: string
  /** Overskriften i arket på telefon (f.eks. prosjektnavnet). */
  title?: ReactNode
  items: ActionMenuItem[]
  className?: string
  buttonClassName?: string
  /** Bare «⋯» (med `label` som tilgjengelig navn) — for menyer per rad i en liste. */
  iconOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || sheet) return
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, sheet])

  const toggle = () => {
    // Avgjøres ved trykket, ikke ved første tegning: SSR vet ikke hva slags skjerm det er.
    setSheet(window.matchMedia('(max-width: 1023.98px), (pointer: coarse)').matches)
    setOpen((v) => !v)
  }

  const regular = items.filter((i) => i.tone !== 'danger')
  const danger = items.filter((i) => i.tone === 'danger')
  const pick = (item: ActionMenuItem) => {
    setOpen(false)
    // La arket/menyen lukkes før en dialog åpnes oppå.
    window.setTimeout(item.onSelect, sheet ? 180 : 0)
  }

  const list = (
    <div role="menu" className={sheet ? 'action-sheet-list' : 'action-pop-list'}>
      {regular.map((item) => (
        <MenuRow key={item.label} item={item} onPick={pick} />
      ))}
      {danger.length > 0 && regular.length > 0 && <div className="action-menu-sep" role="separator" />}
      {danger.map((item) => (
        <MenuRow key={item.label} item={item} onPick={pick} />
      ))}
    </div>
  )

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={iconOnly ? label : undefined}
        className={
          buttonClassName ??
          (iconOnly
            ? 'grid h-9 w-9 cursor-pointer place-items-center rounded-full text-ink-faint transition-colors hover:bg-paper-sunken hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11 aria-expanded:bg-paper-sunken aria-expanded:text-ink'
            : 'inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-paper-raised px-3.5 text-[0.82rem] font-medium text-ink-soft transition-colors hover:border-brass hover:text-brass-strong pointer-coarse:min-h-11 pointer-coarse:px-4 aria-expanded:border-brass aria-expanded:text-brass-strong')
        }
      >
        {iconOnly ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="5.5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="18.5" cy="12" r="1.7" />
          </svg>
        ) : (
          <>
            <Icon name="sliders" size={16} />
            {label}
          </>
        )}
      </button>
      {sheet ? (
        <BottomSheet
          open={open}
          onClose={() => setOpen(false)}
          label={label}
          header={
            title ? (
              <p className="display-title mt-2 truncate text-center text-[1.05rem] font-semibold text-ink">{title}</p>
            ) : undefined
          }
        >
          {list}
        </BottomSheet>
      ) : (
        open && <div className="action-pop">{list}</div>
      )}
    </div>
  )
}

function MenuRow({ item, onPick }: { item: ActionMenuItem; onPick: (item: ActionMenuItem) => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onClick={() => onPick(item)}
      className={`action-menu-item ${item.tone === 'danger' ? 'action-menu-danger' : ''}`}
    >
      {item.icon && <Icon name={item.icon} size={19} className="action-menu-icon" />}
      <span className="min-w-0 flex-1">
        <span className="block">{item.label}</span>
        {item.hint && <span className="action-menu-hint">{item.hint}</span>}
      </span>
    </button>
  )
}
