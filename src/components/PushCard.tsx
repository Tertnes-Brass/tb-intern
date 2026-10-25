import { useEffect, useState } from 'react'
import { formatDateTime } from '../lib/format'
import type { RsvpReminderChoice } from '../lib/push'
import { currentPushSubscription, disablePush, enablePush, pushSupport, type PushSupport } from '../lib/push-client'
import { isIos } from '../lib/pwa'
import { getPushConfig, listMyPushDevices, sendTestPush, updateMyRsvpReminders } from '../server/push'
import { Icon } from './Icons'
import { toast, toastError } from './toast'
import { Button, Kicker } from './ui'

type Devices = Awaited<ReturnType<typeof listMyPushDevices>>

/**
 * «Varsler på denne enheten» på /min-profil. Push slås på per enhet — en
 * installert app på telefonen, Chrome på jobb-PC-en — og hva det varsles om,
 * styres av valgene under (de samme som for e-post). Påminnelsen om oppmøte
 * er det eneste som bare finnes som push.
 */
export function PushCard({ userId }: { userId: string }) {
  const [support, setSupport] = useState<PushSupport>('unsupported')
  const [enabledHere, setEnabledHere] = useState(false)
  const [devices, setDevices] = useState<Devices | null>(null)
  const [busy, setBusy] = useState<'toggle' | 'test' | 'rsvp' | null>(null)
  const [publicKey, setPublicKey] = useState<string | null>(null)

  const refresh = async () => {
    setSupport(pushSupport())
    const [sub, list, config] = await Promise.all([
      currentPushSubscription().catch(() => null),
      listMyPushDevices(),
      getPushConfig(),
    ])
    setPublicKey(config.publicKey)
    setDevices(list)
    setEnabledHere(!!sub && list.devices.some((d) => d.endpoint === sub.endpoint))
  }

  useEffect(() => {
    void refresh().catch(() => {})
  }, [])

  const toggle = async () => {
    setBusy('toggle')
    try {
      if (enabledHere) {
        await disablePush()
        toast('Varsler er slått av på denne enheten')
      } else {
        await enablePush(publicKey, userId)
        toast('Varsler er slått på')
      }
      await refresh()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const configured = devices?.configured ?? false
  const others = devices?.devices.length ? devices.devices.length - (enabledHere ? 1 : 0) : 0

  return (
    <section id="varsler" className="sheet rise scroll-mt-24 overflow-hidden" style={{ animationDelay: '90ms' }}>
      <div className="border-b border-line bg-paper-sunken/50 px-5 py-5 sm:px-6">
        <Kicker className="mb-2">Varsler</Kicker>
        <h2 className="display-title text-2xl font-semibold text-ink">På denne enheten</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Få beskjeder, omtaler og påminnelser som varsel på telefonen — også når appen er lukket.
        </p>
      </div>
      <div className="space-y-4 p-5 sm:p-6">
        {!devices ? (
          <span className="spinner text-brass" aria-label="Laster" />
        ) : !configured ? (
          <p className="text-sm text-ink-soft">Varsler er ikke slått på for internsiden ennå.</p>
        ) : support === 'needs-install' ? (
          <div className="flex gap-3 rounded-xl border border-line bg-paper px-4 py-3">
            <Icon name="share" size={20} className="mt-0.5 text-brass-strong" />
            <p className="text-sm leading-relaxed text-ink-soft">
              På iPhone og iPad virker varsler bare når Intern er lagt på Hjem-skjermen. Trykk{' '}
              <b className="font-semibold text-ink">Del</b> i Safari, velg «Legg til på Hjem-skjerm», og åpne appen
              derfra.
            </p>
          </div>
        ) : support === 'unsupported' ? (
          <p className="text-sm text-ink-soft">
            {isIos()
              ? 'Varsler krever iOS 16.4 eller nyere, og at appen er åpnet fra Hjem-skjermen.'
              : 'Denne nettleseren kan ikke vise varsler fra internsiden.'}
          </p>
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={enabledHere}
            disabled={busy !== null}
            onClick={toggle}
            className="flex w-full cursor-pointer items-center gap-3.5 rounded-xl border border-line bg-paper px-4 py-3.5 text-left disabled:cursor-wait"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--brass-soft)] text-brass-strong">
              {busy === 'toggle' ? <span className="spinner" aria-hidden /> : <Icon name="bell" size={20} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.95rem] font-semibold text-ink">Varsler på denne enheten</span>
              <span className="block text-xs text-ink-soft">{enabledHere ? 'På' : 'Av'}</span>
            </span>
            <span
              aria-hidden
              className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors ${enabledHere ? 'bg-ok' : 'bg-line-strong'}`}
            >
              <span
                className={`absolute top-[3px] h-6 w-6 rounded-full bg-paper-raised shadow transition-transform ${enabledHere ? 'translate-x-[23px]' : 'translate-x-[3px]'}`}
              />
            </span>
          </button>
        )}

        {configured && devices && devices.devices.length > 0 && (
          <div>
            <p className="mb-1.5 text-[0.8rem] font-medium text-ink-soft">
              {others > 0 && !enabledHere ? 'Varsler er på for' : 'Enheter med varsler'}
            </p>
            <ul className="divide-y divide-[var(--line)] rounded-xl border border-line">
              {devices.devices.map((d) => (
                <li key={d.endpoint} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="text-ink">{d.label}</span>
                  <span className="text-xs text-ink-faint">
                    {d.lastSuccessAt ? `sist varslet ${formatDateTime(d.lastSuccessAt)}` : `lagt til ${formatDateTime(d.createdAt)}`}
                  </span>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              loading={busy === 'test'}
              onClick={async () => {
                setBusy('test')
                try {
                  const r = await sendTestPush()
                  toast(r.sent > 0 ? 'Prøvevarselet er sendt' : 'Fant ingen enhet å sende til', r.sent > 0 ? 'ok' : 'error')
                  await refresh()
                } catch (err) {
                  toastError(err)
                } finally {
                  setBusy(null)
                }
              }}
            >
              Send et prøvevarsel
            </Button>
          </div>
        )}

        {configured && devices && (
          <RsvpReminderChoice
            current={devices.rsvpReminders}
            busy={busy === 'rsvp'}
            onChange={async (next) => {
              setBusy('rsvp')
              try {
                await updateMyRsvpReminders({ data: { rsvpReminders: next } })
                setDevices({ ...devices, rsvpReminders: next })
                toast('Varslingsvalget er lagret')
              } catch (err) {
                toastError(err)
              } finally {
                setBusy(null)
              }
            }}
          />
        )}
      </div>
    </section>
  )
}

function RsvpReminderChoice({
  current,
  busy,
  onChange,
}: {
  current: RsvpReminderChoice
  busy: boolean
  onChange: (next: RsvpReminderChoice) => void
}) {
  return (
    <div className="border-t border-line pt-4">
      <p className="text-[0.95rem] font-semibold text-ink">Påminnelse om oppmøte</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        Et varsel dagen før en øvelse eller konsert du ikke har svart på. Bare som varsel, aldri på e-post.
      </p>
      <div className="mt-3 flex gap-2">
        {(['all', 'off'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={current === value ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => current !== value && onChange(value)}
          >
            {value === 'all' ? 'På' : 'Av'}
          </Button>
        ))}
      </div>
    </div>
  )
}
