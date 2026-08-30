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
  it('gir et vanlig medlem de tre åpne områdene', () => {
    expect(areasFor(['scores.view']).map((a) => a.to)).toEqual(['/noter', '/kalender', '/medlemmer'])
  })

  it('legger til Filtilganger ved downloads.view', () => {
    expect(areasFor(['downloads.view']).map((a) => a.to)).toContain('/innstillinger/nedlastinger')
  })

  it('legger til Innstillinger ved settings.manage', () => {
    expect(areasFor(['settings.manage']).map((a) => a.to)).toContain('/innstillinger')
  })

  it('gir admin (*) alle områdene, i rekkefølgen fra toppmenyen', () => {
    expect(areasFor(['*']).map((a) => a.to)).toEqual([
      '/noter',
      '/kalender',
      '/medlemmer',
      '/innstillinger/nedlastinger',
      '/innstillinger',
    ])
  })

  it('muterer ikke grunnlista mellom kall', () => {
    areasFor(['*'])
    expect(areasFor([]).map((a) => a.to)).toEqual(['/noter', '/kalender', '/medlemmer'])
  })
})
