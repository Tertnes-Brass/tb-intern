import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useId, useMemo, useRef, useState } from 'react'
import { type PostDraft, isPostDraft } from '../lib/drafts'
import { attachmentRejectionReason, MAX_POST_ATTACHMENTS, postAttachmentUrl, uploadPostAttachment, type PostAttachment } from '../lib/post-attachments'
import { deletePostAttachment } from '../server/post-attachments'
import { markdownToHtml } from '../lib/markdown'
import { type MentionUser, mentionDraft, toMarkers } from '../lib/mentions'
import { postImageUrl, uploadPostImage } from '../lib/post-images-client'
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
import { createPost, deletePostImage, publishPost, searchMentionableForAudience, updatePost } from '../server/posts'
import { MentionTextarea } from './MentionTextarea'
import { toast, toastError } from './toast'
import { ComposerBar, ComposerLayout, ComposerTitle, Glyph, Segmented, ToolButton } from './compose/Composer'
import { DraftNotice, LeaveGuard } from './compose/LeaveGuard'
import { useLocalDraft } from './compose/useLocalDraft'
import { Button, Modal } from './ui'

/**
 * Skjemaet bak «Skriv innlegg» og «Rediger» på veggen (#28). Samme komponent
 * for alle: et vanlig medlem ser tekst, valgfri tittel og bilder, mens
 * `posts.publish` i tillegg får målgruppe, viktighet, «Fra styret» og e-post.
 *
 * Flyten er alltid opprett → last opp bilder og vedlegg → publiser, slik at et innlegg
 * aldri blir synlig halvferdig og bilder aldri blir foreldreløse.
 *
 * Utformingen er skriveflaten i `compose/Composer.tsx`: «Avbryt · Nytt innlegg ·
 * Publiser» klistret øverst, overskrift og tekst først, en verktøylinje for
 * bilder og vedlegg, og valgene (avsender, målgruppe, viktighet, format) i en
 * egen spalte på iPad og et sammenleggbart «Valg» på telefon. For `canPublish`
 * åpner «Publiser» et ark med det som er valgt og avkryssingen for varsel —
 * fortsatt AVSLÅTT som standard (`DEFAULT_NOTIFY`), og knappen sier om det
 * sendes noe («Publiser og varsle» / «Publiser uten varsel»).
 *
 * Formatvalget (#79) er ikke privilegert: alle kan velge markdown når teksten
 * trenger overskrifter, lister eller en tabell. Forhåndsvisningen kjører samme
 * rendrer som serveren og detaljsiden — `src/lib/markdown.ts` er en ren modul
 * nettopp for at klienten skal kunne vise nøyaktig det som blir publisert.
 *
 * Omtaler: brødteksten er en `MentionTextarea`, delt med kommentarfeltet og
 * chatten. Feltet viser `@Navn` — også når et LAGRET innlegg åpnes for
 * redigering, der `mentionDraft` gjør markørene om til navn og gir tilbake de
 * samme medlemmene som «valgt», slik at `toMarkers` kan legge markørene tilbake
 * ved lagring. Forslagslista spør om målgruppen, ikke om innlegget: et nytt
 * innlegg har ingen id å slå opp ennå.
 *
 * Det man skriver er beskyttet (`draftKey`): teksten og valgene lagres på
 * enheten mens man skriver (`useLocalDraft`, nøkkelen har brukerens id), og
 * kommer tilbake med «Gjenopprettet utkast fra kl. …» hvis man forlot siden
 * eller appen ble lastet på nytt. Forlater man en endret skriveflate, spør
 * `LeaveGuard` «Forkast endringene?» først. Bilder og vedlegg som ikke er
 * lastet opp ennå, er filer og kan ikke lagres slik.
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
  fromArchive: boolean
  publishedAt: number | null
  images: PostFormImage[]
  attachments?: PostAttachment[]
  /** Dagens navn på de omtalte i `body`, slik at feltet kan vise `@Navn`. */
  mentions: MentionUser[]
  /** Serverens versjon — et lokalt utkast fra før en senere endring merkes. */
  updatedAt?: number
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

