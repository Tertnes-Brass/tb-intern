/**
 * KUN for `@better-auth/cli generate` (skjemautledning).
 * Importerer bevisst IKKE cloudflare:workers eller ../db, slik at CLI-en
 * (Node-kontekst) kan evaluere konfigurasjonen. Speiler de skjema-relevante
 * opsjonene i den ekte instansen (auth-instance.ts): rateLimit,
 * emailAndPassword, emailOTP og magicLink.
 * Kjør: pnpm dlx @better-auth/cli generate --config src/server/auth.cli.ts --output src/db/auth-schema.ts -y
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP, magicLink } from 'better-auth/plugins'

export const auth = betterAuth({
  database: drizzleAdapter({}, { provider: 'sqlite' }),
  emailAndPassword: { enabled: true },
  rateLimit: { storage: 'database' },
  plugins: [
    emailOTP({ sendVerificationOTP: async () => {} }),
    magicLink({ sendMagicLink: async () => {} }),
  ],
})
