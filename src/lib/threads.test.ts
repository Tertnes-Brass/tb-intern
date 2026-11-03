import { describe, expect, it } from 'vitest'
import { buildThreads, foldChildren, replyContext, replyPlacement, type ThreadItem } from './threads'

const item = (id: string, createdAt: number, parentId: string | null = null, replyToId: string | null = parentId): ThreadItem =>
  ({ id, createdAt, parentId, replyToId })
const self = (x: ThreadItem) => x

describe('replyPlacement', () => {
  it('puts a reply to a root under that root', () => {
    expect(replyPlacement({ id: 'root', parentId: null })).toEqual({ parentId: 'root', replyToId: 'root' })
  })
  it('keeps a reply to a reply under the same root — never a third level', () => {
    expect(replyPlacement({ id: 'child', parentId: 'root' })).toEqual({ parentId: 'root', replyToId: 'child' })
  })
})

describe('buildThreads', () => {
  it('keeps the root order it was given and sorts replies oldest first', () => {
    const threads = buildThreads([item('b', 20), item('a', 10), item('a2', 40, 'a'), item('a1', 30, 'a'), item('b1', 30, 'b')], self)
    expect(threads.map((t) => [t.id, t.children.map((c) => c.id)])).toEqual([['b', ['b1']], ['a', ['a1', 'a2']]])
  })
  it('breaks ties on the same millisecond by id, like the SQL', () => {
    const threads = buildThreads([item('r', 1), item('y', 5, 'r'), item('x', 5, 'r')], self)
    expect(threads[0].children.map((c) => c.id)).toEqual(['x', 'y'])
  })
  it('never hides a reply whose root is missing — it becomes a root of its own', () => {
    const threads = buildThreads([item('a', 1), item('orphan', 2, 'gone')], self)
    expect(threads.map((t) => t.id)).toEqual(['a', 'orphan'])
  })
  it('moves a reply that points at another reply up under the real root', () => {
    const threads = buildThreads([item('r', 1), item('c', 2, 'r'), item('deep', 3, 'c')], self)
    expect(threads.map((t) => [t.id, t.children.map((c) => c.id)])).toEqual([['r', ['c', 'deep']]])
  })
  it('works through an accessor, so callers keep their own row shape', () => {
    const rows = [{ reply: item('r', 1) }, { reply: item('c', 2, 'r') }]
    expect(buildThreads(rows, (row) => row.reply)[0].children).toEqual([rows[1]])
  })
})

describe('replyContext', () => {
  const root = item('r', 1)
  const a = item('a', 2, 'r')
  const b = item('b', 3, 'r', 'a')
  const lost = item('l', 4, 'r', 'deleted')
  it('says nothing extra for a reply straight to the root', () => {
    expect(replyContext(a, [a, b], self)).toEqual({ kind: 'root' })
    expect(replyContext(item('legacy', 5, 'r', null), [a], self)).toEqual({ kind: 'root' })
    expect(replyContext(root, [], self)).toEqual({ kind: 'root' })
  })
  it('names the sibling a reply answered', () => {
    expect(replyContext(b, [a, b], self)).toEqual({ kind: 'sibling', target: a })
  })
  it('admits it when the reply it answered is gone', () => {
    expect(replyContext(lost, [a, b, lost], self)).toEqual({ kind: 'gone' })
  })
})

describe('foldChildren', () => {
  const kids = ['1', '2', '3', '4', '5', '6'].map((id) => ({ id }))
  it('shows short threads in full — folding away a single reply is not worth a tap', () => {
    expect(foldChildren(kids.slice(0, 4))).toEqual({ hidden: 0, visible: kids.slice(0, 4) })
  })
  it('folds the oldest replies of a long thread and keeps the latest in view', () => {
    expect(foldChildren(kids)).toEqual({ hidden: 3, visible: kids.slice(3) })
    expect(foldChildren(kids, { keep: 2 })).toEqual({ hidden: 4, visible: kids.slice(4) })
  })
  it('never hides an unread or linked reply, nor anything after it', () => {
    expect(foldChildren(kids, { mustShow: (k) => k.id === '3' })).toEqual({ hidden: 2, visible: kids.slice(2) })
    expect(foldChildren(kids, { mustShow: (k) => k.id === '2' })).toEqual({ hidden: 0, visible: kids })
    expect(foldChildren(kids, { mustShow: (k) => k.id === '6' })).toEqual({ hidden: 3, visible: kids.slice(3) })
  })
})
