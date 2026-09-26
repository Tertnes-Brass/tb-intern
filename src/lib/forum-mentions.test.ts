import { describe, expect, it } from 'vitest'
import { FORUM_ALL, forumMarkers, forumMentionDraft, forumMentionHtml } from './forum-mentions'

describe('forum mention text', () => {
  it('round-trips people and everyone without changing their order', () => {
    const users = [{ id: 'one', name: 'Ingrid' }, { id: 'two', name: 'Jonas' }]
    const raw = '@[u:one] Hei @[all]! @[u:two]'
    const draft = forumMentionDraft(raw, users)
    expect(draft.text).toBe('@Ingrid Hei @Alle i korpset! @Jonas')
    expect(forumMarkers(draft.text, draft.chosen)).toBe(raw)
  })
  it('requires selecting everyone and leaves code alone', () => {
    expect(forumMarkers('@Alle i korpset', [])).toBe('@Alle i korpset')
    expect(forumMarkers('`@Alle i korpset`', [FORUM_ALL])).toBe('`@Alle i korpset`')
    expect(forumMarkers('@Alle i korpset', [FORUM_ALL])).toBe('@[all]')
  })
  it('escapes text and names, and never leaks unknown markers', () => {
    const html = forumMentionHtml('<script>x</script> @[u:one] @[all] @[u:gone]', [{ id: 'one', name: '<img onerror=x>' }])
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('@Alle i korpset')
    expect(html).toContain('Ukjent medlem')
    expect(html).not.toContain('@[u:')
  })
})
