import { describe, expect, it } from 'vitest'
import {
  DRAFT_MAX_AGE_MS,
  decodeDraft,
  draftKey,
  draftTimeLabel,
  encodeDraft,
  isPostDraft,
  isTextDraft,
  sameDraft,
} from './drafts'

describe('draftKey', () => {
  it('har alltid brukerens id, så ingen får en annens utkast', () => {
    expect(draftKey('u1', { kind: 'new-post' })).toBe('tb-draft:u1:new-post')
    expect(draftKey('u2', { kind: 'new-post' })).not.toBe(draftKey('u1', { kind: 'new-post' }))
    expect(draftKey('u1', { kind: 'edit-post', postId: 'p1' })).toBe('tb-draft:u1:edit:p1')
    expect(draftKey('u1', { kind: 'forum-new' })).toBe('tb-draft:u1:forum-new')
    expect(draftKey('u1', { kind: 'comment', postId: 'p1' })).toBe('tb-draft:u1:comment:p1')
    expect(draftKey('u1', { kind: 'comment', postId: 'p1', replyToId: 'c9' })).toBe('tb-draft:u1:comment:p1:c9')
    expect(draftKey('u1', { kind: 'forum-reply', topicId: 't1' })).toBe('tb-draft:u1:forum-reply:t1')
  })

  it('lar ikke en id bryte ut av sitt eget felt', () => {
    expect(draftKey('a:b', { kind: 'edit-post', postId: 'x:y' })).toBe('tb-draft:a_b:edit:x_y')
  })
})

describe('encode/decode', () => {
  const now = Date.UTC(2026, 10, 5, 13, 32)
  const text = { body: 'Hei @Ingrid', chosen: [{ id: 'u3', name: 'Ingrid' }] }

  it('tur-retur', () => {
    const decoded = decodeDraft(encodeDraft(text, now - 1000, 42), isTextDraft, now)
    expect(decoded).toEqual({ v: 1, savedAt: now - 1000, base: 42, data: text })
  })

  it('avviser skadet, feil form og for gammelt', () => {
    expect(decodeDraft(null, isTextDraft, now)).toBeNull()
    expect(decodeDraft('{ikke json', isTextDraft, now)).toBeNull()
    expect(decodeDraft(JSON.stringify({ v: 1, savedAt: now, data: { body: 3 } }), isTextDraft, now)).toBeNull()
    expect(decodeDraft(JSON.stringify({ v: 2, savedAt: now, data: text }), isTextDraft, now)).toBeNull()
    expect(decodeDraft(encodeDraft(text, now - DRAFT_MAX_AGE_MS - 1), isTextDraft, now)).toBeNull()
  })

  it('validerer innleggsutkastet felt for felt', () => {
    const post = { title: '', body: 'x', chosen: [], format: 'markdown', audience: 'all', importance: 'normal', official: false, fromArchive: false }
    expect(isPostDraft(post)).toBe(true)
    expect(isPostDraft({ ...post, audience: 'alle' })).toBe(false)
    expect(isPostDraft({ ...post, official: 'ja' })).toBe(false)
    expect(isTextDraft({ body: 'x', chosen: [{ id: 1 }] })).toBe(false)
  })
})

describe('sameDraft', () => {
  it('ser bort fra mellomrom i kantene og rekkefølgen på feltene', () => {
    expect(sameDraft({ body: 'hei ', chosen: [] }, { chosen: [], body: 'hei' })).toBe(true)
    expect(sameDraft({ body: '', chosen: [] }, { body: '   ', chosen: [] })).toBe(true)
    expect(sameDraft({ body: 'hei', chosen: [] }, { body: 'hallo', chosen: [] })).toBe(false)
  })
})

describe('draftTimeLabel', () => {
  // 5. nov. 2026 14:32 norsk tid (UTC+1).
  const saved = Date.UTC(2026, 10, 5, 13, 32)
  it('viser klokkeslett i dag, «i går» og dato ellers', () => {
    expect(draftTimeLabel(saved, saved + 60_000)).toBe('kl. 14:32')
    expect(draftTimeLabel(saved, saved + 86_400_000)).toBe('i går kl. 14:32')
    expect(draftTimeLabel(saved, saved + 3 * 86_400_000)).toBe('5. nov. kl. 14:32')
  })
})
