import { env } from 'cloudflare:workers'
import { EMAIL_MARKDOWN_STYLES, markdownToHtml, postPlainText } from '../lib/markdown'
import {
  type PostFormat,
  bodyToHtml,
  escapeHtml,
  postEmailFrom,
  postEmailImageNote,
  postEmailSubject,
} from '../lib/posts'

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
const FROM = { email: 'noreply@tertnesbrass.com', name: 'Tertnes Brass Internside' }

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

/** Bunntekst for e-poster som utløses av en innloggingsforespørsel. */
const LOGIN_FOOTER =
  'Du mottar denne e-posten fordi noen ba om innlogging til Tertnes Brass Internside. Var det ikke deg, kan du se bort fra den.'
/** Bunntekst for e-poster som sendes fordi du er medlem (beskjeder, styreoppgaver). */
const MEMBER_FOOTER =
  'Du mottar denne e-posten fordi du er medlem i Tertnes Brass. Varslingsvalgene dine finner du under «Min profil» på intern.tertnesbrass.com.'

/** Felles ramme rundt e-postene — enkel, papir/messing-estetikk. */
function shell(heading: string, bodyHtml: string, footer: string = LOGIN_FOOTER): string {
  return `<!doctype html><html lang="nb"><body style="margin:0;background:#f7f1e6;font-family:'Helvetica Neue',Arial,sans-serif;color:#211b12;padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:480px;background:#fdfaf2;border:1px solid #ddd2ba;border-radius:14px;padding:32px">
      <tr><td>
        <p style="margin:0 0 24px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#95762a;font-weight:600">Tertnes Brass · Internside</p>
        <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:24px;font-style:italic;color:#211b12">${heading}</h1>
        ${bodyHtml}
      </td></tr>
    </table>
    <p style="margin:20px 0 0;font-size:11px;color:#8e8468">${footer}</p>
  </td></tr></table>
</body></html>`
}

function button(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:#95762a;color:#fdfaf2;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:9px;font-size:15px">${label}</a>`
}

export function magicLinkEmail(url: string): { subject: string; html: string; text: string } {
  return {
    subject: 'Logg inn på Tertnes Brass Internside',
    html: shell(
      'Logg inn',
      `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5f5640">Klikk knappen under for å logge inn. Lenken er gyldig i 30 minutter og kan brukes én gang.</p>
       <p style="margin:0 0 24px">${button(url, 'Logg inn')}</p>
       <p style="margin:0;font-size:12px;color:#8e8468">Eller lim inn denne lenken i nettleseren:<br><span style="color:#7a5f1d;word-break:break-all">${url}</span></p>`,
    ),
    text: `Logg inn på Tertnes Brass Internside.\n\nÅpne denne lenken (gyldig i 30 minutter, kan brukes én gang):\n${url}\n`,
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
    text: `Tilbakestill passordet ditt for Tertnes Brass Internside.\n\nÅpne denne lenken (gyldig i 1 time):\n${url}\n`,
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
    text: `${copy.heading} på Tertnes Brass Internside.\n\n${copy.lead}\n\nKode: ${otp}\n\nKoden kan bare brukes én gang. Del den aldri med andre.\n`,
  }
}

/**
 * Varsel om en ny beskjed (#28). Teksten er skrevet av et menneske i en
 * textarea og er aldri betrodd som HTML: `plain_text` escapes med
 * `bodyToHtml`, `markdown` (#79) rendres av `markdownToHtml`, som bygger HTML-en
 * fra en allowlist og aldri slipper gjennom rå HTML. E-postklienter kan ikke
 * bruke klasser, så markdown-utgaven får inline-stiler (`EMAIL_MARKDOWN_STYLES`).
 * `url` bygges server-side fra `BETTER_AUTH_URL`, aldri fra request-origin.
 */
