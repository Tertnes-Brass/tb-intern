import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROJECT_NOTIFY,
  MAX_CHANGE_LINES,
  type ProjectChange,
  type ProjectRecipient,
  describeProjectChange,
  pendingChangesLabel,
  projectNotifyMessage,
  projectRecipientsFor,
  summarizeProjectChanges,
  wantsProjectEmail,
} from './project-notify'

const member = (over: Partial<ProjectRecipient> & { userId: string }): ProjectRecipient => ({
  email: `${over.userId}@tertnesbrass.no`,
  isActive: true,
  ...over,
})

describe('mottakerutvalg', () => {
  const members = [member({ userId: 'a' }), member({ userId: 'b' }), member({ userId: 'c' })]

  it('tar med alle aktive medlemmer med e-post når ingen har valgt noe', () => {
    expect(projectRecipientsFor(members, new Map()).map((m) => m.userId)).toEqual(['a', 'b', 'c'])
  })

  it('hopper over deaktiverte medlemmer', () => {
    const list = [...members, member({ userId: 'd', isActive: false })]
    expect(projectRecipientsFor(list, new Map()).map((m) => m.userId)).toEqual(['a', 'b', 'c'])
  })

  it('hopper over medlemmer uten brukbar e-postadresse', () => {
    const list = [member({ userId: 'a' }), member({ userId: 'b', email: null }), member({ userId: 'c', email: '   ' })]
    expect(projectRecipientsFor(list, new Map()).map((m) => m.userId)).toEqual(['a'])
  })

  it('respekterer «av» i varslingsvalget', () => {
    const prefs = new Map([['b', 'off' as const]])
    expect(projectRecipientsFor(members, prefs).map((m) => m.userId)).toEqual(['a', 'c'])
  })

  it('leser valget likt fra Map og objekt', () => {
    expect(projectRecipientsFor(members, { b: 'off' }).map((m) => m.userId)).toEqual(['a', 'c'])
  })

  it('ingen rad betyr alle varsler — fravær av valg er aldri «av»', () => {
    expect(wantsProjectEmail(undefined)).toBe(true)
    expect(wantsProjectEmail(null)).toBe(true)
    expect(wantsProjectEmail('all')).toBe(true)
    expect(wantsProjectEmail('off')).toBe(false)
  })
})

describe('standardvalget i publiseringsdialogen', () => {
  // Låser #85-prinsippet også for prosjekter: publisering og masseutsending er
  // to bevisste handlinger, og bare den ene kan angres.
  it('er AVSLÅTT', () => {
    expect(DEFAULT_PROJECT_NOTIFY).toBe(false)
  })
})

describe('beskrivelse av én endring', () => {
  const change = (over: Partial<ProjectChange> & { kind: string }): ProjectChange => ({
    subject: null,
    detail: null,
    ...over,
  })

  it('navngir verket når det finnes', () => {
    expect(describeProjectChange(change({ kind: 'work_added', subject: 'Where Eagles Sing' }))).toBe(
      '«Where Eagles Sing» er lagt til i programmet',
    )
    expect(describeProjectChange(change({ kind: 'work_removed', subject: 'Journey to the Centre' }))).toBe(
      '«Journey to the Centre» er tatt ut av programmet',
    )
  })

  it('faller tilbake på en nøytral formulering uten emne', () => {
    expect(describeProjectChange(change({ kind: 'work_added' }))).toBe('Et verk er lagt til i programmet')
  })

  it('tar med den nye verdien der den er verdt å si', () => {
    expect(describeProjectChange(change({ kind: 'date_changed', detail: '15. november 2026' }))).toBe(
      'Datoen er endret til 15. november 2026',
    )
    expect(describeProjectChange(change({ kind: 'venue_changed', detail: 'Grieghallen' }))).toBe(
      'Stedet er endret til Grieghallen',
    )
    expect(describeProjectChange(change({ kind: 'name_changed', detail: 'Julekonsert 2026' }))).toBe(
      'Prosjektet heter nå «Julekonsert 2026»',
    )
  })

  it('klarer seg uten detaljen også der den vanligvis finnes', () => {
    expect(describeProjectChange(change({ kind: 'date_changed' }))).toBe('Datoen er endret')
    expect(describeProjectChange(change({ kind: 'venue_changed', detail: '  ' }))).toBe('Stedet er endret')
  })

  it('beskriver tidsplanen med klokkeslettet i parentes', () => {
    expect(describeProjectChange(change({ kind: 'time_added', subject: 'Lasting', detail: 'lør 14. nov 09:00' }))).toBe(
      'Nytt tidspunkt i tidsplanen: «Lasting» (lør 14. nov 09:00)',
    )
    expect(describeProjectChange(change({ kind: 'time_removed', subject: 'Nedrigg' }))).toBe(
      '«Nedrigg» er tatt ut av tidsplanen',
    )
  })

  it('gir en rolig fallback for en ukjent nøkkel i stedet for å kaste', () => {
    expect(describeProjectChange(change({ kind: 'noe_helt_annet' }))).toBe('Noe i prosjektet er endret')
  })
})

