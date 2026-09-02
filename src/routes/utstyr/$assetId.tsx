import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { AssetForm, type AssetFormValues } from '../../components/AssetForm'
import { toast, toastError } from '../../components/toast'
import { Button, EmptyState, Kicker, Modal, SectionHeading, Stamp } from '../../components/ui'
import { formatDate, toOsloDate } from '../../lib/format'
import { assetImageUrl, uploadAssetImages } from '../../lib/utstyr-images-client'
import {
  type AssetProjectLink,
  type AssetUsage,
  MAX_ASSET_IMAGES,
  USAGE_LABELS,
  type OwnerKind,
  lastUsedLink,
  loanStatus,
  ownerLabel,
  plannedLinks,
} from '../../lib/utstyr'
import {
  deleteAsset,
  deleteAssetImage,
  getAsset,
  linkAssetProject,
  unlinkAssetProject,
  updateAsset,
} from '../../server/utstyr'

/**
 * Én gjenstand i utstyrsregisteret (#13): bildene, opplysningene, lånestatusen
 * og koblingene til prosjekt.
 *
 * Alt på siden er lesbart for et hvilket som helst aktivt medlem. Knappene som
 * endrer noe vises kun ved `assets.manage` — og det er kosmetikk: hver
 * serverfunksjon i `src/server/utstyr.ts` går gjennom `requirePermission()`.
 */
export const Route = createFileRoute('/utstyr/$assetId')({
  loader: ({ params }) => getAsset({ data: { id: params.assetId } }),
  component: AssetPage,
})