export function postEmail({
  title,
  body,
  format = 'plain_text',
  url,
  authorName,
  important,
  official,
  imageCount,
}: {
  title: string
  /** Hele teksten i beskjeden — e-posten skal kunne leses uten å logge inn. */
  body: string
  /** Hvordan `body` skal tolkes. Utelatt = ren tekst, som før #79. */
  format?: PostFormat
  url: string
  authorName: string
  important: boolean
  /** Merket «Fra styret». Sier hvem beskjeden kommer fra, ikke bare hvem som skrev den. */
  official: boolean
  /** Bilder vises ikke i e-posten; de ligger bak innlogging på internsiden. */
  imageCount: number
}): { subject: string; html: string; text: string } {
  const heading = escapeHtml(title)
  // Tekstversjonen skal ikke ha HTML-escaping i seg («Bø &amp; Co»).
  const fromText = postEmailFrom(authorName, official)
  const from = escapeHtml(fromText)
  const images = postEmailImageNote(imageCount)
  const bodyHtml =
    format === 'markdown'
      ? markdownToHtml(body, { styles: EMAIL_MARKDOWN_STYLES })
      : bodyToHtml(body, 'margin:0 0 16px')
  // Tekstversjonen skal aldri vise «#» eller «**».
  const bodyText = postPlainText(body, format).trim()
  return {
    subject: postEmailSubject(title, important),
    html: shell(
      heading,
      `${official ? '<p style="margin:0 0 12px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#95762a;font-weight:700">Fra styret</p>' : ''}
       ${important ? '<p style="margin:0 0 16px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8f2f24;font-weight:700">Viktig beskjed</p>' : ''}
       <p style="margin:0 0 20px;font-size:12px;color:#8e8468">${from} · Tertnes Brass</p>
       <div style="font-size:15px;line-height:1.6;color:#5f5640">${bodyHtml}</div>
       ${images ? `<p style="margin:0 0 20px;font-size:13px;color:#8e8468">${escapeHtml(images)}</p>` : ''}
       <p style="margin:8px 0 24px">${button(url, 'Les på internsiden')}</p>
       <p style="margin:0;font-size:12px;color:#8e8468">Du kan velge hvilke beskjeder du vil ha på e-post under «Min profil» på internsiden.</p>`,
      MEMBER_FOOTER,
    ),
    text: `${official ? 'FRA STYRET\n' : ''}${important ? 'VIKTIG BESKJED\n' : ''}\n${title}\n${fromText} · Tertnes Brass\n\n${bodyText}\n${images ? `\n${images}\n` : ''}\nLes på internsiden:\n${url}\n\nVil du ha færre e-poster? Endre varslingsvalget under «Min profil».\n`,
  }
}

export function inviteEmail(url: string, bandName = 'Tertnes Brass'): { subject: string; html: string; text: string } {
  return {
    subject: `Du er invitert til internsiden til ${bandName}`,
    html: shell(
      'Velkommen!',
      `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5f5640">Du er lagt til på internsiden til ${bandName}. Klikk under for å logge inn første gang — så finner du beskjeder, kalender, notene dine og kommende konserter.</p>
       <p style="margin:0 0 24px">${button(url, 'Logg inn første gang')}</p>
       <p style="margin:0;font-size:12px;color:#8e8468">Lenken er gyldig i 30 minutter. Du kan også gå til <span style="color:#7a5f1d">intern.tertnesbrass.com</span> og logge inn med e-postadressen din når som helst.</p>`,
    ),
    text: `Du er invitert til internsiden til ${bandName}.\n\nLogg inn første gang her (gyldig i 30 minutter):\n${url}\n`,
  }
}

/**
 * Varsel til den som blir satt som ansvarlig for en styreoppgave. Sendes bare
 * når en ANNEN delegerer — man varsler ikke seg selv om noe man nettopp gjorde.
 */
