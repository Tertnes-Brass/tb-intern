/**
 * Markdown i Beskjeder (#79) — rendring og «strip til ren tekst».
 *
 * Ren modul uten server-, DOM- eller Node-avhengigheter: den brukes både i
 * klienten (forhåndsvisningen i `PostForm`, detaljsiden) og på serveren
 * (utdrag, e-post). `marked` er valgt fordi den er ren JavaScript uten
 * Node-moduler og derfor kjører uendret i workerd.
 *
 * ## Sikkerhet — allowlist ved konstruksjon
 *
 * Vi bruker KUN `marked` sin lexer og skriver HTML-en selv. Det betyr at det
 * ikke finnes noe «passthrough» å sanitere i etterkant: hver eneste tag i
 * utdata er skrevet i denne filen, og alt brukerinnhold går gjennom
 * `escapeHtml` på vei ut. Konkret:
 *
 * - **Rå HTML er slått av.** `html`-tokens (både blokk og inline, altså
 *   `<script>`, `<img onerror=…>`, `<iframe>` osv.) escapes og vises som den
 *   teksten de er. Ingenting slippes gjennom som markering — men ingenting
 *   forsvinner heller, slik at «temperaturen er <b> grader» ikke mister et ord.
 * - **Lenker** må ha et trygt skjema (`http:`, `https:`, `mailto:`) eller være
 *   relative/fragmenter. `javascript:`, `data:`, `vbscript:` og alt annet
 *   avvises, og lenketeksten vises som ren tekst i stedet.
 * - **Bilder rendres aldri som `<img>`.** Et eksternt bilde ville lekket
 *   IP-adressen og lesetidspunktet til hvert medlem til en tredjepart, og
 *   ville brutt med at bilder på veggen ellers går gjennom den gatede
 *   opplastingen (`/api/post-images/*`, docs/tilgangsstyring.md §7). De blir
 *   derfor en vanlig lenke som leseren selv må velge å åpne.
 * - **Overskrifter starter på `h2`.** Sidens `h1` er innleggets tittel;
 *   `#` i teksten skal ikke konkurrere med den i dokumentstrukturen.
 *
 * `breaks: true` er bevisst: et enkelt linjeskift blir `<br>`, slik det alltid
 * har vært for ren tekst på veggen. Ingen skal oppdage at de må trykke enter to
 * ganger for å få linjeskift.
 */
import { Lexer, type MarkedToken, type Token, type Tokens } from 'marked'
import { type PostFormat, escapeHtml } from './posts'

/** Lexer-oppsettet. GFM gir tabeller, gjennomstreking og oppgavelister. */
const LEX_OPTIONS = { gfm: true, breaks: true, pedantic: false, silent: true }

/** Skjemaene en lenke får ha. Alt annet blir ren tekst. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/**
 * Kontrolltegn og mellomrom som skal bort før skjemasjekken. Nettlesere
 * stripper tab, linjeskift og NUL fra URL-er, så `java\tscript:alert(1)` ville
 * ellers sluppet forbi en naiv sjekk og blitt kjørbar.
 */
const URL_NOISE = /[\u0000-\u0020\u007f]/g

/** Elementene som kan få en inline-stil (e-post kan ikke bruke klasser). */
export type MarkdownStyleKey =
  | 'p'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'ul'
  | 'ol'
  | 'li'
  | 'blockquote'
  | 'pre'
  | 'code'
  | 'codespan'
  | 'a'
  | 'hr'
  | 'tableWrap'
  | 'table'
  | 'th'
  | 'td'

export type MarkdownStyles = Partial<Record<MarkdownStyleKey, string>>

export type MarkdownOptions = {
  /**
   * Nivået `#` skal bli. Standard `2`, fordi sidens `h1` allerede er tatt.
   * `##` blir da `h3` og så videre, klemt mot `h6`.
   */
  headingLevel?: number
  /**
   * Inline-stiler per element. Tom for nettsiden (der `.prose` i
   * `src/styles.css` gjør jobben), satt for e-post.
   */
  styles?: MarkdownStyles
}

type Ctx = { base: number; styles: MarkdownStyles }

/**
 * Inline-stilene e-posten bruker. E-postklienter støtter ikke klasser eller
 * eksterne stilark, så de vanligste elementene får sin stil med seg. Fargene er
 * de samme som i det lyse temaet i `src/styles.css` — e-post har ikke tema.
 */
