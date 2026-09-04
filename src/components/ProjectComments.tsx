import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { formatDateTime } from '../lib/format'
import {
  PROJECT_COMMENT_MAX,
  type ProjectCommentRow,
  type ProjectCommentThread,
  canDeleteProjectComment,
  openThreadCount,
  openThreadsLabel,
  replyCountLabel,
  threadStatusLabel,
} from '../lib/project-comments'
import {
  addProjectComment,
  deleteProjectComment,
  setProjectThreadResolved,
} from '../server/projects'
import { toast, toastError } from './toast'
import { Avatar, Button, SectionHeading, Stamp } from './ui'

/**
 * Spørsmål og svar på prosjektsiden (#27).
 *
 * Bevisst lettvekt: ett spørsmål, svar under, og et «avklart»-stempel når staben
 * har svart. Ingen kategorier, ingen egen inngang, ingen varsling — et fullt
 * forum ville blitt enda en kanal å holde øye med, og det er nettopp det saken
 * ber oss unngå.
 *
 * All tilgangskontroll ligger i `src/server/projects.ts`. Det denne komponenten
 * gjør med `canManage`, er å la være å vise knapper som likevel ville blitt
 * avvist — UI-et er kosmetikk (docs/designprinsipper.md §4).
 */
export function ProjectComments({
  projectId,
  threads,
  canManage,
  meId,
}: {
  projectId: string
  threads: ProjectCommentThread[]
  canManage: boolean
  meId: string
}) {
  const open = openThreadCount(threads)

  return (
    <section className="rise" style={{ animationDelay: '170ms' }}>
      <SectionHeading
        kicker={threads.length > 0 ? openThreadsLabel(open) || 'Alt er besvart' : undefined}
        title="Spørsmål og kommentarer"
        className="mb-4"
      />

      {threads.length === 0 ? (
        <p className="mb-4 text-sm leading-relaxed text-ink-soft">
          Ingen spørsmål ennå. Lurer du på noe om programmet, oppmøtet eller hva du skal ta med — spør her, så ser
          alle svaret.
        </p>
      ) : (
        <ul className="mb-5 space-y-3">
          {threads.map((thread) => (
            <Thread
              key={thread.id}
              projectId={projectId}
              thread={thread}
              canManage={canManage}
              meId={meId}
            />
          ))}
        </ul>
      )}

      <Composer
        projectId={projectId}
        placeholder="Still et spørsmål til prosjektledelsen …"
        submitLabel="Send spørsmål"
      />
    </section>
  )
}

/** Én tråd: spørsmålet, svarene under, og stabens handlinger. */
function Thread({
  projectId,
  thread,
  canManage,
  meId,
}: {
  projectId: string
  thread: ProjectCommentThread
  canManage: boolean
  meId: string
}) {
  const router = useRouter()
  const [replying, setReplying] = useState(false)
  const [busy, setBusy] = useState(false)
  const resolved = thread.resolvedAt !== null

  const toggleResolved = async () => {
    setBusy(true)
    try {
      await setProjectThreadResolved({ data: { id: thread.id, resolved: !resolved } })
      toast(resolved ? 'Tråden er åpnet igjen' : 'Tråden er markert som avklart')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`sheet overflow-hidden ${resolved ? 'opacity-80' : ''}`}>
      <div className="px-4 py-3.5 sm:px-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Stamp tone={resolved ? 'brass' : 'oxblood'}>{threadStatusLabel(thread)}</Stamp>
          {thread.replies.length > 0 && (
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-ink-faint">
              {replyCountLabel(thread.replies.length)}
            </span>
          )}
        </div>
        <CommentBody
          comment={thread}
          canManage={canManage}
          meId={meId}
          onChanged={() => router.invalidate()}
        />
      </div>

      {thread.replies.length > 0 && (
        <ul className="border-t border-line bg-paper-sunken/40">
          {thread.replies.map((reply) => (
            <li key={reply.id} className="border-b border-line/60 px-4 py-3 last:border-b-0 sm:px-5">
              <CommentBody
                comment={reply}
                canManage={canManage}
                meId={meId}
                onChanged={() => router.invalidate()}
              />
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
          {replying ? (
            <div className="w-full">
              <Composer
                projectId={projectId}
                parentId={thread.id}
                placeholder="Svar på spørsmålet …"
                submitLabel="Svar"
                autoFocus
                onDone={() => setReplying(false)}
              />
              <button
                type="button"
                onClick={() => setReplying(false)}
                className="mt-2 cursor-pointer text-xs text-ink-faint hover:text-ink"
              >
                Avbryt
              </button>
            </div>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => setReplying(true)}>
                Svar
              </Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void toggleResolved()}>
                {resolved ? 'Åpne igjen' : 'Marker som avklart'}
              </Button>
              {resolved && thread.resolvedByName && (
                <span className="text-xs text-ink-faint">Avklart av {thread.resolvedByName}</span>
              )}
            </>
          )}
        </div>
      )}
    </li>
  )
}

/** Selve teksten med forfatter, tidspunkt og slett-knappen. Alltid ren tekst. */
function CommentBody({
  comment,
  canManage,
  meId,
  onChanged,
}: {
  comment: ProjectCommentRow
  canManage: boolean
  meId: string
  onChanged: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const isThread = comment.parentId === null
  const canDelete = canDeleteProjectComment({ id: meId }, comment, canManage)

  const remove = async () => {
    setBusy(true)
    try {
      await deleteProjectComment({ data: { id: comment.id } })
      toast(isThread ? 'Tråden er slettet' : 'Svaret er slettet')
      await onChanged()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-2.5">
      <Avatar name={comment.author.name} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[0.82rem] font-semibold text-ink">{comment.author.name}</p>
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-[0.58rem] uppercase tracking-[0.12em] text-ink-faint">
              {formatDateTime(comment.createdAt)}
            </span>
            {canDelete && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                // Sletter du en tråd, følger svarene med (cascade). Si det før
                // det skjer — knappen ser ellers lik ut i begge tilfeller.
                title={isThread ? 'Sletter spørsmålet og alle svarene' : 'Sletter dette svaret'}
                className="cursor-pointer text-[0.62rem] text-ink-faint transition-colors hover:text-danger disabled:opacity-50"
              >
                Slett
              </button>
            )}
          </div>
        </div>
        {/* Ren tekst, som kommentarene på veggen: linjeskift bevares, ingenting
            tolkes som markering. Teksten rendres som en tekstnode — aldri HTML. */}
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft">{comment.body}</p>
      </div>
    </div>
  )
}

/** Skrivefeltet — både for nye spørsmål og for svar i en tråd. */
function Composer({
  projectId,
  parentId,
  placeholder,
  submitLabel,
  autoFocus,
  onDone,
}: {
  projectId: string
  parentId?: string
  placeholder: string
  submitLabel: string
  autoFocus?: boolean
  onDone?: () => void
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const text = body.trim()
    if (!text) return
    setBusy(true)
    try {
      await addProjectComment({ data: { projectId, parentId, body: text } })
      setBody('')
      onDone?.()
      await router.invalidate()
    } catch (err) {
      // Teksten blir stående: en tapt forbindelse skal ikke koste spørsmålet.
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <textarea
        className="field-input min-h-16 flex-1 resize-y text-sm"
        value={body}
        maxLength={PROJECT_COMMENT_MAX}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // Enter sender, skift+enter gir ny linje — samme vane som på veggen.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      <Button
        type="button"
        variant="primary"
        loading={busy}
        disabled={!body.trim()}
        onClick={() => void submit()}
        className="w-full sm:w-auto"
      >
        {submitLabel}
      </Button>
    </div>
  )
}
