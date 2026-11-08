/**
 * Det som står over «Legg til» i Tertnes — både for en ferdig GIF og i «Lag GIF
 * fra video»: at GIF-ene bare ligger internt, og avkrysningen for at alle som er
 * med har sagt ja. Avkrysningen er påkrevd; serveren avviser opplastingen uten
 * (`BAND_MEDIA_CONSENT_REQUIRED` i src/lib/band-media.ts).
 */
export function BandMediaConsent({
  checked,
  onChange,
  disabled,
  compact = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** Mindre tekst — i det lille panelet i GIF-velgeren. */
  compact?: boolean
}) {
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <p className={`rounded-[8px] bg-[var(--brass-soft)] leading-snug text-ink-soft ${compact ? 'px-2.5 py-2 text-[0.75rem]' : 'px-3 py-2.5 text-[0.8rem]'}`}>
        <span className="font-semibold text-ink">Lagres bare internt.</span> GIF-ene i Tertnes ligger på internsidene og publiseres ikke på
        internett. Bare innloggede medlemmer kan se dem — men alle medlemmer kan se og bruke dem.
      </p>
      <label className={`flex cursor-pointer items-start gap-2.5 leading-snug ${compact ? 'text-[0.78rem]' : 'text-[0.85rem]'}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--brass)]"
        />
        <span>
          <span className="block font-semibold text-ink">Alle som er med, har sagt ja</span>
          <span className="block text-ink-soft">
            Jeg har spurt alle som kan kjennes igjen i GIF-en, og de er med på at den ligger her. Er det ingen personer i den, kan du krysse av.
          </span>
        </span>
      </label>
    </div>
  )
}