describe('samling av endringer til én e-post', () => {
  it('slår sammen gjentakelser — fem flyttinger er én opplysning', () => {
    const changes: ProjectChange[] = [
      { kind: 'work_order', subject: null, detail: null },
      { kind: 'work_order', subject: null, detail: null },
      { kind: 'work_order', subject: null, detail: null },
    ]
    const summary = summarizeProjectChanges(changes)
    expect(summary.lines).toEqual(['Rekkefølgen i programmet er endret'])
    // Antallet endringer er fortsatt sant — det er visningen som er samlet.
    expect(summary.total).toBe(3)
    expect(summary.more).toBe(0)
  })

  it('beholder rekkefølgen endringene skjedde i', () => {
    const summary = summarizeProjectChanges([
      { kind: 'work_added', subject: 'A', detail: null },
      { kind: 'date_changed', subject: null, detail: '1. mai 2027' },
      { kind: 'work_removed', subject: 'B', detail: null },
    ])
    expect(summary.lines).toEqual([
      '«A» er lagt til i programmet',
      'Datoen er endret til 1. mai 2027',
      '«B» er tatt ut av programmet',
    ])
  })

  it('kutter lange lister og teller opp resten', () => {
    const changes = Array.from({ length: MAX_CHANGE_LINES + 3 }, (_, i) => ({
      kind: 'work_added',
      subject: `Verk ${i}`,
      detail: null,
    }))
    const summary = summarizeProjectChanges(changes)
    expect(summary.lines).toHaveLength(MAX_CHANGE_LINES)
    expect(summary.more).toBe(3)
    expect(summary.total).toBe(MAX_CHANGE_LINES + 3)
  })

  it('svarer tomt på ingen endringer', () => {
    expect(summarizeProjectChanges([])).toEqual({ lines: [], more: 0, total: 0 })
  })

  it('teller på norsk', () => {
    expect(pendingChangesLabel(0)).toBe('Ingen nye endringer siden forrige varsel')
    expect(pendingChangesLabel(1)).toBe('1 endring siden forrige varsel')
    expect(pendingChangesLabel(4)).toBe('4 endringer siden forrige varsel')
  })
})

describe('kvittering etter utsending', () => {
  it('sier tydelig fra når ingenting ble sendt', () => {
    expect(projectNotifyMessage({ sent: 0, logged: 0, failed: 0, skipped: 0 }, 'Prosjektet er publisert')).toEqual({
      message: 'Prosjektet er publisert. Ingen e-post ble sendt.',
      kind: 'ok',
    })
  })

  it('skiller «alle hadde den fra før» fra «ingen ble sendt»', () => {
    expect(projectNotifyMessage({ sent: 0, logged: 0, failed: 0, skipped: 12 }, 'Prosjektet er publisert')).toEqual({
      message: 'Prosjektet er publisert. Alle mottakerne har allerede fått e-post.',
      kind: 'ok',
    })
  })

  // Den viktigste regelen i hele modulen: `logged` betyr konsoll-logg, altså at
  // ingen e-post gikk ut. Presenteres den som «sendt», lyver kvitteringen.
  it('presenterer ALDRI loggførte varsler som sendt', () => {
    const result = projectNotifyMessage({ sent: 0, logged: 9, failed: 0, skipped: 0 }, 'Prosjektet er publisert')
    expect(result.message).toBe(
      'Prosjektet er publisert, men e-post er ikke aktivert her — 9 varsler ble bare loggført lokalt.',
    )
    expect(result.message).not.toMatch(/[Ss]endt/)
    expect(result.kind).toBe('error')
  })

  it('teller opp en blandet runde og flagger feil', () => {
    const result = projectNotifyMessage({ sent: 20, logged: 1, failed: 2, skipped: 3 }, 'Oppdateringsvarsel')
    expect(result.message).toBe(
      'Oppdateringsvarsel. Sendt til 20 medlemmer · 1 loggført lokalt · 2 feilet · 3 hadde den fra før.',
    )
    expect(result.kind).toBe('error')
  })

  it('bøyer «medlem» riktig i entall', () => {
    expect(projectNotifyMessage({ sent: 1, logged: 0, failed: 0, skipped: 0 }, 'Sendt').message).toBe(
      'Sendt. Sendt til 1 medlem.',
    )
  })
})
