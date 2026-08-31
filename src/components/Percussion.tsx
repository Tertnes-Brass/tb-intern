import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PERCUSSION_MAX_LENGTH, parsePercussionSetup, percussionLines } from '../lib/percussion'
import { updateProject, updateProjectWorkPercussion } from '../server/projects'
import { toast, toastError } from './toast'
import { Button } from './ui'

/**
 * Slagverksoppsettet slik det leses: én linje per instrument, med en messing-
 * strek i margen så det ikke forveksles med merknaden på verket.
 */
export function PercussionLine({ text, className = '' }: { text: string; className?: string }) {
  const lines = percussionLines(text)
  if (lines.length === 0) return null
  return (
    <div className={`mt-2.5 border-l-2 border-brass/40 pl-3 ${className}`}>
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-brass">Slagverk</p>
      <ul className="mt-1 space-y-0.5">
        {lines.map((line, i) => (
          <li key={i} className="text-[0.85rem] leading-snug text-ink-soft">
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}

const HINT = 'Én linje per instrument, f.eks. «Timpani – Silje».'

/**
 * Klikk → textarea → lagre/avbryt, uten å åpne et eget skjema. Den som setter
 * opp slagverket sitter med regnearket ved siden av seg og skal kunne fylle inn
 * verk for verk uten en modal per rad.
 */
function InlineTextEdit({
  value,
  addLabel,
  placeholder,
  display,
  onSave,
}: {
  value: string | null
  addLabel: string
  placeholder: string
  display: ReactNode
  onSave: (next: string | null) => Promise<unknown>
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  // Ny verdi fra serveren skal slå gjennom i utkastet — men aldri mens noen
  // står og skriver i feltet.
  useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [value, editing])

  useEffect(() => {
    if (!editing) return
    const el = areaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="print-hidden -mx-2 -my-1 block w-full cursor-pointer rounded-lg px-2 py-1 text-left transition-colors hover:bg-paper-sunken/70"
      >
        {value ? (
          display
        ) : (
          <span className="font-mono text-[0.64rem] uppercase tracking-[0.14em] text-ink-faint transition-colors hover:text-brass-strong">
            + {addLabel}
          </span>
        )}
      </button>
    )
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(parsePercussionSetup(draft))
      setEditing(false)
      toast('Slagverksoppsettet er lagret')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="print-hidden mt-2">
      <textarea
        ref={areaRef}
        className="field-input min-h-24 resize-y leading-relaxed"
        value={draft}
        maxLength={PERCUSSION_MAX_LENGTH}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(value ?? '')
            setEditing(false)
          }
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" loading={saving} onClick={save}>
          Lagre
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(value ?? '')
            setEditing(false)
          }}
        >
          Avbryt
        </Button>
        <span className="ml-auto font-mono text-[0.6rem] tracking-[0.1em] text-ink-faint">
          {draft.length}/{PERCUSSION_MAX_LENGTH}
        </span>
      </div>
      <p className="mt-1.5 text-[0.74rem] leading-snug text-ink-faint">{HINT}</p>
    </div>
  )
}

/** Oppsettet for ett verk i ett prosjekt. Redigerbart ved `projects.manage`. */
export function PercussionSetupField({
  projectId,
  workId,
  value,
  canEdit,
}: {
  projectId: string
  workId: string
  value: string | null
  canEdit: boolean
}) {
  if (!canEdit) return value ? <PercussionLine text={value} /> : null
  return (
    <InlineTextEdit
      value={value}
      addLabel="Slagverk"
      placeholder={'Timpani – Silje\nPauker + cymbal – Ole\nTrommesett – Karim'}
      display={value ? <PercussionLine text={value} /> : null}
      onSave={(next) => updateProjectWorkPercussion({ data: { projectId, workId, percussionSetup: next } })}
    />
  )
}

/** Generelle slagverksnotater for hele konserten. */
export function PercussionNotesField({
  projectId,
  value,
  canEdit,
}: {
  projectId: string
  value: string | null
  canEdit: boolean
}) {
  const notes = value ? (
    <div className="space-y-1">
      {percussionLines(value).map((line, i) => (
        <p key={i} className="text-[0.9rem] leading-relaxed text-ink-soft">
          {line}
        </p>
      ))}
    </div>
  ) : null

  if (!canEdit) return notes
  return (
    <InlineTextEdit
      value={value}
      addLabel="Legg til slagverksnotater"
      placeholder={'Pauker lånes av Åsane musikklag – hentes fredag\nRigging fra kl. 16:00\nStativer og køller tas med fra korpsrommet'}
      display={notes}
      onSave={(next) => updateProject({ data: { id: projectId, percussionNotes: next } })}
    />
  )
}
