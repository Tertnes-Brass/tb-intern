/**
 * Ren demodata (ingen Cloudflare-avhengigheter) — brukes både av
 * in-app-seeding i lokal dev (seed.ts).
 */

/** Fast vikartoken i demo, så vikarvisningen kan demonstreres uten oppsett. */
export const DEMO_SHARE_TOKEN = 'demo-vikar-sommerkonsert'

export type SeedMember = {
  name: string
  email: string
  roleId: 'admin' | 'archivist' | 'conductor' | 'board' | 'member'
  partIds: string[]
}

export const SEED_MEMBERS: SeedMember[] = [
  { name: 'Sindre Ryland', email: 'sindre@demo.tertnesbrass.no', roleId: 'admin', partIds: ['euphonium'] },
  { name: 'Eirik Berge', email: 'dirigent@demo.tertnesbrass.no', roleId: 'conductor', partIds: ['score'] },
  { name: 'Ingrid Marie Dale', email: 'ingrid@demo.tertnesbrass.no', roleId: 'member', partIds: ['solo-cornet'] },
  { name: 'Jonas Helle', email: 'jonas@demo.tertnesbrass.no', roleId: 'member', partIds: ['second-cornet'] },
  { name: 'Astrid Fjeldstad', email: 'astrid@demo.tertnesbrass.no', roleId: 'member', partIds: ['flugel'] },
  { name: 'Karim Aly', email: 'karim@demo.tertnesbrass.no', roleId: 'member', partIds: ['eb-bass'] },
  { name: 'Silje Tveit', email: 'silje@demo.tertnesbrass.no', roleId: 'member', partIds: ['percussion-1'] },
  { name: 'Ole Kristian Bø', email: 'ole@demo.tertnesbrass.no', roleId: 'archivist', partIds: ['bass-trombone'] },
  { name: 'Hilde Nordvik', email: 'hilde@demo.tertnesbrass.no', roleId: 'board', partIds: ['first-horn'] },
]

// `isSystem` skrives eksplisitt: rollene her er plattformens egne og skal ikke
// kunne slettes i /innstillinger, uavhengig av kolonnens standardverdi.
export const SEED_ROLES = [
  { id: 'admin', name: 'Administrator', isSystem: true },
  { id: 'archivist', name: 'Arkivar', isSystem: true },
  { id: 'conductor', name: 'Dirigent', isSystem: true },
  { id: 'board', name: 'Styremedlem', isSystem: true },
  { id: 'member', name: 'Musiker', isSystem: true },
] as const

export const SEED_ROLE_PERMISSIONS: Array<{ roleId: string; permission: string }> = [
  { roleId: 'admin', permission: '*' },
  { roleId: 'archivist', permission: 'works.manage' },
  { roleId: 'archivist', permission: 'projects.manage' },
  { roleId: 'archivist', permission: 'shares.manage' },
  { roleId: 'archivist', permission: 'scores.view' },
  { roleId: 'archivist', permission: 'archive.viewAll' },
  { roleId: 'archivist', permission: 'downloads.view' },
  { roleId: 'conductor', permission: 'works.manage' },
  { roleId: 'conductor', permission: 'projects.manage' },
  { roleId: 'conductor', permission: 'shares.manage' },
  { roleId: 'conductor', permission: 'scores.view' },
  { roleId: 'conductor', permission: 'archive.viewAll' },
  { roleId: 'conductor', permission: 'downloads.view' },
  { roleId: 'conductor', permission: 'posts.publish' },
  // Øvingsplanen og fraværet (#82/#24) er dirigentens arbeid. Begge er egne
  // rettigheter nettopp for at en fraværsansvarlig skal kunne få den ene uten
  // prosjekt-, medlems- eller admintilgang — se rollematrisen i /innstillinger.
  { roleId: 'conductor', permission: 'calendar.manage' },
  { roleId: 'conductor', permission: 'attendance.manage' },
  // Styremedlem har alt en musiker har, pluss styreområdet (/styre) og retten
  // til å publisere beskjeder «Fra styret» på veggen (/beskjeder).
  { roleId: 'board', permission: 'scores.view' },
  { roleId: 'board', permission: 'board.manage' },
  { roleId: 'board', permission: 'posts.publish' },
  { roleId: 'member', permission: 'scores.view' },
]

