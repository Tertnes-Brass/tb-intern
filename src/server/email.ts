import { env } from 'cloudflare:workers'

/**
 * E-postsending via Cloudflare Email Sending (binding `EMAIL`) — ingen ekstern
 * leverandør. Avsenderdomenet må være onboardet:
 * `wrangler email sending enable tertnesbrass.com`.
 *
 * Degraderer pent: hvis bindingen ikke finnes (lokal dev, eller e-post ikke
 * aktivert ennå), logges meldingen til konsollen så magiske lenker kan testes,
 * og passordinnlogging fungerer uansett.
 */

// Avsenderdomenet må være onboardet i Cloudflare Email Sending. Dette påvirker
// ikke innkommende e-post for tertnesbrass.no, som fortsatt håndteres av Uniweb.
const FROM = { email: 'noreply@tertnesbrass.com', name: 'Tertnes Brass Notearkiv' }

type SendArgs = { to: string; subject: string; html: string; text: string }

/** `sent` = bindingen tok imot meldingen. `logged` = den ble bare skrevet til konsollen. */
export type EmailOutcome = 'sent' | 'logged'

/**
 * Siste leveringsutfall per adresse. Nødvendig fordi `sendEmail` bevisst
 * degraderer til konsoll-logg uten å kaste, OG fordi better-auth eier kallet som
 * sender magiske lenker — utfallet kan derfor ikke returneres gjennom
 * kallkjeden. Invitasjonsflyten henter det ut med `takeEmailOutcome` rett etter
 * sendingen, så UI-et aldri påstår at en e-post gikk ut når den ikke gjorde det.
 */
const outcomes = new Map<string, EmailOutcome>()
// Ingen leser utfallet for vanlige innlogginger; hold kartet lite i en langlevd isolate.
const MAX_TRACKED_OUTCOMES = 20

function recordOutcome(to: string, outcome: EmailOutcome): void {
  if (outcomes.size >= MAX_TRACKED_OUTCOMES) {
    const oldest = outcomes.keys().next().value
    if (oldest !== undefined) outcomes.delete(oldest)
  }
  outcomes.set(to.trim().toLowerCase(), outcome)
}

/** Leser og forbruker utfallet. `null` = ingen sending ble forsøkt for adressen. */
export function takeEmailOutcome(to: string): EmailOutcome | null {
  const key = to.trim().toLowerCase()
  const outcome = outcomes.get(key) ?? null
  outcomes.delete(key)
  return outcome
}

export async function sendEmail({ to, subject, html, text }: SendArgs): Promise<{ ok: boolean; fallback?: boolean }> {
  const binding = (env as unknown as { EMAIL?: { send: (m: unknown) => Promise<unknown> } }).EMAIL
  if (!binding || typeof binding.send !== 'function') {
    // Binding mangler (lokal dev): logg innholdet så lenker kan testes.
    console.log(`\n[e-post:fallback] Til: ${to}\nEmne: ${subject}\n${text}\n`)
    recordOutcome(to, 'logged')
    return { ok: false, fallback: true }
  }
  try {
    await binding.send({ to, from: FROM, subject, html, text })
    recordOutcome(to, 'sent')
    return { ok: true }
  } catch (err) {
    // Binding finnes, men sending feilet (f.eks. domenet ikke onboardet ennå).
    // Logg innholdet som nødløsning — lenken kan da hentes via `wrangler tail`
    // for å bootstrappe første admin før e-post er ferdig satt opp.
    console.error('[e-post] sending feilet, logger innhold som nødløsning:', err)
    console.log(`\n[e-post:fallback] Til: ${to}\nEmne: ${subject}\n${text}\n`)
    recordOutcome(to, 'logged')
    return { ok: false }
  }
}

/** Felles ramme rundt e-postene — enkel, papir/messing-estetikk. */
function shell(heading: string, bodyHtml: string): string {
  return `<!doctype html><html lang="nb"><body style="margin:0;background:#f7f1e6;font-family:'Helvetica Neue',Arial,sans-serif;color:#211b12;padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:480px;background:#fdfaf2;border:1px solid #ddd2ba;border-radius:14px;padding:32px">
      <tr><td>
        <p style="margin:0 0 24px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#95762a;font-weight:600">Tertnes Brass · Notearkiv</p>
        <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:24px;font-style:italic;color:#211b12">${heading}</h1>
        ${bodyHtml}
      </td></tr>
    </table>
    <p style="margin:20px 0 0;font-size:11px;color:#8e8468">Du mottar denne e-posten fordi noen ba om innlogging til Tertnes Brass Notearkiv. Var det ikke deg, kan du se bort fra den.</p>
  </td></tr></table>
</body></html>`
}

