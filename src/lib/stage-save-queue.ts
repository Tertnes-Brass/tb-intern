/**
 * Autolagring for sceneoppsettet. Én skriving om gangen, med en kort pause
 * etter siste endring, og endringer som kommer MENS en lagring pågår blir med i
 * neste runde før statusen blir «Lagret».
 *
 * Revisjonen følger med hver skriving. Svarer serveren at noen andre har
 * lagret i mellomtiden, stopper køen i `conflict` — den prøver aldri på nytt
 * av seg selv, for det ville overskrevet den andres arbeid.
 *
 * Ren TypeScript uten React og Excalidraw, så den kan testes for seg (porten er
 * tatt fra `CanvasSaveQueue` i trestl).
 */

export type StageDraft = { title: string; notes: string; scene: unknown }

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict'

export type StageConflict = { revision: number; updatedAt: number; updatedByName: string | null }

export type StageWriteResult =
  | { ok: true; revision: number; updatedAt: number }
  | { ok: false; conflict: StageConflict }

export type StageWriter = (draft: StageDraft, expectedRevision: number) => Promise<StageWriteResult>

/**
 * JSON med sorterte nøkler: Excalidraw og databasen kan gi samme innhold med
 * nøklene i ulik rekkefølge, og det skal ikke se ut som en endring.
 */
export function stableSnapshot(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  )
}

export class StageSaveQueue {
  draft: StageDraft
  revision: number
  status: SaveStatus = 'saved'
  error: unknown = undefined
  conflict: StageConflict | null = null
  lastSavedAt: number | null = null
  private saved: string
  private current: string
  private running: Promise<boolean> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    initial: StageDraft,
    revision: number,
    private write: StageWriter,
    private notify: () => void,
    private delayMs = 1200,
  ) {
    this.draft = initial
    this.revision = revision
    this.saved = this.current = stableSnapshot(initial)
  }

  get dirty(): boolean {
    return this.current !== this.saved
  }

  /**
   * Gjør `draft` til det lagrede utgangspunktet uten å lagre. Brukes når
   * Excalidraw har normalisert den innlastede tegningen (indekser, bindinger)
   * — det er ikke en endring brukeren har gjort.
   */
  rebase(draft: StageDraft): void {
    if (this.dirty || this.status !== 'saved') return
    this.draft = draft
    this.saved = this.current = stableSnapshot(draft)
  }

  update(draft: StageDraft): void {
    const next = stableSnapshot(draft)
    if (next === this.current) return
    this.draft = draft
    this.current = next
    clearTimeout(this.timer)
    if (this.status === 'pending' || this.status === 'saved') {
      this.status = this.dirty ? 'pending' : 'saved'
      if (this.dirty) this.timer = setTimeout(() => void this.flush(), this.delayMs)
    } else if (this.status === 'error') {
      // En ny endring er et nytt forsøk — men aldri etter en konflikt.
      this.timer = setTimeout(() => void this.flush(), this.delayMs)
    }
    this.notify()
  }

  /** Lagrer nå. Svarer `true` når alt er lagret, `false` ved feil eller konflikt. */
  flush(): Promise<boolean> {
    clearTimeout(this.timer)
    if (this.status === 'conflict') return Promise.resolve(false)
    if (this.running) return this.running
    this.running = this.drain().finally(() => {
      this.running = undefined
    })
    return this.running
  }

  private async drain(): Promise<boolean> {
    try {
      while (this.dirty) {
        const snapshot = this.current
        // Fra øyeblikksbildet, ikke fra objektet: Excalidraw muterer elementene
        // sine mens man drar, og det som sendes må være det som ble sammenlignet.
        const draft = JSON.parse(snapshot) as StageDraft
        if (!draft.title.trim()) throw new Error('Gi oppsettet et navn før det lagres')
        this.status = 'saving'
        this.error = undefined
        this.notify()
        const result = await this.write(draft, this.revision)
        if (!result.ok) {
          this.conflict = result.conflict
          this.status = 'conflict'
          this.notify()
          return false
        }
        this.revision = result.revision
        this.lastSavedAt = result.updatedAt
        this.saved = snapshot
      }
      this.status = 'saved'
      this.error = undefined
      this.notify()
      return true
    } catch (error) {
      this.error = error
      this.status = 'error'
      this.notify()
      return false
    }
  }

  dispose(): void {
    clearTimeout(this.timer)
  }
}