export type SeedWorkData = {
  title: string
  composer: string | null
  arranger: string | null
  publisher: string | null
  genre: string | null
  grade: number | null
  durationSec: number | null
  acquiredYear: number | null
  physicalLocation: string | null
  notes: string | null
  tempoText: string
}

export const SEED_WORKS: SeedWorkData[] = [
  { title: 'Where Eagles Sing', composer: 'Paul Lovatt-Cooper', arranger: null, publisher: null, genre: 'Konsertåpner', grade: 3, durationSec: 300, acquiredYear: 2019, physicalLocation: 'Skap 1 · Mappe 041', notes: null, tempoText: 'Vivace' },
  { title: 'I Dovregubbens hall', composer: 'Edvard Grieg', arranger: 'Ray Farr', publisher: null, genre: 'Klassisk', grade: 3, durationSec: 210, acquiredYear: 2015, physicalLocation: 'Skap 1 · Mappe 012', notes: null, tempoText: 'Alla marcia, poco a poco accelerando' },
  { title: 'Benedictus', composer: 'Karl Jenkins', arranger: 'Tony Small', publisher: 'Boosey & Hawkes', genre: 'Hymne', grade: 3, durationSec: 420, acquiredYear: 2017, physicalLocation: 'Skap 1 · Mappe 027', notes: 'Husk soloist-stemme til euphonium.', tempoText: 'Andante sostenuto' },
  { title: 'Cry of the Celts', composer: 'Ronan Hardiman', arranger: 'Peter Graham', publisher: 'Gramercy Music', genre: 'Suite', grade: 3, durationSec: 480, acquiredYear: 2019, physicalLocation: 'Skap 2 · Mappe 008', notes: null, tempoText: 'Misterioso' },
  { title: 'Sætergjentens søndag', composer: 'Ole Bull', arranger: null, publisher: 'Norsk Noteservice', genre: 'Norsk perle', grade: 2, durationSec: 240, acquiredYear: 2020, physicalLocation: 'Skap 1 · Mappe 055', notes: null, tempoText: 'Adagio cantabile' },
  { title: 'Tico-Tico no Fubá', composer: 'Zequinha de Abreu', arranger: 'Sandy Smith', publisher: null, genre: 'Latin', grade: 4, durationSec: 200, acquiredYear: 2022, physicalLocation: 'Skap 2 · Mappe 019', notes: 'Brukes gjerne som ekstranummer.', tempoText: 'Presto' },
  { title: 'Gaelforce', composer: 'Peter Graham', arranger: null, publisher: 'Gramercy Music', genre: 'Konsertverk', grade: 4, durationSec: 660, acquiredYear: 2018, physicalLocation: 'Skap 1 · Mappe 003', notes: 'Original 2. kornett-stemme mangler — kopi ligger i mappen.', tempoText: 'Maestoso' },
  { title: 'Vitae Aeternum', composer: 'Paul Lovatt-Cooper', arranger: null, publisher: null, genre: 'Konsertverk', grade: 4, durationSec: 540, acquiredYear: 2021, physicalLocation: 'Skap 2 · Mappe 031', notes: null, tempoText: 'Adagio — Allegro' },
  { title: 'Shine as the Light', composer: 'Peter Graham', arranger: null, publisher: 'SP&S', genre: 'Konsertverk', grade: 3, durationSec: 330, acquiredYear: 2016, physicalLocation: 'Skap 1 · Mappe 022', notes: null, tempoText: 'Allegro deciso' },
  { title: 'Amazing Grace', composer: 'Trad.', arranger: 'William Himes', publisher: null, genre: 'Hymne', grade: 2, durationSec: 260, acquiredYear: 2010, physicalLocation: 'Skap 1 · Mappe 001', notes: null, tempoText: 'Lento espressivo' },
]

