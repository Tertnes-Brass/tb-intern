import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { emailOTP, magicLink } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { env, waitUntil } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { invitations, memberProfiles, user, userParts } from '../db/schema'
import { memberNameSchema, PASSWORD_MIN_LENGTH } from '../lib/profile'
import { writeAudit } from './audit'
import { inviteEmail, magicLinkEmail, resetPasswordEmail, sendEmail, verificationCodeEmail } from './email'

const MAGIC_LINK_EXPIRY = 60 * 30 // 30 min

/**
 * Slår opp hvilken tilgang en innkommende e-post skal få:
 *  - ADMIN_EMAIL (bootstrap av første admin) → admin-rolle uten invitasjon
 *  - ellers: må finnes en invitasjon (rolle + stemmer forhåndsbestemt av admin)
 *  - null → ikke tillatt (create-hooken avviser innlogging)
 * E-post normaliseres til små bokstaver begge steder.
 */
type Access = {
  roleId: string
  partIds: string[]
  inviteEmail: string | null
  name: string | null
  // Invitasjon som ennå ikke er tatt i bruk ⇒ e-posten skal ønske velkommen,
  // ikke bare tilby innlogging. Rent kosmetisk; gaten bryr seg ikke.
  pendingInvite: boolean
}

async function resolveAccess(email: string): Promise<Access | null> {
  const normalized = email.trim().toLowerCase()
  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase()
  if (adminEmail && normalized === adminEmail) {
    return { roleId: 'admin', partIds: [], inviteEmail: null, name: null, pendingInvite: false }
  }
  const inv = await db()
    .select({
      email: invitations.email,
      name: invitations.name,
      roleId: invitations.roleId,
      partIds: invitations.partIds,
      acceptedAt: invitations.acceptedAt,
    })
    .from(invitations)
    .where(eq(invitations.email, normalized))
    .limit(1)
  if (!inv[0]) return null
  return {
    roleId: inv[0].roleId,
    partIds: JSON.parse(inv[0].partIds) as string[],
    inviteEmail: inv[0].email,
    name: inv[0].name,
    pendingInvite: inv[0].acceptedAt == null,
  }
}

/** «sindre.ryland@…» → «Sindre Ryland» som fallback-navn. */
function deriveName(email: string): string {
  const local = email.split('@')[0] ?? email
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join(' ') || email
  )
}

let _auth: ReturnType<typeof buildAuth> | undefined

