/**
 * Kodeformatering i chatten (#80) — og bevisst ingenting mer.
 *
 * Chatten skal kunne vise `felt_navn` og en liten blokk med SQL uten å bli en
 * markdown-editor: stjerner, understreker, overskrifter, lenker og rå HTML er
 * ren tekst. Derfor er dette en egen, liten tokenizer og IKKE en
 * markdown-rendrer — den kjenner bare backticks.
 *
 * Sikkerhet: funksjonen produserer aldri HTML. Den deler teksten i biter som
 * React rendrer som tekstnoder (`<code>`/`<pre>`), og React escaper dem. Det
 * finnes ingen `dangerouslySetInnerHTML` i denne veien, så `<script>` i en
 * melding er akkurat like ufarlig inne i en kodeblokk som utenfor.
 *
 * Regler:
 * - ``` … ``` er en blokk. Første linje kan være en språkmarkør; den tolkes
 *   ikke, men vises diskret over blokken.
 * - `` … `` er inline kode, og brukes når koden selv inneholder en backtick.
 * - ` … ` er inline kode.
 * - En backtick uten avslutning er bare en backtick.
 */

export type ChatSegment =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'block'; value: string; lang: string | null }

const FENCE = '```'

/** Ett mellomrom på hver side strippes, slik at `` ` `` kan skrives som `` ` ``. */
function trimInline(value: string): string {
  if (value.length > 1 && value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '') {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Deler meldingsteksten i tekst, inline kode og kodeblokker. Ugyldige/uavsluttede
 * backticks blir stående som tekst — en halvskrevet melding skal aldri kunne
 * spise resten av tråden.
 */
export function parseChatText(input: string): ChatSegment[] {
  const segments: ChatSegment[] = []
  let text = ''
  let i = 0

  const flush = () => {
    if (text) segments.push({ type: 'text', value: text })
    text = ''
  }

  while (i < input.length) {
    const char = input[i]!
    if (char !== '`') {
      text += char
      i += 1
      continue
    }

    // ---- Kodeblokk ----
    if (input.startsWith(FENCE, i)) {
      const end = input.indexOf(FENCE, i + FENCE.length)
      if (end !== -1) {
        const raw = input.slice(i + FENCE.length, end)
        const newline = raw.indexOf('\n')
        // Alt på åpningslinja er språkmarkør (som i markdown) — den tolkes ikke.
        const lang = newline === -1 ? null : raw.slice(0, newline).trim() || null
        const bodyRaw = newline === -1 ? raw.trim() : raw.slice(newline + 1)
        // Linjeskiftet rett før den avsluttende gjerdet hører til syntaksen,
        // ikke til koden.
        const value = bodyRaw.replace(/\n[ \t]*$/, '')
        flush()
        segments.push({ type: 'block', value, lang })
        i = end + FENCE.length
        continue
      }
      // Ingen avslutning: tre backticks er bare tre backticks.
      text += FENCE
      i += FENCE.length
      continue
    }

    // ---- Inline med doble backticks (koden inneholder selv en backtick) ----
    if (input.startsWith('``', i)) {
      const end = input.indexOf('``', i + 2)
      const value = end === -1 ? '' : trimInline(input.slice(i + 2, end))
      if (end !== -1 && value.trim() !== '') {
        flush()
        segments.push({ type: 'code', value })
        i = end + 2
        continue
      }
      text += '``'
      i += 2
      continue
    }

    // ---- Inline med én backtick ----
    const end = input.indexOf('`', i + 1)
    const value = end === -1 ? '' : trimInline(input.slice(i + 1, end))
    if (end !== -1 && value.trim() !== '') {
      flush()
      segments.push({ type: 'code', value })
      i = end + 1
      continue
    }
    text += '`'
    i += 1
  }

  flush()
  return segments
}

/** Har meldingen kodeformatering i det hele tatt? Brukes til å slippe krom. */
export function hasCode(segments: ChatSegment[]): boolean {
  return segments.some((s) => s.type !== 'text')
}

/**
 * Meldingen som ren lesbar tekst — uten backticks, men med koden i behold.
 * Brukes der en melding skal komprimeres til én linje (svarreferansen), slik at
 * referansen ikke viser syntaks brukeren ikke skrev for å bli lest.
 */
export function chatPlainText(input: string): string {
  return parseChatText(input)
    .map((s) => s.value)
    .join('')
}
