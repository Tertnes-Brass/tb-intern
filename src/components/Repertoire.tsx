import { useState, type ReactNode } from 'react'
import type { ProjectWorkDetail } from '../server/projects'
import { formatDuration, toRoman } from '../lib/format'
import { youTubeEmbedUrl, youTubeVideoId } from '../lib/youtube'
import { PercussionLine } from './Percussion'
import { Modal, Stamp } from './ui'

function FileChip({ fileId, label, accent }: { fileId: string; label: string; accent?: boolean }) {
  return (
    <a
      href={`/api/files/${fileId}`}
      target="_blank"
      rel="noreferrer"
      className={`group/chip inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border px-2.5 py-2.5 font-mono text-[0.68rem] uppercase tracking-[0.07em] transition-all duration-150 can-hover:hover:-translate-y-px active:translate-y-0 ${
        accent
          ? 'border-brass/50 bg-[var(--brass-soft)] text-brass-strong hover:border-brass'
          : 'border-line-strong text-ink-soft hover:border-brass/60 hover:text-brass-strong'
      }`}
    >
      <svg width="11" height="13" viewBox="0 0 11 13" fill="none" aria-hidden className="shrink-0">
        <path d="M1 1h6l3 3v8H1V1Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        <path d="M7 1v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      </svg>
      {label}
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        aria-hidden
        className="opacity-60 transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/chip:opacity-70"
      >
        <path d="M2 8L8 2M3.5 2H8v4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  )
}

function ListenButton({ item }: { item: ProjectWorkDetail }) {
  const [open, setOpen] = useState(false)
  const embeddable = item.links.find((l) => l.kind === 'youtube' && youTubeVideoId(l.url))
  const external = item.links.filter((l) => !(l.kind === 'youtube' && youTubeVideoId(l.url)))
  const hasAudio = item.audioFiles.length > 0

  if (!embeddable && !hasAudio && external.length === 0) return null

  // Bare én ekstern lenke og ingenting å spille av inline → gå rett dit
  if (!embeddable && !hasAudio && external.length === 1) {
    return (
      <a
        href={external[0]!.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border border-line-strong px-2.5 py-2.5 font-mono text-[0.68rem] uppercase tracking-[0.07em] text-ink-soft transition-all duration-150 can-hover:hover:-translate-y-px active:translate-y-0 hover:border-oxblood/60 hover:text-oxblood"
      >
        <PlayIcon /> Lytt
      </a>
    )
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border border-line-strong px-2.5 py-2.5 font-mono text-[0.68rem] uppercase tracking-[0.07em] text-ink-soft transition-all duration-150 can-hover:hover:-translate-y-px active:translate-y-0 hover:border-oxblood/60 hover:text-oxblood"
      >
        <PlayIcon /> Lytt
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={item.title} kicker="Lytteeksempler" wide={!!embeddable} mobileFull>
        <div className="space-y-4">
          {embeddable && (
            <div className="overflow-hidden rounded-xl border border-line">
              <iframe
                src={youTubeEmbedUrl(youTubeVideoId(embeddable.url)!)}
                title={`YouTube: ${item.title}`}
                className="aspect-video w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}
          {item.audioFiles.map((a) => (
            <div key={a.id} className="rounded-xl border border-line bg-paper px-4 py-3">
              <p className="mb-2 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-ink-faint">
                {a.label ?? a.fileName}
              </p>
              <audio controls preload="none" src={`/api/files/${a.id}`} className="w-full" />
            </div>
          ))}
          {external.length > 0 && (
            <ul className="space-y-1.5">
              {external.map((l) => (
                <li key={l.id}>
                  <a href={l.url} target="_blank" rel="noreferrer" className="link-brass text-sm">
                    {l.label ?? l.url} ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  )
}

function PlayIcon() {
  return (
    <svg width="10" height="11" viewBox="0 0 10 11" fill="none" aria-hidden>
      <path d="M1.5 1.6v7.8c0 .5.5.8.9.5l6.2-3.9c.4-.2.4-.8 0-1L2.4 1.1c-.4-.3-.9 0-.9.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

export function RepertoireRow({
  item,
  index,
  manage,
  percussion,
  extra,
  shareToken,
}: {
  item: ProjectWorkDetail
  index: number
  manage?: ReactNode
  /**
   * Slagverkslinjen. Uten denne rendres oppsettet skrivebeskyttet fra
   * `item.percussionSetup` — serveren har allerede fjernet feltet for dem som
   * ikke skal se det. Prosjektsiden sender inn den redigerbare varianten.
   */
  percussion?: ReactNode
  /**
   * Alt annet raden skal bære: solister (#50) og min egen øvingsstatus (#30).
   * Ett slot og ikke to props per funksjon — raden skal ikke vokse en ny
   * parameter hver gang prosjektsiden får noe mer å vise.
   */
  extra?: ReactNode
  shareToken?: string
}) {
  const tokenSuffix = shareToken ? `?t=${shareToken}` : ''
  return (
    <li className="hairline-row group/row flex gap-4 py-5 sm:gap-6">
      <span className="roman-no w-9 shrink-0 pt-0.5 text-right text-lg text-brass sm:w-11 sm:text-xl" aria-hidden>
        {toRoman(index)}.
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="display-title text-[1.18rem] font-semibold leading-snug text-ink sm:text-[1.3rem]">
            {item.title}
          </h3>
          {item.durationSec ? (
            <span className="tabular font-mono text-[0.68rem] tracking-wide text-ink-faint">
              {formatDuration(item.durationSec)}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[0.85rem] text-ink-soft">
          {[item.composer, item.arranger ? `arr. ${item.arranger}` : null].filter(Boolean).join(' · ') || '—'}
        </p>
        {item.note && (
          <p className="mt-1.5">
            <Stamp tone="oxblood">{item.note}</Stamp>
          </p>
        )}
        {percussion ?? (item.percussionSetup ? <PercussionLine text={item.percussionSetup} /> : null)}
        {extra}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {item.myFiles.map((f) => (
            <FileChip key={f.id} fileId={`${f.id}${tokenSuffix}`} label={f.partName ?? 'Min stemme'} accent />
          ))}
          {item.scoreFileId && <FileChip fileId={item.scoreFileId} label="Partitur" />}
          <ListenButton item={item} />
          {!shareToken && item.partFiles.length > 0 && <AllPartsDisclosure item={item} />}
          {item.myFiles.length === 0 && !item.scoreFileId && item.partFiles.length === 0 && (
            <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-ink-faint">
              Ingen noter lastet opp ennå
            </span>
          )}
        </div>
      </div>
      {manage && <div className="flex shrink-0 items-start gap-1.5 opacity-100 transition-opacity can-hover:opacity-0 can-hover:group-hover/row:opacity-100">{manage}</div>}
    </li>
  )
}

function AllPartsDisclosure({ item }: { item: ProjectWorkDetail }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-[7px] px-2 py-1.5 font-mono text-[0.68rem] uppercase tracking-[0.07em] text-ink-faint transition-colors hover:text-brass-strong"
      >
        Alle stemmer
        <svg width="9" height="6" viewBox="0 0 9 6" fill="none" aria-hidden>
          <path d="M1 1l3.5 3.5L8 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={item.title} kicker="Alle stemmer" wide>
        <div className="flex flex-wrap gap-2">
          {item.partFiles.map((f) => (
            <FileChip key={f.id} fileId={f.id} label={f.partName ?? 'Ukjent stemme'} />
          ))}
        </div>
      </Modal>
    </>
  )
}

export function RepertoireList({
  items,
  manage,
  percussion,
  extra,
  shareToken,
  className = '',
}: {
  items: ProjectWorkDetail[]
  manage?: (item: ProjectWorkDetail, index: number) => ReactNode
  percussion?: (item: ProjectWorkDetail, index: number) => ReactNode
  extra?: (item: ProjectWorkDetail, index: number) => ReactNode
  shareToken?: string
  className?: string
}) {
  return (
    <ol className={className}>
      {items.map((item, i) => (
        <RepertoireRow
          key={item.workId}
          item={item}
          index={i + 1}
          manage={manage?.(item, i)}
          percussion={percussion?.(item, i)}
          extra={extra?.(item, i)}
          shareToken={shareToken}
        />
      ))}
    </ol>
  )
}
