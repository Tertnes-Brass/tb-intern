import { describe, expect, it } from 'vitest'
import { type HubCalendar, type HubEvent, type HubProject, areasFor, chooseHero, eventsAfter } from './hub'

function event(id: string, start: string): HubEvent {
  return { id, title: `Hendelse ${id}`, start, end: null, allDay: false, location: null }
}

const ovelse = event('ovelse', '2026-09-02T17:00:00.000Z')
const konsert = event('konsert', '2026-09-12T18:00:00.000Z')

const sommerkonsert: HubProject = {
  id: 'p1',
  name: 'Sommerkonsert',
  eventDate: '2026-06-24',
  venue: 'Åsane kulturhus',
  description: null,
  workCount: 6,
}

const emptyCalendar: HubCalendar = { configured: false, error: false, next: null, upcoming: [] }

describe('chooseHero', () => {
  it('velger neste kalenderhendelse når kalenderen svarer', () => {
    const hero = chooseHero({
      calendar: { configured: true, error: false, next: ovelse, upcoming: [konsert] },
      nextProject: sommerkonsert,
    })
    expect(hero).toEqual({ kind: 'event', event: ovelse })
  })

  it('faller tilbake til neste prosjekt når kalenderen ikke er konfigurert', () => {
    const hero = chooseHero({ calendar: emptyCalendar, nextProject: sommerkonsert })
    expect(hero).toEqual({ kind: 'project', project: sommerkonsert })
  })

  it('faller tilbake til neste prosjekt når kalenderen feiler', () => {
    const hero = chooseHero({
      calendar: { configured: true, error: true, next: null, upcoming: [] },
      nextProject: sommerkonsert,
    })
    expect(hero).toEqual({ kind: 'project', project: sommerkonsert })
  })

  it('faller tilbake til neste prosjekt når kalenderen er tom', () => {
    const hero = chooseHero({
      calendar: { configured: true, error: false, next: null, upcoming: [] },
      nextProject: sommerkonsert,
    })
    expect(hero).toEqual({ kind: 'project', project: sommerkonsert })
  })

  it('gir tomtilstand når verken kalender eller prosjekt finnes', () => {
    expect(chooseHero({ calendar: emptyCalendar, nextProject: null })).toEqual({ kind: 'none' })
  })
})

describe('eventsAfter', () => {
  const events = [ovelse, konsert, event('c', '2026-09-16T17:00:00.000Z'), event('d', '2026-09-23T17:00:00.000Z')]

  it('hopper over hero og respekterer grensen', () => {
    expect(eventsAfter(events, ovelse, 2).map((e) => e.id)).toEqual(['konsert', 'c'])
  })

  it('tar hele lista når hero mangler', () => {
    expect(eventsAfter(events, null, 3).map((e) => e.id)).toEqual(['ovelse', 'konsert', 'c'])
  })

  it('beholder lista når hero ikke finnes i den', () => {
    expect(eventsAfter(events, event('utenfor', '2026-08-01T17:00:00.000Z'), 2).map((e) => e.id)).toEqual([
      'ovelse',
      'konsert',
    ])
  })
})

describe('areasFor', () => {
  it('gir et vanlig medlem de fire åpne områdene', () => {
    expect(areasFor(['scores.view']).map((a) => a.to)).toEqual([
      '/beskjeder',
      '/noter',
      '/kalender',
      '/medlemmer',
    ])
  })

  it('legger til Styre ved board.manage', () => {
    expect(areasFor(['board.manage']).map((a) => a.to)).toContain('/styre')
  })

  it('gir ikke Styre til et vanlig medlem', () => {
    expect(areasFor(['scores.view']).map((a) => a.to)).not.toContain('/styre')
  })

  // Filtilganger er ikke lenger i toppmenyen (§6), men skal fortsatt ha en vei inn.
  it('legger til Filtilganger ved downloads.view', () => {
    expect(areasFor(['downloads.view']).map((a) => a.to)).toContain('/innstillinger/nedlastinger')
  })

  it('legger til Innstillinger ved settings.manage', () => {
    expect(areasFor(['settings.manage']).map((a) => a.to)).toContain('/innstillinger')
  })

  it('gir admin (*) alle områdene, i rekkefølgen fra toppmenyen', () => {
    expect(areasFor(['*']).map((a) => a.to)).toEqual([
      '/beskjeder',
      '/noter',
      '/kalender',
      '/medlemmer',
      '/styre',
      '/innstillinger/nedlastinger',
      '/innstillinger',
    ])
  })

  // Gruppeledere (#81): rettighet OG aktiv leiarbinding — samme regel som
  // guarden på serveren og toppmenyen i Shell.tsx.
  it('legger til Gruppeledere ved members.manage.section OG en leiarbinding', () => {
    expect(areasFor(['members.manage.section'], { leadsPartIds: ['solo-cornet'] }).map((a) => a.to)).toContain(
      '/gruppeledere',
    )
  })

  it('gir ikke Gruppeledere uten leiarbinding', () => {
    expect(areasFor(['members.manage.section']).map((a) => a.to)).not.toContain('/gruppeledere')
    expect(areasFor(['members.manage.section'], { leadsPartIds: [] }).map((a) => a.to)).not.toContain('/gruppeledere')
  })

  it('gir ikke Gruppeledere til en admin uten leiarbinding', () => {
    expect(areasFor(['*']).map((a) => a.to)).not.toContain('/gruppeledere')
  })

  it('gir Gruppeledere til en admin som faktisk leder en gruppe', () => {
    expect(areasFor(['*'], { leadsPartIds: ['eb-bass'] }).map((a) => a.to)).toContain('/gruppeledere')
  })

  it('gir Gruppeledere til en med binding uansett rolle — én rolle per medlem gjør at ledere ofte har en annen', () => {
    expect(areasFor(['scores.view'], { leadsPartIds: ['flugel'] }).map((a) => a.to)).toContain('/gruppeledere')
  })

  it('plasserer Gruppeledere mellom Medlemmer og Styre, som i toppmenyen', () => {
    expect(areasFor(['*'], { leadsPartIds: ['flugel'] }).map((a) => a.to)).toEqual([
      '/beskjeder',
      '/noter',
      '/kalender',
      '/medlemmer',
      '/gruppeledere',
      '/styre',
      '/innstillinger/nedlastinger',
      '/innstillinger',
    ])
  })

  it('setter aldri note — tallene fylles i getHub, ikke her', () => {
    expect(areasFor(['*']).every((a) => a.note === undefined)).toBe(true)
  })

  it('muterer ikke grunnlista mellom kall', () => {
    areasFor(['*'])
    expect(areasFor([]).map((a) => a.to)).toEqual(['/beskjeder', '/noter', '/kalender', '/medlemmer'])
  })
})