export type SeedProjectData = {
  name: string
  kind: string
  eventDate: string
  venue: string
  description: string
  isPublished: boolean
  seasonName: 'Vår 2026' | 'Vår 2027'
  /** Slagverksnotater for hele konserten (transport, lån, rigging). */
  percussionNotes?: string
  /** [verkstittel, posisjon, merknad, slagverksoppsett] */
  repertoire: Array<[title: string, position: number, note: string | null, percussionSetup?: string]>
}

export const SEED_SEASONS = [
  { name: 'Vår 2026' as const, startsOn: '2026-01-01', endsOn: '2026-07-31' },
  { name: 'Vår 2027' as const, startsOn: '2027-01-01', endsOn: '2027-07-31' },
]

export const SEED_PROJECTS: SeedProjectData[] = [
  {
    name: 'Sommerkonsert',
    kind: 'konsert',
    eventDate: '2026-06-24',
    venue: 'Åsane kulturhus',
    description: 'Sesongavslutning med sommerlig program. Oppmøte kl. 17:30, antrekk: sort med sommersløyfe.',
    isPublished: true,
    seasonName: 'Vår 2026',
    percussionNotes:
      'Pauker lånes av Åsane musikklag — hentes fredag kl. 18.\nRigging fra kl. 16:00: pauker bakerst til venstre, mallets til høyre for dirigenten.\nKøller, triangel og tamburin tas med fra korpsrommet.',
    repertoire: [
      ['Where Eagles Sing', 1, null, 'Timpani – Silje\nCymbaler + tamburin – Ole\nKlokkespill – Karim'],
      ['I Dovregubbens hall', 2, null],
      ['Benedictus', 3, 'Solist: eufonium', 'Timpani – Silje\nSuspended cymbal – Ole'],
      ['Cry of the Celts', 4, null, 'Trommesett – Karim\nBodhrán + tamburin – Ole\nTimpani – Silje'],
      ['Sætergjentens søndag', 5, null],
      ['Tico-Tico no Fubá', 6, 'Ekstranummer', 'Congas – Karim\nGüiro + claves – Ole\nSkarptromme – Silje'],
    ],
  },
  {
    name: '17. mai',
    kind: 'konsert',
    eventDate: '2026-05-17',
    venue: 'Tertnes',
    description: 'Morgenspilling og folketog.',
    isPublished: true,
    seasonName: 'Vår 2026',
    repertoire: [
      ['Amazing Grace', 1, null],
      ['Gaelforce', 2, null],
      ['Sætergjentens søndag', 3, null],
    ],
  },
  {
    name: 'NM Brass 2027',
    kind: 'konkurranse',
    eventDate: '2027-02-12',
    venue: 'Grieghallen, Bergen',
    description: 'Utkast til konkurranseprogram — ikke publisert til medlemmene ennå.',
    isPublished: false,
    seasonName: 'Vår 2027',
    repertoire: [['Vitae Aeternum', 1, 'Selvvalgt verk']],
  },
]

/** Utløp for demovikarlenken. */
export const DEMO_SHARE_EXPIRES = '2026-07-24T12:00:00Z'
export const DEMO_SHARE_RECIPIENT = 'Ola Vikar'
export const DEMO_SHARE_PART_IDS = ['solo-cornet']

// ---------- Styre (demo) ----------

export type SeedBoardMeeting = {
  title: string
  /** Dager fra i dag; negativt = allerede avholdt. */
  dayOffset: number
  agenda: string | null
  notes: string | null
  decisions: string | null
}

