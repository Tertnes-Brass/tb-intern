import { describe, expect, it } from 'vitest'
import {
  type PostRecipient,
  bodyToHtml,
  canDeleteComment,
  canEditPost,
  canReadPost,
  commentCountLabel,
  escapeHtml,
  excerpt,
  imageExtension,
  imageRejectionReason,
  notifyResultMessage,
  paragraphs,
  postEmailFrom,
  postEmailImageNote,
  postEmailSubject,
  postHeading,
  reactionLabel,
  recipientsFor,
  sanitizePostInput,
  toggleReaction,
  tokenize,
} from './posts'

describe('excerpt', () => {
  it('lar korte tekster stå urørt', () => {
    expect(excerpt('Øvelsen er flyttet.', 40)).toBe('Øvelsen er flyttet.')
  })

  it('slår sammen avsnitt og normaliserer mellomrom', () => {
    expect(excerpt('Hei\n\n  alle   sammen \n', 40)).toBe('Hei alle sammen')
  })

  it('kutter på ordgrense og legger på ellipse', () => {
    const out = excerpt('Vi møtes klokken atten på Åsane kulturhus for generalprøve', 25)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(26)
    expect(out).toBe('Vi møtes klokken atten…')
  })

  it('fjerner tegnsetting foran ellipsen', () => {
    expect(excerpt('Husk uniform, notestativ og godt humør', 18)).toBe('Husk uniform…')
  })

  it('kutter hardt når teksten ikke har ordgrenser', () => {
    expect(excerpt('a'.repeat(30), 10)).toBe(`${'a'.repeat(10)}…`)
  })
})

describe('paragraphs', () => {
  it('deler på tomme linjer og kaster tomme avsnitt', () => {
    expect(paragraphs('Ett\n\n\nTo\n\n   \n\nTre  ')).toEqual(['Ett', 'To', 'Tre'])
  })

  it('beholder enkle linjeskift inne i et avsnitt', () => {
    expect(paragraphs('Linje 1\nLinje 2')).toEqual(['Linje 1\nLinje 2'])
  })

  it('takler CRLF', () => {
    expect(paragraphs('Ett\r\n\r\nTo')).toEqual(['Ett', 'To'])
  })
})

describe('tokenize', () => {
  it('finner http-lenker midt i teksten', () => {
    expect(tokenize('Se https://tertnesbrass.no/program for detaljer')).toEqual([
      { kind: 'text', value: 'Se ' },
      { kind: 'link', value: 'https://tertnesbrass.no/program', href: 'https://tertnesbrass.no/program' },
      { kind: 'text', value: ' for detaljer' },
    ])
  })

  it('gir www-lenker https-skjema', () => {
    expect(tokenize('www.tertnesbrass.no')).toEqual([
      { kind: 'link', value: 'www.tertnesbrass.no', href: 'https://www.tertnesbrass.no' },
    ])
  })

  it('tar ikke med avsluttende punktum i lenken', () => {
    expect(tokenize('Meld deg på https://tb.no/paamelding.')).toEqual([
      { kind: 'text', value: 'Meld deg på ' },
      { kind: 'link', value: 'https://tb.no/paamelding', href: 'https://tb.no/paamelding' },
      { kind: 'text', value: '.' },
    ])
  })

  it('finner flere lenker på samme linje', () => {
    const tokens = tokenize('https://a.no og https://b.no')
    expect(tokens.filter((t) => t.kind === 'link').map((t) => t.value)).toEqual(['https://a.no', 'https://b.no'])
  })

  it('gir én tekstbit når det ikke finnes lenker', () => {
    expect(tokenize('Ingen lenker her')).toEqual([{ kind: 'text', value: 'Ingen lenker her' }])
  })
})

describe('escapeHtml / bodyToHtml', () => {
  it('escaper alt som kan bryte ut av HTML', () => {
    expect(escapeHtml(`<script>"tag" & 'x'</script>`)).toBe(
      '&lt;script&gt;&quot;tag&quot; &amp; &#39;x&#39;&lt;/script&gt;',
    )
  })

  it('lager avsnitt og linjeskift', () => {
    expect(bodyToHtml('Ett\nTo\n\nTre')).toBe('<p>Ett<br>To</p><p>Tre</p>')
  })

  it('auto-lenker uten å slippe gjennom HTML', () => {
    expect(bodyToHtml('Se <b>https://tb.no</b>')).toBe('<p>Se &lt;b&gt;<a href="https://tb.no">https://tb.no</a>&lt;/b&gt;</p>')
  })

  it('escaper også href-en', () => {
    const html = bodyToHtml(`https://tb.no/"onmouseover="alert(1)`)
    expect(html).not.toContain('onmouseover="alert')
    expect(html).toContain('&quot;')
  })

  it('kan sette avsnittsstil for e-post', () => {
    expect(bodyToHtml('Hei', 'margin:0')).toBe('<p style="margin:0">Hei</p>')
  })
})