export const EMAIL_MARKDOWN_STYLES: MarkdownStyles = {
  p: 'margin:0 0 16px',
  h2: 'margin:24px 0 10px;font-family:Georgia,serif;font-size:20px;line-height:1.25;color:#211b12',
  h3: 'margin:20px 0 8px;font-family:Georgia,serif;font-size:17px;line-height:1.3;color:#211b12',
  h4: 'margin:18px 0 8px;font-family:Georgia,serif;font-size:15px;line-height:1.3;color:#211b12',
  h5: 'margin:16px 0 6px;font-size:14px;color:#211b12',
  h6: 'margin:16px 0 6px;font-size:13px;color:#211b12',
  ul: 'margin:0 0 16px;padding-left:22px',
  ol: 'margin:0 0 16px;padding-left:22px',
  li: 'margin:0 0 6px',
  blockquote: 'margin:0 0 16px;padding:2px 0 2px 14px;border-left:3px solid #ddd2ba;color:#8e8468',
  pre: 'margin:0 0 16px;padding:12px;background:#efe7d6;border-radius:8px;overflow-x:auto',
  code: 'font-family:Menlo,monospace;font-size:13px;line-height:1.5',
  codespan: 'padding:1px 4px;background:#efe7d6;border-radius:4px;font-family:Menlo,monospace;font-size:13px',
  a: 'color:#7a5f1d',
  hr: 'margin:24px 0;border:0;border-top:1px solid #ddd2ba',
  tableWrap: 'margin:0 0 16px;overflow-x:auto',
  table: 'border-collapse:collapse;font-size:14px',
  th: 'padding:6px 10px;border:1px solid #ddd2ba;background:#efe7d6;text-align:left;font-weight:600',
  td: 'padding:6px 10px;border:1px solid #ddd2ba',
}

/** `null` = lenken er ikke trygg og skal ikke bli en `<a>`. */
export function safeHref(raw: string): string | null {
  const cleaned = raw.replace(URL_NOISE, '').trim()
  if (!cleaned) return null
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned)
  // Ingen skjema = relativ lenke eller et fragment på siden — begge greit.
  if (scheme && !SAFE_SCHEMES.has(`${scheme[1]!.toLowerCase()}:`)) return null
  try {
    // Samme normalisering som marked selv gjør: enkoder alt som kan bryte ut av
    // attributtet, men lar allerede prosentenkodede URL-er være i fred.
    return encodeURI(cleaned).replace(/%25/g, '%')
  } catch {
    return null
  }
}

/** Åpner en tag med inline-stil hvis den er satt. */
function open(ctx: Ctx, tag: string, key: MarkdownStyleKey, extra = ''): string {
  const style = ctx.styles[key]
  return `<${tag}${extra}${style ? ` style="${escapeHtml(style)}"` : ''}>`
}

/** Bare http(s) åpnes i ny fane; `mailto:` og relative lenker blir i samme. */
function isExternal(href: string): boolean {
  return /^(https?:)?\/\//i.test(href)
}

// ---------- Rendring til HTML ----------

/**
 * Markdown → sanitert HTML. Utdata inneholder kun taggene denne filen skriver,
 * og kan derfor settes inn med `dangerouslySetInnerHTML` uten et ekstra
 * saniteringssteg.
 */
export function markdownToHtml(source: string, options: MarkdownOptions = {}): string {
  const text = (source ?? '').trim()
  if (!text) return ''
  const ctx: Ctx = {
    base: Math.min(6, Math.max(1, options.headingLevel ?? 2)),
    styles: options.styles ?? {},
  }
  return blocks(Lexer.lex(text, LEX_OPTIONS), ctx)
}

function blocks(tokens: Token[], ctx: Ctx): string {
  return tokens.map((t) => block(t, ctx)).join('')
}

