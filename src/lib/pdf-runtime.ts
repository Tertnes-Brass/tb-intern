/**
 * Selve pdf.js-modulen og arbeideren. Lastes bare dynamisk, via
 * `pdf-loader.ts` — aldri importer denne fila direkte, ellers havner ~2 MB i
 * både klientpakken og Worker-bundelen.
 *
 * «legacy»-bygget brukes fordi det også kjører på eldre iPad-er og iPhoner
 * (Safari før 17.4), som er nøyaktig den typen enhet som står på et notestativ.
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Adressen til denne modulen selv — offline-lagringen må ha den med. */
const runtimeUrl = import.meta.url

export { pdfjs, runtimeUrl, workerUrl }
