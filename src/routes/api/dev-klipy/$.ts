import { createFileRoute } from '@tanstack/react-router'

/**
 * KUN for lokal utvikling: en etterligning av KLIPYs API når `KLIPY_API_KEY`
 * mangler (se `getKlipyConfig` og src/server/dev-klipy.ts). I produksjonsbygget
 * svarer ruta 404, og etterligningen er ikke med i bundelen.
 */
async function handle(request: Request, splat: string | undefined): Promise<Response> {
  if (!import.meta.env.DEV) return new Response('Not found', { status: 404 })
  const { devKlipyResponse } = await import('../../../server/dev-klipy')
  const body = devKlipyResponse(splat ?? '', new URL(request.url).searchParams, request.method)
  return body ? Response.json(body) : new Response('Not found', { status: 404 })
}

export const Route = createFileRoute('/api/dev-klipy/$')({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params._splat),
      POST: ({ request, params }) => handle(request, params._splat),
    },
  },
})
