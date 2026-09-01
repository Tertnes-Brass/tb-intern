import { useNavigate, useRouter } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import { markdownToHtml } from '../lib/markdown'
import { postImageUrl, uploadPostImages } from '../lib/post-images-client'
import {
  DEFAULT_NOTIFY,
  DEFAULT_POST_FORMAT,
  MAX_POST_IMAGES,
  type PostAudience,
  type PostFormat,
  type PostImportance,
  imageRejectionReason,
  notifyLabel,
  notifyResultMessage,
} from '../lib/posts'
import { createPost, deletePostImage, publishPost, updatePost } from '../server/posts'
import { toast, toastError } from './toast'
import { Button, Field } from './ui'

/**
 * Skjemaet bak «Skriv innlegg» og «Rediger» på veggen (#28). Samme komponent
 * for alle: et vanlig medlem ser tekst, valgfri tittel og bilder, mens
 * `posts.publish` i tillegg får målgruppe, viktighet, «Fra styret» og e-post.
 *
 * Flyten er alltid opprett → last opp bilder → publiser, slik at et innlegg
 * aldri blir synlig halvferdig og bilder aldri blir foreldreløse.
 *
 * Formatvalget (#79) er ikke privilegert: alle kan velge markdown når teksten
 * trenger overskrifter, lister eller en tabell. Forhåndsvisningen kjører samme
 * rendrer som serveren og detaljsiden — `src/lib/markdown.ts` er en ren modul
 * nettopp for at klienten skal kunne vise nøyaktig det som blir publisert.
 */

export type PostFormImage = { id: string; fileName: string }

export type PostFormValues = {
  id: string
  title: string | null
  body: string
  format: PostFormat
  audience: PostAudience
  importance: PostImportance
  official: boolean
  publishedAt: number | null
  images: PostFormImage[]
}

const AUDIENCES: Array<{ value: PostAudience; label: string; hint: string }> = [
  { value: 'all', label: 'Hele korpset', hint: 'Alle innloggede medlemmer ser innlegget.' },
  { value: 'board', label: 'Bare styret', hint: 'Kun de som selv kan publisere beskjeder ser det.' },
]

const FORMATS: Array<{ value: PostFormat; label: string; hint: string }> = [
  {
    value: 'plain_text',
    label: 'Rein tekst',
    hint: 'Tomme linjer lager avsnitt. Lenker blir klikkbare av seg selv.',
  },
  {
    value: 'markdown',
    label: 'Markdown',
    hint: '# overskrift · **fet** · - liste · [tekst](lenke) · tabeller. Rå HTML og bilder utenfra blir ikke vist.',
  },
]

const IMPORTANCES: Array<{ value: PostImportance; label: string; hint: string }> = [
  { value: 'normal', label: 'Vanlig', hint: 'Havner på veggen som et vanlig innlegg.' },
  { value: 'important', label: 'Viktig', hint: 'Merkes «Viktig», og når også dem som bare vil ha viktige e-poster.' },
]

