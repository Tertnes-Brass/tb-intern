import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type StageDraft, type StageWriteResult, StageSaveQueue, stableSnapshot } from './stage-save-queue'

const draft = (title: string, scene: unknown = { elements: [] }): StageDraft => ({ title, notes: '', scene })

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('stableSnapshot', () => {
  it('er lik uansett nøkkelrekkefølge', () => {
    expect(stableSnapshot({ a: 1, b: { c: 2, d: [{ e: 1, f: 2 }] } })).toBe(
      stableSnapshot({ b: { d: [{ f: 2, e: 1 }], c: 2 }, a: 1 }),
    )
  })
})

describe('StageSaveQueue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('venter til endringene har stilnet, og lagrer én gang', async () => {
    const write = vi.fn(async (): Promise<StageWriteResult> => ({ ok: true, revision: 2, updatedAt: 1 }))
    const q = new StageSaveQueue(draft('A'), 1, write, () => {}, 1000)
    q.update(draft('AB'))
    q.update(draft('ABC'))
    expect(q.status).toBe('pending')
    await vi.advanceTimersByTimeAsync(999)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(draft('ABC'), 1)
    expect(q.status).toBe('saved')
    expect(q.revision).toBe(2)
  })

  it('ser ikke en endring tilbake til det lagrede som en endring', () => {
    const q = new StageSaveQueue(draft('A'), 1, vi.fn(), () => {})
    q.update(draft('B'))
    q.update(draft('A'))
    expect(q.status).toBe('saved')
    expect(q.dirty).toBe(false)
  })

  it('tar med endringer som kom mens den lagret, før den sier «Lagret»', async () => {
    const first = deferred<StageWriteResult>()
    const write = vi
      .fn<(d: StageDraft, r: number) => Promise<StageWriteResult>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true, revision: 3, updatedAt: 2 })
    const q = new StageSaveQueue(draft('A'), 1, write, () => {}, 10)
    q.update(draft('B'))
    const flushing = q.flush()
    q.update(draft('C'))
    expect(q.status).toBe('saving')
    first.resolve({ ok: true, revision: 2, updatedAt: 1 })
    expect(await flushing).toBe(true)
    expect(write).toHaveBeenNthCalledWith(2, draft('C'), 2)
    expect(q.status).toBe('saved')
    expect(q.revision).toBe(3)
  })

  it('stopper ved konflikt og prøver aldri igjen av seg selv', async () => {
    const write = vi.fn(
      async (): Promise<StageWriteResult> => ({ ok: false, conflict: { revision: 5, updatedAt: 9, updatedByName: 'Kim' } }),
    )
    const q = new StageSaveQueue(draft('A'), 1, write, () => {}, 10)
    q.update(draft('B'))
    expect(await q.flush()).toBe(false)
    expect(q.status).toBe('conflict')
    expect(q.conflict?.updatedByName).toBe('Kim')
    q.update(draft('C'))
    await vi.advanceTimersByTimeAsync(100)
    expect(await q.flush()).toBe(false)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('prøver igjen etter en feil når det kommer en ny endring', async () => {
    const write = vi
      .fn<(d: StageDraft, r: number) => Promise<StageWriteResult>>()
      .mockRejectedValueOnce(new Error('nett'))
      .mockResolvedValueOnce({ ok: true, revision: 2, updatedAt: 1 })
    const q = new StageSaveQueue(draft('A'), 1, write, () => {}, 10)
    q.update(draft('B'))
    expect(await q.flush()).toBe(false)
    expect(q.status).toBe('error')
    q.update(draft('C'))
    await vi.advanceTimersByTimeAsync(10)
    expect(q.status).toBe('saved')
    expect(write).toHaveBeenLastCalledWith(draft('C'), 1)
  })

  it('lagrer ikke uten navn', async () => {
    const write = vi.fn()
    const q = new StageSaveQueue(draft('A'), 1, write, () => {}, 10)
    q.update(draft('  '))
    expect(await q.flush()).toBe(false)
    expect(q.status).toBe('error')
    expect(write).not.toHaveBeenCalled()
  })

  it('rebase gjør normaliseringen til utgangspunktet uten å lagre', async () => {
    const write = vi.fn()
    const q = new StageSaveQueue(draft('A', { elements: [{ id: 1 }] }), 1, write, () => {}, 10)
    q.rebase(draft('A', { elements: [{ id: 1, index: 'a0' }] }))
    expect(q.dirty).toBe(false)
    await vi.advanceTimersByTimeAsync(50)
    expect(write).not.toHaveBeenCalled()
  })
})
