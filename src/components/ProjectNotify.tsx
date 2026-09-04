import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { formatDateTime } from '../lib/format'
import {
  DEFAULT_PROJECT_NOTIFY,
  PROJECT_NOTIFY_LABEL,
  pendingChangesLabel,
  projectNotifyMessage,
} from '../lib/project-notify'
import {
  getProject,
  publishProject,
  resendProjectNotifications,
  sendProjectUpdate,
} from '../server/projects'
import { toast, toastError } from './toast'
import { Button, Kicker, Modal } from './ui'

/**
 * Varslingsstatusen slik prosjektsiden faktisk får den. Typen utledes av
 * loaderen og ikke av `src/server/project-notify.ts`: den modulen har levende
 * eksport som rører `cloudflare:workers`, og en komponent skal ikke importere
 * fra den i det hele tatt — heller ikke en type, som en senere redigering kan
 * gjøre om til et verdi-import ved et uhell.
 */
type ProjectNotifyState = NonNullable<Awaited<ReturnType<typeof getProject>>['notify']>

/**
 * Varslingsflaten på prosjektsiden (#18 + #51) — kun for `projects.manage`.
 *
 * Den svarer på tre spørsmål den som publiserer faktisk stiller: har medlemmene
 * fått vite om prosjektet, mangler noen det, og er det noe nytt siden sist som
 * er verdt en e-post? Leveringstallene er de samme som på veggens detaljside, og
 * `logged` presenteres aldri som «sendt».
 */
export function ProjectNotifySection({
  projectId,
  state,
}: {
  projectId: string
  state: ProjectNotifyState
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'resend' | 'update' | null>(null)
  const { published } = state
  const hasChanges = state.changeLines.length > 0

  const act = async (kind: 'resend' | 'update', fn: () => Promise<void>) => {
    setBusy(kind)
    try {
      await fn()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const resend = () =>
    act('resend', async () => {
      const result = await resendProjectNotifications({ data: { id: projectId } })
      const { message, kind } = projectNotifyMessage(result, 'Publiseringsvarsel')
      toast(message, kind)
      await router.invalidate()
    })

  const sendUpdate = () =>
    act('update', async () => {
      const result = await sendProjectUpdate({ data: { id: projectId } })
      const { message, kind } = projectNotifyMessage(result, 'Oppdateringsvarsel')
      toast(message, kind)
      await router.invalidate()
    })

  return (
    <section className="sheet rise space-y-4 px-5 py-5" style={{ animationDelay: '180ms' }}>
      <div>
        <Kicker className="mb-1">Varsling</Kicker>
        <p className="text-sm leading-relaxed text-ink-soft">
          E-post: {published.sent} sendt
          {published.logged > 0 ? ` · ${published.logged} loggført lokalt` : ''}
          {published.failed > 0 ? ` · ${published.failed} feilet` : ''}
          {published.pending > 0
            ? ` · ${published.pending} mangler publiseringsvarselet`
            : ' · alle mottakere har fått publiseringsvarselet'}
          .
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
          {pendingChangesLabel(state.changeCount)}
          {state.lastUpdateAt
            ? ` · forrige oppdateringsvarsel ${formatDateTime(state.lastUpdateAt)}`
            : ' · ingen oppdateringsvarsel er sendt ennå'}
          .
        </p>
      </div>

      {/* Nøyaktig det mottakerne kommer til å lese. Uten forhåndsvisningen ville
          «Send oppdateringsvarsel» vært en knapp man trykker i blinde. */}
      {hasChanges && (
        <div className="rounded-[10px] border border-line bg-paper-sunken/50 px-4 py-3">
          <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink-faint">
            Dette blir sendt
          </p>
          <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-ink-soft">
            {state.changeLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {state.moreChanges > 0 && (
            <p className="mt-2 text-xs text-ink-faint">
              … og {state.moreChanges} {state.moreChanges === 1 ? 'endring' : 'endringer'} til.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          loading={busy === 'update'}
          disabled={!hasChanges}
          onClick={() => void sendUpdate()}
        >
          Send oppdateringsvarsel
        </Button>
        <Button loading={busy === 'resend'} disabled={published.pending === 0} onClick={() => void resend()}>
          Send publiseringsvarsel på nytt
        </Button>
      </div>

      <p className="text-xs leading-relaxed text-ink-faint">
        {hasChanges
          ? `Oppdateringsvarselet går til alle ${state.updateRecipients} som vil ha prosjektvarsler, som ÉN e-post med alt som er nytt.`
          : 'Endringer i repertoar og tidsplan lagres stille. Når noe er verdt å si fra om, samles alt her.'}{' '}
        «Send på nytt» går bare til dem som mangler publiseringsvarselet — ingen får det to ganger.
      </p>
    </section>
  )
}

/**
 * Publiseringsdialogen. Avkryssingen for e-post er AVSLÅTT som standard
 * (`DEFAULT_PROJECT_NOTIFY`): å publisere og å sende e-post til hele korpset er
 * to forskjellige handlinger, og bare den ene kan angres.
 */
export function PublishProjectModal({
  open,
  onClose,
  projectId,
  projectName,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  projectName: string
}) {
  const router = useRouter()
  const [notify, setNotify] = useState(DEFAULT_PROJECT_NOTIFY)
  const [busy, setBusy] = useState(false)

  const publish = async () => {
    setBusy(true)
    try {
      const result = await publishProject({ data: { id: projectId, notify } })
      const { message, kind } = projectNotifyMessage(result, 'Prosjektet er publisert')
      onClose()
      setNotify(DEFAULT_PROJECT_NOTIFY)
      toast(notify ? message : 'Publisert! Medlemmene ser prosjektet nå', notify ? kind : 'ok')
      await router.invalidate()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Publisere prosjektet?"
      kicker={projectName}
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        Prosjektet blir synlig for alle medlemmer med det samme, og dukker opp under «Mine noter» for dem som har en
        stemme i programmet.
      </p>
      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brass)]"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium text-ink">{PROJECT_NOTIFY_LABEL}</span>
          <span className="mt-0.5 block text-xs leading-snug text-ink-soft">
            Uten avkryssing publiseres prosjektet uten at det sendes e-post. E-posten følger varslingsvalget til hver
            enkelt, og ingen får den samme to ganger — heller ikke om prosjektet avpubliseres og publiseres på nytt.
          </span>
        </span>
      </label>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose}>
          Avbryt
        </Button>
        <Button variant="primary" loading={busy} onClick={() => void publish()}>
          Publiser nå
        </Button>
      </div>
    </Modal>
  )
}
