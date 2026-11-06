import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import { QUICK_REACTIONS, type ReactionSummary, type ReactionTarget, reactionTitle, toggleInSummary } from '../lib/reactions'
import { listReactionPeople, toggleEmojiReaction } from '../server/reactions'
import { EmojiPicker } from './EmojiPicker'
import { Icon } from './Icons'
import { Popover } from './Popover'
import { toastError } from './toast'
import { Avatar } from './ui'

/** Så lenge man holder en reaksjon før arket «Hvem har reagert» åpner seg. */
const LONG_PRESS_MS = 450
/** Flytter fingeren seg mer enn dette, ruller man — det er ikke et langt trykk. */
const LONG_PRESS_SLOP_PX = 10

/**
 * Emoji-reaksjonene under et innlegg, en kommentar eller et forumsvar: én
 * «chip» per emoji med antall (dine er markert), og et smilefjes-pluss som
 * åpner hurtigvalgene og hele emoji-velgeren. Trykk på en chip for å bli med
 * eller trekke din tilbake — som i Discord og Slack.
 *
 * Optimistisk: skjermen endres med en gang (`toggleInSummary`, samme regel som
 * serveren) og erstattes av serverens fasit når svaret kommer. Bare svaret på
 * det SISTE trykket får gjelde (et løpenummer som aldri nullstilles), så raske
 * trykk ikke kan ende i feil rekkefølge.
 *
 * Hvem som har reagert: verktøytipset med mus (de første navnene), og et langt
 * trykk på berøringsskjerm — eller høyreklikk/menytasten — åpner et ark med
 * alle, per emoji (`ReactionPeople`). Trykket som avslutter det lange trykket
 * slår IKKE reaksjonen av eller på, og iOS markerer ikke teksten rundt
 * (`AppBehaviour` i skallet).
 */
