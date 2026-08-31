import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { type PostAudience, type PostImportance, notifyResultMessage } from '../lib/posts'
import { createPost, publishPost, updatePost } from '../server/posts'
import { toast, toastError } from './toast'
import { Button, Field } from './ui'

/**
 * Skjemaet bak «Skriv beskjed» og «Rediger» (#28). Samme komponent begge steder
 * — forskjellen er om `post` finnes. Publisering går alltid gjennom
 * `publishPost`, som eier både `publishedAt` og e-postvarslingen.
 */

export type PostFormValues = {
  id: string
  title: string
  body: string
  audience: PostAudience
  importance: PostImportance
  publishedAt: number | null
}

const AUDIENCES: Array<{ value: PostAudience; label: string; hint: string }> = [
  { value: 'all', label: 'Hele korpset', hint: 'Alle innloggede medlemmer ser beskjeden.' },
  { value: 'board', label: 'Bare styret', hint: 'Kun de som selv kan publisere beskjeder ser den.' },
]

const IMPORTANCES: Array<{ value: PostImportance; label: string; hint: string }> = [
  { value: 'normal', label: 'Vanlig', hint: 'Havner i feeden som en vanlig beskjed.' },
  { value: 'important', label: 'Viktig', hint: 'Merkes «Viktig», og når også dem som bare vil ha viktige e-poster.' },
]

export function PostForm({ post }: { post?: PostFormValues }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(post?.title ?? '')
  const [body, setBody] = useState(post?.body ?? '')
  const [audience, setAudience] = useState<PostAudience>(post?.audience ?? 'all')
  const [importance, setImportance] = useState<PostImportance>(post?.importance ?? 'normal')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null)
  const isPublished = post?.publishedAt != null

  const save = async (): Promise<string> => {
    const values = { title: title.trim(), body: body.trim(), audience, importance }
    if (!values.title || !values.body) throw new Error('Tittel og tekst må fylles ut')
    if (post) {
      await updatePost({ data: { id: post.id, ...values } })
      return post.id
    }
    const created = await createPost({ data: values })
    return created.id
  }

  const saveDraft = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('draft')
    try {
      const id = await save()
      toast(isPublished ? 'Endringene er lagret' : 'Lagret som utkast')
      await navigate({ to: '/beskjeder/$postId', params: { postId: id } })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const publish = async () => {
    setBusy('publish')
    try {
      const id = await save()
      const result = await publishPost({ data: { id, sendEmail: notify } })
      const { message, kind } = notifyResultMessage(result)
      toast(message, kind)
      await navigate({ to: '/beskjeder/$postId', params: { postId: id } })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <form onSubmit={saveDraft} className="space-y-6">
      <Field label="Tittel *">
        <input
          className="field-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Øvelsen flyttes til tirsdag"
          maxLength={160}
          autoFocus
        />
      </Field>

      <Field label="Tekst *" hint="Tomme linjer lager avsnitt. Lenker blir klikkbare av seg selv.">
        <textarea
          className="field-input min-h-56 resize-y leading-relaxed"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'Hei alle sammen!\n\nØvelsen neste uke er flyttet …'}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Hvem skal se den?" hint={AUDIENCES.find((a) => a.value === audience)!.hint}>
          <select
            className="field-input"
            value={audience}
            onChange={(e) => setAudience(e.target.value as PostAudience)}
          >
            {AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Viktighet" hint={IMPORTANCES.find((i) => i.value === importance)!.hint}>
          <select
            className="field-input"
            value={importance}
            onChange={(e) => setImportance(e.target.value as PostImportance)}
          >
            {IMPORTANCES.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <label className="sheet flex cursor-pointer items-start gap-3 px-4 py-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brass)]"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium text-ink">Send e-post til medlemmene</span>
          <span className="mt-0.5 block text-xs leading-snug text-ink-soft">
            {audience === 'board'
              ? 'Går kun til dem som selv kan publisere beskjeder.'
              : 'Går til aktive medlemmer med e-post, etter varslingsvalget deres.'}{' '}
            Ingen får den samme beskjeden to ganger.
          </span>
        </span>
      </label>

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
        <Button type="submit" variant="secondary" loading={busy === 'draft'} className="w-full sm:w-auto">
          {isPublished ? 'Lagre endringer' : 'Lagre utkast'}
        </Button>
        <Button
          type="button"
          variant="primary"
          loading={busy === 'publish'}
          onClick={() => void publish()}
          className="w-full sm:w-auto"
        >
          {isPublished ? 'Lagre og varsle' : 'Publiser nå'}
        </Button>
      </div>
    </form>
  )
}