/** To møter: ett avholdt med referat, ett som kommer med saksliste. */
export const SEED_BOARD_MEETINGS: SeedBoardMeeting[] = [
  {
    title: 'Styremøte september',
    dayOffset: -12,
    agenda: '1. Økonomi og kontingent\n2. Evaluering av sommerkonserten\n3. Rekruttering\n4. Eventuelt',
    notes:
      'Til stede: hele styret.\n\nØkonomi: regnskapet er ajour, og kontingenten for høsten er sendt ut. To purringer gjenstår.\n\nSommerkonserten: godt oppmøte, men lydanlegget må leies inn neste gang.\n\nRekruttering: vi tar kontakt med kulturskolen før jul.',
    decisions:
      'Vedtak: vi leier inn lydanlegg til neste sommerkonsert.\nPurre på utestående kontingent innen to uker.\nHente inn tilbud på nye uniformsjakker fra minst to leverandører.',
  },
  {
    title: 'Styremøte oktober',
    dayOffset: 9,
    agenda:
      '1. Regnskap per 30. september\n2. Budsjett for vårsemesteret\n3. Uniformer — tilbud fra to leverandører\n4. Dugnad på julemarkedet\n5. Eventuelt',
    notes: null,
    decisions: null,
  },
]

export type SeedBoardTask = {
  title: string
  description: string | null
  status: 'open' | 'in_progress' | 'done'
  /** Dager fra i dag; null = ingen frist. */
  dueDayOffset: number | null
  /** Møtet oppgaven kom fra, matchet på tittel. */
  meetingTitle: string | null
  /** Prosjektet i noteområdet, matchet på navn. */
  projectName: string | null
  /** Styreprosjektet oppgaven hører til, matchet på tittel. */
  boardProjectTitle: string | null
  comments: string[]
}

export const SEED_BOARD_TASKS: SeedBoardTask[] = [
  {
    title: 'Purre på utestående kontingent',
    description: 'To medlemmer har ikke betalt høstkontingenten. Send vennlig påminnelse på e-post.',
    status: 'open',
    dueDayOffset: -4,
    meetingTitle: 'Styremøte september',
    projectName: null,
    boardProjectTitle: null,
    comments: ['Første purring er sendt, venter til over helgen før jeg ringer.'],
  },
  {
    title: 'Hente inn tilbud på nye uniformsjakker',
    description: 'Minst to leverandører, med pris per jakke og leveringstid.',
    status: 'in_progress',
    dueDayOffset: 6,
    meetingTitle: 'Styremøte september',
    projectName: null,
    boardProjectTitle: 'Nye uniformer',
    comments: ['Ett tilbud er inne. Venter på det andre.', 'Husk å spørre om broderi av logo.'],
  },
  {
    title: 'Booke lokale til sommerkonserten',
    description: 'Åsane kulturhus, samme dato som i fjor. Sjekk om vi får leie lydanlegget med.',
    status: 'open',
    dueDayOffset: 21,
    meetingTitle: null,
    projectName: 'Sommerkonsert',
    boardProjectTitle: 'Sommerkonsert 2027',
    comments: [],
  },
  {
    title: 'Sette opp saksliste til oktobermøtet',
    description: null,
    status: 'done',
    dueDayOffset: -2,
    meetingTitle: 'Styremøte oktober',
    projectName: null,
    boardProjectTitle: null,
    comments: [],
  },
  {
    title: 'Søke om kommunal driftsstøtte',
    description: 'Fristen er i november, men søknaden bør være klar i god tid.',
    status: 'open',
    dueDayOffset: null,
    meetingTitle: null,
    projectName: null,
    boardProjectTitle: null,
    comments: [],
  },
]

export type SeedBoardProject = {
  title: string
  goal: string
  /** Dager fra i dag; null = ingen frist. */
  dueDayOffset: number | null
  /** Konserten i noteområdet, matchet på navn. */
  linkedProjectName: string | null
  /** Ekstra oppgaver som bare finnes i dette prosjektet. */
  tasks: Array<{ title: string; status: 'open' | 'in_progress' | 'done'; dueDayOffset: number | null }>
  /** Meldinger i prosjektets egen chat-tråd. */
  messages: string[]
}