describe('recipientsFor', () => {
  const members: PostRecipient[] = [
    { userId: 'medlem', email: 'medlem@tb.no', isActive: true, canPublish: false },
    { userId: 'styret', email: 'styret@tb.no', isActive: true, canPublish: true },
    { userId: 'sluttet', email: 'sluttet@tb.no', isActive: false, canPublish: false },
    { userId: 'uten-epost', email: null, isActive: true, canPublish: false },
    { userId: 'tom-epost', email: '   ', isActive: true, canPublish: false },
  ]
  const normal = { audience: 'all', importance: 'normal' } as const
  const ids = (list: PostRecipient[]) => list.map((r) => r.userId)

  it('tar med aktive medlemmer med e-post', () => {
    expect(ids(recipientsFor(normal, members, new Map()))).toEqual(['medlem', 'styret'])
  })

  it('utelater dem som har slått varsler av', () => {
    expect(ids(recipientsFor(normal, members, { medlem: 'off' }))).toEqual(['styret'])
  })

  it('«bare viktige» får ikke vanlige beskjeder', () => {
    expect(ids(recipientsFor(normal, members, { medlem: 'important' }))).toEqual(['styret'])
  })

  it('«bare viktige» får viktige beskjeder', () => {
    const post = { audience: 'all', importance: 'important' } as const
    expect(ids(recipientsFor(post, members, { medlem: 'important' }))).toEqual(['medlem', 'styret'])
  })

  it('styre-beskjeder går kun til dem som kan publisere', () => {
    const post = { audience: 'board', importance: 'normal' } as const
    expect(ids(recipientsFor(post, members, new Map()))).toEqual(['styret'])
  })

  it('behandler manglende preferanse som «alle»', () => {
    expect(ids(recipientsFor(normal, members, new Map([['styret', 'off']])))).toEqual(['medlem'])
  })
})

describe('canReadPost', () => {
  it('lar alle lese publiserte beskjeder til hele korpset', () => {
    expect(canReadPost({ audience: 'all', publishedAt: 1 }, false)).toBe(true)
  })

  it('skjuler utkast for lesere', () => {
    expect(canReadPost({ audience: 'all', publishedAt: null }, false)).toBe(false)
  })

  it('skjuler styre-beskjeder for lesere', () => {
    expect(canReadPost({ audience: 'board', publishedAt: 1 }, false)).toBe(false)
  })

  it('lar skrivere se alt', () => {
    expect(canReadPost({ audience: 'board', publishedAt: null }, true)).toBe(true)
  })
})

describe('notifyResultMessage', () => {
  it('teller mottakerne som faktisk fikk e-post', () => {
    expect(notifyResultMessage({ sent: 37, logged: 0, failed: 0, skipped: 0 })).toEqual({
      message: 'Sendt til 37 medlemmer.',
      kind: 'ok',
    })
  })

  it('kaller aldri en konsoll-logg for «sendt»', () => {
    const out = notifyResultMessage({ sent: 0, logged: 8, failed: 0, skipped: 0 })
    expect(out.kind).toBe('error')
    expect(out.message).toContain('loggført lokalt')
  })

  it('markerer delvis feil', () => {
    const out = notifyResultMessage({ sent: 30, logged: 0, failed: 2, skipped: 5 })
    expect(out.kind).toBe('error')
    expect(out.message).toBe('Sendt til 30 medlemmer · 2 feilet · 5 hadde den fra før.')
  })

  it('sier fra når alle allerede hadde beskjeden', () => {
    expect(notifyResultMessage({ sent: 0, logged: 0, failed: 0, skipped: 12 }).message).toBe(
      'Publisert. Alle mottakerne har allerede fått e-post.',
    )
  })

  it('sier fra når ingen e-post ble sendt i det hele tatt', () => {
    expect(notifyResultMessage({ sent: 0, logged: 0, failed: 0, skipped: 0 }).message).toBe(
      'Publisert. Ingen e-post ble sendt.',
    )
  })
})

describe('sanitizePostInput', () => {
  const raw = {
    title: '  Viktig melding  ',
    body: '  Hei  ',
    audience: 'board' as const,
    importance: 'important' as const,
    official: true,
  }

  it('lar en skriver sette alt, men trimmer tekst', () => {
    expect(sanitizePostInput(raw, true)).toEqual({
      title: 'Viktig melding',
      body: 'Hei',
      audience: 'board',
      importance: 'important',
      official: true,
    })
  })

  it('stripper privilegerte felter for et vanlig medlem', () => {
    expect(sanitizePostInput(raw, false)).toEqual({
      title: 'Viktig melding',
      body: 'Hei',
      audience: 'all',
      importance: 'normal',
      official: false,
    })
  })

  it('gjør tom tittel til null', () => {
    expect(sanitizePostInput({ ...raw, title: '   ' }, true).title).toBeNull()
    expect(sanitizePostInput({ ...raw, title: null }, false).title).toBeNull()
  })
})

