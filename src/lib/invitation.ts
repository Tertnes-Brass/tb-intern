import { z } from 'zod'
import { memberNameSchema } from './profile'

/**
 * Ren logikk for invitasjonsflyten (`/medlemmer` → `inviteMember`). Ligger i
 * `lib/` uten `cloudflare:workers`-import slik at reglene kan enhetstestes, og
 * slik at klient og server bruker de SAMME reglene.
 */

/** Maks stemmer på én invitasjon — samme grense som `updateMemberParts`. */
export const MAX_INVITE_PARTS = 4

/** E-post er primærnøkkelen i `invitations`; normaliseres begge veier. */
export const inviteEmailSchema = z.string().trim().toLowerCase().email('Ugyldig e-post')

/**
 * Navn er valgfritt: administrator kjenner det ikke alltid. Tom streng betyr
 * «vet ikke ennå» (→ `undefined`), ikke et ugyldig navn. Når navnet ER oppgitt,
 * gjelder samme krav som ellers i profilen.
 */
export const inviteNameSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)
  .pipe(memberNameSchema.optional())

export const invitePartIdsSchema = z
  .array(z.string().min(1))
  .max(MAX_INVITE_PARTS, `En invitasjon kan ha maks ${MAX_INVITE_PARTS} stemmer`)
  .refine((ids) => new Set(ids).size === ids.length, 'Samme stemme er valgt flere ganger')

export const invitePayloadSchema = z
  .object({
    email: inviteEmailSchema,
    name: inviteNameSchema,
    roleId: z.string().min(1, 'Velg en rolle'),
    partIds: invitePartIdsSchema.default([]),
    // Hovedstemmen styrer seksjon og sortering i besetningslista. Utelatt ⇒
    // rekkefølgen i `partIds` gjelder som den er.
    primaryPartId: z.string().optional(),
    // Eksplisitt valg: skal invitasjonen også sendes på e-post nå?
    sendEmail: z.boolean().default(true),
  })
  .refine((value) => !value.primaryPartId || value.partIds.includes(value.primaryPartId), {
    message: 'Hovedstemmen må være en av de valgte stemmene',
    path: ['primaryPartId'],
  })

/**
 * Rekkefølgen ER dataen: både `updateMemberParts` og databasehooken som
 * oppretter kontoen setter `isPrimary: i === 0`. Derfor normaliseres
 * hovedstemmen til første element i stedet for å lagres i et eget felt.
 * Duplikater fjernes så primærvalget aldri kan bli tvetydig.
 */
export function orderPartsWithPrimary(partIds: string[], primaryPartId?: string | null): string[] {
  const unique = [...new Set(partIds)]
  if (!primaryPartId || !unique.includes(primaryPartId)) return unique
  return [primaryPartId, ...unique.filter((id) => id !== primaryPartId)]
}

/** Legger til en stemme (ingen duplikater, aldri over grensen). Første valgte blir hovedstemme. */
export function addInvitePart(partIds: string[], partId: string): string[] {
  if (!partId || partIds.includes(partId) || partIds.length >= MAX_INVITE_PARTS) return partIds
  return [...partIds, partId]
}

/** Fjerner en stemme. Fjernes hovedstemmen, arver neste stemme rollen (index 0). */
export function removeInvitePart(partIds: string[], partId: string): string[] {
  return partIds.filter((id) => id !== partId)
}

/**
 * Hva som FAKTISK skjedde med invitasjons-e-posten. `sendEmail` i
 * `src/server/email.ts` degraderer til konsoll-logg når EMAIL-bindingen mangler,
 * så «logged» må aldri presenteres som «sendt».
 */
export type InviteDelivery = 'sent' | 'logged' | 'failed' | 'skipped'

/** Én sannhetskilde for tilbakemeldingen — brukes både i toast og i kvitteringen. */
export function inviteDeliveryMessage(
  delivery: InviteDelivery,
  email: string,
): { message: string; kind: 'ok' | 'error' } {
  switch (delivery) {
    case 'sent':
      return { message: `Invitasjon sendt til ${email}`, kind: 'ok' }
    case 'logged':
      return {
        message: `${email} er invitert, men e-post er ikke aktivert her – ingenting gikk ut. Gi beskjed selv.`,
        kind: 'error',
      }
    case 'failed':
      return {
        message: `${email} er invitert, men e-posten stoppet underveis. Inviter samme adresse på nytt for å prøve igjen.`,
        kind: 'error',
      }
    case 'skipped':
      return {
        message: `${email} er invitert. Ingen e-post ble sendt – be dem logge inn på intern.tertnesbrass.com.`,
        kind: 'ok',
      }
  }
}
