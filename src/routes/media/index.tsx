import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import { EMPTY_MEDIA, MediaForm, type ProjectOption } from '../../components/MediaForm'
import { toast, toastError } from '../../components/toast'
import { Button, EmptyState, Field, Kicker, Modal, Stamp } from '../../components/ui'
import { formatDate } from '../../lib/format'
import {
  MAX_MEDIA_MB,
  MEDIA_KINDS,
  MEDIA_KIND_LABELS,
  MEDIA_VISIBILITIES,
  type MediaKind,
  type MediaVisibility,
  VISIBILITY_LABELS,
  compareMedia,
  filterMedia,
  isMediaKind,
  isMediaVisibility,
  mediaRejectionReason,
} from '../../lib/media'
import { mediaFileUrl, uploadMediaFile } from '../../lib/media-client'
import { listMedia, updateMedia } from '../../server/media'

/**
 * Mediearkivet (#32), oversikten.
 *
 * Området heter **Media** — samme ord i URL-en, overskriften og hub-kortet
 * (docs/designprinsipper.md §1). «Opptak» ble vurdert, men arkivet inneholder
 * også PR-bilder og video fra prosjekter, og ordet ville vært feil på to av tre
 * skjermer.
 *
 * Primærbruker er den som forvalter korpsets opptak, og primærhandlingen «Legg
 * inn media» ligger i headeren — ett klikk fra første skjerm (§3 pkt 4). Alle
 * andre medlemmer leser og lytter; det er derfor lesing bare krever innlogging.
 *
 * Filtrene bor i søkeparametrene og valideres i `validateSearch`, slik at et
 * prosjekt eller et verk kan lenke inn i en ferdig filtrert visning (§4).
 * Selve filtreringen er de rene funksjonene i `src/lib/media.ts`.
 */

type Search = {
  q?: string
  type?: MediaKind
  tilgang?: MediaVisibility
  prosjekt?: string
  verk?: string
}

function str(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value.trim() : ''
  return s ? s.slice(0, 120) : undefined
}

export const Route = createFileRoute('/media/')({
  validateSearch: (search: Record<string, unknown>): Search => {
    const type = str(search.type)
    const tilgang = str(search.tilgang)
    return {
      q: str(search.q),
      type: type && isMediaKind(type) ? type : undefined,
      tilgang: tilgang && isMediaVisibility(tilgang) ? tilgang : undefined,
      prosjekt: str(search.prosjekt),
      verk: str(search.verk),
    }
  },
  loader: () => listMedia(),
  component: MediaPage,
})

function MediaPage() {
  const { items, canManage, projectOptions, visibilities } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [creating, setCreating] = useState(false)

  const visible = useMemo(
    () =>
      filterMedia(items, {
        q: search.q,
        kind: search.type ?? null,
        visibility: search.tilgang ?? null,
        projectId: search.prosjekt ?? null,
        workId: search.verk ?? null,
      }).sort(compareMedia),
    [items, search.q, search.type, search.tilgang, search.prosjekt, search.verk],
  )

  const setSearch = (patch: Partial<Search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const filtered = Boolean(search.q || search.type || search.tilgang || search.prosjekt || search.verk)

  return (
    <div className="space-y-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker className="mb-2">Mediearkiv</Kicker>
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Media</h1>
          <p className="mt-2 max-w-lg text-sm text-ink-soft">
            Korpsets egne opptak, bilder og video — fra øvingsrommet til konsertscenen.
          </p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            Legg inn media
          </Button>
        )}
      </header>

      <div className="sheet rise space-y-4 p-4 sm:p-5" style={{ animationDelay: '60ms' }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="sr-only">Søk i mediearkivet</span>
            <input
              className="field-input"
              type="search"
              placeholder="Søk på tittel, prosjekt eller verk …"
              value={search.q ?? ''}
              onChange={(e) => setSearch({ q: e.target.value.trim() || undefined })}
            />
          </label>
          <label className="block">
            <span className="sr-only">Type</span>
            <select
              className="field-input"
              value={search.type ?? ''}
              onChange={(e) => {
                const value = e.target.value
                setSearch({ type: isMediaKind(value) ? value : undefined })
              }}
            >
              <option value="">Alle typer</option>
              {MEDIA_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {MEDIA_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">Tilgangsnivå</span>
            <select
              className="field-input"
              value={search.tilgang ?? ''}
              onChange={(e) => {
                const value = e.target.value
                setSearch({ tilgang: isMediaVisibility(value) ? value : undefined })
              }}
            >
              <option value="">Alle tilgangsnivåer</option>
              {MEDIA_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABELS[v]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {filtered ? (
            <Button size="sm" variant="ghost" onClick={() => navigate({ search: {} })}>
              Nullstill filtrene
            </Button>
          ) : (
            <span />
          )}
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-ink-faint">
            {visible.length === items.length ? `${items.length} elementer` : `${visible.length} av ${items.length}`}
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="sheet rise" style={{ animationDelay: '100ms' }}>
          <EmptyState
            title="Arkivet er tomt"
            action={
              canManage ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Legg inn det første
                </Button>
              ) : undefined
            }
          >
            Her kommer øvingsopptakene, konsertopptakene og bildene — knyttet til prosjektet eller verket de hører til.
          </EmptyState>
        </div>
      ) : visible.length === 0 ? (
        <div className="sheet rise" style={{ animationDelay: '100ms' }}>
          <EmptyState
            title="Ingen treff"
            action={filtered ? <Button onClick={() => navigate({ search: {} })}>Nullstill filtrene</Button> : undefined}
          >
            Prøv et annet søkeord, eller fjern et filter.
          </EmptyState>
        </div>
      ) : (
        <ul className="rise grid gap-4 sm:grid-cols-2 lg:grid-cols-3" style={{ animationDelay: '100ms' }}>
          {visible.map((item) => (
            <li key={item.id}>
              <MediaCard item={item} />
            </li>
          ))}
        </ul>
      )}

      {/* Skjemaet finnes ikke i DOM-en for en som bare leser: `Modal` rendrer
          barna sine også når den er lukket, og et helt opplastingsskjema er
          ikke noe en leser skal laste ned for å ikke kunne bruke det. */}
      {canManage && (
        <NewMediaDialog
          open={creating}
          onClose={() => setCreating(false)}
          visibilities={visibilities}
          projectOptions={projectOptions}
        />
      )}
    </div>
  )
}