export function PostForm({ post, canPublish }: { post?: PostFormValues; canPublish: boolean }) {
  const navigate = useNavigate()
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(post?.title ?? '')
  const [body, setBody] = useState(post?.body ?? '')
  const [format, setFormat] = useState<PostFormat>(post?.format ?? DEFAULT_POST_FORMAT)
  const [preview, setPreview] = useState(false)
  const [audience, setAudience] = useState<PostAudience>(post?.audience ?? 'all')
  const [importance, setImportance] = useState<PostImportance>(post?.importance ?? 'normal')
  const [official, setOfficial] = useState(post?.official ?? false)
  // Avslått som standard (#85): publisering og masseutsending er to handlinger.
  const [notify, setNotify] = useState(DEFAULT_NOTIFY)
  const [existingImages, setExistingImages] = useState<PostFormImage[]>(post?.images ?? [])
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null)
  const isPublished = post?.publishedAt != null
  const imageBudget = MAX_POST_IMAGES - existingImages.length - files.length
  // Samme rendrer som serveren og detaljsiden — forhåndsvisningen kan ikke
  // vise noe annet enn det som faktisk blir publisert.
  const previewHtml = useMemo(
    () => (format === 'markdown' && preview ? markdownToHtml(body) : ''),
    [body, format, preview],
  )

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const picked: File[] = []
    for (const file of Array.from(list)) {
      const reason = imageRejectionReason({ type: file.type, size: file.size })
      if (reason) {
        toast(`${file.name}: ${reason}`, 'error')
        continue
      }
      picked.push(file)
    }
    if (picked.length > imageBudget) {
      toast(`Maks ${MAX_POST_IMAGES} bilder per innlegg`, 'error')
    }
    setFiles((current) => [...current, ...picked.slice(0, Math.max(0, imageBudget))])
    if (fileInput.current) fileInput.current.value = ''
  }

  const removeExisting = async (image: PostFormImage) => {
    try {
      await deletePostImage({ data: { id: image.id } })
      setExistingImages((current) => current.filter((i) => i.id !== image.id))
      await router.invalidate()
    } catch (err) {
      toastError(err)
    }
  }

  /** Lagrer teksten og laster opp nye bilder. Returnerer id-en til innlegget. */
  const save = async (): Promise<string> => {
    const values = {
      title: title.trim() || null,
      body: body.trim(),
      format,
      audience,
      importance,
      official,
    }
    if (!values.body) throw new Error('Skriv noe i teksten først')
    const id = post ? post.id : (await createPost({ data: values })).id
    if (post) await updatePost({ data: { id, ...values } })
    if (files.length > 0) {
      try {
        await uploadPostImages(id, files)
      } catch (err) {
        // Teksten er lagret; si tydelig fra hvor den ble av, slik at ingen
        // skriver det samme innlegget på nytt.
        const reason = err instanceof Error ? err.message : 'Bildet ble ikke lastet opp'
        throw new Error(`${reason}. Innlegget er lagret som utkast — åpne det og prøv bildene på nytt.`)
      }
      setFiles([])
    }
    return id
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
      const result = await publishPost({ data: { id, sendEmail: canPublish && notify } })
      if (canPublish) {
        const { message, kind } = notifyResultMessage(result)
        toast(message, kind)
      } else {
        toast('Publisert på veggen')
      }
      await navigate({ to: '/beskjeder/$postId', params: { postId: id } })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <form onSubmit={canPublish ? saveDraft : (e) => { e.preventDefault(); void publish() }} className="space-y-6">
      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[0.8rem] font-medium text-ink-soft">Tekst *</span>
          <fieldset className="flex items-center gap-1 rounded-full border border-line p-0.5">
            <legend className="sr-only">Format på teksten</legend>
            {FORMATS.map((f) => (
              <label
                key={f.value}
                className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brass ${
                  format === f.value
                    ? 'bg-[var(--brass-soft)] text-brass-strong'
                    : 'text-ink-faint hover:text-brass-strong'
                }`}
              >
                <input
                  type="radio"
                  name="post-format"
                  className="sr-only"
                  value={f.value}
                  checked={format === f.value}
                  onChange={() => {
                    setFormat(f.value)
                    // «Forhåndsvisning» gir ikke mening for rein tekst.
                    if (f.value !== 'markdown') setPreview(false)
                  }}
                />
                {f.label}
              </label>
            ))}
          </fieldset>
        </div>

        {format === 'markdown' && (
          <div className="mb-2 flex gap-2">
            {[
              { on: false, label: 'Skriv' },
              { on: true, label: 'Forhåndsvisning' },
            ].map((tab) => (
              <button
                key={tab.label}
                type="button"
                aria-pressed={preview === tab.on}
                onClick={() => setPreview(tab.on)}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  preview === tab.on
                    ? 'border-brass bg-[var(--brass-soft)] text-brass-strong'
                    : 'border-line text-ink-soft hover:border-brass hover:text-brass-strong'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {preview && format === 'markdown' ? (
          previewHtml ? (
            // HTML-en kommer fra `markdownToHtml`, som bygger utdata av en
            // allowlist og aldri slipper gjennom rå HTML eller farlige lenker.
            <div
              className="prose sheet min-h-40 px-4 py-3.5"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <p className="sheet min-h-40 px-4 py-3.5 text-sm text-ink-faint">Ingenting å vise ennå.</p>
          )
        ) : (
          <textarea
            className="field-input min-h-40 resize-y leading-relaxed"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              format === 'markdown'
                ? '## Øvelsen neste uke\n\n- Vi starter 19.00\n- Ta med **svart mappe**'
                : canPublish
                  ? 'Hei alle sammen!\n\nØvelsen neste uke er flyttet …'
                  : 'Hva skjer?'
            }
            autoFocus
          />
        )}
        <p className="mt-1 text-xs text-ink-faint">{FORMATS.find((f) => f.value === format)!.hint}</p>
      </div>

      <Field label="Tittel" hint="Valgfri. Uten tittel vises første linje av teksten.">
        <input
          className="field-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Øvelsen flyttes til tirsdag"
          maxLength={160}
        />
      </Field>

      <div>
        <p className="mb-1.5 text-[0.8rem] font-medium text-ink-soft">Bilder</p>
        {(existingImages.length > 0 || files.length > 0) && (
          <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {existingImages.map((image) => (
              <li key={image.id} className="relative">
                <img
                  src={postImageUrl(image.id)}
                  alt={image.fileName}
                  loading="lazy"
                  className="aspect-square w-full rounded-[9px] border border-line object-cover"
                />
                <button
                  type="button"
                  onClick={() => void removeExisting(image)}
                  aria-label={`Fjern ${image.fileName}`}
                  className="absolute right-1 top-1 grid h-6 w-6 cursor-pointer place-items-center rounded-full bg-paper/90 text-ink-soft transition-colors hover:text-danger"
                >
                  ×
                </button>
              </li>
            ))}
            {files.map((file, i) => (
              <li key={`${file.name}-${i}`} className="relative">
                <span className="flex aspect-square w-full items-center justify-center rounded-[9px] border border-dashed border-line bg-paper-sunken/60 px-2 text-center text-[0.6rem] leading-tight text-ink-faint">
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, index) => index !== i))}
                  aria-label={`Fjern ${file.name}`}
                  className="absolute right-1 top-1 grid h-6 w-6 cursor-pointer place-items-center rounded-full bg-paper/90 text-ink-soft transition-colors hover:text-danger"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic"
          multiple
          onChange={(e) => addFiles(e.target.files)}
          className="block w-full text-xs text-ink-soft file:mr-3 file:cursor-pointer file:rounded-[9px] file:border file:border-line-strong file:bg-paper-raised file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink hover:file:border-brass"
          disabled={imageBudget <= 0}
        />
        <p className="mt-1 text-xs text-ink-faint">
          Inntil {MAX_POST_IMAGES} bilder, maks 10 MB hver. Bildene er kun synlige for innloggede medlemmer.
        </p>
      </div>

      {canPublish && (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Hvem skal se det?" hint={AUDIENCES.find((a) => a.value === audience)!.hint}>
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
              checked={official}
              onChange={(e) => setOfficial(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-ink">Merk som «Fra styret»</span>
              <span className="mt-0.5 block text-xs leading-snug text-ink-soft">
                Innlegget vises som en offisiell beskjed fra korpset, ikke som et vanlig medlemsinnlegg.
              </span>
            </span>
          </label>

          <label className="sheet flex cursor-pointer items-start gap-3 px-4 py-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brass)]"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-ink">{notifyLabel(audience)}</span>
              <span className="mt-0.5 block text-xs leading-snug text-ink-soft">
                Uten avkryssing publiseres innlegget uten at det sendes e-post.{' '}
                {audience === 'board'
                  ? 'E-posten går kun til dem som selv kan publisere beskjeder.'
                  : 'E-posten går til aktive medlemmer med e-post, etter varslingsvalget deres.'}{' '}
                Ingen får den samme beskjeden to ganger.
              </span>
            </span>
          </label>
        </>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
        {canPublish && (
          <Button type="submit" variant="secondary" loading={busy === 'draft'} className="w-full sm:w-auto">
            {isPublished ? 'Lagre endringer' : 'Lagre utkast'}
          </Button>
        )}
        <Button
          type={canPublish ? 'button' : 'submit'}
          variant="primary"
          loading={busy === 'publish'}
          onClick={canPublish ? () => void publish() : undefined}
          className="w-full sm:w-auto"
        >
          {isPublished ? (canPublish ? 'Lagre og varsle' : 'Lagre endringer') : 'Publiser'}
        </Button>
      </div>
    </form>
  )
}