function button(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:#95762a;color:#fdfaf2;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:9px;font-size:15px">${label}</a>`
}

export function magicLinkEmail(url: string): { subject: string; html: string; text: string } {
  return {
    subject: 'Logg inn i Tertnes Brass Notearkiv',
    html: shell(
      'Logg inn',
      `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5f5640">Klikk knappen under for å logge inn. Lenken er gyldig i 30 minutter og kan brukes én gang.</p>
       <p style="margin:0 0 24px">${button(url, 'Logg inn')}</p>
       <p style="margin:0;font-size:12px;color:#8e8468">Eller lim inn denne lenken i nettleseren:<br><span style="color:#7a5f1d;word-break:break-all">${url}</span></p>`,
    ),
    text: `Logg inn i Tertnes Brass Notearkiv.\n\nÅpne denne lenken (gyldig i 30 minutter, kan brukes én gang):\n${url}\n`,
  }
}

export function resetPasswordEmail(url: string): { subject: string; html: string; text: string } {
  return {
    subject: 'Tilbakestill passordet ditt',
    html: shell(
      'Tilbakestill passord',
      `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5f5640">Klikk knappen under for å velge et nytt passord. Lenken er gyldig i 1 time.</p>
       <p style="margin:0 0 24px">${button(url, 'Velg nytt passord')}</p>
       <p style="margin:0;font-size:12px;color:#8e8468">Eller lim inn denne lenken i nettleseren:<br><span style="color:#7a5f1d;word-break:break-all">${url}</span></p>`,
    ),
    text: `Tilbakestill passordet ditt for Tertnes Brass Notearkiv.\n\nÅpne denne lenken (gyldig i 1 time):\n${url}\n`,
  }
}

export function verificationCodeEmail(
  otp: string,
  type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email',
): { subject: string; html: string; text: string } {
  const copy = {
    'sign-in': {
      subject: 'Innloggingskoden din',
      heading: 'Logg inn',
      lead: 'Bruk denne engangskoden for å logge inn. Koden er gyldig i 5 minutter.',
    },
    'email-verification': {
      subject: 'Bekreft e-postadressen din',
      heading: 'Bekreft e-post',
      lead: 'Bruk denne engangskoden for å bekrefte e-postadressen din.',
    },
    'forget-password': {
      subject: 'Kode for nytt passord',
      heading: 'Velg nytt passord',
      lead: 'Bruk denne engangskoden for å opprette eller tilbakestille passordet ditt.',
    },
    'change-email': {
      subject: 'Bekreft den nye e-postadressen',
      heading: 'Bekreft ny e-post',
      lead: 'Bruk denne engangskoden for å bekrefte den nye e-postadressen.',
    },
  }[type]

  return {
    subject: copy.subject,
    html: shell(
      copy.heading,
      `<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#5f5640">${copy.lead}</p>
       <p style="margin:0 0 20px;font-family:Menlo,Consolas,monospace;font-size:32px;letter-spacing:8px;font-weight:700;color:#7a5f1d">${otp}</p>
       <p style="margin:0;font-size:12px;color:#8e8468">Koden kan bare brukes én gang. Del den aldri med andre.</p>`,
    ),
    text: `${copy.heading} i Tertnes Brass Notearkiv.\n\n${copy.lead}\n\nKode: ${otp}\n\nKoden kan bare brukes én gang. Del den aldri med andre.\n`,
  }
}

export function inviteEmail(url: string, bandName = 'Tertnes Brass'): { subject: string; html: string; text: string } {
  return {
    subject: `Du er invitert til ${bandName} Notearkiv`,
    html: shell(
      'Velkommen!',
      `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5f5640">Du er lagt til i notearkivet til ${bandName}. Klikk under for å logge inn første gang — så finner du notene dine, kommende konserter og lytteeksempler.</p>
       <p style="margin:0 0 24px">${button(url, 'Logg inn første gang')}</p>
       <p style="margin:0;font-size:12px;color:#8e8468">Lenken er gyldig i 30 minutter. Du kan også gå til <span style="color:#7a5f1d">intern.tertnesbrass.com</span> og logge inn med e-postadressen din når som helst.</p>`,
    ),
    text: `Du er invitert til ${bandName} Notearkiv.\n\nLogg inn første gang her (gyldig i 30 minutter):\n${url}\n`,
  }
}