export function PostForm({
  post,
  canPublish: canBoard,
  canArchive = false,
  draftKey,
}: {
  post?: PostFormValues
  canPublish: boolean
  canArchive?: boolean
  /** `draftKey(me.id, …)` fra `src/lib/drafts.ts`. Uten nøkkel lagres ingen utkast. */
  draftKey?: string
}) {
  const canPublish = canBoard || (canArchive && !post?.official && (!post || post.audience === 'all'))
  const navigate = useNavigate()
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const attachmentInput = useRef<HTMLInputElement>(null)
  const bodyId = useId()
  const bodyHintId = useId()
  const titleHintId = useId()
  const notifyHintId = useId()
  /** Telefon: «Valg» er lagt sammen til man åpner det. */
  const [optionsOpen, setOptionsOpen] = useState(false)
  /** Arket «Publisere innlegget?» med varslingsvalget — bare for `canPublish`. */
  const [confirm, setConfirm] = useState(false)
  const [title, setTitle] = useState(post?.title ?? '')
  // Lagret tekst har markører; feltet skal vise navn. `draft` gjør om begge
  // veier, og `chosen` er grunnlaget `toMarkers` bruker ved lagring.
  const [draft] = useState(() => mentionDraft(post?.body ?? '', post?.mentions ?? []))
  const [body, setBody] = useState(draft.text)
  const [chosen, setChosen] = useState<MentionUser[]>(draft.chosen)
  const [format, setFormat] = useState<PostFormat>(post?.format ?? DEFAULT_POST_FORMAT)
  const [preview, setPreview] = useState(false)
  const [audience, setAudience] = useState<PostAudience>(post?.audience ?? 'all')
  const [importance, setImportance] = useState<PostImportance>(post?.importance ?? 'normal')
  const [official, setOfficial] = useState(post?.official ?? false)
  const [fromArchive, setFromArchive] = useState(post?.fromArchive ?? false)
  // Avslått som standard (#85): publisering og masseutsending er to handlinger.
  const [notify, setNotify] = useState(DEFAULT_NOTIFY)
  const [existingImages, setExistingImages] = useState<PostFormImage[]>(post?.images ?? [])
  const [files, setFiles] = useState<File[]>([])
  const [savedPostId, setSavedPostId] = useState(post?.id)
  const savedIdRef = useRef(post?.id)
  const [existingAttachments, setExistingAttachments] = useState<PostAttachment[]>(post?.attachments ?? [])
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([])
  const [removingAttachment, setRemovingAttachment] = useState<string | null>(null)
  const attachmentBudget = MAX_POST_ATTACHMENTS - existingAttachments.length - attachmentFiles.length
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null)
  const isPublished = post?.publishedAt != null
  /** Bekreftelse før et lagret bilde eller vedlegg slettes fra innlegget. */
  const [confirmRemove, setConfirmRemove] = useState<{ kind: 'image'; item: PostFormImage } | { kind: 'attachment'; item: PostAttachment } | null>(null)

  // ---- Utkast på enheten ----
  const [initialDraft] = useState<PostDraft>(() => ({
    title: post?.title ?? '',
    body: draft.text,
    chosen: draft.chosen,
    format: post?.format ?? DEFAULT_POST_FORMAT,
    audience: post?.audience ?? 'all',
    importance: post?.importance ?? 'normal',
    official: post?.official ?? false,
    fromArchive: post?.fromArchive ?? false,
  }))
  const currentDraft: PostDraft = { title, body, chosen, format, audience, importance, official, fromArchive }
  const applyDraft = (d: PostDraft, trusted = false) => {
    setTitle(d.title)
    setBody(d.body)
    setChosen(d.chosen)
    setFormat(d.format)
    if (d.format !== 'markdown') setPreview(false)
    // Privilegerte valg følger bare med for den som fortsatt kan gjøre dem —
    // serveren håndhever det uansett (`sanitizePostInput`).
    setAudience(trusted || canBoard ? d.audience : 'all')
    setImportance(trusted || canPublish ? d.importance : 'normal')
    setOfficial(trusted ? d.official : canBoard && d.official)
    setFromArchive(trusted ? d.fromArchive : canPublish && d.fromArchive)
  }
  const local = useLocalDraft<PostDraft>({
    storageKey: draftKey,
    value: currentDraft,
    initial: initialDraft,
    validate: isPostDraft,
    onRestore: (d) => applyDraft(d),
    base: post?.updatedAt ?? null,
  })
  /** Slås av i samme øyeblikk som en vellykket lagring navigerer videre. */
  const leaving = useRef(false)
  const dirty = JSON.stringify(currentDraft) !== JSON.stringify(initialDraft) || files.length > 0 || attachmentFiles.length > 0
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const discardDraft = () => {
    local.discard()
    applyDraft(initialDraft, true)
  }
  const imageBudget = MAX_POST_IMAGES - existingImages.length - files.length
  // Samme rendrer som serveren og detaljsiden — forhåndsvisningen kan ikke
  // vise noe annet enn det som faktisk blir publisert.
  // Omtalene vises som chips også her: teksten oversettes til markører først, med
  // nøyaktig de samme navnene serveren vil slå opp etterpå.
  const previewHtml = useMemo(
    () => (format === 'markdown' && preview ? markdownToHtml(toMarkers(body, chosen), { mentions: chosen }) : ''),
    [body, chosen, format, preview],
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

  const removeExistingAttachment = async (file: PostAttachment) => {
    setRemovingAttachment(file.id)
    try {
      await deletePostAttachment({ data: { id: file.id } })
      setExistingAttachments((current) => current.filter((f) => f.id !== file.id))
      await router.invalidate()
    } catch (error) {
      toastError(error)
    } finally {
      setRemovingAttachment(null)
    }
  }

  /** Lagrer teksten og laster opp nye bilder og vedlegg. Returnerer id-en til innlegget. */
  const save = async (): Promise<string> => {
    const values = {
      title: title.trim() || null,
      // `@Navn` → `@[u:…]` helt til slutt. Bare navn som faktisk er valgt fra
      // lista blir markører; serveren validerer hver av dem uansett.
      body: toMarkers(body.trim(), chosen),
      format,
      audience,
      importance,
      official,
      fromArchive,
    }
    if (!values.body) throw new Error('Skriv noe i teksten først')
    let id = savedIdRef.current
    if (id) await updatePost({ data: { id, ...values } })
    else {
      id = (await createPost({ data: values })).id
      savedIdRef.current = id
      setSavedPostId(id)
    }
    try {
      // Remove each successfully uploaded file from the pending list, so a
      // retry after a partial failure never duplicates those uploads.
      for (const file of files) {
        const uploaded = await uploadPostImage(id, file)
        setExistingImages((current) => [...current, uploaded])
        setFiles((current) => current.filter((pending) => pending !== file))
      }
      for (const file of attachmentFiles) {
        const uploaded = await uploadPostAttachment(id, file)
        setExistingAttachments((current) => [...current, uploaded])
        setAttachmentFiles((current) => current.filter((pending) => pending !== file))
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Filen ble ikke lastet opp'
      throw new Error(`${reason}. Teksten er lagret${isPublished ? '' : ' som utkast'}. Prøv igjen eller åpne den lagrede beskjeden nedenfor.`)
    }
    return id
  }

  const saveDraft = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('draft')
    try {
      const id = await save()
      local.clear()
      leaving.current = true
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
      local.clear()
      leaving.current = true
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

  const blocked = busy !== null || removingAttachment !== null
  const senderValue: 'member' | 'board' | 'archive' = fromArchive ? 'archive' : official ? 'board' : 'member'
  const senderLabel = { member: 'Fra meg', board: 'Fra styret', archive: 'Fra notearkivar' }[senderValue]
  const audienceLabel = AUDIENCES.find((a) => a.value === audience)!.label
  const formatLabel = FORMATS.find((f) => f.value === format)!.label
  // Linjen på «Valg»-knappen (telefon): hva som er valgt, uten å åpne.
  const optionsSummary = canPublish
    ? [senderLabel, audienceLabel, importance === 'important' ? 'Viktig' : null].filter(Boolean).join(' · ')
    : formatLabel

  const barActions = canPublish ? (
    isPublished ? (
      <Button type="submit" variant="primary" size="sm" loading={busy === 'draft'} disabled={blocked}>
        Lagre
      </Button>
    ) : (
      <>
        <Button type="submit" variant="ghost" size="sm" loading={busy === 'draft'} disabled={blocked}>
          Lagre<span className="max-sm:hidden"> utkast</span>
        </Button>
        <Button type="button" variant="primary" size="sm" loading={busy === 'publish'} disabled={blocked} onClick={() => setConfirm(true)}>
          Publiser
        </Button>
      </>
    )
  ) : (
    <Button type="submit" variant="primary" size="sm" loading={busy === 'publish'} disabled={blocked}>
      {isPublished ? 'Lagre' : 'Publiser'}
    </Button>
  )

  const imageHint = `Inntil ${MAX_POST_IMAGES} bilder, maks 10 MB hver. Bildene er kun synlige for innloggede medlemmer.`
  const attachmentHint = `Inntil ${MAX_POST_ATTACHMENTS} filer, maks 25 MB hver. De som kan lese beskjeden, kan laste ned vedleggene.`

  const main = (
    <div className="composer-sheet">
      <ComposerTitle
        label="Tittel (valgfri)"
        placeholder="Tittel (valgfri)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={160}
        aria-describedby={titleHintId}
      />
      <p id={titleHintId} className="sr-only">
        Uten tittel vises første linje av teksten.
      </p>

      <label htmlFor={bodyId} className="sr-only">
        Tekst
      </label>
      {preview && format === 'markdown' ? (
        previewHtml ? (
          // HTML-en kommer fra `markdownToHtml`, som bygger utdata av en
          // allowlist og aldri slipper gjennom rå HTML eller farlige lenker.
          <div className="prose composer-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        ) : (
          <p className="composer-preview text-sm text-ink-faint">Ingenting å vise ennå.</p>
        )
      ) : (
        <MentionTextarea
          id={bodyId}
          aria-describedby={bodyHintId}
          required
          className="composer-body"
          value={body}
          onChange={setBody}
          chosen={chosen}
          onChosenChange={setChosen}
          // Målgruppen avgjør hvem som kan omtales — den er valgt her i
          // skjemaet, og innlegget har kanskje ingen id ennå.
          search={(query) => searchMentionableForAudience({ data: { audience, query } })}
          // Ingen `onEnter`: her er enter et linjeskift, ikke «send».
          placement="below"
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
      <p id={bodyHintId} className="composer-hint">
        {FORMATS.find((f) => f.value === format)!.hint} Skriv @ for å nevne noen.
      </p>

      {(existingImages.length > 0 || files.length > 0) && (
        <div className="px-4 pb-3 sm:px-5">
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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
                  onClick={() => setConfirmRemove({ kind: 'image', item: image })}
                  disabled={busy !== null}
                  aria-label={`Fjern ${image.fileName}`}
                  className="hit absolute right-1 top-1 grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-paper/90 text-ink-soft transition-colors hover:text-danger"
                >
                  ×
                </button>
              </li>
            ))}
            {files.map((file, i) => (
              <li key={`${file.name}-${i}`} className="relative">
                <span className="flex aspect-square w-full items-center justify-center rounded-[9px] border border-dashed border-line bg-paper-sunken/60 px-2 text-center text-[0.7rem] leading-tight text-ink-faint">
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, index) => index !== i))}
                  disabled={busy !== null}
                  aria-label={`Fjern ${file.name}`}
                  className="hit absolute right-1 top-1 grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-paper/90 text-ink-soft transition-colors hover:text-danger"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-ink-faint">{imageHint}</p>
        </div>
      )}

      {canBoard && (existingAttachments.length > 0 || attachmentFiles.length > 0) && (
        <div className="px-4 pb-3 sm:px-5">
          <ul className="divide-y divide-line rounded-[9px] border border-line">
            {existingAttachments.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                <a className="link-brass min-w-0 break-all" href={postAttachmentUrl(file.id)} download>
                  {file.fileName}
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={blocked}
                  onClick={() => setConfirmRemove({ kind: 'attachment', item: file })}
                  aria-label={`Fjern ${file.fileName}`}
                >
                  Fjern
                </Button>
              </li>
            ))}
            {attachmentFiles.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                <span className="min-w-0 break-all">
                  {file.name} <span className="text-ink-faint">· ikke lastet opp ennå</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setAttachmentFiles((current) => current.filter((_, i) => i !== index))}
                  aria-label={`Fjern ${file.name}`}
                >
                  Fjern
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-ink-faint">{attachmentHint}</p>
        </div>
      )}

      {/* Verktøylinjen. Filvelgerne er skjult og åpnes fra knappene; bildene
          står først, så vedleggene (rekkefølgen testene leser dem i). */}
      {/* Kompakt når verktøylinjen har mange knapper (vedlegg, forhåndsvisning):
          da faller sammendraget på «Valg» bort på smal skjerm, i stedet for å
          klippes. Ellers brytes linjen heller enn å skjule noe. */}
      <div className={`composer-toolbar ${canBoard || format === 'markdown' ? 'is-compact' : ''}`}>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic"
          multiple
          tabIndex={-1}
          aria-hidden
          onChange={(e) => addFiles(e.target.files)}
          className="sr-only"
          disabled={busy !== null || imageBudget <= 0}
        />
        <ToolButton
          icon={<Glyph name="image" />}
          title={imageHint}
          disabled={busy !== null || imageBudget <= 0}
          onClick={() => fileInput.current?.click()}
        >
          Bilder
          {existingImages.length + files.length > 0 && (
            <span className="tabular text-xs text-ink-faint">{existingImages.length + files.length}</span>
          )}
        </ToolButton>
        {canBoard && (
          <>
            <input
              ref={attachmentInput}
              type="file"
              multiple
              tabIndex={-1}
              aria-hidden
              className="sr-only"
              disabled={blocked || attachmentBudget <= 0}
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? []).filter((file) => {
                  const reason = attachmentRejectionReason(file.size)
                  if (reason) toast(`${file.name}: ${reason}`, 'error')
                  return !reason
                })
                if (picked.length > attachmentBudget) toast(`Maks ${MAX_POST_ATTACHMENTS} vedlegg per beskjed`, 'error')
                setAttachmentFiles((current) => [...current, ...picked.slice(0, Math.max(0, attachmentBudget))])
                event.target.value = ''
              }}
            />
            <ToolButton
              icon={<Glyph name="clip" />}
              title={attachmentHint}
              aria-label="Legg til vedlegg"
              disabled={blocked || attachmentBudget <= 0}
              onClick={() => attachmentInput.current?.click()}
            >
              Vedlegg
              {existingAttachments.length + attachmentFiles.length > 0 && (
                <span className="tabular text-xs text-ink-faint">
                  {existingAttachments.length + attachmentFiles.length}
                </span>
              )}
            </ToolButton>
          </>
        )}
        {format === 'markdown' && (
          <ToolButton icon={<Glyph name={preview ? 'pencil' : 'eye'} />} active={preview} aria-pressed={preview} onClick={() => setPreview(!preview)}>
            {preview ? 'Skriv' : 'Forhåndsvis'}
          </ToolButton>
        )}
        <ToolButton
          className="ml-auto min-w-0 shrink md:hidden"
          icon={<Glyph name="options" />}
          aria-expanded={optionsOpen}
          aria-controls="composer-valg"
          active={optionsOpen}
          onClick={() => {
            const opening = !optionsOpen
            setOptionsOpen(opening)
            // Valgene åpner seg under teksten — vis dem, i stedet for at de havner under bretten.
            if (opening) requestAnimationFrame(() => document.getElementById('composer-valg')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
          }}
        >
          Valg
          <span className="tool-summary">{optionsSummary}</span>
        </ToolButton>
      </div>
    </div>
  )

  const side = (
    <div className="space-y-5">
      {canPublish && (
        <Segmented
          legend="Avsender"
          name="post-sender"
          value={senderValue}
          options={[
            { value: 'member' as const, label: 'Meg' },
            ...(canBoard ? [{ value: 'board' as const, label: 'Styret' }] : []),
            { value: 'archive' as const, label: 'Notearkivar' },
          ]}
          onChange={(v) => {
            setOfficial(v === 'board')
            setFromArchive(v === 'archive')
          }}
          hint="Hvem beskjeden kommer fra. Navnet ditt følger innlegget."
        />
      )}
      {canPublish && (
        <Segmented
          legend="Hvem skal se det?"
          name="post-audience"
          value={audience}
          options={AUDIENCES.filter((a) => canBoard || a.value === 'all')}
          onChange={setAudience}
          hint={AUDIENCES.find((a) => a.value === audience)!.hint}
        />
      )}
      {canPublish && (
        <Segmented
          legend="Viktighet"
          name="post-importance"
          value={importance}
          options={IMPORTANCES}
          onChange={setImportance}
          hint={IMPORTANCES.find((i) => i.value === importance)!.hint}
        />
      )}
      <Segmented
        legend="Format på teksten"
        name="post-format"
        value={format}
        options={FORMATS}
        onChange={(value) => {
          setFormat(value)
          // «Forhåndsvis» gir ikke mening for rein tekst.
          if (value !== 'markdown') setPreview(false)
        }}
      />
      {!canPublish && (
        <p className="text-xs leading-snug text-ink-faint">
          Innlegget blir synlig for alle innloggede medlemmer{isPublished ? '' : ' når du publiserer'}.
        </p>
      )}
      {canPublish && isPublished && (
        <div className="border-t border-line pt-4">
          <p className="composer-label">Varsling</p>
          <p className="mb-3 text-xs leading-snug text-ink-faint">
            Endringer vises med det samme. Varsel går kun til dem som ikke allerede har fått det.
          </p>
          <Button type="button" size="sm" className="w-full" disabled={blocked} onClick={() => setConfirm(true)}>
            Lagre og varsle …
          </Button>
        </div>
      )}
    </div>
  )

  // Dialogene står UTENFOR skjemaet: en knapp uten `type` i et ark (som
  // lukkekrysset i `Modal`) ville ellers sendt skjemaet — «Lagre utkast».
  return (
    <>
    <form onSubmit={canPublish ? saveDraft : (e) => { e.preventDefault(); void publish() }} className="composer">
      <ComposerBar
        cancel={
          post ? (
            <Link to="/beskjeder/$postId" params={{ postId: post.id }} className="composer-cancel">
              Avbryt
            </Link>
          ) : (
            <Link to="/beskjeder" className="composer-cancel">
              Avbryt
            </Link>
          )
        }
        title={!post ? 'Nytt innlegg' : isPublished ? 'Rediger innlegg' : 'Rediger utkast'}
        actions={barActions}
        status={local.savedAt && dirty ? 'Lagret på enheten' : null}
      />

      <DraftNotice restored={local.restored} onDiscard={discardDraft} className="composer-notice" />

      {!post && savedPostId && (
        <p className="composer-notice">
          Beskjeden er lagret.{' '}
          <Link to="/beskjeder/$postId" params={{ postId: savedPostId }} className="link-brass">
            Åpne den lagrede beskjeden
          </Link>{' '}
          for å fortsette senere.
        </p>
      )}

      <ComposerLayout main={main} side={side} sideOpen={optionsOpen} sideLabel="Valg for innlegget" />
    </form>

      {draftKey && <LeaveGuard shouldBlock={() => dirtyRef.current && !leaving.current} onDiscard={() => local.discard()} />}

      {canPublish && (
        <Modal
          open={confirm}
          onClose={() => (busy === 'publish' ? undefined : setConfirm(false))}
          title={isPublished ? 'Lagre og varsle?' : 'Publisere innlegget?'}
          kicker="Veggen"
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-faint">Synlig for</dt>
            <dd className="text-ink">{audience === 'board' ? 'Bare styret' : 'Hele korpset'}</dd>
            <dt className="text-ink-faint">Avsender</dt>
            <dd className="text-ink">{senderLabel}</dd>
            <dt className="text-ink-faint">Viktighet</dt>
            <dd className="text-ink">{importance === 'important' ? 'Viktig' : 'Vanlig'}</dd>
          </dl>
          {/* Avslått som standard (#85, `DEFAULT_NOTIFY`): publisering og
              masseutsending er to bevisste handlinger. */}
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[11px] border border-line px-4 py-3">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brass)]"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              aria-describedby={notifyHintId}
            />
            <span>
              <span className="block text-sm font-medium text-ink">{notifyLabel(audience)}</span>
              <span id={notifyHintId} className="mt-0.5 block text-xs leading-snug text-ink-soft">
                Sender e-post, og varsel til dem som har slått på varsler på en enhet. Uten avkryssing
                {isPublished ? ' lagres endringene' : ' publiseres innlegget'} uten varsel.{' '}
                {audience === 'board'
                  ? 'Varselet går kun til dem som selv kan publisere beskjeder.'
                  : 'Varselet går til aktive medlemmer, etter varslingsvalget deres.'}{' '}
                Ingen får den samme beskjeden to ganger.
              </span>
            </span>
          </label>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setConfirm(false)} disabled={busy === 'publish'}>
              Avbryt
            </Button>
            <Button type="button" variant="primary" loading={busy === 'publish'} disabled={blocked} onClick={() => void publish()}>
              {isPublished ? (notify ? 'Lagre og varsle' : 'Lagre uten varsel') : notify ? 'Publiser og varsle' : 'Publiser uten varsel'}
            </Button>
          </div>
        </Modal>
      )}

      <Modal
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        title={confirmRemove?.kind === 'attachment' ? 'Fjerne vedlegget?' : 'Fjerne bildet?'}
      >
        <p className="text-sm leading-relaxed text-ink-soft">
          {confirmRemove?.kind === 'attachment' ? `«${confirmRemove.item.fileName}»` : 'Bildet'} slettes fra innlegget med en
          gang, også om du ikke lagrer endringene.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => setConfirmRemove(null)}>
            Avbryt
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              const target = confirmRemove
              setConfirmRemove(null)
              if (target?.kind === 'image') void removeExisting(target.item)
              else if (target?.kind === 'attachment') void removeExistingAttachment(target.item)
            }}
          >
            {confirmRemove?.kind === 'attachment' ? 'Fjern vedlegget' : 'Fjern bildet'}
          </Button>
        </div>
      </Modal>
    </>
  )
}
