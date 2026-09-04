import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { MAX_PART_SHARES, type PartShareRow } from '../lib/part-shares'
import { listPartShareOptions, removePartShare, sharePart } from '../server/part-shares'
import { toast, toastError } from './toast'
import { Button, Field, Kicker, Modal } from './ui'

type Options = Awaited<ReturnType<typeof listPartShareOptions>>

/**
 * Stemmedeling mellom medlemmer (#16), slik den ser ut på «Mine noter».
 *
 * Panelet er bevisst rolig og står under repertoaret: primærhandlingen på
 * `/noter` er fortsatt «åpne min stemme». Selve notene fra en mottatt deling
 * dukker opp der de hører hjemme — på verket, i «Delt med deg av …» — ikke her.
 * Her er det bare oversikten og de to knappene som endrer noe.
 *
 * All tilgangskontroll ligger server-side. Lista viser bare det serveren
 * allerede har bestemt at du skal se, og «Fjern» avvises av `removePartShare`
 * om du ikke er part i delingen.
 */
export function PartSharesPanel({
  given,
  received,
  meId,
  myPartCount,
}: {
  given: PartShareRow[]
  received: PartShareRow[]
  meId: string
  /** Har du ingen tildelt stemme, er det ingenting å dele — da vises ingen knapp. */
  myPartCount: number
}) {
  const [open, setOpen] = useState(false)

  // Et medlem uten tildelt stemme har ingenting å dele. Har hen heller ikke
  // fått noe delt, er panelet bare en tom boks — da vises det ikke i det hele
  // tatt. Har du en stemme, står det der selv om lista er tom: det er slik man
  // oppdager at man KAN dele.
  if (myPartCount === 0 && given.length === 0 && received.length === 0) return null

  return (
    <section className="rise" style={{ animationDelay: '160ms' }}>
      <div className="sheet overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line bg-paper-sunken/50 px-5 py-5 sm:px-6">
          <div>
            <Kicker className="mb-1.5">Stemmedeling</Kicker>
            <h2 className="display-title text-xl font-semibold text-ink sm:text-2xl">
              Del en stemme med et annet medlem
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
              Skal noe lavt i horn prøves på baryton? Del stemmen din, så finner hen notene
              under «Delt med deg» på sine egne noter. Delingen gir bare lesing av dine
              stemmefiler — ingenting annet — og begge kan fjerne den når som helst.
            </p>
          </div>
          {myPartCount > 0 && (
            <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
              Del en stemme
            </Button>
          )}
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-2">
          <ShareColumn
            title="Du deler"
            empty="Du deler ingen stemmer nå."
            rows={given}
            meId={meId}
            direction="given"
          />
          <ShareColumn
            title="Delt med deg"
            empty="Ingen har delt en stemme med deg."
            rows={received}
            meId={meId}
            direction="received"
          />
        </div>
      </div>

      {open && <ShareDialog onClose={() => setOpen(false)} />}
    </section>
  )
}

function ShareColumn({
  title,
  empty,
  rows,
  meId,
  direction,
}: {
  title: string
  empty: string
  rows: PartShareRow[]
  meId: string
  direction: 'given' | 'received'
}) {
  return (
    <div className="bg-paper-raised px-5 py-5 sm:px-6">
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-brass">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-faint">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li
              key={`${row.memberId}:${row.partId}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{row.partName}</span>
                <span className="block truncate text-xs text-ink-soft">
                  {direction === 'given' ? `til ${row.memberName}` : `fra ${row.memberName}`}
                </span>
              </span>
              <RemoveShareButton row={row} meId={meId} direction={direction} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RemoveShareButton({
  row,
  meId,
  direction,
}: {
  row: PartShareRow
  meId: string
  direction: 'given' | 'received'
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      await removePartShare({
        data: {
          fromUserId: direction === 'given' ? meId : row.memberId,
          toUserId: direction === 'given' ? row.memberId : meId,
          partId: row.partId,
        },
      })
      toast('Delingen er fjernet')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      loading={busy}
      onClick={() => void remove()}
      aria-label={`Fjern deling av ${row.partName} ${direction === 'given' ? 'til' : 'fra'} ${row.memberName}`}
    >
      Fjern
    </Button>
  )
}

/**
 * Dialogen. Valgmulighetene hentes først når den åpnes — medlemslista skal ikke
 * ligge i hver eneste lasting av «Mine noter».
 */
function ShareDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [options, setOptions] = useState<Options | null>(null)
  const [partId, setPartId] = useState('')
  const [toUserId, setToUserId] = useState('')
  const [busy, setBusy] = useState(false)

  // Lastes én gang, ved montering — dialogen monteres først når den åpnes.
  useEffect(() => {
    let alive = true
    void listPartShareOptions()
      .then((data) => {
        if (!alive) return
        setOptions(data)
        // Har du bare én stemme, er valget allerede tatt.
        if (data.myParts.length === 1) setPartId(data.myParts[0]!.id)
      })
      .catch((err) => {
        if (alive) toastError(err)
      })
    return () => {
      alive = false
    }
  }, [])

  const submit = async () => {
    if (!partId || !toUserId) return
    setBusy(true)
    try {
      await sharePart({ data: { partId, toUserId } })
      toast('Stemmen er delt')
      await router.invalidate()
      onClose()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Del en stemme" kicker="Stemmedeling">
      <div className="space-y-4">
        <Field label="Stemmen din" hint="Du kan bare dele stemmer du selv er tildelt.">
          <select
            className="field-input w-full"
            value={partId}
            onChange={(e) => setPartId(e.target.value)}
            disabled={!options}
          >
            <option value="">Velg stemme …</option>
            {options?.myParts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameNo}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Medlem" hint={`Du kan dele med maks ${MAX_PART_SHARES} medlemmer om gangen.`}>
          <select
            className="field-input w-full"
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            disabled={!options}
          >
            <option value="">Velg medlem …</option>
            {options?.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.partName ? ` · ${m.partName}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <p className="text-xs leading-relaxed text-ink-faint">
          Medlemmet får lese stemmefilene dine på de prosjektene som er publisert og ikke
          avholdt — det samme du selv ser. Ingen partitur, ingen arkivtilgang. Ingen e-post
          sendes; delingen dukker opp på «Mine noter» hos mottakeren.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!partId || !toUserId}
            onClick={() => void submit()}
          >
            Del stemmen
          </Button>
        </div>
      </div>
    </Modal>
  )
}
