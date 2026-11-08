// gifenc 1.0.3 har ingen typer. Bare det src/lib/gif-encode.ts bruker.
declare module 'gifenc' {
  export type Palette = number[][]

  export type FrameOptions = {
    /** Paletten. På første bilde blir den global; senere bilder får den som lokal palett. */
    palette?: Palette
    /** Millisekunder; lagres i hundredeler. */
    delay?: number
    /** -1 = én gang, 0 = for alltid, > 0 = antall ekstra runder. */
    repeat?: number
    transparent?: boolean
    transparentIndex?: number
    /** 0–7; 1 = la bildet stå (neste bilde tegnes oppå). */
    dispose?: number
  }

  export type Encoder = {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void
    finish(): void
    bytes(): Uint8Array<ArrayBuffer>
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): Encoder

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' },
  ): Palette
}