export function ReactionBar({
  kind,
  targetId,
  reactions,
  canReact = true,
  size = 'sm',
  className = '',
}: {
  kind: ReactionTarget
  targetId: string
  reactions: readonly ReactionSummary[]
  /** Falsk der man bare kan se (f.eks. et utkast). */
  canReact?: boolean
  /** `md` står ved siden av `.post-chip` på veggen (32 px); `sm` under kommentarer og svar. */
  size?: 'sm' | 'md'
  className?: string
}) {
  const [state, setState] = useState<readonly ReactionSummary[]>(reactions)
  /** Løpenummer per trykk — øker bare, så et sent svar aldri kan ta over. */
  const seq = useRef(0)
  /** Kall på vei til serveren. */
  const inflight = useRef(0)
  // Ny fasit fra siden (en oppdatering, en annen fane): ta den — men ikke midt i
  // et eget trykk, der den optimistiske versjonen er nyere. Sammenlignes på
  // innhold: siden lager en ny tom liste ved hver tegning, og den skal ikke
  // viske ut en reaksjon man nettopp la til.
  const signature = reactions.map((r) => `${r.emoji}:${r.count}:${r.mine ? 1 : 0}`).join('|')
  useEffect(() => {
    if (inflight.current === 0) setState(reactions)
  }, [signature])

  /** Emojien arket «Hvem har reagert» står på, og chipen det åpnet seg fra. */
  const [people, setPeople] = useState<string | null>(null)
  const peopleAnchor = useRef<HTMLElement | null>(null)
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null)
  const clearPress = () => {
    if (press.current) clearTimeout(press.current.timer)
    press.current = null
  }
  useEffect(() => clearPress, [])
  // At iOS ikke markerer teksten rundt mens man holder, ordner skallet for alle
  // knapper (`AppBehaviour`, src/lib/press-selection.ts).
  const showPeople = (emoji: string, el: HTMLElement) => {
    peopleAnchor.current = el
    setPeople(emoji)
  }
  const onPressStart = (emoji: string, e: ReactPointerEvent<HTMLButtonElement>) => {
    clearPress()
    // Med mus er det verktøytipset og høyreklikk som gjelder.
    if (e.pointerType === 'mouse') return
    const el = e.currentTarget
    const timer = window.setTimeout(() => {
      if (press.current) press.current.fired = true
      showPeople(emoji, el)
    }, LONG_PRESS_MS)
    press.current = { timer, x: e.clientX, y: e.clientY, fired: false }
  }
  const onPressMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP_PX) clearPress()
  }
  const onChipClick = (emoji: string) => {
    // Slutten på et langt trykk er ikke et trykk.
    if (press.current?.fired) return clearPress()
    clearPress()
    void toggle(emoji)
  }

  const toggle = async (emoji: string) => {
    if (!canReact) return
    const before = state
    setState((s) => toggleInSummary(s, emoji))
    const ticket = ++seq.current
    inflight.current += 1
    try {
      const result = await toggleEmojiReaction({ data: { kind, targetId, emoji } })
      if (ticket === seq.current) setState(result.reactions)
    } catch (err) {
      if (ticket === seq.current) setState(before)
      toastError(err)
    } finally {
      inflight.current -= 1
    }
  }

  if (!canReact && state.length === 0) return null
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {state.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onChipClick(r.emoji)}
          onPointerDown={(e) => onPressStart(r.emoji, e)}
          onPointerMove={onPressMove}
          onPointerUp={() => {
            // Etter et langt trykk står merket til klikket som følger (det skal ikke telle).
            if (!press.current?.fired) clearPress()
          }}
          onPointerCancel={clearPress}
          onContextMenu={(e) => {
            e.preventDefault()
            clearPress()
            showPeople(r.emoji, e.currentTarget)
          }}
          // Ikke `disabled`: da får man heller ikke se hvem som har reagert.
          aria-disabled={!canReact || undefined}
          aria-pressed={r.mine}
          aria-haspopup="dialog"
          title={reactionTitle(r)}
          aria-label={`${reactionTitle(r)}. ${canReact ? (r.mine ? 'Trykk for å fjerne din. ' : 'Trykk for å bli med. ') : ''}Trykk lenge for å se alle.`}
          className={`hit inline-flex cursor-pointer touch-manipulation select-none items-center gap-1 rounded-full border transition-colors [-webkit-touch-callout:none] aria-disabled:cursor-default ${
            size === 'md' ? 'h-8 px-2.5 text-[0.8rem]' : 'h-7 px-2 text-xs'
          } ${
            r.mine
              ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
              : 'border-line bg-paper-raised text-ink-soft hover:border-brass/60 hover:text-ink'
          }`}
        >
          <span className={`${size === 'md' ? 'text-[1.05rem]' : 'text-[0.95rem]'} leading-none`} aria-hidden>
            {r.emoji}
          </span>
          <span className={`tabular font-mono ${size === 'md' ? 'text-[0.72rem]' : 'text-[0.68rem]'}`}>{r.count}</span>
        </button>
      ))}
      {canReact && <AddReaction onPick={(emoji) => void toggle(emoji)} hasAny={state.length > 0} size={size} />}
      <Popover anchor={peopleAnchor} open={people !== null} onClose={() => setPeople(null)} label="Hvem har reagert" width={300} height="fit">
        {people !== null && <ReactionPeople kind={kind} targetId={targetId} summary={state} initial={people} signature={signature} />}
      </Popover>
    </div>
  )
}

/**
 * Arket «Hvem har reagert»: én fane per emoji (som i Discord), og alle som har
 * reagert med den i rekkefølgen de gjorde det. Siden har bare de ti første
 * navnene; resten hentes når arket åpner seg (`listReactionPeople`, samme
 * tilgang som å reagere), og på nytt når reaksjonene endrer seg mens det er åpent.
 */