function block(token: Token, ctx: Ctx): string {
  // Lexeren vår har ingen utvidelser, så alle tokens er kjente typer.
  const t = token as MarkedToken
  switch (t.type) {
    case 'space':
      return ''
    case 'hr':
      return open(ctx, 'hr', 'hr')
    case 'heading': {
      const level = Math.min(6, ctx.base + t.depth - 1)
      const tag = `h${level}` as 'h2'
      return `${open(ctx, tag, tag)}${inlines(t.tokens, ctx)}</${tag}>`
    }
    case 'code': {
      const lang = (t.lang ?? '').trim().split(/\s+/)[0] ?? ''
      const cls = /^[A-Za-z0-9_+-]{1,24}$/.test(lang) ? ` class="language-${lang}"` : ''
      return `${open(ctx, 'pre', 'pre')}${open(ctx, 'code', 'code', cls)}${escapeHtml(t.text)}</code></pre>`
    }
    case 'blockquote':
      return `${open(ctx, 'blockquote', 'blockquote')}${blocks(t.tokens, ctx)}</blockquote>`
    case 'list':
      return list(t, ctx)
    case 'table':
      return table(t, ctx)
    case 'paragraph':
      return `${open(ctx, 'p', 'p')}${inlines(t.tokens, ctx)}</p>`
    case 'text':
      // Løse tekstlinjer (bl.a. innholdet i en «tett» liste) står uten <p>.
      return t.tokens ? inlines(t.tokens, ctx) : escapeHtml(t.text)
    case 'checkbox':
      return checkbox(t.checked)
    case 'html':
      // Rå HTML er tekst, ikke markering: escapes og vises som skrevet.
      return `${open(ctx, 'p', 'p')}${escapeHtml(t.text.trim())}</p>`
    // Lenkedefinisjoner (`[id]: https://…`) har ingen synlig utdata.
    case 'def':
      return ''
    default:
      return ''
  }
}

/** `- [x] Ferdig` blir et tegn, ikke et `<input>` — allowlisten holdes liten. */
function checkbox(checked: boolean | undefined): string {
  return checked ? '☑ ' : '☐ '
}

function list(token: Tokens.List, ctx: Ctx): string {
  const tag = token.ordered ? 'ol' : 'ul'
  const start =
    token.ordered && typeof token.start === 'number' && Number.isInteger(token.start) && token.start !== 1
      ? ` start="${token.start}"`
      : ''
  const items = token.items.map((item) => `${open(ctx, 'li', 'li')}${blocks(item.tokens, ctx)}</li>`).join('')
  return `${open(ctx, tag, tag, start)}${items}</${tag}>`
}

function table(token: Tokens.Table, ctx: Ctx): string {
  const cell = (c: Tokens.TableCell, header: boolean): string => {
    const tag = header ? 'th' : 'td'
    // Justeringen kommer fra lexeren ('left' | 'center' | 'right' | null), aldri
    // fra brukerens tekst — men den escapes uansett sammen med resten av stilen.
    const align = c.align ? `text-align:${c.align}` : ''
    const style = [ctx.styles[tag] ?? '', align].filter(Boolean).join(';')
    return `<${tag}${style ? ` style="${escapeHtml(style)}"` : ''}>${inlines(c.tokens, ctx)}</${tag}>`
  }
  const head = `<thead><tr>${token.header.map((c) => cell(c, true)).join('')}</tr></thead>`
  const body = token.rows.length
    ? `<tbody>${token.rows.map((r) => `<tr>${r.map((c) => cell(c, false)).join('')}</tr>`).join('')}</tbody>`
    : ''
  // Wrapperen gir tabellen vannrett scroll på mobil i stedet for å sprenge siden.
  return `${open(ctx, 'div', 'tableWrap', ' class="prose-table"')}${open(ctx, 'table', 'table')}${head}${body}</table></div>`
}

function inlines(tokens: Token[] | undefined, ctx: Ctx): string {
  if (!tokens) return ''
  return tokens.map((t) => inline(t, ctx)).join('')
}

function inline(token: Token, ctx: Ctx): string {
  const t = token as MarkedToken
  switch (t.type) {
    case 'text':
      return t.tokens ? inlines(t.tokens, ctx) : escapeHtml(t.text)
    case 'escape':
      return escapeHtml(t.text)
    case 'strong':
      return `<strong>${inlines(t.tokens, ctx)}</strong>`
    case 'em':
      return `<em>${inlines(t.tokens, ctx)}</em>`
    case 'del':
      return `<del>${inlines(t.tokens, ctx)}</del>`
    case 'codespan':
      return `${open(ctx, 'code', 'codespan')}${escapeHtml(t.text)}</code>`
    case 'br':
      return '<br>'
    case 'link':
      return anchor(t.href, t.title ?? null, inlines(t.tokens, ctx), ctx)
    case 'image':
      return image(t, ctx)
    case 'checkbox':
      return checkbox(t.checked)
    // Rå HTML («<script>», «<b>») er tekst vi escaper, ikke markering vi stoler på.
    case 'html':
      return escapeHtml(t.text)
    default:
      return ''
  }
}