/** Merket som gjør et element gjenkjennelig i lista uten å åpne det. */
const KIND_MARK: Record<MediaKind, string> = { lyd: '♪', bilde: '▣', video: '▶' }

function MediaCard({
  item,
}: {
  item: {
    id: string
    title: string
    kind: MediaKind
    visibility: MediaVisibility
    recordedOn: string | null
    projectName: string | null
    workTitle: string | null
  }
}) {
  const context = [item.projectName, item.workTitle].filter(Boolean).join(' · ')
  return (
    <Link
      to="/media/$mediaId"
      params={{ mediaId: item.id }}
      className="sheet sheet-hover link-quiet flex h-full gap-4 overflow-hidden p-3"
    >
      <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-paper-sunken">
        {item.kind === 'bilde' ? (
          // Full oppløsning i en 80 px rute. Kjent hull: vi lager ingen
          // miniatyrer, så en lang liste med bilder er tung på mobil.
          // `loading="lazy"` gjør at bare det som er på skjermen hentes.
          <img src={mediaFileUrl(item.id)} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="text-2xl text-ink-faint" aria-hidden>
            {KIND_MARK[item.kind]}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">{item.title}</p>
        <p className="truncate text-[0.8rem] text-ink-soft">
          {item.recordedOn ? formatDate(item.recordedOn) : 'Uten dato'}
        </p>
        {context && <p className="mt-1 truncate text-[0.8rem] text-ink-faint">{context}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Stamp>{MEDIA_KIND_LABELS[item.kind]}</Stamp>
          {item.visibility === 'styre' && <Stamp tone="oxblood">Bare styret</Stamp>}
          {item.visibility === 'offentlig-kandidat' && <Stamp tone="brass">Kandidat utad</Stamp>}
        </div>
      </div>
    </Link>
  )
}

/**
 * Opprettelsen: fil + opplysninger i én dialog, to kall til serveren.
 *
 * Filen lastes opp først (`PUT /api/media/upload`, som oppretter raden), og
 * opplysningene lagres rett etterpå med `updateMedia`. Rekkefølgen er valgt
 * fordi den ikke kan etterlate et element uten fil — se begrunnelsen i
 * opplastingsruta. Feiler det andre kallet, står elementet igjen med filnavnet
 * som tittel, og vi sender brukeren til detaljsiden der det kan rettes.
 */
function NewMediaDialog({
  open,
  onClose,
  visibilities,
  projectOptions,
}: {
  open: boolean
  onClose: () => void
  visibilities: MediaVisibility[]
  projectOptions: ProjectOption[]
}) {
  const router = useRouter()
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const close = () => {
    setFile(null)
    setFileError(null)
    if (inputRef.current) inputRef.current.value = ''
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title="Legg inn media" kicker="Nytt i arkivet" wide mobileFull>
      <p className="mb-5 text-sm text-ink-soft">
        Lyd, bilde eller video — maks {MAX_MEDIA_MB} MB per fil. Typen leses av filen, så den kan ikke bli feil.
      </p>
      <MediaForm
        initial={{ ...EMPTY_MEDIA, visibility: visibilities[0] ?? 'intern' }}
        visibilities={visibilities}
        projectOptions={projectOptions}
        submitLabel="Last opp"
        busyLabel="Laster opp …"
        onCancel={close}
        fileField={
          <Field
            label="Fil"
            hint={`Lyd (MP3, M4A, WAV, FLAC), bilde (JPG, PNG, WebP, HEIC) eller video (MP4, WebM, MOV). Maks ${MAX_MEDIA_MB} MB.`}
          >
            <input
              ref={inputRef}
              className="field-input"
              type="file"
              accept="audio/*,image/*,video/*"
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null
                // Sjekken her er ikke sikkerhet — den ligger server-side — men
                // forskjellen på en beskjed og en gåte: en fil over
                // Workers-taket blir ellers en nettverksfeil uten forklaring.
                const reason = picked ? mediaRejectionReason({ type: picked.type, size: picked.size }) : null
                setFileError(reason)
                setFile(reason ? null : picked)
              }}
              required
            />
            {fileError && <span className="mt-1 block text-xs text-danger">{fileError}</span>}
          </Field>
        }
        onSubmit={async (values) => {
          if (!file) {
            toastError(new Error('Velg en fil først'))
            return
          }
          const created = await uploadMediaFile(file, values.visibility)
          try {
            await updateMedia({
              data: {
                id: created.id,
                title: values.title.trim() || created.title,
                recordedOn: values.recordedOn || null,
                description: values.description || null,
                visibility: values.visibility,
                projectId: values.projectId || null,
                workId: values.workId || null,
              },
            })
            toast('Media er lagt inn')
          } catch (err) {
            // Filen ligger der, raden finnes — bare opplysningene manglet.
            // Brukeren skal vite begge deler, ikke tro at alt gikk tapt.
            toastError(err)
          }
          close()
          await router.invalidate()
          await navigate({ to: '/media/$mediaId', params: { mediaId: created.id } })
        }}
      />
    </Modal>
  )
}