function ReactionPeople({
  kind,
  targetId,
  summary,
  initial,
  signature,
}: {
  kind: ReactionTarget
  targetId: string
  summary: readonly ReactionSummary[]
  initial: string
  signature: string
}) {
  const [active, setActive] = useState(initial)
  const [full, setFull] = useState<readonly ReactionSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    listReactionPeople({ data: { kind, targetId } })
      .then((res) => {
        if (!live) return
        setFull(res.reactions)
        setFailed(false)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [kind, targetId, signature])

  // Fasiten fra serveren når den er her og stemmer med det siden viser.
  const list = full && full.length > 0 ? full : summary
  const current = list.find((r) => r.emoji === active) ?? list[0]
  if (!current) return <p className="px-4 py-6 text-center text-sm text-ink-soft">Ingen reaksjoner ennå.</p>
  const rest = current.count - current.names.length
  return (
    <div className="flex min-h-0 flex-col">
      <div role="tablist" aria-label="Reaksjoner" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 pt-1 pb-2">
        {list.map((r) => {
          const selected = r.emoji === current.emoji
          return (
            <button
              key={r.emoji}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={`${r.emoji} ${r.count}`}
              onClick={() => setActive(r.emoji)}
              className={`inline-flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-3 transition-colors pointer-coarse:h-11 ${
                selected ? 'border-brass bg-[var(--brass-soft)] text-brass-strong' : 'border-transparent text-ink-soft hover:bg-paper-sunken'
              }`}
            >
              <span className="text-[1.1rem] leading-none" aria-hidden>
                {r.emoji}
              </span>
              <span className="tabular font-mono text-[0.75rem]" aria-hidden>
                {r.count}
              </span>
            </button>
          )
        })}
      </div>
      <ul role="tabpanel" aria-label={`Reagerte med ${current.emoji}`} className="min-h-0 overflow-y-auto px-4 py-2 sm:max-h-[min(60vh,360px)]">
        {current.names.map((name, i) => (
          <li key={`${i}-${name}`} className="flex min-h-11 items-center gap-3 text-sm text-ink">
            <Avatar name={name} size="sm" />
            <span className="min-w-0 truncate">{name}</span>
          </li>
        ))}
        {rest > 0 && (
          <li className="flex min-h-11 items-center text-sm text-ink-faint">
            {full === null && !failed ? 'Henter resten …' : `og ${rest} ${rest === 1 ? 'annen' : 'andre'}`}
          </li>
        )}
      </ul>
    </div>
  )
}

/**
 * Knappene i hurtigvalget. På datamaskin faste 40 px (panelet måler raden); på
 * telefon deler de bredden på arket likt (maks 48 px), så alle åtte får plass
 * også på den smaleste skjermen.
 */
const QUICK_BUTTON = 'grid h-10 min-w-0 max-w-12 flex-1 cursor-pointer place-items-center rounded-[8px] sm:w-10 sm:flex-none'

/** Smilefjes-pluss: hurtigvalgene, og «Flere» for hele emoji-velgeren. */
function AddReaction({ onPick, hasAny, size }: { onPick: (emoji: string) => void; hasAny: boolean; size: 'sm' | 'md' }) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  // På berøringsskjerm får ikke søket fokus når hele velgeren åpnes: da ville
  // tastaturet dekket emojiene man kom for å bla i (som i GIF-velgeren).
  const [coarse, setCoarse] = useState(false)
  const pick = (emoji: string) => {
    setOpen(false)
    onPick(emoji)
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Legg til reaksjon"
        aria-label="Legg til reaksjon"
        onClick={() => {
          setAll(false)
          setCoarse(window.matchMedia('(pointer: coarse)').matches)
          setOpen((o) => !o)
        }}
        className={`hit inline-flex cursor-pointer items-center justify-center gap-1 rounded-full border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-paper-raised hover:text-ink ${
          size === 'md' ? 'h-8 px-2 text-[0.8rem]' : 'h-7 px-1.5 text-[0.72rem]'
        } ${
          open ? 'border-line bg-paper-raised text-ink' : ''
        }`}
      >
        <Icon name="smilePlus" size={17} />
        {!hasAny && <span className="font-medium">Reager</span>}
      </button>
      <Popover anchor={button} open={open} onClose={() => setOpen(false)} label="Legg til reaksjon" width={all ? 340 : 'fit'} height={all ? 380 : 'fit'}>
        {all ? (
          <EmojiPicker onPick={pick} autoFocus={!coarse} className="min-h-0 flex-1" />
        ) : (
          // Så bred som knappene på datamaskin (panelet måler den), hele arket på telefon.
          <div className="flex items-center gap-0.5 px-2 py-2">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => pick(emoji)}
                className={`${QUICK_BUTTON} text-[1.35rem] transition-transform hover:scale-110 hover:bg-paper-sunken`}
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAll(true)}
              title="Flere emojier"
              aria-label="Flere emojier"
              className={`${QUICK_BUTTON} text-ink-soft hover:bg-paper-sunken hover:text-ink sm:ml-1`}
            >
              <Icon name="smilePlus" size={18} />
            </button>
          </div>
        )}
      </Popover>
    </>
  )
}