function anchor(href: string, title: string | null, label: string, ctx: Ctx): string {
  const safe = safeHref(href)
  // Utrygg lenke: behold teksten, mist lenken. Leseren ser hva som stod der.
  if (!safe) return label
  const extras = isExternal(safe) ? ' target="_blank" rel="noopener noreferrer nofollow"' : ' rel="nofollow"'
  const t = title ? ` title="${escapeHtml(title)}"` : ''
  return `${open(ctx, 'a', 'a', ` href="${escapeHtml(safe)}"${t}${extras}`)}${label}</a>`
}

/**
 * `![alt](url)` blir en lenke, aldri en `<img>`. Se sikkerhetsnotatet øverst:
 * et eksternt bilde ville lastet av seg selv og fortalt en tredjepart hvem som
 * leser veggen og når. Bilder som hører til innlegget lastes opp gjennom den
 * gatede flyten i stedet, og vises under teksten.
 */
function image(token: Tokens.Image, ctx: Ctx): string {
  const alt = token.text.trim()
  const label = alt ? `${escapeHtml(alt)} (bilde)` : 'Bilde'
  return anchor(token.href, token.title ?? null, label, ctx)
}

// ---------- Rendring til ren tekst ----------

/**
 * Markdown → lesbar ren tekst. Brukes til utdrag i feeden, tittel-fallback,
 * e-postemne og tekstversjonen av e-posten — ingen av dem skal vise `#` eller
 * `**`. Avsnittsstrukturen beholdes, slik at `paragraphs()` og `excerpt()` i
 * `lib/posts.ts` virker uendret på resultatet.
 */
export function markdownToPlainText(source: string): string {
  const text = (source ?? '').trim()
  if (!text) return ''
  return textBlocks(Lexer.lex(text, LEX_OPTIONS))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function textBlocks(tokens: Token[]): string {
  return tokens
    .map((t) => textBlock(t))
    .filter((s) => s.trim().length > 0)
    .join('\n\n')
}

function textBlock(token: Token): string {
  const t = token as MarkedToken
  switch (t.type) {
    case 'heading':
    case 'paragraph':
      return textInlines(t.tokens)
    case 'text':
      return t.tokens ? textInlines(t.tokens) : t.text
    case 'code':
      return t.text
    case 'blockquote':
      return textBlocks(t.tokens)
    case 'list': {
      const first = typeof t.start === 'number' ? t.start : 1
      return t.items
        .map((item, i) => {
          const marker = t.ordered ? `${first + i}. ` : '• '
          return `${marker}${textBlocks(item.tokens).replace(/\s*\n\s*/g, ' ')}`
        })
        .join('\n')
    }
    case 'table':
      return [t.header, ...t.rows].map((row) => row.map((c) => textInlines(c.tokens)).join(' · ')).join('\n')
    case 'checkbox':
      return t.checked ? '[x]' : '[ ]'
    case 'html':
      return t.text.trim()
    // Skillelinjer og lenkedefinisjoner har ingen tekst å vise.
    case 'hr':
    case 'def':
    case 'space':
      return ''
    default:
      return ''
  }
}

function textInlines(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  return tokens.map((t) => textInline(t)).join('')
}

function textInline(token: Token): string {
  const t = token as MarkedToken
  switch (t.type) {
    case 'text':
      return t.tokens ? textInlines(t.tokens) : t.text
    case 'escape':
    case 'codespan':
      return t.text
    case 'strong':
    case 'em':
    case 'del':
      return textInlines(t.tokens)
    case 'link':
      // Lenketeksten er det leserverdige; URL-en ville tatt hele utdraget.
      return textInlines(t.tokens)
    case 'image':
      return t.text.trim() || 'Bilde'
    case 'br':
      return '\n'
    case 'checkbox':
      return t.checked ? '[x] ' : '[ ] '
    case 'html':
      return t.text
    default:
      return ''
  }
}

// ---------- Felles inngang for begge formatene ----------

/**
 * Teksten uten formateringsstøy, uansett format. Serveren bruker den før
 * `excerpt()`/`postHeading()` og i tekstversjonen av e-posten, slik at et
 * markdown-innlegg aldri viser `#` eller `**` i feeden, på hub-en eller i
 * emnefeltet.
 */
export function postPlainText(body: string, format: PostFormat): string {
  return format === 'markdown' ? markdownToPlainText(body) : body
}
