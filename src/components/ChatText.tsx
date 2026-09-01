import { useMemo, useState } from 'react'
import { type ChatSegment, parseChatText } from '../lib/chat-format'
import { type MentionUser, UNKNOWN_MENTION, mentionTokens } from '../lib/mentions'

/**
 * Meldingsteksten med kodeformatering (`src/lib/chat-format.ts`) og omtaler.
 * Alt annet enn backticks er ren tekst — ingen markdown, ingen HTML. React
 * rendrer bitene som tekstnoder, så et `<script>` i en melding er akkurat like
 * ufarlig som resten.
 *
 * Omtalene løses KUN i tekst-bitene: en markør inne i `kode` eller en kodeblokk
 * står som skrevet, akkurat som `@` ellers gjør det der.
 */
export function ChatText({ text, mentions = [] }: { text: string; mentions?: MentionUser[] }) {
  const segments = useMemo(() => parseChatText(text), [text])
  return (
    <>
      {segments.map((segment, i) => (
        <Segment key={i} segment={segment} mentions={mentions} />
      ))}
    </>
  )
}

function Segment({ segment, mentions }: { segment: ChatSegment; mentions: MentionUser[] }) {
  if (segment.type === 'text') return <MentionedText text={segment.value} mentions={mentions} />
  if (segment.type === 'code') return <code className="chat-code">{segment.value}</code>
  return <CodeBlock value={segment.value} lang={segment.lang} />
}

/** Ren tekst der markørene er blitt chips — samme chip som på veggen. */
function MentionedText({ text, mentions }: { text: string; mentions: MentionUser[] }) {
  const tokens = useMemo(() => mentionTokens(text, mentions), [text, mentions])
  return (
    <>
      {tokens.map((token, i) =>
        token.kind === 'text' ? (
          <span key={i}>{token.value}</span>
        ) : (
          <span key={i} className={token.name === null ? 'mention mention-unknown' : 'mention'}>
            {token.name === null ? UNKNOWN_MENTION : `@${token.name}`}
          </span>
        ),
      )}
    </>
  )
}

/**
 * Kodeblokk: mono, egen ramme og horisontal scroll i stedet for ombrekking —
 * en SQL-linje som brekker midt i er verre å lese enn en man drar på. Derfor
 * ligger «Kopier» rett over blokken, så mobilbrukeren slipper å markere tekst
 * i en boks som scroller.
 */
function CodeBlock({ value, lang }: { value: string; lang: string | null }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_500)
    } catch {
      // Uten utklippstavle (eldre nettleser, ingen tillatelse) er teksten
      // fortsatt markerbar. Ingen feilmelding for noe så lite.
    }
  }

  return (
    <span className="my-1 block whitespace-normal">
      <span className="mb-1 flex items-center justify-between gap-2">
        <span className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-ink-faint">{lang ?? 'Kode'}</span>
        <button
          type="button"
          onClick={copy}
          className="cursor-pointer font-mono text-[0.58rem] uppercase tracking-[0.12em] text-ink-faint transition-colors hover:text-brass"
        >
          {copied ? 'Kopiert' : 'Kopier'}
        </button>
      </span>
      <pre className="chat-block">
        <code>{value}</code>
      </pre>
    </span>
  )
}
