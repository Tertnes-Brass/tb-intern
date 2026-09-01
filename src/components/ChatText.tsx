import { useMemo, useState } from 'react'
import { type ChatSegment, parseChatText } from '../lib/chat-format'

/**
 * Meldingsteksten med kodeformatering (`src/lib/chat-format.ts`). Alt annet enn
 * backticks er ren tekst — ingen markdown, ingen HTML. React rendrer bitene som
 * tekstnoder, så et `<script>` i en melding er akkurat like ufarlig som resten.
 */
export function ChatText({ text }: { text: string }) {
  const segments = useMemo(() => parseChatText(text), [text])
  return (
    <>
      {segments.map((segment, i) => (
        <Segment key={i} segment={segment} />
      ))}
    </>
  )
}

function Segment({ segment }: { segment: ChatSegment }) {
  if (segment.type === 'text') return <>{segment.value}</>
  if (segment.type === 'code') return <code className="chat-code">{segment.value}</code>
  return <CodeBlock value={segment.value} lang={segment.lang} />
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
