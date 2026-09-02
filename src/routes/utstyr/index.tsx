import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { AssetForm, EMPTY_ASSET } from '../../components/AssetForm'
import { toast } from '../../components/toast'
import { Button, EmptyState, Kicker, Modal, Stamp } from '../../components/ui'
import { assetImageUrl } from '../../lib/utstyr-images-client'
import {
  type AssetSummary,
  OWNER_KINDS,
  OWNER_KIND_LABELS,
  type OwnerKind,
  compareAssets,
  filterAssets,
  isOwnerKind,
  loanStatus,
  ownerLabel,
} from '../../lib/utstyr'
import { toOsloDate } from '../../lib/format'
import { createAsset, listAssets } from '../../server/utstyr'

/**
 * Utstyrsregisteret (#13), oversikten.
 *
 * Primærbruker er materialforvalteren, og primærhandlingen «Registrer utstyr»
 * ligger i headeren — ett klikk fra første skjerm (docs/designprinsipper.md §3
 * pkt 4). Alle andre medlemmer leser: registeret svarer på «kven eiger denne?»
 * uten at man må spørre noen.
 *
 * Filtrene bor i søkeparametrene og valideres i `validateSearch`, slik at en
 * filtrert visning kan lenkes til fra et annet område (§4). Selve filtreringen
 * er de rene funksjonene i `src/lib/utstyr.ts` — hele lista lastes én gang, og
 * søket er dermed øyeblikkelig.
 */

type Search = {
  q?: string
  kategori?: string
  eier?: OwnerKind
  laant?: true
}

function str(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value.trim() : ''
  return s ? s.slice(0, 120) : undefined
}

export const Route = createFileRoute('/utstyr/')({
  validateSearch: (search: Record<string, unknown>): Search => {
    const eier = str(search.eier)
    return {
      q: str(search.q),
      kategori: str(search.kategori),
      eier: eier && isOwnerKind(eier) ? eier : undefined,
      laant: search.laant === true || search.laant === 'true' ? true : undefined,
    }
  },
  loader: () => listAssets(),
  component: AssetsPage,
})