function buildAuth() {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [
      // noter.tertnesbrass.com er det kanoniske produksjonsdomenet.
      // workers.dev-adressen beholdes for feilsøking av en deploy uten DNS.
      'https://noter.tertnesbrass.com',
      'https://tb-notearkiv.tb-370.workers.dev',
      // Vite velger neste ledige port når 3000 er opptatt. Hold wildcardet
      // strengt dev-only; localhost skal aldri være trusted origin i prod.
      ...(import.meta.env.DEV ? ['http://localhost:*'] : []),
    ],
    database: drizzleAdapter(db(), { provider: 'sqlite', schema }),
    emailAndPassword: {
      enabled: true,
      // Lokal dev-login oppretter en passordkonto for en seedet, invitert
      // demobruker. I produksjon er registrering alltid stengt.
      disableSignUp: import.meta.env.PROD,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const { subject, html, text } = resetPasswordEmail(url)
        await sendEmail({ to: user.email, subject, html, text }).catch(() => {})
      },
      onPasswordReset: async ({ user }) => {
        await writeAudit({
          action: 'auth.password_reset_completed',
          targetUserId: user.id,
          details: { changedFields: ['password'] },
        })
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 dager
      updateAge: 60 * 60 * 24, // forny én gang/dag
      cookieCache: { enabled: true, maxAge: 5 * 60 }, // færre D1-lesninger
    },
    advanced: {
      useSecureCookies: import.meta.env.PROD,
      backgroundTasks: { handler: waitUntil },
      // Workeren står alltid bak Cloudflare i produksjon. Stol bare på
      // Cloudflares egen, overskrevne klient-IP-header for rate limiting.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-in/magic-link': { window: 60, max: 3 },
        '/request-password-reset': { window: 60, max: 3 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // GATE: kjører for både passord OG magisk lenke. disableSignUp dekker
          // ikke alle veier, så denne hooken er den faktiske invitasjonssperren.
          before: async (newUser: { email: string; name?: string }) => {
            const access = await resolveAccess(newUser.email)
            if (!access) {
              throw new APIError('FORBIDDEN', { message: 'Du må være invitert for å logge inn.' })
            }
            // Normaliser e-post til små bokstaver: SQLite UNIQUE er case-sensitiv,
            // så uten dette kunne «A@x» og «a@x» bli to kontoer for samme person.
            const email = newUser.email.trim().toLowerCase()
            // Sett et navn hvis registreringen ikke ga ett (magisk lenke gjør ikke det).
            const name = newUser.name?.trim() || access.name?.trim() || deriveName(email)
            return { data: { ...newUser, email, name } }
          },
          // LINK: better-auth user.id finnes nå — skriv domeneradene.
          after: async (createdUser: { id: string; email: string }) => {
            const access = await resolveAccess(createdUser.email)
            const d = db()
            if (!access) {
              // Invitasjonen ble trukket tilbake mellom before og after — fjern den
              // foreldreløse brukerraden så den ikke blir en konto uten profil.
              await d.delete(user).where(eq(user.id, createdUser.id))
              return
            }
            await d
              .insert(memberProfiles)
              .values({ authUserId: createdUser.id, roleId: access.roleId, isActive: true, createdAt: new Date() })
              .onConflictDoNothing()
            if (access.partIds.length > 0) {
              await d
                .insert(userParts)
                .values(access.partIds.map((partId, i) => ({ userId: createdUser.id, partId, isPrimary: i === 0 })))
                .onConflictDoNothing()
            }
            if (access.inviteEmail) {
              await d
                .update(invitations)
                .set({ acceptedAt: new Date() })
                .where(eq(invitations.email, access.inviteEmail))
            }
            await writeAudit({
              action: 'member.account_created',
              actorUserId: createdUser.id,
              targetUserId: createdUser.id,
              details: { roleId: access.roleId, partIds: access.partIds },
            })
          },
        },
        update: {
          before: async (updates) => {
            const data = { ...updates }
            if (typeof data.name === 'string') data.name = memberNameSchema.parse(data.name)
            if (typeof data.email === 'string') data.email = data.email.trim().toLowerCase()
            return { data }
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const userId = ctx.context.session?.user.id ?? ctx.context.newSession?.user.id
        if (!userId) return
        if (ctx.path === '/update-user') {
          const changedFields = ['name', 'image'].filter((field) => field in (ctx.body ?? {}))
          if (changedFields.length > 0) {
            await writeAudit({
              action: 'member.profile_updated',
              actorUserId: userId,
              targetUserId: userId,
              details: { changedFields },
            })
          }
        }
        if (ctx.path === '/change-password') {
          await writeAudit({
            action: 'auth.password_changed',
            actorUserId: userId,
            targetUserId: userId,
            details: {
              changedFields: ['password'],
              otherSessionsRevoked: Boolean(ctx.body?.revokeOtherSessions),
            },
          })
        }
      }),
    },
    plugins: [
      emailOTP({
        expiresIn: 5 * 60,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        rateLimit: { window: 60, max: 3 },
        sendVerificationOTP: async ({ email, otp, type }) => {
          // Ikke bruk e-postbindingen som en åpen relay. API-et svarer fortsatt
          // generisk, så dette røper ikke om adressen er invitert.
          if (!(await resolveAccess(email))) return
          const { subject, html, text } = verificationCodeEmail(otp, type)
          await sendEmail({ to: email, subject, html, text })
        },
      }),
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRY,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          const access = await resolveAccess(email)
          if (!access) return
          // Første lenke på en ubrukt invitasjon er en invitasjon — bruk
          // velkomstteksten. Ellers er det en helt vanlig innloggingslenke.
          const { subject, html, text } = access.pendingInvite ? inviteEmail(url) : magicLinkEmail(url)
          await sendEmail({ to: email, subject, html, text }).catch(() => {})
        },
      }),
      tanstackStartCookies(), // MÅ være siste plugin
    ],
  })
}

/** Lat, memoisert instans — unngår binding-tilgang ved modul-/build-evaluering. */
export function getAuth() {
  return (_auth ??= buildAuth())
}
