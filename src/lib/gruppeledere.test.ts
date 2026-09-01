import { describe, expect, it } from 'vitest'
import { GROUP_LEADER_PERMISSION, type GroupLeaderSubject, isGroupLeader } from './gruppeledere'

function subject(permissions: string[], leadsPartIds: string[] = []): GroupLeaderSubject {
  return { permissions, leadsPartIds }
}

describe('isGroupLeader', () => {
  it('avviser et vanlig medlem', () => {
    expect(isGroupLeader(subject(['scores.view']))).toBe(false)
  })

  it('avviser et styremedlem uten leiarbinding', () => {
    expect(isGroupLeader(subject(['scores.view', 'board.manage', 'posts.publish']))).toBe(false)
  })

  it('avviser en med leiarbinding, men uten rettigheten', () => {
    // Kan skje etter at rettigheten er tatt bort i rollematrisen mens raden i
    // `section_leaders` står igjen. Bindingen alene gir ingenting.
    expect(isGroupLeader(subject(['scores.view'], ['solo-cornet']))).toBe(false)
  })

  it('slipper inn en gruppeleder med både rettighet og binding', () => {
    expect(isGroupLeader(subject([GROUP_LEADER_PERMISSION], ['solo-cornet', 'second-cornet']))).toBe(true)
  })

  it('avviser en admin UTEN leiarbinding', () => {
    // Kjernen i #81: `*` gir alt annet, men ikke en plass i gruppeledernes chat.
    expect(isGroupLeader(subject(['*']))).toBe(false)
  })

  it('slipper inn en admin som faktisk leder en gruppe', () => {
    expect(isGroupLeader(subject(['*'], ['eb-bass']))).toBe(true)
  })

  it('avviser når bindingen fjernes — tilgangen henger ikke igjen', () => {
    const me = subject([GROUP_LEADER_PERMISSION], ['flugel'])
    expect(isGroupLeader(me)).toBe(true)
    expect(isGroupLeader({ ...me, leadsPartIds: [] })).toBe(false)
  })

  it('avviser når det ikke finnes en bruker i det hele tatt', () => {
    expect(isGroupLeader(null)).toBe(false)
    expect(isGroupLeader(undefined)).toBe(false)
  })

  it('lar ikke global members.manage alene åpne området', () => {
    // Medlemsforvaltning er ikke det samme som å lede en stemmegruppe.
    expect(isGroupLeader(subject(['members.manage'], ['solo-cornet']))).toBe(false)
  })
})