export const SEED_BOARD_PROJECTS: SeedBoardProject[] = [
  {
    title: 'Nye uniformer',
    goal: 'Hele korpset i nye jakker før NM. Innenfor budsjett, og med logo brodert på brystet.',
    dueDayOffset: 45,
    linkedProjectName: null,
    tasks: [
      { title: 'Måltaking av alle medlemmer', status: 'open', dueDayOffset: 14 },
      { title: 'Legge fram tilbudene for styret', status: 'open', dueDayOffset: 20 },
      { title: 'Kartlegge hvor mange jakker vi trenger', status: 'done', dueDayOffset: -8 },
    ],
    messages: [
      'Leverandør A svarte i dag: 2 900 per jakke, seks ukers leveringstid.',
      'Har vi sjekket om broderiet kommer i tillegg? Det gjorde det sist.',
      'Ja, 180 per jakke. Tar det med i oversikten til styremøtet.',
    ],
  },
  {
    title: 'Sommerkonsert 2027',
    goal: 'Fylle Åsane kulturhus, med eget lydanlegg og kaffesalg i pausen.',
    dueDayOffset: 120,
    linkedProjectName: 'Sommerkonsert',
    tasks: [
      { title: 'Avtale lydleverandør', status: 'in_progress', dueDayOffset: 30 },
      { title: 'Lage plakat og legge ut på Facebook', status: 'open', dueDayOffset: 60 },
    ],
    messages: ['Kulturhuset har holdt av datoen. Kontrakt kommer på e-post.'],
  },
]

/** Meldinger i fellesekanalen «Styret». */
export const SEED_BOARD_MESSAGES: string[] = [
  'Da er den nye internsiden i gang — vi tar styrearbeidet her fra nå.',
  'Fint. Da slipper vi å lete i Google Chat etter hva vi ble enige om.',
  'Husk at oktobermøtet er flyttet en uke. Agendaen ligger på møtesiden.',
]

export type SeedBoardChannel = {
  name: string
  /** `replyToIndex` peker på en tidligere melding i samme liste. */
  messages: Array<{ body: string; replyToIndex?: number }>
}

/**
 * Egendefinerte chatkanaler (#80) i demodataene: én kanal med et svar og en
 * kodeformatert melding, så både svarreferansen og backtick-formateringen kan
 * ses uten å skrive noe først.
 */
export const SEED_BOARD_CHANNELS: SeedBoardChannel[] = [
  {
    name: 'Uniformer 2027',
    messages: [
      { body: 'Vi tar uniformspraten her, så prosjekttråden holder seg til oppgavene.' },
      {
        body: 'Leverandøren vil ha målene som en CSV med kolonnene `navn`, `jakke` og `bukse` — ingenting annet.',
      },
      {
        body: 'Her er formatet de sendte:\n```csv\nnavn;jakke;bukse\nKari Nordmann;48;46\n```\nJeg fyller ut etter måltakingen.',
        replyToIndex: 1,
      },
      { body: 'Da tar vi målene rett etter øvelsen på torsdag.' },
    ],
  },
]

// ---------- Gruppeledere (demo, #81) ----------

export type SeedSectionLeader = {
  /** E-posten til en av SEED_MEMBERS. */
  email: string
  /** Stemmene hen er gruppeleder for. */
  partIds: string[]
}

/**
 * Leiarbindingene i demoen. To vanlige musikere leder hver sin seksjon — det er
 * poenget med #81: gruppeleder er ikke en rolle med et fint navn, det er en
 * binding i `section_leaders`. Ingrid spiller solokornett og leder kornettene;
 * Karim spiller Eb-bass og leder bassene.
 */
export const SEED_SECTION_LEADERS: SeedSectionLeader[] = [
  {
    email: 'ingrid@demo.tertnesbrass.no',
    partIds: ['soprano-cornet', 'solo-cornet', 'repiano-cornet', 'second-cornet', 'third-cornet'],
  },
  { email: 'karim@demo.tertnesbrass.no', partIds: ['eb-bass', 'bb-bass'] },
]

/** Meldinger i fellesekanalen «Gruppelederne». */
export const SEED_LEADER_MESSAGES: string[] = [
  'Da har vi vårt eget rom. Her tar vi det som går på tvers av stemmegruppene.',
  'Bra. Jeg trenger å vite hvem som mangler på lørdag før jeg setter opp bassrekka.',
  'Send meg en beskjed hvis noen i kornettene trenger ekstra tid på Benedictus.',
]