export function taskAssignedEmail(input: {
  title: string
  dueDate: string | null
  projectTitle: string | null
  url: string
  assignedByName: string
}): { subject: string; html: string; text: string } {
  const { title, dueDate, projectTitle, url, assignedByName } = input
  const facts = [
    projectTitle ? `Prosjekt: ${projectTitle}` : null,
    dueDate ? `Frist: ${formatIsoDate(dueDate)}` : null,
  ].filter((line): line is string => line !== null)

  return {
    subject: `Ny styreoppgave: ${title}`,
    html: shell(
      'Du har fått en oppgave',
      `<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#5f5640">${escapeHtml(assignedByName)} har satt deg som ansvarlig for en oppgave i styrearbeidet:</p>
       <p style="margin:0 0 ${facts.length > 0 ? '8' : '24'}px;font-family:Georgia,serif;font-size:19px;color:#211b12">${escapeHtml(title)}</p>
       ${facts.length > 0 ? `<p style="margin:0 0 24px;font-size:13px;color:#8e8468">${facts.map(escapeHtml).join('<br>')}</p>` : ''}
       <p style="margin:0 0 24px">${button(url, 'Åpne oppgaven')}</p>
       <p style="margin:0;font-size:12px;color:#8e8468">Eller lim inn denne lenken i nettleseren:<br><span style="color:#7a5f1d;word-break:break-all">${url}</span></p>`,
      MEMBER_FOOTER,
    ),
    text: `${assignedByName} har satt deg som ansvarlig for en oppgave i styrearbeidet.\n\n${title}\n${facts.length > 0 ? `${facts.join('\n')}\n` : ''}\nÅpne oppgaven her:\n${url}\n`,
  }
}

/**
 * Den daglige påminnelsen om forfalte styreoppgaver. Én e-post per ansvarlig
 * med ALT som ligger på overtid — ikke én per oppgave. Sendes av
 * `runOverdueReminders` i `board-notify.ts` (cron, 07:00 UTC).
 */
export function overdueTasksEmail(input: {
  tasks: Array<{ title: string; dueDate: string; url: string; projectTitle: string | null }>
  count: number
}): { subject: string; html: string; text: string } {
  const { tasks, count } = input
  const heading = count === 1 ? 'Én oppgave har gått over fristen' : `${count} oppgaver har gått over fristen`
  const rows = tasks
    .map((t) => {
      const meta = [`Frist ${formatIsoDate(t.dueDate)}`, t.projectTitle].filter(Boolean).join(' · ')
      return `<li style="margin:0 0 14px">
         <a href="${t.url}" style="color:#7a5f1d;font-family:Georgia,serif;font-size:17px;text-decoration:none">${escapeHtml(t.title)}</a>
         <br><span style="font-size:12px;color:#8e8468">${escapeHtml(meta)}</span>
       </li>`
    })
    .join('')

  return {
    subject: count === 1 ? 'Forfalt styreoppgave' : `${count} forfalte styreoppgaver`,
    html: shell(
      heading,
      `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#5f5640">Du står som ansvarlig for ${
        count === 1 ? 'denne oppgaven' : 'disse oppgavene'
      } i styrearbeidet, og fristen er passert:</p>
       <ul style="margin:0 0 24px;padding:0 0 0 18px">${rows}</ul>
       <p style="margin:0;font-size:12px;color:#8e8468">Du får denne e-posten én gang per dag så lenge noe ligger på overtid. Vil du slippe den, skru av «E-post om styreoppgaver» under «Min profil».</p>`,
      MEMBER_FOOTER,
    ),
    text: `${heading}.\n\nDu står som ansvarlig for ${count === 1 ? 'denne oppgaven' : 'disse oppgavene'} i styrearbeidet:\n\n${tasks
      .map((t) => `- ${t.title} (frist ${formatIsoDate(t.dueDate)}${t.projectTitle ? `, ${t.projectTitle}` : ''})\n  ${t.url}`)
      .join('\n')}\n\nDu får denne e-posten én gang per dag så lenge noe ligger på overtid. Vil du slippe den, skru av «E-post om styreoppgaver» under «Min profil».\n`,
  }
}

/** «2026-09-15» → «15. september 2026». Egen her: e-post kjører uten klientens Intl-oppsett. */
function formatIsoDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('nb-NO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Oslo',
    }).format(new Date(`${iso}T12:00:00Z`))
  } catch {
    return iso
  }
}
