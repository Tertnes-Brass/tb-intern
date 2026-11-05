import { useEffect, useRef, useState } from 'react'
import { QUICK_REACTIONS, type ReactionSummary, type ReactionTarget, reactionTitle, toggleInSummary } from '../lib/reactions'
import { toggleEmojiReaction } from '../server/reactions'
import { EmojiPicker } from './EmojiPicker'
import { Icon } from './Icons'
import { Popover } from './Popover'
import { toastError } from './toast'

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
 */
export function ReactionBar({
  kind,
  targetId,
  reactions,
  canReact = true,
  className = '',
}: {
  kind: ReactionTarget
  targetId: string
  reactions: readonly ReactionSummary[]
  /** Falsk der man bare kan se (f.eks. et utkast). */
  canReact?: boolean
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
          onClick={() => void toggle(r.emoji)}
          disabled={!canReact}
          aria-pressed={r.mine}
          title={reactionTitle(r)}
          aria-label={`${reactionTitle(r)}. ${r.mine ? 'Trykk for å fjerne din.' : 'Trykk for å bli med.'}`}
          className={`inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs transition-colors disabled:cursor-default ${
            r.mine
              ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
              : 'border-line bg-paper-raised text-ink-soft hover:border-brass/60 hover:text-ink'
          }`}
        >
          <span className="text-[0.95rem] leading-none" aria-hidden>
            {r.emoji}
          </span>
          <span className="tabular font-mono text-[0.68rem]">{r.count}</span>
        </button>
      ))}
      {canReact && <AddReaction onPick={(emoji) => void toggle(emoji)} hasAny={state.length > 0} />}
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
function AddReaction({ onPick, hasAny }: { onPick: (emoji: string) => void; hasAny: boolean }) {
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
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
          setOpen((o) => !o)
        }}
        className={`inline-flex h-7 cursor-pointer items-center justify-center gap-1 rounded-full border border-transparent px-1.5 text-ink-faint transition-colors hover:border-line hover:bg-paper-raised hover:text-ink pointer-coarse:min-w-9 ${
          open ? 'border-line bg-paper-raised text-ink' : ''
        }`}
      >
        <Icon name="smilePlus" size={17} />
        {!hasAny && <span className="text-[0.72rem] font-medium">Reager</span>}
      </button>
      <Popover anchor={button} open={open} onClose={() => setOpen(false)} label="Legg til reaksjon" width={all ? 340 : 'fit'} height={all ? 380 : 'fit'}>
        {all ? (
          <EmojiPicker onPick={pick} className="min-h-0 flex-1" />
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
