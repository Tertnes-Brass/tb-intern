import { describe, expect, it } from 'vitest'
import { GIG_KIND, PROJECT_NOT_FOUND, crewPartsFor, parseCrewPartIds, projectFileGrant, projectReadError } from './project-access'
import { canReadStageSetups } from './stage-scene'

const today = '2026-11-23'
const gig = { kind: GIG_KIND, isPublished: true, eventDate: '2026-12-12' }
const member = { canManage: false, canBrowseArchive: false }

describe('projectReadError for spilleoppdrag', () => {
  it('skjuler oppdraget for alle som ikke er med, også med fullt arkivinnsyn', () => {
    expect(projectReadError(gig, member, today)).toBe(PROJECT_NOT_FOUND)
    expect(projectReadError(gig, { ...member, canBrowseArchive: true }, today)).toBe(PROJECT_NOT_FOUND)
  })
  it('viser det til dem som er med og til prosjektansvarlige', () => {
    expect(projectReadError(gig, { ...member, isCrew: true }, today)).toBeNull()
    expect(projectReadError(gig, { ...member, canManage: true }, today)).toBeNull()
  })
  it('gir ikke dem som er med tilgang til et utkast eller et avholdt oppdrag', () => {
    expect(projectReadError({ ...gig, isPublished: false }, { ...member, isCrew: true }, today)).not.toBeNull()
    expect(projectReadError({ ...gig, eventDate: '2026-11-01' }, { ...member, isCrew: true }, today)).not.toBeNull()
  })
  it('endrer ikke regelen for vanlige prosjekter', () => {
    expect(projectReadError({ ...gig, kind: 'konsert' }, member, today)).toBeNull()
  })
  it('lar ikke stage.manage lese oppsett på et oppdrag hen ikke er med på', () => {
    const reader = { canManageProjects: false, canBrowseArchive: false, canManageStage: true }
    expect(canReadStageSetups(gig, reader, today)).toBe(false)
    expect(canReadStageSetups(gig, { ...reader, isCrew: true }, today)).toBe(true)
    expect(canReadStageSetups({ ...gig, kind: 'konsert', eventDate: '2026-01-01' }, reader, today)).toBe(true)
  })
})

describe('stemmer på oppdraget', () => {
  it('bruker de tildelte, ellers de vanlige, og ingen for den som ikke er med', () => {
    expect(crewPartsFor('["bass"]', ['cornet'])).toEqual(['bass'])
    expect(crewPartsFor('[]', ['cornet'])).toEqual(['cornet'])
    expect(crewPartsFor(null, ['cornet'])).toEqual([])
  })
  it('tåler ødelagt JSON', () => {
    expect(parseCrewPartIds('ikke json')).toEqual([])
    expect(parseCrewPartIds('{"a":1}')).toEqual([])
    expect(parseCrewPartIds('["a",1]')).toEqual(['a'])
  })
})

describe('projectFileGrant', () => {
  it('åpner ikke verket for den som ikke er med på oppdraget', () => {
    expect(projectFileGrant([{ kind: GIG_KIND, crewPartIds: null }], ['cornet'])).toEqual({
      inAccessibleProject: false,
      effectivePartIds: [],
    })
  })
  it('gir oppdragets stemme i stedet for den vanlige', () => {
    expect(projectFileGrant([{ kind: GIG_KIND, crewPartIds: '["bass"]' }], ['cornet'])).toEqual({
      inAccessibleProject: true,
      effectivePartIds: ['bass'],
    })
  })
  it('slår sammen når verket også står i et vanlig prosjekt', () => {
    const grant = projectFileGrant(
      [
        { kind: 'konsert', crewPartIds: null },
        { kind: GIG_KIND, crewPartIds: '["bass"]' },
      ],
      ['cornet'],
    )
    expect(grant.inAccessibleProject).toBe(true)
    expect(grant.effectivePartIds.sort()).toEqual(['bass', 'cornet'])
  })
  it('lar et vanlig prosjekt gjelde selv om verket også er på et lukket oppdrag', () => {
    const grant = projectFileGrant(
      [
        { kind: GIG_KIND, crewPartIds: null },
        { kind: 'konsert', crewPartIds: null },
      ],
      ['cornet'],
    )
    expect(grant).toEqual({ inAccessibleProject: true, effectivePartIds: ['cornet'] })
  })
})