/**
 * Egendefinerte kanaler for gruppelederne, med et svar og en kodeformatert
 * melding — samme demo som styret har, i sitt eget datasett.
 */
export const SEED_LEADER_CHANNELS: SeedBoardChannel[] = [
  {
    name: 'Stemmeprøver høsten',
    messages: [
      { body: 'Jeg foreslår at vi kjører stemmeprøver i uke 40 og 41, én seksjon per kveld.' },
      { body: 'Sett gjerne opp lista slik: `seksjon · dag · rom`, så er den lett å lese på veggen.' },
      {
        body: 'Da blir det slik:\n```\nkornett · mandag · lilleslaen\nbass · onsdag · storsalen\n```\nSi fra om noe krasjer.',
        replyToIndex: 1,
      },
    ],
  },
]

// ---------- Veggen (demo) ----------

export type SeedPostData = {
  /** Fast id, så demodata kan fylles på idempotent ved hver dev-innlogging. */
  id: string
  title: string | null
  body: string
  /** Utelatt = `plain_text`, som alle innlegg var før #79. */
  format?: 'plain_text' | 'markdown'
  audience: 'all' | 'board'
  importance: 'normal' | 'important'
  official: boolean
  /** E-posten til forfatteren blant SEED_MEMBERS. */
  authorEmail: string
  /** Dager tilbake i tid. `null` = utkast (aldri publisert). */
  publishedDaysAgo: number | null
}

/**
 * Demoinnhold for veggen i lokal utvikling: beskjeder fra styret (én viktig,
 * én kun for styret, ett utkast) og vanlige medlemsinnlegg, så feeden,
 * filtrene og hub-blokken kan sees uten å skrive noe først. Forfatterne kobles
 * til demobrukerne etter hvert som kontoene finnes — de opprettes ved første
 * innlogging.
 */
