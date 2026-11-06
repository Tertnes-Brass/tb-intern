import { describe, expect, it } from 'vitest'
import { PRESS_WINDOW_MS, blocksSelection, pressFrom } from './press-selection'

describe('langt trykk og tekstmarkering', () => {
  it('stopper markeringen når fingeren holdt på en kontroll', () => {
    const press = pressFrom('touch', true, false, 1000)
    expect(blocksSelection(press, false, 1500)).toBe(true)
    expect(blocksSelection(pressFrom('pen', true, false, 1000), false, 1500)).toBe(true)
  })

  it('lar vanlig tekst markeres som før', () => {
    expect(blocksSelection(pressFrom('touch', false, false, 1000), false, 1500)).toBe(false)
  })

  it('rører aldri musa eller tekstfelt', () => {
    expect(pressFrom('mouse', true, false, 1000)).toBeNull()
    expect(blocksSelection(pressFrom('mouse', true, false, 1000), false, 1500)).toBe(false)
    // Trykk i et felt (f.eks. en label rundt det), eller markering inne i et felt.
    expect(blocksSelection(pressFrom('touch', true, true, 1000), false, 1500)).toBe(false)
    expect(blocksSelection(pressFrom('touch', true, false, 1000), true, 1500)).toBe(false)
  })

  it('gjelder bare rett etter trykket', () => {
    const press = pressFrom('touch', true, false, 1000)
    expect(blocksSelection(press, false, 1000 + PRESS_WINDOW_MS - 1)).toBe(true)
    expect(blocksSelection(press, false, 1000 + PRESS_WINDOW_MS)).toBe(false)
    expect(blocksSelection(null, false, 1500)).toBe(false)
  })
})
