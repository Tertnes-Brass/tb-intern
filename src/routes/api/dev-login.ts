import { createFileRoute } from '@tanstack/react-router'
import { SEED_MEMBERS } from '../../server/seed-data'
import { getAuth } from '../../server/auth-instance'
import { seedDemoData } from '../../server/seed'

const DEV_PASSWORD = 'notearkiv-demo'
const DEFAULT_EMAIL = SEED_MEMBERS.find((member) => member.roleId === 'admin')!.email

function internalPath(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

function selectedMember(url: URL) {
  const email = (url.searchParams.get('as') ?? DEFAULT_EMAIL).trim().toLowerCase()
  return SEED_MEMBERS.find((candidate) => candidate.email === email)
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

async function authRequest(request: Request, path: string, body: Record<string, unknown>): Promise<Response> {
  const url = new URL(request.url)
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  headers.set('origin', url.origin)
  headers.delete('content-length')
  return getAuth().handler(
    new Request(new URL(path, url.origin), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

/**
 * E-postfri innlogging for lokale agenter og utviklere.
 *
 * Eksempel:
 *   /api/dev-login?as=sindre@demo.tertnesbrass.no&to=/innstillinger/nedlastinger
 *
 * Ruten er utilgjengelig i produksjonsbygg, og tillater bare demobrukerne fra
 * seed-data. Første kall oppretter passordkontoen; senere kall logger den inn.
 */
export const Route = createFileRoute('/api/dev-login')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!import.meta.env.DEV) return new Response('Not found', { status: 404 })

        const url = new URL(request.url)
        const member = selectedMember(url)
        if (!member) return new Response('Ukjent demobruker', { status: 400 })

        // Selve mutasjonen skjer som POST. GET-siden gjør bare den direkte
        // navigasjons-URL-en praktisk for en nettleser/agent.
        const action = `/api/dev-login?${new URLSearchParams({
          as: member.email,
          to: internalPath(url.searchParams.get('to')),
        })}`
        return new Response(
          `<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>Logger inn…</title></head><body><form method="post" action="${escapeAttribute(action)}"><button type="submit">Logg inn som ${escapeAttribute(member.name)}</button></form><script>document.forms[0].submit()</script></body></html>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        )
      },
      POST: async ({ request }) => {
        if (!import.meta.env.DEV) return new Response('Not found', { status: 404 })

        const url = new URL(request.url)
        const member = selectedMember(url)
        if (!member) return new Response('Ukjent demobruker', { status: 400 })

        await seedDemoData()

        let authResponse = await authRequest(request, '/api/auth/sign-up/email', {
          name: member.name,
          email: member.email,
          password: DEV_PASSWORD,
          rememberMe: true,
        })
        if (authResponse.status === 422) {
          authResponse = await authRequest(request, '/api/auth/sign-in/email', {
            email: member.email,
            password: DEV_PASSWORD,
            rememberMe: true,
          })
        }
        if (!authResponse.ok) return authResponse

        const headers = new Headers(authResponse.headers)
        headers.set('location', internalPath(url.searchParams.get('to')))
        headers.delete('content-length')
        headers.delete('content-type')
        return new Response(null, { status: 302, headers })
      },
    },
  },
})