export const SEED_POSTS: SeedPostData[] = [
  {
    id: 'demo-post-ovelse',
    title: 'Øvelsen flyttes til tirsdag i uke 36',
    body: 'Hei alle sammen!\n\nPå grunn av et arrangement i Tertneshallen flytter vi øvelsen den uken til tirsdag, samme tid og sted. Vi bruker kvelden på Cry of the Celts og Benedictus.\n\nSi fra til stemmegruppa di om noen ikke leser dette.',
    audience: 'all',
    importance: 'normal',
    official: true,
    authorEmail: 'sindre@demo.tertnesbrass.no',
    publishedDaysAgo: 2,
  },
  {
    id: 'demo-post-sommertur',
    title: 'Påmelding til sommerturen — frist søndag',
    body: 'Vi trenger endelig antall til bussen og hotellet, og fristen er søndag kveld.\n\nMeld deg på i skjemaet her: https://tertnesbrass.no/sommertur\n\nHar du spørsmål om egenandel eller reise, ta kontakt med styret.',
    audience: 'all',
    importance: 'important',
    official: true,
    authorEmail: 'sindre@demo.tertnesbrass.no',
    publishedDaysAgo: 9,
  },
  {
    id: 'demo-post-styremote',
    title: 'Styremøte torsdag: budsjett og dirigentavtale',
    body: 'Sakslisten er kort denne gangen: budsjettet for høsten, dirigentavtalen og en oppsummering av vårkonserten.\n\nMøtet er i møterommet klokken 19.',
    audience: 'board',
    importance: 'normal',
    official: true,
    authorEmail: 'sindre@demo.tertnesbrass.no',
    publishedDaysAgo: 4,
  },
  {
    id: 'demo-post-uniform',
    title: 'Utkast: uniformsregler til julekonserten',
    body: 'Foreløpig tekst — må avklares i styret før den går ut.\n\nSvart bukse/skjørt, korpsjakke og hvit skjorte. Nye medlemmer får jakke utlevert på øvelsen før konserten.',
    audience: 'all',
    importance: 'normal',
    official: true,
    authorEmail: 'sindre@demo.tertnesbrass.no',
    publishedDaysAgo: null,
  },
  {
    id: 'demo-post-generalprove',
    title: 'Kjøreplan for generalprøven',
    // Markdown-demoen (#79): overskrift, liste, tabell og lenke i ett innlegg,
    // så rendringen og `.prose` kan sees uten å skrive noe først.
    body: '## Program\n\nVi kjører gjennom hele programmet i rekkefølge. Ta med **blyant** og svart mappe.\n\n| Klokken | Hva | Hvor |\n| --- | --- | --- |\n| 18.30 | Rigg og oppvarming | Salen |\n| 19.00 | Gjennomkjøring | Salen |\n| 20.15 | Bilder | Foajeen |\n\n### Husk\n\n- Svart antrekk, ingen joggesko\n- Notestativ merkes med navn\n- Er du forhindret, si fra til stemmegruppa\n\n> Kjøreplanen ligger også på [tertnesbrass.no](https://tertnesbrass.no).',
    format: 'markdown',
    audience: 'all',
    importance: 'normal',
    official: true,
    authorEmail: 'sindre@demo.tertnesbrass.no',
    publishedDaysAgo: 5,
  },
  {
    id: 'demo-post-notestativ',
    title: null,
    // Demo av omtaler i selve INNLEGGET. `@[demo:<e-post>]` byttes ut med en
    // ekte markør i `seedWallDemo` når demobrukeren finnes — se kommentaren der.
    body: 'Er det noen som har tatt med seg feil notestativ hjem etter øvelsen? Mitt har et grønt bånd rundt foten.\n\n@[demo:silje@demo.tertnesbrass.no] du satt vel rett ved siden av meg?',
    audience: 'all',
    importance: 'normal',
    official: false,
    authorEmail: 'jonas@demo.tertnesbrass.no',
    publishedDaysAgo: 1,
  },
  {
    id: 'demo-post-takk',
    title: 'Takk for en fin konsert!',
    body: 'Tusen takk til alle som stilte i går — og til dem som ble igjen og ryddet.\n\nJeg har noen bilder fra generalprøven som jeg legger ut her senere.',
    audience: 'all',
    importance: 'normal',
    official: false,
    authorEmail: 'ingrid@demo.tertnesbrass.no',
    publishedDaysAgo: 3,
  },
  {
    id: 'demo-post-samspill',
    title: null,
    body: 'Noen som har lyst på ekstra samspill før NM? Tenker en søndag formiddag i mars, kanskje kvintett.',
    audience: 'all',
    importance: 'normal',
    official: false,
    authorEmail: 'astrid@demo.tertnesbrass.no',
    publishedDaysAgo: 6,
  },
  {
    id: 'demo-post-kaffe',
    title: null,
    body: 'Kaffemaskinen på øvingslokalet er fikset. Bare å bruke den igjen — husk å skylle kannen.',
    audience: 'all',
    importance: 'normal',
    official: false,
    authorEmail: 'karim@demo.tertnesbrass.no',
    publishedDaysAgo: 8,
  },
]

export type SeedCommentData = {
  id: string
  postId: string
  authorEmail: string
  /**
   * Teksten. `@[demo:<e-post>]` er en plassholder for en omtale (#83) og
   * erstattes med markøren `@[u:<brukerId>]` i `seedWallDemo` når demobrukeren
   * faktisk finnes — id-en kan ikke stå her.
   */
  body: string
  /** Timer etter at innlegget ble publisert. */
  hoursAfter: number
}

