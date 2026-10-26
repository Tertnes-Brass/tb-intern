import { describe, expect, it } from 'vitest'
import { deviceLabel, mentionPushMessage, postPushMessage, rsvpReminderMessage, rsvpReminderRecipients } from './push'

describe('postPushMessage', () => {
  const base = { id: 'p1', heading: 'Øvelsen flyttes', important: false, official: true, authorName: 'Hilde' }

  it('sier hvem beskjeden er fra og lenker til den', () => {
    expect(postPushMessage(base)).toEqual({
      title: 'Ny beskjed fra styret',
      body: 'Øvelsen flyttes',
      url: '/beskjeder/p1',
      tag: 'post:p1',
    })
  })

  it('merker viktige beskjeder', () => {
    expect(postPushMessage({ ...base, important: true }).title).toBe('Viktig fra styret')
    expect(postPushMessage({ ...base, official: false, fromArchive: true, important: true }).title).toBe('Viktig fra notearkivar')
    expect(postPushMessage({ ...base, official: false }).title).toBe('Ny beskjed fra Hilde')
  })

  it('korter ned lange titler', () => {
    const body = postPushMessage({ ...base, heading: 'a'.repeat(400) }).body
    expect(body.length).toBe(160)
    expect(body.endsWith('…')).toBe(true)
  })
})

describe('mentionPushMessage', () => {
  it('skiller kommentar fra innlegg', () => {
    expect(mentionPushMessage({ postId: 'p1', authorName: 'Ingrid', excerpt: 'Hei @Hilde', where: 'comment' }).title).toBe(
      'Ingrid nevnte deg i en kommentar',
    )
    expect(mentionPushMessage({ postId: 'p1', authorName: 'Ingrid', excerpt: 'Hei', where: 'post' }).title).toBe('Ingrid nevnte deg')
  })
})

describe('rsvpReminderMessage', () => {
  it('spør og lenker til forekomsten', () => {
    expect(rsvpReminderMessage({ occurrenceKey: 'abc.20261028T170000Z', title: 'Øvelse', when: 'i morgen kl. 19:00' })).toEqual({
      title: 'Kommer du i morgen kl. 19:00?',
      body: 'Øvelse — du har ikke svart ennå.',
      url: '/kalender/abc.20261028T170000Z',
      tag: 'rsvp:abc.20261028T170000Z',
    })
  })
})

describe('rsvpReminderRecipients', () => {
  const subscribers = [
    { userId: 'a', isActive: true, pref: null },
    { userId: 'b', isActive: true, pref: 'off' as const },
    { userId: 'c', isActive: false, pref: 'all' as const },
    { userId: 'd', isActive: true, pref: 'all' as const },
    { userId: 'd', isActive: true, pref: 'all' as const },
  ]

  it('gir bare aktive som ikke har svart og ikke har slått det av, én gang hver', () => {
    expect(rsvpReminderRecipients({ subscribers, answered: new Set() })).toEqual(['a', 'd'])
    expect(rsvpReminderRecipients({ subscribers, answered: new Set(['a']) })).toEqual(['d'])
  })
})

describe('deviceLabel', () => {
  it('kjenner igjen de vanlige', () => {
    expect(
      deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
    ).toBe('iPhone · Safari')
    expect(
      deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'),
    ).toBe('Android · Chrome')
    expect(deviceLabel(null)).toBe('Ukjent enhet')
  })
})