describe('canEditPost / canDeleteComment', () => {
  const me = { id: 'u1' }

  it('lar eieren redigere sitt eget innlegg', () => {
    expect(canEditPost(me, { authorId: 'u1' }, false)).toBe(true)
  })

  it('nekter et medlem å redigere andres innlegg', () => {
    expect(canEditPost(me, { authorId: 'u2' }, false)).toBe(false)
  })

  it('lar en moderator redigere alt', () => {
    expect(canEditPost(me, { authorId: 'u2' }, true)).toBe(true)
  })

  it('gir ikke tilgang til innlegg uten forfatter', () => {
    expect(canEditPost(me, { authorId: null }, false)).toBe(false)
  })

  it('krever innlogging', () => {
    expect(canEditPost(null, { authorId: 'u1' }, true)).toBe(false)
  })

  it('bruker samme regel for kommentarer', () => {
    expect(canDeleteComment(me, { authorId: 'u1' }, false)).toBe(true)
    expect(canDeleteComment(me, { authorId: 'u2' }, false)).toBe(false)
    expect(canDeleteComment(me, { authorId: 'u2' }, true)).toBe(true)
  })
})

describe('postHeading', () => {
  it('bruker tittelen når den finnes', () => {
    expect(postHeading({ title: 'Dugnad', body: 'Vi rigger' })).toBe('Dugnad')
  })

  it('faller tilbake til første linje av teksten', () => {
    expect(postHeading({ title: null, body: 'Noen som har glemt et notestativ?\n\nDet står i gangen.' })).toBe(
      'Noen som har glemt et notestativ?',
    )
  })

  it('korter ned en lang førstelinje', () => {
    const heading = postHeading({ title: '  ', body: 'a'.repeat(120) })
    expect(heading.endsWith('…')).toBe(true)
    expect(heading.length).toBeLessThanOrEqual(71)
  })

  it('gir en rolig fallback for tom tekst', () => {
    expect(postHeading({ title: null, body: '   ' })).toBe('Uten tittel')
  })
})

describe('bilder', () => {
  it('slipper gjennom vanlige bildetyper', () => {
    expect(imageRejectionReason({ type: 'image/jpeg', size: 1000 })).toBeNull()
    expect(imageRejectionReason({ type: 'IMAGE/PNG', size: 1000 })).toBeNull()
  })

  it('avviser andre filtyper', () => {
    expect(imageRejectionReason({ type: 'application/pdf', size: 10 })).toMatch(/Bare bilder/)
  })

  it('avviser for store og tomme filer', () => {
    expect(imageRejectionReason({ type: 'image/jpeg', size: 11 * 1024 * 1024 })).toMatch(/10 MB/)
    expect(imageRejectionReason({ type: 'image/jpeg', size: 0 })).toMatch(/Tom fil/)
  })

  it('utleder endelsen fra innholdstypen, ikke filnavnet', () => {
    expect(imageExtension('image/png')).toBe('png')
    expect(imageExtension('image/heic')).toBe('heic')
    expect(imageExtension('image/jpeg')).toBe('jpg')
    expect(imageExtension('noe/rart')).toBe('jpg')
  })
})

describe('reaksjoner', () => {
  it('slår på og av', () => {
    expect(toggleReaction({ count: 3, mine: false })).toEqual({ count: 4, mine: true })
    expect(toggleReaction({ count: 4, mine: true })).toEqual({ count: 3, mine: false })
  })

  it('går aldri under null', () => {
    expect(toggleReaction({ count: 0, mine: true })).toEqual({ count: 0, mine: false })
  })

  it('formulerer seg riktig', () => {
    expect(reactionLabel({ count: 0, mine: false })).toBe('Ingen har likt dette ennå')
    expect(reactionLabel({ count: 1, mine: false })).toBe('1 liker dette')
    expect(reactionLabel({ count: 3, mine: false })).toBe('3 liker dette')
    expect(reactionLabel({ count: 1, mine: true })).toBe('Du liker dette')
    expect(reactionLabel({ count: 2, mine: true })).toBe('Du og 1 annen liker dette')
    expect(reactionLabel({ count: 4, mine: true })).toBe('Du og 3 andre liker dette')
  })
})

describe('commentCountLabel', () => {
  it('teller riktig', () => {
    expect(commentCountLabel(0)).toBe('Ingen kommentarer ennå')
    expect(commentCountLabel(1)).toBe('1 kommentar')
    expect(commentCountLabel(5)).toBe('5 kommentarer')
  })
})

describe('e-postkopi', () => {
  it('markerer viktige beskjeder i emnefeltet', () => {
    expect(postEmailSubject('Dugnad', false)).toBe('Dugnad')
    expect(postEmailSubject('Dugnad', true)).toBe('Viktig: Dugnad')
  })

  it('sier tydelig at beskjeden er fra styret', () => {
    expect(postEmailFrom('Sindre Ryland', true)).toBe('Fra styret · Sindre Ryland')
    expect(postEmailFrom('Sindre Ryland', false)).toBe('Sindre Ryland')
  })

  it('nevner bildene uten å sende dem', () => {
    expect(postEmailImageNote(0)).toBe('')
    expect(postEmailImageNote(1)).toBe('Ett bilde er lagt ved — se dem på internsiden.')
    expect(postEmailImageNote(3)).toBe('3 bilder er lagt ved — se dem på internsiden.')
  })
})
