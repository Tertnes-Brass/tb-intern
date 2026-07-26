import { emailOTPClient, magicLinkClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

// baseURL utelates: klient og API deler origin i prod (noter.tertnesbrass.com) og i dev.
export const authClient = createAuthClient({
  plugins: [emailOTPClient(), magicLinkClient()],
})

export const { signIn, signOut, useSession } = authClient
