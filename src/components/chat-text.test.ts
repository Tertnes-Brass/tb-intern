import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatText } from './ChatText'

/**
 * Rendringen av en melding. Poenget er ikke React, men de to løftene i #80:
 * kode blir `<code>`/`<pre>`, og ALT brukerinnhold escapes — kodeformatering
 * skal ikke være en bakvei for rå HTML.
 */
const render = (text: string, mentions: Array<{ id: string; name: string }> = []) =>
  renderToStaticMarkup(createElement(ChatText, { text, mentions }))

describe('ChatText', () => {
  it('viser inline kode som <code>', () => {
    expect(render('feltet heter `felt_navn`')).toContain('<code class="chat-code">felt_navn</code>')
  })

  it('viser en blokk som <pre><code> med kopier-knapp', () => {
    const html = render('```sql\nselect 1;\n```')
    expect(html).toContain('<pre class="chat-block"><code>select 1;</code></pre>')
    expect(html).toContain('Kopier')
    expect(html).toContain('sql')
  })

  it('escaper HTML i kode', () => {
    const html = render('```\n<script>alert(1)</script>\n```')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('escaper HTML i ren tekst', () => {
    const html = render('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
  })

  it('tolker ikke annen markdown', () => {
    expect(render('**ikke fet**')).toContain('**ikke fet**')
    expect(render('**ikke fet**')).not.toContain('<strong>')
  })

  it('gjør en omtale om til en chip med dagens navn', () => {
    const html = render('Hei @[u:u1], tar du den?', [{ id: 'u1', name: 'Ola Nordmann' }])
    expect(html).toContain('<span class="mention">@Ola Nordmann</span>')
    expect(html).not.toContain('@[u:')
  })

  it('viser «Ukjent medlem» for en slettet bruker — aldri rå markørtekst', () => {
    const html = render('Hei @[u:borte]')
    expect(html).toContain('Ukjent medlem')
    expect(html).not.toContain('@[u:')
  })

  it('lar en markør INNE i kode stå som skrevet', () => {
    const html = render('formatet er `@[u:u1]`', [{ id: 'u1', name: 'Ola Nordmann' }])
    expect(html).toContain('<code class="chat-code">@[u:u1]</code>')
    expect(html).not.toContain('Ola Nordmann')
  })

  it('escaper navnet — et navn er brukerinnhold', () => {
    const html = render('@[u:u1]', [{ id: 'u1', name: '<img src=x onerror=alert(1)>' }])
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
  })
})