function AssetsPage() {
  const { assets, canManage } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  const today = toOsloDate(Date.now())

  // Kategoriene som faktisk er i bruk — ikke forslagslista. Et filter på en
  // kategori ingen gjenstand har, ville alltid gitt en tom liste.
  const categories = useMemo(
    () => [...new Set(assets.map((a) => a.category?.trim()).filter((c): c is string => !!c))].sort((a, b) =>
      a.localeCompare(b, 'nb'),
    ),
    [assets],
  )

  const visible = useMemo(
    () =>
      filterAssets(assets, {
        q: search.q,
        category: search.kategori ?? null,
        ownerKind: search.eier ?? null,
        onLoan: search.laant,
      }).sort(compareAssets),
    [assets, search.q, search.kategori, search.eier, search.laant],
  )

  const setSearch = (patch: Partial<Search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const filtered = Boolean(search.q || search.kategori || search.eier || search.laant)

  return (
    <div className="space-y-8">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker className="mb-2">Materialforvaltning</Kicker>
          <h1 className="display-title text-4xl font-semibold italic text-ink sm:text-5xl">Utstyr</h1>
          <p className="mt-2 max-w-lg text-sm text-ink-soft">
            Hva korpset har, hvem som eier det, og hva som er lånt inn.
          </p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            Registrer utstyr
          </Button>
        )}
      </header>

      <div className="sheet rise space-y-4 p-4 sm:p-5" style={{ animationDelay: '60ms' }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-1">
            <span className="sr-only">Søk i utstyret</span>
            <input
              className="field-input"
              type="search"
              placeholder="Søk på navn, produsent eller serienummer …"
              value={search.q ?? ''}
              onChange={(e) => setSearch({ q: e.target.value.trim() || undefined })}
            />
          </label>
          <label className="block">
            <span className="sr-only">Kategori</span>
            <select
              className="field-input"
              value={search.kategori ?? ''}
              onChange={(e) => setSearch({ kategori: e.target.value || undefined })}
            >
              <option value="">Alle kategorier</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">Eier</span>
            <select
              className="field-input"
              value={search.eier ?? ''}
              onChange={(e) => {
                const value = e.target.value
                setSearch({ eier: isOwnerKind(value) ? value : undefined })
              }}
            >
              <option value="">Alle eiere</option>
              {OWNER_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {OWNER_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              className="accent-[var(--brass)]"
              checked={search.laant ?? false}
              onChange={(e) => setSearch({ laant: e.target.checked ? true : undefined })}
            />
            Bare det som er lånt inn
          </label>
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-ink-faint">
            {visible.length === assets.length
              ? `${assets.length} gjenstander`
              : `${visible.length} av ${assets.length}`}
          </p>
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="sheet rise" style={{ animationDelay: '100ms' }}>
          <EmptyState
            title="Registeret er tomt"
            action={
              canManage ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Registrer den første
                </Button>
              ) : undefined
            }
          >
            Her kommer instrumentene, transportkassene og notestativene — med bilde, eier og lånestatus.
          </EmptyState>
        </div>
      ) : visible.length === 0 ? (
        <div className="sheet rise" style={{ animationDelay: '100ms' }}>
          <EmptyState
            title="Ingen treff"
            action={
              filtered ? (
                <Button onClick={() => navigate({ search: {} })}>Nullstill filtrene</Button>
              ) : undefined
            }
          >
            Prøv et annet søkeord, eller fjern et filter.
          </EmptyState>
        </div>
      ) : (
        <ul className="rise grid gap-4 sm:grid-cols-2 lg:grid-cols-3" style={{ animationDelay: '100ms' }}>
          {visible.map((asset) => (
            <li key={asset.id}>
              <AssetCard asset={asset} today={today} />
            </li>
          ))}
        </ul>
      )}

      {/* Skjemaet finnes ikke i DOM-en for en som bare leser. `Modal` rendrer
          barna sine også når den er lukket, og et helt registreringsskjema er
          ikke noe en leser skal laste ned for å ikke kunne bruke det. */}
      {canManage && (
        <Modal
          open={creating}
          onClose={() => setCreating(false)}
          title="Registrer utstyr"
          kicker="Nytt i registeret"
          wide
          mobileFull
        >
          <p className="mb-5 text-sm text-ink-soft">
            Navnet er det eneste som må fylles ut. Bilder legges til på siden til gjenstanden etterpå.
          </p>
          <AssetForm
            initial={EMPTY_ASSET}
            // Eier-velgeren trenger medlemslista; den følger med detaljsiden, så
            // her holder det med de to organisasjonene og fritekst. Skal du koble
            // et medlem, gjør du det på siden til gjenstanden.
            memberOptions={[]}
            submitLabel="Registrer"
            onCancel={() => setCreating(false)}
            onSubmit={async (values) => {
              const created = await createAsset({ data: { ...values, ownerKind: values.ownerKind as OwnerKind } })
              toast('Gjenstanden er registrert')
              setCreating(false)
              await router.invalidate()
              await navigate({ to: '/utstyr/$assetId', params: { assetId: created.id }, search: {} })
            }}
          />
        </Modal>
      )}
    </div>
  )
}

function AssetCard({
  asset,
  today,
}: {
  asset: AssetSummary & { coverImageId: string | null; loanFrom: string | null; loanUntil: string | null }
  today: string
}) {
  const loan = loanStatus(asset, today)
  const subtitle = [asset.manufacturer, asset.model].filter(Boolean).join(' ')

  return (
    <Link
      to="/utstyr/$assetId"
      params={{ assetId: asset.id }}
      className="sheet sheet-hover link-quiet flex h-full gap-4 overflow-hidden p-3"
    >
      <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-paper-sunken">
        {asset.coverImageId ? (
          <img
            src={assetImageUrl(asset.coverImageId)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink-faint">Uten bilde</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">{asset.name}</p>
        {subtitle && <p className="truncate text-[0.8rem] text-ink-soft">{subtitle}</p>}
        <p className="mt-1 truncate text-[0.8rem] text-ink-faint">{ownerLabel(asset)}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {asset.category && <Stamp>{asset.category}</Stamp>}
          {loan.onLoan && (
            <Stamp tone={loan.expired ? 'oxblood' : 'brass'} title={`Lånt av ${loan.from}`}>
              {loan.expired ? 'Lån utløpt' : 'Lånt inn'}
            </Stamp>
          )}
        </div>
      </div>
    </Link>
  )
}