function AssetPage() {
  const { asset, images, links, memberOptions, projectOptions, canManage } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const today = toOsloDate(Date.now())
  const loan = loanStatus(asset, today)
  const planned = plannedLinks(links)
  const lastUsed = lastUsedLink(links)

  const initial: AssetFormValues = {
    name: asset.name,
    category: asset.category ?? '',
    manufacturer: asset.manufacturer ?? '',
    model: asset.model ?? '',
    serialNumber: asset.serialNumber ?? '',
    ownerKind: asset.ownerKind,
    ownerUserId: asset.ownerUserId ?? '',
    ownerName: asset.ownerName ?? '',
    loanedFrom: asset.loanedFrom ?? '',
    loanFrom: asset.loanFrom ?? '',
    loanUntil: asset.loanUntil ?? '',
    notes: asset.notes ?? '',
  }

  return (
    <div className="space-y-9">
      <div className="rise">
        <Link to="/utstyr" search={{}} className="link-quiet text-sm text-ink-faint hover:text-ink">
          ← Utstyr
        </Link>
      </div>

      <header className="rise flex flex-wrap items-end justify-between gap-4" style={{ animationDelay: '40ms' }}>
        <div>
          <Kicker className="mb-2">{asset.category ?? 'Uten kategori'}</Kicker>
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">{asset.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Stamp>{ownerLabel(asset)}</Stamp>
            {loan.onLoan && (
              <Stamp tone={loan.expired ? 'oxblood' : 'brass'}>
                {loan.expired ? 'Lån utløpt' : 'Lånt inn'}
              </Stamp>
            )}
          </div>
        </div>
        {canManage && !editing && (
          <div className="flex gap-2">
            <Button onClick={() => setEditing(true)}>Rediger</Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Slett
            </Button>
          </div>
        )}
      </header>

      {editing ? (
        <section className="sheet rise p-5 sm:p-6">
          <SectionHeading kicker="Endre" title="Opplysninger" className="mb-5" />
          <AssetForm
            initial={initial}
            memberOptions={memberOptions}
            submitLabel="Lagre"
            onCancel={() => setEditing(false)}
            onSubmit={async (values) => {
              await updateAsset({ data: { id: asset.id, ...values, ownerKind: values.ownerKind as OwnerKind } })
              toast('Lagret')
              setEditing(false)
              await router.invalidate()
            }}
          />
        </section>
      ) : (
        <>
          <ImageSection assetId={asset.id} images={images} canManage={canManage} />

          <section className="sheet rise p-5 sm:p-6" style={{ animationDelay: '80ms' }}>
            <SectionHeading kicker="Fakta" title="Opplysninger" className="mb-5" />
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <Fact label="Produsent" value={asset.manufacturer} />
              <Fact label="Modell" value={asset.model} />
              <Fact label="Serienummer" value={asset.serialNumber} mono />
              <Fact label="Eier" value={ownerLabel(asset)} />
              {loan.onLoan && (
                <>
                  <Fact label="Lånt av" value={loan.from} />
                  <Fact label="Låneperiode" value={loan.period ?? 'Ikke oppgitt'} />
                </>
              )}
            </dl>
            {asset.notes && (
              <div className="mt-6 border-t border-line pt-5">
                <p className="mb-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint">Notat</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{asset.notes}</p>
              </div>
            )}
          </section>

          <ProjectSection
            assetId={asset.id}
            planned={planned}
            lastUsed={lastUsed}
            links={links}
            projectOptions={projectOptions}
            canManage={canManage}
          />
        </>
      )}

      {/* `Modal` rendrer barna sine også når den er lukket. Slettedialogen skal
          derfor ikke engang finnes i DOM-en for en som bare leser. */}
      {canManage && (
        <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette gjenstanden?">
          <p className="text-sm text-ink-soft">
            «{asset.name}» fjernes fra registeret, sammen med bildene og koblingene til prosjekt. Dette kan ikke angres.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setConfirmDelete(false)}>Avbryt</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await deleteAsset({ data: { id: asset.id } })
                  toast('Gjenstanden er slettet')
                  await navigate({ to: '/utstyr', search: {} })
                } catch (err) {
                  toastError(err)
                }
              }}
            >
              Slett
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Fact({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint">{label}</dt>
      <dd className={`mt-1 text-sm text-ink ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</dd>
    </div>
  )
}

/**
 * Bildene. Opplastingen er én PUT per fil mot `/api/utstyr-images/upload`
 * (`uploadAssetImages`), og visningen går alltid gjennom den gatede ruta —
 * aldri direkte mot R2.
 */
function ImageSection({
  assetId,
  images,
  canManage,
}: {
  assetId: string
  images: Array<{ id: string; fileName: string }>
  canManage: boolean
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ id: string; fileName: string } | null>(null)
  const full = images.length >= MAX_ASSET_IMAGES

  return (
    <section className="sheet rise p-5 sm:p-6" style={{ animationDelay: '60ms' }}>
      <SectionHeading
        kicker="Bilder"
        title="Slik ser den ut"
        className="mb-5"
        action={
          canManage ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])]
                  e.target.value = ''
                  if (files.length === 0) return
                  setBusy(true)
                  try {
                    await uploadAssetImages(assetId, files.slice(0, MAX_ASSET_IMAGES - images.length))
                    await router.invalidate()
                  } catch (err) {
                    toastError(err)
                  } finally {
                    setBusy(false)
                  }
                }}
              />
              <Button
                onClick={() => fileRef.current?.click()}
                loading={busy}
                disabled={full}
                title={full ? `Maks ${MAX_ASSET_IMAGES} bilder` : undefined}
              >
                Legg til bilde
              </Button>
            </>
          ) : undefined
        }
      />

      {images.length === 0 ? (
        <p className="text-sm text-ink-faint">
          Ingen bilder ennå. Et bilde er det som gjør en gjenstand gjenkjennelig — vi merker den ikke med
          klistremerker.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image) => (
            <li key={image.id} className="group relative">
              <a href={assetImageUrl(image.id)} target="_blank" rel="noreferrer" className="block">
                <img
                  src={assetImageUrl(image.id)}
                  alt={image.fileName}
                  loading="lazy"
                  className="aspect-4/3 w-full rounded-lg border border-line object-cover"
                />
              </a>
              {canManage && (
                <button
                  onClick={() => setPending(image)}
                  aria-label={`Fjern ${image.fileName}`}
                  className="absolute right-1.5 top-1.5 grid h-7 w-7 cursor-pointer place-items-center rounded-full border border-line bg-paper-raised/90 text-ink-faint opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <Modal open={pending !== null} onClose={() => setPending(null)} title="Fjerne bildet?">
          <p className="text-sm text-ink-soft">«{pending?.fileName}» slettes også fra lageret.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setPending(null)}>Avbryt</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!pending) return
                try {
                  await deleteAssetImage({ data: { id: pending.id } })
                  setPending(null)
                  await router.invalidate()
                } catch (err) {
                  toastError(err)
                }
              }}
            >
              Fjern
            </Button>
          </div>
        </Modal>
      )}
    </section>
  )
}

/**
 * Koblingen til prosjekt: «skal brukes til» og «brukt på». Riggelister (#12) er
 * bevisst IKKE bygget her — de kommer som egen sak og skal kunne referere
 * gjenstanden direkte, uten å endre denne modellen.
 */
function ProjectSection({
  assetId,
  planned,
  lastUsed,
  links,
  projectOptions,
  canManage,
}: {
  assetId: string
  planned: AssetProjectLink[]
  lastUsed: AssetProjectLink | null
  links: AssetProjectLink[]
  projectOptions: Array<{ id: string; name: string; eventDate: string | null }>
  canManage: boolean
}) {
  const router = useRouter()
  const [projectId, setProjectId] = useState('')
  const [usage, setUsage] = useState<AssetUsage>('planned')
  const [saving, setSaving] = useState(false)

  const linkedIds = new Set(links.map((l) => l.projectId))
  const available = projectOptions.filter((p) => !linkedIds.has(p.id))
  const used = links.filter((l) => l.usage === 'used')

  return (
    <section className="sheet rise p-5 sm:p-6" style={{ animationDelay: '100ms' }}>
      <SectionHeading kicker="Bruk" title="Prosjekter" className="mb-5" />

      {links.length === 0 ? (
        <EmptyState title="Ikke koblet til noe prosjekt">
          Koble gjenstanden til konserten den skal brukes på, så vet neste materialforvalter hvor den var sist.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {lastUsed && (
            <div>
              <p className="mb-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint">Sist brukt på</p>
              <ProjectRow link={lastUsed} assetId={assetId} canManage={canManage} />
            </div>
          )}
          {planned.length > 0 && (
            <div>
              <p className="mb-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint">
                {USAGE_LABELS.planned}
              </p>
              <ul className="space-y-2">
                {planned.map((l) => (
                  <li key={l.projectId}>
                    <ProjectRow link={l} assetId={assetId} canManage={canManage} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {used.length > 0 && (
            <div>
              <p className="mb-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint">
                Historikk
              </p>
              <ul className="space-y-2">
                {used.map((l) => (
                  <li key={l.projectId}>
                    <ProjectRow link={l} assetId={assetId} canManage={canManage} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {canManage && (
        <form
          className="mt-6 flex flex-wrap items-end gap-2 border-t border-line pt-5"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!projectId) return
            setSaving(true)
            try {
              await linkAssetProject({ data: { assetId, projectId, usage, note: null } })
              setProjectId('')
              await router.invalidate()
            } catch (err) {
              toastError(err)
            } finally {
              setSaving(false)
            }
          }}
        >
          <label className="min-w-48 flex-1">
            <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-soft">Koble til prosjekt</span>
            <select className="field-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Velg prosjekt …</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.eventDate ? ` · ${formatDate(p.eventDate)}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-40">
            <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-soft">Hvordan</span>
            <select
              className="field-input"
              value={usage}
              onChange={(e) => setUsage(e.target.value === 'used' ? 'used' : 'planned')}
            >
              <option value="planned">{USAGE_LABELS.planned}</option>
              <option value="used">{USAGE_LABELS.used}</option>
            </select>
          </label>
          <Button type="submit" variant="primary" loading={saving} disabled={!projectId}>
            Koble
          </Button>
        </form>
      )}
    </section>
  )
}

function ProjectRow({
  link,
  assetId,
  canManage,
}: {
  link: AssetProjectLink
  assetId: string
  canManage: boolean
}) {
  const router = useRouter()
  return (
    <div className="hairline-row flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        {/* Krysslenke til den konkrete ressursen, ikke til prosjektoversikten
            (docs/designprinsipper.md §4). */}
        <Link
          to="/noter/prosjekter/$projectId"
          params={{ projectId: link.projectId }}
          className="link-brass text-sm font-medium"
        >
          {link.projectName}
        </Link>
        {link.eventDate && <span className="ml-2 text-[0.8rem] text-ink-faint">{formatDate(link.eventDate)}</span>}
        {link.note && <p className="text-[0.8rem] text-ink-soft">{link.note}</p>}
      </div>
      {canManage && (
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await unlinkAssetProject({ data: { assetId, projectId: link.projectId } })
              await router.invalidate()
            } catch (err) {
              toastError(err)
            }
          }}
        >
          Fjern
        </Button>
      )}
    </div>
  )
}