export const SEED_POST_COMMENTS: SeedCommentData[] = [
  {
    id: 'demo-comment-1',
    postId: 'demo-post-notestativ',
    authorEmail: 'silje@demo.tertnesbrass.no',
    body: 'Jeg tror jeg har det! Tar det med på neste øvelse.',
    hoursAfter: 2,
  },
  {
    // Demo av omtaler (#83). `@[demo:<e-post>]` byttes ut med en ekte markør i
    // `seedWallDemo` når demobrukeren finnes — se kommentaren der.
    id: 'demo-comment-2',
    postId: 'demo-post-notestativ',
    authorEmail: 'jonas@demo.tertnesbrass.no',
    body: '@[demo:silje@demo.tertnesbrass.no] perfekt, tusen takk! Legg det gjerne ved siden av slagverket.',
    hoursAfter: 3,
  },
  {
    id: 'demo-comment-3',
    postId: 'demo-post-ovelse',
    authorEmail: 'astrid@demo.tertnesbrass.no',
    body: 'Noteres. Kommer litt sent den tirsdagen, men rekker andre halvdel.',
    hoursAfter: 5,
  },
  {
    id: 'demo-comment-4',
    postId: 'demo-post-takk',
    authorEmail: 'karim@demo.tertnesbrass.no',
    body: 'Enig — og god stemning i bassrekka hele veien.',
    hoursAfter: 8,
  },
]

/** Likes på tvers, så tellerne i feeden viser noe realistisk. */
export const SEED_POST_REACTIONS: Array<{ postId: string; authorEmail: string }> = [
  { postId: 'demo-post-takk', authorEmail: 'jonas@demo.tertnesbrass.no' },
  { postId: 'demo-post-takk', authorEmail: 'astrid@demo.tertnesbrass.no' },
  { postId: 'demo-post-takk', authorEmail: 'sindre@demo.tertnesbrass.no' },
  { postId: 'demo-post-ovelse', authorEmail: 'ingrid@demo.tertnesbrass.no' },
  { postId: 'demo-post-kaffe', authorEmail: 'silje@demo.tertnesbrass.no' },
  { postId: 'demo-post-kaffe', authorEmail: 'jonas@demo.tertnesbrass.no' },
  { postId: 'demo-post-samspill', authorEmail: 'ingrid@demo.tertnesbrass.no' },
]

// ---------- Øvingsplan og oppmøte (#82 + #24) ----------

export type SeedSetlistItem = {
  /** Tittel på et verk i SEED_WORKS, eller null for et fritekstpunkt. */
  workTitle: string | null
  customTitle: string | null
  note: string | null
}

/**
 * Øvingsplanen for neste øvelse i demoen: to verk fra arkivet og ett
 * fritekstpunkt — nettopp den blandingen #82 ber om («ting utenfor arkivet,
 * f.eks. oppvarming»).
 */
export const SEED_SETLIST: SeedSetlistItem[] = [
  { workTitle: null, customTitle: 'Oppvarming og stemming', note: 'Ca. 10 min — koraler i Bb' },
  { workTitle: 'Benedictus', customTitle: null, note: 'Fra takt 42, euphonium-soloen' },
  { workTitle: 'Where Eagles Sing', customTitle: null, note: 'Gjennomspilling, tempo som på konserten' },
]

export type SeedAttendance = {
  /** E-posten til en av SEED_MEMBERS. */
  email: string
  status: 'attending' | 'not_attending' | 'unsure'
  comment: string | null
  /**
   * Hvem som registrerte den. `null` = medlemmet svarte selv (`source: 'self'`);
   * en e-post = registrert av en ansvarlig (`source: 'admin'`). Det er hele
   * poenget med den delte raden i #82: samme status, ulik opprinnelse.
   */
  registeredByEmail: string | null
}

export const SEED_ATTENDANCE: SeedAttendance[] = [
  { email: 'ingrid@demo.tertnesbrass.no', status: 'attending', comment: null, registeredByEmail: null },
  { email: 'astrid@demo.tertnesbrass.no', status: 'unsure', comment: 'Kommer senest 19:30', registeredByEmail: null },
  { email: 'karim@demo.tertnesbrass.no', status: 'attending', comment: null, registeredByEmail: null },
  {
    email: 'jonas@demo.tertnesbrass.no',
    status: 'not_attending',
    comment: 'Meldt fra på telefon',
    registeredByEmail: 'dirigent@demo.tertnesbrass.no',
  },
]
