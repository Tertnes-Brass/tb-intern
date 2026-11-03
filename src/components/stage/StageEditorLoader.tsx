import { ClientOnly } from '@tanstack/react-router'
import { type ComponentProps, Suspense, lazy } from 'react'

type EditorProps = ComponentProps<typeof import('./StageEditor').default>

/**
 * Excalidraw er ~2 MB og kjører bare i nettleseren. Editoren lastes derfor
 * først når noen åpner et oppsett, og `import.meta.env.SSR`-vakten fjerner den
 * dynamiske importen helt fra serverbygget — den skal ikke gjøre
 * Worker-bundelen større (samme grep som `pdf-loader.ts`).
 */
const LazyStageEditor = lazy(() => {
  if (import.meta.env.SSR) return new Promise<never>(() => {})
  return import('./StageEditor')
})

function Loading() {
  return (
    <div className="fixed inset-0 grid place-items-center bg-paper">
      <p className="flex items-center gap-2.5 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-ink-faint">
        <span className="spinner" aria-hidden />
        Henter tegneverktøyet …
      </p>
    </div>
  )
}

export function StageEditorLoader(props: EditorProps) {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <LazyStageEditor {...props} />
      </Suspense>
    </ClientOnly>
  )
}
