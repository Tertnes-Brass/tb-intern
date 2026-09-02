import { Field, Stamp } from './ui'
import {
  INTEREST_CATALOG,
  type InterestKey,
  MAX_INSTRUMENT_NOTE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_SECONDARY_PARTS,
  interestLabel,
} from '../lib/member-profile'
import { SECTION_LABELS, SECTION_ORDER } from '../lib/taxonomy'

/**
 * Feltene i den utvidede medlemsprofilen (#14 + #25), delt av `/min-profil` og
 * medlemsansvarliges dialog i `/medlemmer`. Ett skjema ett sted: skal et medlem
 * kunne be medlemsansvarlig fylle ut noe for seg, må de to se det samme.
 *
 * Rene props, ingen serverkall og ingen tilgangslogikk — den som rendrer har
 * allerede fått avgjort server-side om hen får skrive.
 */

export type PartOption = {
  id: string
  name: string
  section: string
  parentId: string | null
}

export type MemberDetailsValue = {
  phone: string
  /** Nøkler fra katalogen — samme type som serverens validator krever. */
  interests: InterestKey[]
  interestsNote: string
  otherInstruments: string
  secondaryPartIds: string[]
}

export function MemberDetailsFields({
  value,
  onChange,
  allParts,
  assignedPartIds,
  phoneHint,
  idPrefix,
}: {
  value: MemberDetailsValue
  onChange: (next: MemberDetailsValue) => void
  allParts: PartOption[]
  /** Tildelte stemmer — kan ikke også være bistemme (samme regel server-side). */
  assignedPartIds: string[]
  phoneHint: string
  /** Skiller radioknapp-/felt-navn når begge skjemaene finnes på samme side. */
  idPrefix: string
}) {
  const set = (patch: Partial<MemberDetailsValue>) => onChange({ ...value, ...patch })

  const partById = new Map(allParts.map((p) => [p.id, p]))
  const chosen = value.secondaryPartIds.flatMap((id) => {
    const part = partById.get(id)
    return part ? [part] : []
  })
  const atCap = value.secondaryPartIds.length >= MAX_SECONDARY_PARTS

  // Samme optgroup-mønster som invitasjonsdialogen: 21 like linjer i én select
  // er uleselig på telefon.
  const sectionLabels: Record<string, string> = { ...SECTION_LABELS }
  const knownSections: string[] = [...SECTION_ORDER]
  const bySection = new Map<string, PartOption[]>()
  for (const part of allParts) {
    if (assignedPartIds.includes(part.id) || value.secondaryPartIds.includes(part.id)) continue
    const list = bySection.get(part.section) ?? []
    list.push(part)
    bySection.set(part.section, list)
  }
  const groups = [
    ...knownSections.filter((key) => bySection.has(key)),
    ...[...bySection.keys()].filter((key) => !knownSections.includes(key)),
  ].map((key) => ({ key, parts: bySection.get(key) ?? [] }))

  const toggleInterest = (key: InterestKey) =>
    set({
      interests: value.interests.includes(key)
        ? value.interests.filter((k) => k !== key)
        : [...value.interests, key],
    })

  return (
    <>
      <Field label="Telefon" hint={phoneHint}>
        <input
          type="tel"
          className="field-input min-h-[44px]"
          value={value.phone}
          onChange={(e) => set({ phone: e.target.value })}
          autoComplete="tel"
          inputMode="tel"
          placeholder="+47 900 00 000"
        />
      </Field>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[0.8rem] font-medium text-ink-soft">Bistemmer</span>
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
            {value.secondaryPartIds.length}/{MAX_SECONDARY_PARTS}
          </span>
        </div>
        {chosen.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2">
            {chosen.map((part) => (
              <li key={part.id}>
                <button
                  type="button"
                  onClick={() => set({ secondaryPartIds: value.secondaryPartIds.filter((id) => id !== part.id) })}
                  aria-label={`Fjern ${part.name}`}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-xs text-ink transition-colors hover:border-danger/50 hover:text-danger"
                >
                  {part.name}
                  <svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
        <select
          className="field-input min-h-[44px]"
          value=""
          disabled={atCap}
          onChange={(e) => {
            if (!e.target.value) return
            set({ secondaryPartIds: [...value.secondaryPartIds, e.target.value] })
          }}
        >
          <option value="">
            {atCap
              ? `Maks ${MAX_SECONDARY_PARTS} bistemmer er valgt`
              : chosen.length > 0
                ? 'Legg til én bistemme til…'
                : 'Velg bistemme…'}
          </option>
          {groups.map((group) => (
            <optgroup key={group.key} label={sectionLabels[group.key] ?? 'Annen seksjon'}>
              {group.parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.parentId ? `↳ ${p.name}` : p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="mt-1 block text-xs leading-relaxed text-ink-faint">
          Instrumenter du kan trå til på ved behov. Bistemmer gir ingen tilgang til noter — hovedstemmen settes fortsatt
          av medlemsansvarlig eller seksjonsleder.
        </span>
      </div>

      <Field
        label="Andre instrumenter"
        hint={`Utenfor besetningen: piano, gitar, sang … Maks ${MAX_INSTRUMENT_NOTE_LENGTH} tegn.`}
      >
        <input
          className="field-input min-h-[44px]"
          value={value.otherInstruments}
          onChange={(e) => set({ otherInstruments: e.target.value })}
          maxLength={MAX_INSTRUMENT_NOTE_LENGTH}
          placeholder="Piano, sang"
        />
      </Field>

      <div>
        <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-soft">Interesser og kompetanse</span>
        <div className="grid gap-1 sm:grid-cols-2">
          {INTEREST_CATALOG.map((interest) => (
            <label
              key={interest.key}
              className="flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-paper-sunken"
            >
              <input
                type="checkbox"
                name={`${idPrefix}-interest`}
                checked={value.interests.includes(interest.key)}
                onChange={() => toggleInterest(interest.key)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--brass)]"
              />
              <span className="min-w-0">
                <span className="block text-sm text-ink">{interest.label}</span>
                <span className="block text-xs leading-snug text-ink-faint">{interest.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <Field
        label="Utfyllende om det du kan bidra med"
        hint={`Valgfritt. Maks ${MAX_NOTE_LENGTH} tegn — synlig for de andre medlemmene.`}
      >
        <textarea
          className="field-input min-h-[92px] resize-y"
          value={value.interestsNote}
          onChange={(e) => set({ interestsNote: e.target.value })}
          maxLength={MAX_NOTE_LENGTH}
          rows={3}
          placeholder="Har hengerfeste og kan kjøre utstyr. Kan hjelpe med lyd."
        />
      </Field>
    </>
  )
}

/** Interessene som stempler — samme visning i medlemslista og på profilen. */
export function InterestStamps({ interests }: { interests: readonly string[] }) {
  if (interests.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1.5">
      {interests.map((key) => (
        <Stamp key={key}>{interestLabel(key)}</Stamp>
      ))}
    </span>
  )
}
