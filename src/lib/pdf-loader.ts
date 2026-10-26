/**
 * pdf.js, lastet først når noen faktisk åpner notestativet. Biblioteket er
 * ~0,5 MB og arbeideren ~1,3 MB; resten av appen skal ikke betale for det.
 *
 * `import.meta.env.SSR`-vakten gjør at den dynamiske importen fjernes helt fra
 * serverbygget: pdf.js kjører bare i nettleseren, og skal ikke gjøre
 * Worker-bundelen større.
 */
type Runtime = typeof import('./pdf-runtime')

let loading: Promise<Runtime> | null = null

function runtime(): Promise<Runtime> {
  if (import.meta.env.SSR) return Promise.reject(new Error('pdf.js kjører bare i nettleseren'))
  loading ??= import('./pdf-runtime')
  return loading
}

export async function loadPdfJs(): Promise<Runtime['pdfjs']> {
  return (await runtime()).pdfjs
}

/**
 * Adressene til pdf.js-modulen og arbeideren. Ingen av dem står i sidens HTML
 * (de lastes dynamisk), så offline-lagringen må få dem herfra.
 */
export async function pdfAssetUrls(): Promise<string[]> {
  const { runtimeUrl, workerUrl } = await runtime()
  return [runtimeUrl, workerUrl]
}
