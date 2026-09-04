import { describe, expect, it } from 'vitest'
import { isActiveProject, projectVisibility } from './project-access'

const today = '2026-09-03'
const member = { canManage: false, canBrowseArchive: false }
const archivist = { canManage: false, canBrowseArchive: true }
const manager = { canManage: true, canBrowseArchive: false }

describe('projectVisibility', () => {
  it('skjuler et utkast for alle andre enn den som forvalter prosjekter', () => {
    const draft = { isPublished: false, eventDate: '2026-12-01' }
    expect(projectVisibility(draft, member, today)).toBe('unpublished')
    expect(projectVisibility(draft, archivist, today)).toBe('unpublished')
    expect(projectVisibility(draft, manager, today)).toBe('ok')
  })

  it('viser et publisert, kommende prosjekt til alle', () => {
    expect(projectVisibility({ isPublished: true, eventDate: '2026-12-01' }, member, today)).toBe('ok')
  })

  it('viser dagens prosjekt — datoen er ikke passert før dagen er det', () => {
    expect(projectVisibility({ isPublished: true, eventDate: today }, member, today)).toBe('ok')
  })

  it('lukker et avholdt prosjekt for et vanlig medlem, men ikke for arkivaren', () => {
    const past = { isPublished: true, eventDate: '2026-01-01' }
    expect(projectVisibility(past, member, today)).toBe('past')
    expect(projectVisibility(past, archivist, today)).toBe('ok')
    expect(projectVisibility(past, manager, today)).toBe('ok')
  })

  it('behandler et prosjekt uten dato som avholdt for et vanlig medlem', () => {
    expect(projectVisibility({ isPublished: true, eventDate: null }, member, today)).toBe('past')
  })
})

describe('isActiveProject', () => {
  it('er sant kun for publiserte prosjekter med en dato som ikke er passert', () => {
    expect(isActiveProject({ isPublished: true, eventDate: '2026-12-01' }, today)).toBe(true)
    expect(isActiveProject({ isPublished: true, eventDate: today }, today)).toBe(true)
    expect(isActiveProject({ isPublished: true, eventDate: '2026-01-01' }, today)).toBe(false)
    expect(isActiveProject({ isPublished: false, eventDate: '2026-12-01' }, today)).toBe(false)
    expect(isActiveProject({ isPublished: true, eventDate: null }, today)).toBe(false)
  })
})
