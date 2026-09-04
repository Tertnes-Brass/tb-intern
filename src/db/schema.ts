import {
  type AnySQLiteColumn,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema'

// better-auth eier autentiseringstabellene (user/session/account/verification).
// Vi re-eksporterer dem så Drizzle Kit ser dem, og kobler RBAC til user.id.
export * from './auth-schema'

// ---------- Roller og tilgang (RBAC) ----------

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(), // 'admin' | 'archivist' | 'conductor' | 'member'
  name: text('name').notNull(),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(true),
})

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
)

// Domeneprofil knyttet 1:1 til en better-auth-bruker. Holder RBAC (aktiv-status)
// adskilt fra autentiseringen. Navn/e-post bor på better-auth user.
export const memberProfiles = sqliteTable('member_profiles', {
  authUserId: text('auth_user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  /**
   * DEPRECATED (#48) — les ALDRI rollen herfra. Sannheten er `member_roles`.
   *
   * Kolonnen står igjen fordi migrasjoner her er rent additive: den er NOT NULL
   * uten standardverdi, så den kan ikke droppes uten en tabell-rebuild, og en
   * rebuild i D1 cascader til barnetabellene inne i transaksjonen (se AGENTS.md).
   * Skrivestien holder den i takt med hovedrollen (`primaryRoleId` i
   * `src/lib/roles.ts`) slik at raden aldri blir usann, og `currentUser()` faller
   * tilbake på den for et medlem som mangler koblingsrader — nettopp for
   * vinduet mellom migrasjon og deploy, der gammel kode fortsatt bare skrev hit.
   */
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id),
  phone: text('phone'),
  // Interesser/kompetanse (#25): JSON-array av nøkler fra INTEREST_CATALOG i
  // `src/lib/member-profile.ts`. Ingen FK å peke på — katalogen er en fast
  // enum i koden, ikke data, og en tabell ville blitt en tabell med strenger.
  // Samme mønster som `invitations.part_ids`.
  interests: text('interests').notNull().default('[]'),
  // Fritekst ved siden av avkryssingene: nyansen katalogen ikke fanger
  // («har hengerfeste», «kan bake, ikke bære»).
  interestsNote: text('interests_note'),
  // Instrumenter utenfor brass band-besetningen (piano, gitar, sang). Har de
  // ingen `parts`-rad, kan de ikke være en bistemme — men de er verdt å vite om.
  otherInstruments: text('other_instruments'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

/**
 * Rollene et medlem faktisk har (#48). Et medlem kan ha flere verv samtidig —
 * «Musiker» + «Styremedlem» — og tilgangene er UNIONEN av rettighetene til alle
 * rollene. Ingen rolle kan trekke fra; roller er rent additive.
 *
 * `role_id` har bevisst INGEN `ON DELETE`: en slettet rolle skal ikke kunne ta
 * med seg medlemmenes tilganger i stillhet. `deleteRole` teller radene her og
 * nekter mens rollen er i bruk, slik den alltid har gjort for `member_profiles`.
 */
export const memberRoles = sqliteTable(
  'member_roles',
  {
    authUserId: text('auth_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.authUserId, t.roleId] }), index('member_roles_role_idx').on(t.roleId)],
)

// Invitasjoner: admin forhåndsoppretter tillatt e-post + rolle + stemmer.
// create-hooken i better-auth slipper kun gjennom e-poster som finnes her
// (eller ADMIN_EMAIL-bootstrap). E-post lagres alltid med små bokstaver.
export const invitations = sqliteTable('invitations', {
  email: text('email').primaryKey(),
  name: text('name'), // valgfritt fullt navn — settes på brukeren ved første innlogging
  /** DEPRECATED (#48), som `member_profiles.role_id`: sannheten er `invitation_roles`. */
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id),
  partIds: text('part_ids').notNull().default('[]'), // JSON-array av parts.id
  invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
})

/**
 * Rollene en invitasjon gir (#48) — samme flere-roller-modell som `member_roles`,
 * slik at «Musiker + Styremedlem» kan settes ved invitasjon og ikke må rettes
 * opp manuelt etter første innlogging. Radene kopieres til `member_roles` av
 * create-hooken i `src/server/auth-instance.ts`.
 *
 * `email` cascader fra invitasjonen (en tilbaketrukket invitasjon tar rollene
 * med seg); `role_id` gjør det ikke, av samme grunn som i `member_roles`.
 */
export const invitationRoles = sqliteTable(
  'invitation_roles',
  {
    email: text('email')
      .notNull()
      .references(() => invitations.email, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.email, t.roleId] })],
)

// ---------- Besetning / stemmer ----------

export const parts = sqliteTable('parts', {
  id: text('id').primaryKey(), // slug, f.eks. 'solo-cornet'
  sortOrder: integer('sort_order').notNull(),
  nameNo: text('name_no').notNull(),
  nameEn: text('name_en').notNull(),
  // JSON-array med aliaser for filnavn-gjenkjenning, f.eks. ["2nd cornet","2. kornett"]
  aliases: text('aliases').notNull().default('[]'),
  section: text('section').notNull(), // Se SectionId/SECTION_ORDER i lib/taxonomy.ts
  // Nullable self-FK for nøstede stemmer: en forelder-stemme («Slagverk»)
  // dekker barna sine (Slagverk 1/2/3 …). NULL = rotnode / selvstendig blad.
  parentId: text('parent_id').references((): AnySQLiteColumn => parts.id),
})

export const userParts = sqliteTable(
  'user_parts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    partId: text('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.partId] })],
)

// Bistemmer (#25): instrumenter medlemmet KAN spille, men ikke er tildelt.
// KRITISK: dette er kompetanse, ikke tilgang. `user_parts` er fortsatt det
// eneste som gir stemmefiler (`effectivePartIds` i `access.ts` leser aldri
// denne tabellen), og derfor kan medlemmet sette bistemmene sine selv — mens
// stemmetildeling fortsatt krever `members.manage`/`members.manage.section`.
export const memberInstruments = sqliteTable(
  'member_instruments',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    partId: text('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.partId] })],
)

// Seksjonsledere: binder en bruker til en stemme/seksjon hen kan administrere
// (tildele understemmer til andre i seksjonen). Scope for `members.manage.section`.
export const sectionLeaders = sqliteTable(
  'section_leaders',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    partId: text('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.partId] })],
)

/**
 * Delte stemmer mellom medlemmer (#16) — «noe lavt i horn som skal prøves på
 * baryton». Et medlem lar et annet medlem LESE notene til én av sine egne
 * tildelte stemmer.
 *
 * Dette er en leserett, ikke en tildeling. `user_parts` er fortsatt det eneste
 * som gjør deg til 3. horn, og det eneste medlemslista, seksjonslederomfanget
 * og oppmøtegruppene leser. En deling gir kun `part`-filer: partitur følger
 * `scores.view`, uplassert følger `archive.viewAll`, og ingen rettighet endres.
 *
 * **Delingen er alltid AVLEDET av delerens egen tilgang.** `currentUser()`
 * join-er mot `user_parts` og `member_profiles.is_active`, så en deling slutter
 * å virke i samme øyeblikk deleren mister stemmen eller blir deaktivert — uten
 * at noen rad må ryddes. Raden er en intensjon; delerens tilgang er fasiten.
 *
 * Ingen `expires_at`: begge parter kan fjerne delingen når som helst, og en
 * automatisk utløpsdato ville tømt notestativet midt i en prosjektperiode.
 * Vikarlenkene (`share_links`) er det tidsbegrensede verktøyet for folk uten
 * konto, og de er urørt av dette.
 *
 * Sammensatt primærnøkkel i stedet for en surrogat-id: en deling ER trippelen,
 * og da kan den samme stemmen ikke deles to ganger til samme medlem.
 */
export const partShares = sqliteTable(
  'part_shares',
  {
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    toUserId: text('to_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    partId: text('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromUserId, t.toUserId, t.partId] }),
    // Mottakersiden slås opp i `currentUser()` på HVER forespørsel; primærnøkkelen
    // starter på deleren og hjelper ikke der.
    index('part_shares_to_idx').on(t.toUserId),
  ],
)

// ---------- Verkskatalog ----------

export const works = sqliteTable(
  'works',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    archiveNumber: text('archive_number'),
    composer: text('composer'),
    arranger: text('arranger'),
    publisher: text('publisher'),
    genre: text('genre'),
    grade: integer('grade'), // 1–5
    durationSec: integer('duration_sec'),
    physicalLocation: text('physical_location'),
    acquiredYear: integer('acquired_year'),
    notes: text('notes'),
    status: text('status').notNull().default('active'), // 'active' | 'archived'
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('works_title_idx').on(t.title)],
)

export const workFiles = sqliteTable(
  'work_files',
  {
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'part' | 'score' | 'audio' | 'other'
    partId: text('part_id').references(() => parts.id),
    label: text('label'),
    r2Key: text('r2_key').notNull(),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull().default(0),
    pageCount: integer('page_count'),
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    uploadedAt: integer('uploaded_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('work_files_work_idx').on(t.workId)],
)

export const workLinks = sqliteTable(
  'work_links',
  {
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'youtube' | 'spotify' | 'other'
    url: text('url').notNull(),
    label: text('label'),
  },
  (t) => [index('work_links_work_idx').on(t.workId)],
)

// Slagverksinstrumentene stykket krever (#34) — den gjenbrukbare lista som
// slipper slagverkerne for å lese den ut av PDF-ene på nytt hver gang.
//
// Lista henger på VERKET og ikke på prosjektverket, fordi «Gaelforce trenger
// pauker» er sant uansett hvem som spiller det og når. Fordelingen for én
// konsert («Timpani – Silje») er noe annet og bor fortsatt i
// `project_works.percussion_setup`. To kolonner med samme navn ville før eller
// siden gitt to svar på hva korpset må ha med seg.
//
// `part_id` er hvilken slagverksstemme instrumentet står i, og er valgfri:
// arkivaren vet ofte at det trengs en marimba lenge før noen har fordelt
// stemmene. SET NULL, ikke CASCADE — endres besetningen, skal instrumentet bli
// stående uten stemme i stedet for å forsvinne fra riggelista. Serveren
// håndhever at stemmen faktisk er en slagverksstemme (`isPercussionPart`).
//
// Skriving krever `works.manage`; lesing følger verket. Registreringen er
// manuell nå — et framtidig PDF-/OCR-forslag (#34) skriver de samme radene og
// trenger ingen skjemaendring.
export const workPercussion = sqliteTable(
  'work_percussion',
  {
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    /** Fritekst med forslagsliste i src/lib/work-percussion.ts — aldri en enum i SQLite. */
    instrument: text('instrument').notNull(),
    /** «deles med perc 2», «må lånes», «kan erstattes med vibrafon». */
    note: text('note'),
    partId: text('part_id').references(() => parts.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('work_percussion_work_idx').on(t.workId, t.sortOrder)],
)

// ---------- Sesonger og prosjekter ----------

export const seasons = sqliteTable('seasons', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startsOn: text('starts_on').notNull(), // ISO-dato
  endsOn: text('ends_on').notNull(),
})

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    seasonId: text('season_id').references(() => seasons.id),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('konsert'), // 'konsert' | 'konkurranse' | 'seminar' | 'annet'
    eventDate: text('event_date'), // ISO-dato
    venue: text('venue'),
    description: text('description'),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    // Slagverksnotater for hele konserten: transport, hva som må lånes,
    // oppriggingsrekkefølge. Ren tekst med linjer.
    percussionNotes: text('percussion_notes'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('projects_date_idx').on(t.eventDate)],
)

export const projectWorks = sqliteTable(
  'project_works',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workId: text('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    note: text('note'),
    // Slagverksoppsettet for DETTE stykket i DETTE prosjektet — hvilke
    // instrumenter som trengs og hvem som spiller hva. Én linje per instrument.
    percussionSetup: text('percussion_setup'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.workId] })],
)

// Solister på ETT verk i ETT prosjekt (#50). Fremmednøkkelen er sammensatt og
// peker på `project_works`, ikke på `works`: solisten hører til at stykket
// spilles denne gangen. Tas verket ut av programmet, forsvinner solistene med
// koblingen (CASCADE), mens verket i arkivet er urørt — og neste gang stykket
// settes opp, starter man blankt, slik det skal være.
//
// **Intern eller ekstern.** `user_id` peker på medlemslista og navnet slås opp
// ferskt ved lesing (aldri lagret som kopi); `external_name` er vikaren, den
// innleide solisten eller en gruppe («Trombonegruppa»). Reglene — blant annet
// at et valgt medlem slår ut fritekstnavnet — bor i `src/lib/soloists.ts`.
//
// `user_id` er SET NULL av samme grunn som `project_times.responsible_user_id`:
// slutter solisten i korpset, skal programmet bli stående. Radene her slettes
// aldri av seg selv.
export const projectWorkSoloists = sqliteTable(
  'project_work_soloists',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    workId: text('work_id').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Navnet på en solist som ikke er medlem — eller på en solistgruppe. */
    externalName: text('external_name'),
    /** Valgfri gruppe-/rolletekst: «Kornettsolist», «Duett», «Slagverksgruppa». */
    role: text('role'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.workId],
      foreignColumns: [projectWorks.projectId, projectWorks.workId],
    }).onDelete('cascade'),
    index('project_work_soloists_work_idx').on(t.projectId, t.workId, t.sortOrder),
  ],
)

// Frivillig øvingsstatus per medlem per prosjektverk (#30).
//
// **Medlemmet eier sin egen rad.** PK er (prosjekt, verk, medlem), og det
// finnes bevisst INGEN `source`/`registered_by` slik `event_attendance` har:
// ingen kan sette en status for noen andre. Fraværsføring er en oppgave noen
// har fått; øvingsstatus er noe man sier om seg selv, og en «registrer for»-vei
// ville gjort det til et kontrollverktøy — det saken uttrykkelig ba om at det
// ikke skulle bli.
//
// Statusen slettes når medlemmet fjerner den (raden forsvinner), og cascader
// med prosjektverket og med brukeren. Innsynsregelen — tall til alle, navn til
// dirigent og egen gruppeleder — bor i `src/lib/practice.ts`.
export const projectWorkPractice = sqliteTable(
  'project_work_practice',
  {
    projectId: text('project_id').notNull(),
    workId: text('work_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['looked_at', 'practicing', 'needs_help'] }).notNull(),
    /** Kort, valgfri merknad: «takt 40 og utover». Ikke et skjema. */
    comment: text('comment'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.workId, t.userId] }),
    foreignKey({
      columns: [t.projectId, t.workId],
      foreignColumns: [projectWorks.projectId, projectWorks.workId],
    }).onDelete('cascade'),
    index('project_work_practice_user_idx').on(t.userId),
  ],
)

// Tidsplanen for ett prosjekt (#9): oppmøte for lasting, avreise, oppmøte for
// rigg i lokalet, lydprøve, konsertstart, nedrigg. En fleksibel LISTE og ikke
// et sett kolonner på `projects`: en konsert har lasting og nedrigg, et seminar
// har verken det ene eller det andre, og en konkurranse har en avreise ingen
// andre har. Faste kolonner ville betydd et skjemabytte hver gang korpset fant
// på noe nytt — og en haug tomme felt på alt annet.
//
// **Veggklokke, ikke tidsstempel.** `date` er ISO-dato og `time` er `HH:MM`,
// begge slik de ble skrevet inn. Et oppmøte 17:30 er 17:30 i Bergen uansett
// hvilken tidssone serveren kjører i, og `time` er nullbar fordi «lasting på
// lørdag» er en avtale også uten klokkeslett. Reglene bor i src/lib/practical.ts.
//
// **Ansvarlig er ENTEN et medlem ELLER et navn.** `responsible_user_id` peker
// på medlemslista (SET NULL: slutter sjåføren i korpset, står tidspunktet igjen
// uten ansvarlig i stedet for å forsvinne), mens `responsible_name` finnes for
// den innleide sjåføren som aldri får en konto. `contact_phone` er nummeret
// STAB har skrevet inn for akkurat denne oppgaven — ikke medlemmets
// telefonnummer lest fra profilen. Skillet er med vilje: telefonnummer i
// `member_profiles` er administrasjonsdata (`members.manage`), og et tidspunkt
// som er synlig for hele korpset skal ikke kunne bli en omvei rundt den regelen.
export const projectTimes = sqliteTable(
  'project_times',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Se PROJECT_TIME_KINDS i src/lib/practical.ts. Ren etikett — ingen logikk henger på den. */
    kind: text('kind').notNull().default('annet'),
    /** Egen overskrift når typen ikke er presis nok («Andre sett», «Kaffe i pausen»). */
    label: text('label'),
    date: text('date').notNull(), // ISO-dato
    time: text('time'), // 'HH:MM' i norsk veggklokke-tid, eller NULL
    /** Stedet for DETTE punktet — lastingen skjer sjelden der konserten er. */
    location: text('location'),
    /** Se PROJECT_TIME_AUDIENCES i src/lib/practical.ts. Standard 'alle'. */
    audience: text('audience').notNull().default('alle'),
    note: text('note'),
    responsibleUserId: text('responsible_user_id').references(() => user.id, { onDelete: 'set null' }),
    responsibleName: text('responsible_name'),
    contactPhone: text('contact_phone'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('project_times_project_idx').on(t.projectId, t.date, t.time)],
)

// ---------- Varsling om prosjekter (#18 + #51) ----------

// Idempotensen for prosjektvarsler, bygget som `notification_log` for veggen:
// én rad per (prosjekt, mottaker, varseltype). PK-en er hele poenget — uten den
// ville en avpublisering og en ny publisering sendt den samme e-posten to
// ganger, og «send på nytt» ville truffet alle.
//
// De to typene oppfører seg BEVISST ulikt, og det er derfor `kind` er en del av
// nøkkelen og ikke en egen tabell:
//
// - `published` skrives ÉN gang per mottaker og røres aldri igjen. Publiseres
//   prosjektet på nytt, finnes raden fortsatt, og ingen får varselet to ganger.
//   «Send på nytt» går kun til dem som MANGLER en rad (nye medlemmer, eller de
//   som feilet), nøyaktig som `resendPostNotifications`.
// - `update` er derimot gjentakende av natur: repertoaret kan endres flere
//   ganger fram mot konserten. Raden oppdateres da med nytt `sent_at`, og
//   `sent_at` er selve nyttelasten: den sier hva «siden forrige varsel» betyr
//   for akkurat denne mottakeren. Ett varsel per runde med endringer, aldri ett
//   per endring.
//
// `outcome` er det samme som på veggen: `logged` betyr at e-post ikke er
// aktivert her og at innholdet bare gikk til konsollen. Det skal aldri
// presenteres som «sendt».
export const projectNotifications = sqliteTable(
  'project_notifications',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** `published` = varselet om at prosjektet ble publisert. `update` = siste endringsvarsel. */
    kind: text('kind', { enum: ['published', 'update'] }).notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull(),
    outcome: text('outcome', { enum: ['sent', 'logged', 'failed'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId, t.kind] })],
)

// Hva som har endret seg i et PUBLISERT prosjekt siden sist noen ble varslet
// (#51). Append-only, og grunnlaget for at endringsvarselet kan samle alt i ÉN
// e-post i stedet for å sende én per endring.
//
// **Rader skrives kun for publiserte prosjekter.** Et utkast er ikke synlig for
// noen, så det finnes ingen endring å varsle om — publiseringsvarselet er
// nullpunktet. Uten den regelen ville det første endringsvarselet på et
// prosjekt inneholdt hele oppbyggingen av programmet, som medlemmene aldri har
// sett noe annet enn resultatet av.
//
// `kind` + `subject` + `detail` er STRUKTUR, ikke ferdig tekst: setningen
// bygges av `describeProjectChange` i src/lib/project-notify.ts, slik at
// formuleringen kan rettes uten en datamigrering, og slik at den kan testes
// uten database. `actor_user_id` er SET NULL — hvem som gjorde endringen er en
// opplysning, ikke en grunn til å miste historikken.
export const projectChanges = sqliteTable(
  'project_changes',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Se PROJECT_CHANGE_KINDS i src/lib/project-notify.ts. */
    kind: text('kind').notNull(),
    /** Hva endringen gjelder: verkstittelen, navnet på tidspunktet. */
    subject: text('subject'),
    /** Den nye verdien, når den er verdt å si i klartekst («15. november 2026»). */
    detail: text('detail'),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('project_changes_project_idx').on(t.projectId, t.createdAt)],
)

// ---------- Prosjektkommentarer (#27) ----------

// Spørsmål og svar knyttet til ETT prosjekt — «kva tid er lastinga?», «treng me
// dempar på nr. 3?». Bevisst ikke et forum: ingen kategorier, ingen egne sider,
// ingen nøsting utover ett svarnivå. Tråden bor på prosjektsiden, der spørsmålet
// oppstår.
//
// **Én tabell, to roller.** `parent_id = NULL` er en tråd (spørsmålet); en rad
// med `parent_id` er et svar i den tråden. Ett nivå, aldri dypere — håndheves i
// src/server/projects.ts, som nekter å svare på et svar. Selv-fremmednøkkelen
// cascader: slettes spørsmålet, forsvinner svarene med det. Det er den ønskede
// moderasjonssemantikken — en tråd fjernes som en tråd, ikke som et spørsmål med
// foreldreløse svar etter seg.
//
// `resolved_at`/`resolved_by` gjelder KUN en tråd (`parent_id = NULL`) og settes
// av `projects.manage`: «dette er besvart». Det er en status på spørsmålet, ikke
// på et enkelt svar — derfor står de her og ikke på svaret som avklarte det.
//
// Teksten er REN TEKST, som kommentarene på veggen. Ingen markdown, ingen HTML,
// ingen omtaler (#83 er ikke et krav her) — men modellen sperrer ikke for at de
// kan komme senere: en `project_comment_mentions`-tabell ville kunne legges ved
// siden av uten å røre denne.
export const projectComments = sqliteTable(
  'project_comments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** NULL = tråden selv (spørsmålet). Ellers id-en til tråden svaret hører til. */
    parentId: text('parent_id').references((): AnySQLiteColumn => projectComments.id, { onDelete: 'cascade' }),
    // SET NULL, som på veggen: en historisk kommentar skal bli stående selv om
    // kontoen forsvinner. Visningen sier «Ukjent» og ingenting går tapt.
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    /** Satt når en med `projects.manage` markerer tråden som avklart. Kun på tråder. */
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    resolvedBy: text('resolved_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('project_comments_project_idx').on(t.projectId, t.createdAt),
    index('project_comments_parent_idx').on(t.parentId),
  ],
)

// ---------- Vikardeling ----------

export const shareLinks = sqliteTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    recipientName: text('recipient_name').notNull(),
    // JSON-array med part-id-er vikaren skal ha tilgang til
    partIds: text('part_ids').notNull().default('[]'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('share_links_project_idx').on(t.projectId)],
)

export const downloadLog = sqliteTable(
  'download_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    shareLinkId: text('share_link_id').references(() => shareLinks.id),
    workFileId: text('work_file_id')
      .notNull()
      .references(() => workFiles.id, { onDelete: 'cascade' }),
    accessType: text('access_type', { enum: ['view', 'download'] }).notNull().default('download'),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('download_log_file_idx').on(t.workFileId),
    index('download_log_at_idx').on(t.at),
    index('download_log_user_dedupe_idx').on(t.workFileId, t.accessType, t.userId, t.at),
    index('download_log_share_dedupe_idx').on(t.workFileId, t.accessType, t.shareLinkId, t.at),
  ],
)

// ---------- Revisjonslogg ----------

// Append-only logg over sikkerhets- og medlemsendringer. Detaljer skal aldri
// inneholde passord, OTP-er, sesjonstokens eller andre hemmeligheter.
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    targetUserId: text('target_user_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    details: text('details').notNull().default('{}'),
    ipAddress: text('ip_address'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('audit_log_created_idx').on(t.createdAt),
    index('audit_log_target_idx').on(t.targetUserId, t.createdAt),
    index('audit_log_action_idx').on(t.action, t.createdAt),
  ],
)

// ---------- Innstillinger ----------

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

// ---------- Styre ----------

// Styremøter. `notes` er ren tekst med avsnitt (ingen markup) — referatet
// skrives i en textarea og gjengis med linjeskift bevart.
export const boardMeetings = sqliteTable(
  'board_meetings',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(), // ISO-dato
    title: text('title').notNull(),
    // Tre felt i møtets egen rekkefølge: agenda før, notater under, vedtak
    // etter. Alle er ren tekst med avsnitt — ingen markup.
    agenda: text('agenda'),
    notes: text('notes'),
    decisions: text('decisions'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('board_meetings_date_idx').on(t.date)],
)

// Styreprosjekter: en arbeidspakke styret planlegger og delegerer («Jubileum
// 2027», «Uniformer»). Egen ting fra `projects` i noteområdet — et styreprosjekt
// kan peke på en konsert, men de fleste gjør det ikke.
export const boardProjects = sqliteTable(
  'board_projects',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    goal: text('goal'),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    dueDate: text('due_date'), // ISO-dato
    status: text('status', { enum: ['active', 'done', 'archived'] })
      .notNull()
      .default('active'),
    linkedProjectId: text('linked_project_id').references(() => projects.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('board_projects_status_idx').on(t.status)],
)

// Styreoppgaver. Kobles valgfritt til et prosjekt i noteområdet (en konsert) og
// til møtet oppgaven ble opprettet på. `completedAt` settes når status blir
// 'done', og nullstilles når oppgaven åpnes igjen.
export const boardTasks = sqliteTable(
  'board_tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: ['open', 'in_progress', 'done'] })
      .notNull()
      .default('open'),
    assigneeUserId: text('assignee_user_id').references(() => user.id, { onDelete: 'set null' }),
    dueDate: text('due_date'), // ISO-dato
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    boardProjectId: text('board_project_id').references(() => boardProjects.id, { onDelete: 'set null' }),
    meetingId: text('meeting_id').references(() => boardMeetings.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('board_tasks_status_idx').on(t.status),
    index('board_tasks_meeting_idx').on(t.meetingId),
  ],
)

// Kommentartråd per oppgave — enkel og kronologisk, ingen tråding i tråden.
export const boardComments = sqliteTable(
  'board_comments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => boardTasks.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('board_comments_task_idx').on(t.taskId, t.createdAt)],
)

// Styredokumenter i R2 under nøkkelprefikset `board/`. Filene nås ALDRI via
// note-gaten i /api/files/$fileId — de har sin egen gate på `board.manage`
// (src/routes/api/board-files/$documentId.ts).
export const boardDocuments = sqliteTable(
  'board_documents',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    r2Key: text('r2_key').notNull(),
    fileName: text('file_name').notNull(),
    size: integer('size').notNull().default(0),
    contentType: text('content_type').notNull().default('application/octet-stream'),
    meetingId: text('meeting_id').references(() => boardMeetings.id, { onDelete: 'set null' }),
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('board_documents_meeting_idx').on(t.meetingId)],
)

// Egendefinerte chatkanaler styret oppretter selv (#80). Fellesekanalen
// ('general') og prosjekttrådene ('project:<id>') er FORTSATT bare strenger —
// de har en eier andre steder i modellen, og skal ikke få en tom rad her.
// Tabellen er derfor i praksis lista over `kind = 'custom'`-kanaler, med
// kanalnøkkelen `custom:<id>` i `board_messages.channel`; `kind` finnes for at
// et framtidig område (#81) skal kunne eie sine egne kanaler uten skjemabytte.
// Arkivering er myk: `archivedAt` gjør kanalen lesbar, men ikke skrivbar.
export const boardChannels = sqliteTable(
  'board_channels',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['general', 'project', 'custom'] })
      .notNull()
      .default('custom'),
    name: text('name').notNull(),
    boardProjectId: text('board_project_id').references(() => boardProjects.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('board_channels_kind_idx').on(t.kind, t.archivedAt)],
)

// Styrets interne chat. `channel` er enten 'general' (kanalen «Styret»),
// 'project:<boardProjectId>' (én tråd per styreprosjekt) eller 'custom:<id>'
// (en egendefinert kanal i `board_channels`). Kanalen er en streng og ikke en
// fremmednøkkel: de to første trådtypene finnes så lenge eieren finnes, og en
// slettet tråd skal ikke etterlate en tom rad noe sted.
export const boardMessages = sqliteTable(
  'board_messages',
  {
    id: text('id').primaryKey(),
    channel: text('channel').notNull(),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    // Svar på en konkret melding i samme kanal — én nivå, aldri nøstede tråder.
    // Fremmednøkkelen nullstilles når originalen slettes, og nettopp derfor
    // finnes `replyToDeleted`: uten den ville svaret sett ut som en helt vanlig
    // melding, og referansen «Meldingen er slettet» forsvunnet i stillhet.
    replyToId: text('reply_to_id').references((): AnySQLiteColumn => boardMessages.id, { onDelete: 'set null' }),
    replyToDeleted: integer('reply_to_deleted', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('board_messages_channel_idx').on(t.channel, t.createdAt)],
)

// Hvor langt hver bruker har lest i hver kanal. Uleste telles som meldinger
// etter `lastReadAt` som brukeren ikke skrev selv.
export const boardChannelReads = sqliteTable(
  'board_channel_reads',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    lastReadAt: integer('last_read_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channel] })],
)

// ---------- Gruppeledere (#81) ----------

// Gruppelederområdet (`/gruppeledere`) speiler chat-modellen over, men har
// EGNE tabeller. Det er poenget: gruppelederne skal ha samme opplevelse som
// styret uten noen gang å kunne lese en styremelding, og en delt tabell med et
// «område»-felt ville gjort én glemt WHERE til en lekkasje. Kanalnøklene bruker
// samme format (`general` / `custom:<id>`, `parseChannel` i `src/lib/board.ts`),
// men nøkkelrommene er adskilte fordi tabellene er det.
export const leaderChannels = sqliteTable(
  'leader_channels',
  {
    id: text('id').primaryKey(),
    // Ingen `project`-variant her: gruppelederne har ingen prosjekter å tråde
    // etter. Fellesekanalen «Gruppelederne» har ingen rad, som hos styret.
    kind: text('kind', { enum: ['general', 'custom'] })
      .notNull()
      .default('custom'),
    name: text('name').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('leader_channels_kind_idx').on(t.kind, t.archivedAt)],
)

// Gruppeledernes chat. `author_id` er SET NULL, ikke CASCADE: en historisk
// melding skal bli stående selv om kontoen forsvinner — og en gruppeleder som
// mister leiarbindingen beholder navnet sitt på det hen har skrevet.
export const leaderMessages = sqliteTable(
  'leader_messages',
  {
    id: text('id').primaryKey(),
    channel: text('channel').notNull(),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    // Samme svarmodell som styrechatten: ett nivå, og `replyToDeleted` husker at
    // meldingen VAR et svar etter at originalen er borte.
    replyToId: text('reply_to_id').references((): AnySQLiteColumn => leaderMessages.id, { onDelete: 'set null' }),
    replyToDeleted: integer('reply_to_deleted', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('leader_messages_channel_idx').on(t.channel, t.createdAt)],
)

export const leaderChannelReads = sqliteTable(
  'leader_channel_reads',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    lastReadAt: integer('last_read_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channel] })],
)

// ---------- Beskjeder (#28) ----------

// Veggen: både informasjon fra styret og vanlige medlemsinnlegg. Alle
// innloggede kan skrive; `posts.publish` kreves for å merke innlegget «Fra
// styret» (`official`), sette `importance = 'important'`, velge
// `audience = 'board'`, sende e-post og moderere andres innlegg.
// `publishedAt = null` er et utkast (kun skrivere) og finnes ikke for
// medlemsinnlegg, som publiseres direkte. Filtreringen håndheves alltid i
// src/server/posts.ts, aldri i UI-et.
export const posts = sqliteTable(
  'posts',
  {
    id: text('id').primaryKey(),
    // Valgfri: et medlemsinnlegg er ofte bare et par setninger. Uten tittel
    // vises første linje av teksten (`postHeading` i src/lib/posts.ts).
    title: text('title'),
    // Teksten slik forfatteren skrev den. Tolkningen styres av `format`.
    body: text('body').notNull(),
    // Hvordan `body` skal rendres (#79). `plain_text` = avsnitt med auto-lenkede
    // URL-er, som før; `markdown` går gjennom sanitizeren i src/lib/markdown.ts.
    // Standarden er `plain_text`, så eksisterende innlegg er uendret.
    format: text('format', { enum: ['plain_text', 'markdown'] })
      .notNull()
      .default('plain_text'),
    audience: text('audience', { enum: ['all', 'board'] })
      .notNull()
      .default('all'),
    importance: text('importance', { enum: ['normal', 'important'] })
      .notNull()
      .default('normal'),
    // «Fra styret»: kun `posts.publish` kan sette den.
    official: integer('official', { mode: 'boolean' }).notNull().default(false),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('posts_published_idx').on(t.publishedAt)],
)

// Kommentartråd under et innlegg. Kronologisk, ingen nøsting.
export const postComments = sqliteTable(
  'post_comments',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('post_comments_post_idx').on(t.postId, t.createdAt)],
)

// Medlemsomtaler i en kommentar (#83). Teksten inneholder markøren
// `@[u:<brukerId>]`; denne tabellen er den SPØRRBARE koblingen — «hvem er
// omtalt» skal ikke kreve at man leser gjennom kommentarteksten. Begge
// fremmednøklene cascader: slettes kommentaren, forsvinner omtalene med den, og
// slettes en bruker, forsvinner koblingen (markøren i teksten blir da
// «Ukjent medlem» ved visning). Ingen bruker slettes noen gang herfra.
export const postCommentMentions = sqliteTable(
  'post_comment_mentions',
  {
    commentId: text('comment_id')
      .notNull()
      .references(() => postComments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] }), index('post_comment_mentions_user_idx').on(t.userId)],
)

// Medlemsomtaler i selve INNLEGGET (#83, utvidet). Samme idé som over — teksten
// sier hvor omtalen står, tabellen sier hvem som er omtalt — men med ett tillegg
// et innlegg trenger og en kommentar ikke: `notified_at`.
//
// Et innlegg kan lagres, redigeres, avpubliseres og publiseres på nytt. Uten et
// merke per omtale ville hver av de handlingene kunnet sende den samme
// omtale-e-posten en gang til. `notified_at` er derfor det samme for omtaler som
// `notification_log` er for beskjeden: sannheten om hvem som ER varslet. Den
// settes også for dem som fikk beskjed-e-posten i samme utsending — de er
// varslet, bare gjennom en annen e-post.
export const postMentions = sqliteTable(
  'post_mentions',
  {
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    notifiedAt: integer('notified_at', { mode: 'timestamp_ms' }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index('post_mentions_user_idx').on(t.userId)],
)

// Målretting av en beskjed (#28). Rader her er en INNSNEVRING oppå `audience`,
// aldri en utvidelse: `audience` avgjør fortsatt hele korpset vs. bare styret,
// og målrettingen svarer på «hvem av dem». En beskjed UTEN rader her oppfører
// seg nøyaktig som før målretting fantes — derfor er tabellen tom for alt som
// finnes fra før, og derfor ble ikke `audience` gjort om til noe annet.
//
// `ref_id` har med vilje INGEN fremmednøkkel: kolonnen betyr to ting avhengig
// av `kind`, og en FK kan ikke peke to steder. For `kind = 'section'` er den en
// verdi fra `parts.section` (`SECTION_ORDER` i src/lib/taxonomy.ts) — som ikke
// er en tabell i det hele tatt. For `kind = 'project'` er den `projects.id`, og
// forsvinner prosjektet, blir raden foreldreløs: beskjeden treffer da ingen
// (fail-closed), men står lesbar for forfatteren og `posts.publish`. Det er
// samme linje som resten av basen — foreldreløse rader ryddes aldri automatisk,
// for «slettet» og «utenfor vinduet» er ikke til å skille fra utsiden.
export const postTargets = sqliteTable(
  'post_targets',
  {
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    /** 'section' = stemmegruppe (parts.section), 'project' = prosjektets medlemmer. */
    kind: text('kind', { enum: ['section', 'project'] }).notNull(),
    refId: text('ref_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.kind, t.refId] })],
)

// Lest/sett (#28): én rad første gang et medlem åpner detaljsiden for en
// beskjed. PK (postId, userId) gjør skrivingen idempotent, og `seen_at` er
// FØRSTE gang — ikke siste. Et «sist åpnet» ville svart på et annet spørsmål
// enn det saken stiller («hvem har sett den viktige kunngjøringen?»), og
// oppdatering ved hvert besøk ville gjort hver visning til en skriving.
//
// Ingen e-post og ingen påminnelser henger på denne tabellen. Den svarer på ett
// spørsmål, og tallet vises kun for forfatteren og `posts.publish` (navnelista
// bare for VIKTIGE beskjeder — se canSeeSeenNames i src/lib/posts.ts).
export const postSeen = sqliteTable(
  'post_seen',
  {
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    seenAt: integer('seen_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index('post_seen_user_idx').on(t.userId)],
)

// Reaksjoner. `kind` er foreløpig alltid 'like'; kolonnen finnes så flere kan
// komme uten en ny tabell. PK (postId, userId) = én reaksjon per person.
export const postReactions = sqliteTable(
  'post_reactions',
  {
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['like'] })
      .notNull()
      .default('like'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
)

// Bilder på et innlegg. `r2Key` bygges ALLTID fra en fersk id, aldri fra
// filnavnet. Visning skjer kun via /api/post-images/$imageId, som gjentar
// audience-sjekken — bildene er aldri offentlige (docs/tilgangsstyring.md).
export const postImages = sqliteTable(
  'post_images',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    r2Key: text('r2_key').notNull(),
    fileName: text('file_name').notNull(),
    size: integer('size').notNull().default(0),
    contentType: text('content_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    sortOrder: integer('sort_order').notNull().default(0),
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('post_images_post_idx').on(t.postId, t.sortOrder)],
)

// Én rad per bruker som har valgt noe annet enn standarden. Ingen rad = 'all'
// for begge kolonnene: fravær av rad skal aldri bety «ingen varsler».
export const notificationPreferences = sqliteTable('notification_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  posts: text('posts', { enum: ['all', 'important', 'off'] })
    .notNull()
    .default('all'),
  // E-post om styreoppgaver: både delegering og den daglige påminnelsen om
  // forfalte oppgaver. Valget vises bare for dem som har `board.manage`.
  boardTasks: text('board_tasks', { enum: ['all', 'off'] })
    .notNull()
    .default('all'),
  // E-post når noen omtaler deg i en kommentar (#83). Eget valg, fordi en
  // direkte omtale er noe annet enn en beskjed til hele korpset — den som har
  // slått av beskjedvarslene vil som regel fortsatt vite at hen er spurt om noe.
  mentions: text('mentions', { enum: ['all', 'off'] })
    .notNull()
    .default('all'),
  // E-post om prosjekter (#18 + #51): både varselet når et prosjekt publiseres
  // og oppdateringsvarselet om repertoar/tidsplan. Ett valg for begge, av samme
  // grunn som `board_tasks` dekker to e-poster: de kommer fra samme sted og
  // handler om det samme, og to brytere ville vært én for mye.
  projects: text('projects', { enum: ['all', 'off'] })
    .notNull()
    .default('all'),
})

// Idempotens for varsling: en beskjed sendes aldri to ganger til samme person.
// «Send på nytt» sender kun til dem som mangler en rad her.
export const notificationLog = sqliteTable(
  'notification_log',
  {
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull(),
    outcome: text('outcome', { enum: ['sent', 'logged', 'failed'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
)

// ---------- Utstyr (#13) ----------

// Utstyrsregisteret: én rad per fysisk gjenstand korpset forholder seg til —
// slagverksinstrument, transportkasse, notestativ, lydutstyr. Saken ba
// uttrykkelig om å slippe klistremerker og QR-koder (merking kan påvirke klang
// på et slagverksinstrument), så identiteten er *bildet pluss opplysningene*:
// navn, produsent, modell og serienummer. Ingen kode limes på noe.
//
// Alle aktive medlemmer kan LESE registeret — «kven eiger denne?» er et
// spørsmål alle stiller. Skriving krever `assets.manage` og håndheves i
// src/server/utstyr.ts, aldri i UI-et.
export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    // Fritekst med en foreslått taksonomi i src/lib/utstyr.ts
    // (ASSET_CATEGORIES). Bevisst IKKE en enum i skjemaet: en ny kategori skal
    // ikke kreve en migrasjon, og en enum kan ikke utvides i SQLite uten
    // tabell-rebuild (se AGENTS.md om D1).
    category: text('category'),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    // Hvem som eier gjenstanden. `band` og `trommelaget` er organisasjoner uten
    // rad noe sted; `member` peker på et medlem, `external` er en privatperson
    // eller organisasjon utenfor korpset og har bare et navn.
    ownerKind: text('owner_kind', { enum: ['band', 'trommelaget', 'member', 'external'] })
      .notNull()
      .default('band'),
    // Kun ved `ownerKind = 'member'`. SET NULL: slutter eieren i korpset, skal
    // gjenstanden bli stående i registeret — `ownerName` beholder navnet, slik
    // at raden ikke plutselig ser ut til å være korpsets egen.
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    // Navnet på en eier som ikke er (eller ikke lenger er) et medlem.
    ownerName: text('owner_name'),
    // Lån INN: hvem gjenstanden er lånt av. Fravær av navn = ikke lånt. Det er
    // med vilje ikke et eget boolsk felt — to kilder til «er den lånt?» ville
    // før eller siden gitt to svar. Reglene bor i `loanStatus` i
    // src/lib/utstyr.ts.
    loanedFrom: text('loaned_from'),
    loanFrom: text('loan_from'), // ISO-dato, valgfri
    loanUntil: text('loan_until'), // ISO-dato, valgfri
    notes: text('notes'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('assets_name_idx').on(t.name), index('assets_category_idx').on(t.category)],
)

// Bilder av en gjenstand, i R2 under prefikset `utstyr/`. Samme modell som
// veggbildene (`post_images`): nøkkelen bygges ALLTID av en fersk id, aldri av
// filnavnet, og bytene nås kun gjennom den gatede ruta
// /api/utstyr-images/$imageId — aldri via note-gaten i /api/files/$fileId.
export const assetImages = sqliteTable(
  'asset_images',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    r2Key: text('r2_key').notNull(),
    fileName: text('file_name').notNull(),
    size: integer('size').notNull().default(0),
    contentType: text('content_type').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('asset_images_asset_idx').on(t.assetId, t.sortOrder)],
)

// Kobling utstyr ↔ prosjekt: «skal brukes til» (`planned`) og «brukt på»
// (`used`). Egen koblingstabell og ikke en kolonne på `assets`, fordi
// spørsmålet går begge veier: en gjenstand har en historikk, og et prosjekt har
// en liste. Riggelistene (#12) kommer senere og skal kunne referere `assets.id`
// direkte — de trenger ingen endring her.
//
// PK er (asset_id, project_id): én gjenstand har ÉN relasjon til ett prosjekt om
// gangen, og `usage` flyttes fra `planned` til `used` når konserten er spilt.
// «Sist brukt på» leses av prosjektets `event_date`, ikke av en egen datokolonne
// — da kan de to aldri komme i utakt.
export const assetProjects = sqliteTable(
  'asset_projects',
  {
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    usage: text('usage', { enum: ['planned', 'used'] })
      .notNull()
      .default('planned'),
    note: text('note'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.projectId] }),
    index('asset_projects_project_idx').on(t.projectId),
  ],
)

// ---------- Øvingsplan og oppmøte (#82 + #24) ----------

// Lokale data på ÉN forekomst av en Google-kalenderhendelse. `occurrence_key`
// er den stabile identiteten fra src/lib/occurrence.ts: base64url(uid) for en
// enkelthendelse, base64url(uid) + forekomstens OPPRINNELIGE start for en
// gjentakende. Nøkkelen kommer aldri fra klienten uten å valideres, og den
// bygges alltid av parseren — aldri av et skjema.
//
// Raden opprettes LAZILY: første gang noen legger inn et punkt i øvingsplanen,
// kobler et prosjekt eller svarer på oppmøte. En hendelse ingen har rørt har
// ingen rad, og kalenderen er fortsatt bare en lesekopi av Google.
//
// `summary` og `start` er SNAPSHOT, ikke sannhet. Feeden er sannheten så lenge
// hendelsen finnes der; snapshotet er det som gjør en foreldreløs rad
// (hendelsen slettet i Google, eller falt ut av vinduet) mulig å forstå — uten
// det ville en administrator sittet igjen med en base64-nøkkel og en liste med
// verk. Lokale data slettes ALDRI automatisk fordi feeden endrer seg.
export const eventMeta = sqliteTable(
  'event_meta',
  {
    occurrenceKey: text('occurrence_key').primaryKey(),
    /** iCalendar-UID-en. Lik for hele serien; duplisert ut av nøkkelen for å kunne spørres på. */
    uid: text('uid').notNull(),
    /** Tittelen slik den sto i feeden da raden ble laget. */
    summary: text('summary').notNull(),
    /** Forekomstens starttidspunkt slik det sto i feeden da raden ble laget. */
    start: integer('start', { mode: 'timestamp_ms' }).notNull(),
    // UTGÅTT (#10, 2. september 2026): prosjektkoblingen er n:m og bor i
    // `event_projects`. Kolonnen står igjen fordi migrasjonene skal være rent
    // additive — en `DROP COLUMN` er en tabell-rebuild i SQLite, og en rebuild
    // i D1 cascader til barnetabellene (se AGENTS.md). Radene ble kopiert over
    // i migrasjonen; ingenting leser eller skriver den lenger.
    linkedProjectId: text('linked_project_id').references(() => projects.id, { onDelete: 'set null' }),

    // ---- Praktisk info per øving/hendelse (#10) ----
    // Alt er valgfritt: en vanlig torsdagsøving i kjelleren trenger ingen av
    // feltene, og en tom rad skal ikke se ut som en mangel. Normaliseringen
    // (klokkeslett, kartlenke, fritekst) bor i src/lib/practical.ts.
    /** Stedet med ord — «Tertnes skole, musikkrommet». */
    locationName: text('location_name'),
    /** Gateadressen, slik at hvem som helst finner fram uten å spørre. */
    locationAddress: text('location_address'),
    /** Kartlenke. KUN http(s) — validert av `parseMapUrl`, aldri lagret rått. */
    mapUrl: text('map_url'),
    /** Oppmøte for riggegruppa, 'HH:MM'. Kommer som regel før musikantene. */
    meetupCrew: text('meetup_crew'),
    /** Oppmøte for musikantene, 'HH:MM'. */
    meetupMusicians: text('meetup_musicians'),
    /** Dirigent for DENNE øvingen — fritekst, siden det ofte er en gjest. */
    conductor: text('conductor'),
    /** Nøkkelansvarlig: den som låser opp. Fritekst av samme grunn. */
    keyholder: text('keyholder'),
    /** Riggegruppa — navn på egne linjer. Ingen tabell: dette avtales i en chat. */
    crew: text('crew'),
    /** Vikarer på denne øvingen. Fravær og RSVP bor fortsatt i `event_attendance`. */
    substitutes: text('substitutes'),
    /** Alt annet som må sies: parkering, inngang, hva man tar med. */
    practicalNote: text('practical_note'),

    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('event_meta_uid_idx').on(t.uid)],
)

// Hvilke prosjekter en øving hører til (#10). n:m med vilje: «det kan være vi
// øver til meir enn eit prosjekt på samme øvinga, så det må ikkje være låst
// fast». Den gamle 1:1-kolonnen `event_meta.linked_project_id` er utgått og
// kopiert hit i migrasjonen.
//
// Begge fremmednøklene cascader, og det betyr KOBLINGEN — ikke innholdet:
// slettes prosjektet, forsvinner tilknytningen, mens øvingsplanen, oppmøtet og
// den praktiske infoen på `event_meta` står igjen. Øvingen er ikke prosjektets
// eiendom, den er kalenderens.
export const eventProjects = sqliteTable(
  'event_projects',
  {
    occurrenceKey: text('occurrence_key')
      .notNull()
      .references(() => eventMeta.occurrenceKey, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.occurrenceKey, t.projectId] }),
    index('event_projects_project_idx').on(t.projectId),
  ],
)

// Ett punkt i øvingsplanen: ENTEN et verk fra arkivet ELLER en fritekst-tittel
// (oppvarming, marsjoppstilling, pause). Regelen håndheves i
// src/lib/setlist.ts og i serverfunksjonen — SQLite har ingen CHECK her fordi
// migrasjonen skal være ren additiv og en CHECK ikke kan legges til uten
// tabell-rebuild (se AGENTS.md om D1 og rebuild).
//
// `work_id` er ON DELETE SET NULL: slettes verket fra arkivet, står punktet
// igjen med rekkefølgen og merknaden sin i stedet for å forsvinne fra en plan
// noen allerede har lest.
export const eventSetlist = sqliteTable(
  'event_setlist',
  {
    id: text('id').primaryKey(),
    occurrenceKey: text('occurrence_key')
      .notNull()
      .references(() => eventMeta.occurrenceKey, { onDelete: 'cascade' }),
    workId: text('work_id').references(() => works.id, { onDelete: 'set null' }),
    /** Tittel for et punkt som ikke er et verk i arkivet. Null når `work_id` er satt. */
    customTitle: text('custom_title'),
    /** Kort merknad: sats, taktnummer, omtrentlig tidsbruk. */
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('event_setlist_key_idx').on(t.occurrenceKey, t.sortOrder)],
)

// ÉN status per medlem per forekomst — samme rad for selvbetjent RSVP (#24) og
// administrert fravær (#82). To tabeller ville gitt to svar på «kommer Ingrid
// på torsdag?»; her vinner siste skriving, og `source` + `registered_by` sier
// hvem som satte den. Det er sporbarheten saken ber om.
//
// `comment` er en KORT, valgfri merknad — ikke en fraværsgrunn. Den følger
// samme innsyn som navnelisten (docs/tilgangsstyring.md §5d).
export const eventAttendance = sqliteTable(
  'event_attendance',
  {
    occurrenceKey: text('occurrence_key')
      .notNull()
      .references(() => eventMeta.occurrenceKey, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['attending', 'not_attending', 'unsure'] }).notNull(),
    comment: text('comment'),
    /** `self` = medlemmet svarte selv, `admin` = registrert av en ansvarlig. */
    source: text('source', { enum: ['self', 'admin'] })
      .notNull()
      .default('self'),
    registeredBy: text('registered_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.occurrenceKey, t.userId] }), index('event_attendance_user_idx').on(t.userId)],
)

// ---------- Mediearkivet (#32) ----------

// Ett medieelement: ett opptak, ett bilde eller én video, med opplysningene om
// hva det er og hvem som får se det. Filen ligger i R2 under prefikset
// `media/`, og bytene nås KUN gjennom den gatede ruta `/api/media/$mediaId` —
// aldri via note-gaten i `/api/files/$fileId` (docs/tilgangsstyring.md).
//
// Én fil per rad, ikke et album. Et medieelement er den tingen man deler en
// lenke til og trykker «spill av» på; en samling er et prosjekt eller et verk,
// og de finnes fra før. Skulle det senere trengs flere filer per element (en
// video med et separat lydspor), er veien en `media_files`-tabell ved siden av
// — ikke flere kolonner her.
export const mediaItems = sqliteTable(
  'media_items',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    // Utledet av innholdstypen ved opplasting (`mediaKindFor` i
    // src/lib/media.ts), aldri valgt fritt i et skjema: et element merket
    // «lyd» som egentlig er en MP4 ville gitt en <audio> rundt en video.
    // Kolonnen finnes for at lista skal kunne filtrere uten å parse MIME.
    kind: text('kind', { enum: ['lyd', 'bilde', 'video'] }).notNull(),
    // Datoen opptaket ble GJORT, ikke da det ble lastet opp. ISO-dato, valgfri
    // — et opptak fra 2019 som legges inn i dag hører hjemme i 2019.
    recordedOn: text('recorded_on'),
    description: text('description'),
    // Tilgangsnivået. `styre` er den eneste verdien som skjuler noe (krever
    // `board.manage`, også for å se at raden finnes). `offentlig-kandidat` er
    // en MERKING for senere PR-bruk og leses av nøyaktig de samme som
    // `intern` — reglene bor i `canViewMedia` i src/lib/media.ts.
    visibility: text('visibility', { enum: ['intern', 'styre', 'offentlig-kandidat'] })
      .notNull()
      .default('intern'),
    // Valgfri kobling til prosjektet opptaket er FRA og verket det er AV.
    // To nullbare kolonner og ikke to koblingstabeller: et medieelement har
    // ETT opphav, i motsetning til en gjenstand i utstyrsregisteret, som har en
    // historikk av prosjekter. SET NULL på begge — slettes prosjektet eller
    // verket, står opptaket igjen uten sin kobling i stedet for å forsvinne.
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    workId: text('work_id').references(() => works.id, { onDelete: 'set null' }),
    // Filen. `r2Key` bygges ALLTID av en fersk id og en endelse utledet av
    // innholdstypen — aldri av `fileName`, som er brukerstyrt.
    r2Key: text('r2_key').notNull(),
    fileName: text('file_name').notNull(),
    size: integer('size').notNull().default(0),
    contentType: text('content_type').notNull(),
    // Hvem som lastet opp. En OPPLYSNING om hvor filen kom fra, ikke en
    // rettighet: skriving krever `media.manage` for alle rader (se
    // `canEditMedia`). SET NULL, slik at raden overlever at kontoen slettes.
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('media_items_recorded_idx').on(t.recordedOn),
    index('media_items_project_idx').on(t.projectId),
    index('media_items_work_idx').on(t.workId),
  ],
)

// ---------- Sosiale arrangement (#31) ----------

// Pub etter øving, julebord, fjelltur, dugnad, brettspillkveld. Dette er
// LOKALE arrangement med en egen id — de kommer ikke fra Google-feeden, og de
// har derfor bevisst INGEN `occurrence_key`. Å presse dem inn i
// occurrenceKey-verdenen ville krevd en nøkkel uten en hendelse å utlede den
// fra, og en «forekomst» som aldri kan flyttes av dirigenten.
//
// De vises likevel i kalenderområdets liste sammen med feed-hendelsene
// (`src/lib/social.ts` → `mergeCalendarRows`), fordi det er ett program for
// medlemmet selv om det er to kilder.
//
// **Ingen sletting.** Et arrangement avlyses (`cancelled_at`) og blir stående
// merket «Avlyst» til det faller ut av kalendervinduet av seg selv. Den som
// har svart «kommer» skal kunne se HVA som ble avlyst, ikke oppdage at raden
// forsvant.
//
// **E-postvarsling kommer ikke i denne omgangen (#31).** Modellen er skrevet
// så det blir additivt å legge til: mottakerlista er `social_signups`,
// avsenderen er `host_user_id`, og idempotensen får sin egen loggtabell etter
// mønsteret fra `notification_log` (PK `(social_event_id, user_id)`) pluss en
// kolonne i `notification_preferences`. Ingen av delene krever at noe her
// endres — derfor står det ingen ubrukt `notified_at` og venter.
export const socialEvents = sqliteTable(
  'social_events',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    /** Praktisk info: pris, mat, transport, aldersgrense. Fri tekst, ren tekst. */
    description: text('description'),
    location: text('location'),
    /** Start, dato + klokkeslett. Lagres i UTC; skjemaet snakker veggklokke i Oslo. */
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
    /** Valgfri påmeldingsfrist. Etter den kan man fortsatt melde avbud, ikke melde seg på. */
    signupDeadline: integer('signup_deadline', { mode: 'timestamp_ms' }),
    /**
     * Valgfritt maks antall. Ingen hard grense i skrivepunktet: alle får svare
     * «kommer», og de som ikke får plass havner på venteliste sortert på
     * `attending_since`. Det er derfor D1s manglende interaktive transaksjoner
     * ikke er et problem her — plassen deles ut ved LESING, ikke ved skriving.
     */
    capacity: integer('capacity'),
    /** Arrangøren. SET NULL som ellers i modellen; UI-et viser «Ukjent» da. */
    hostUserId: text('host_user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Satt når arrangementet er avlyst. Kan settes tilbake til null (angre). */
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('social_events_start_idx').on(t.startsAt), index('social_events_host_idx').on(t.hostUserId)],
)

// Én rad per medlem per arrangement — siste svar vinner, som i
// `event_attendance`. Statusene er de samme tre ordene, men tabellen er en
// annen med vilje: et julebord er ikke en øvelse, og en påmelding har frist,
// maks antall og venteliste som oppmøtet ikke har.
//
// `attending_since` er ventelistens sorteringsnøkkel, og settes KUN når svaret
// blir «kommer» (og nullstilles når det slutter å være det). Hadde vi sortert
// på `updated_at`, ville et medlem mistet plassen sin ved å rette en skrivefeil
// i kommentaren; hadde vi sortert på `created_at`, ville en som meldte avbud og
// ombestemte seg beholdt en plass hen hadde gitt fra seg.
export const socialSignups = sqliteTable(
  'social_signups',
  {
    socialEventId: text('social_event_id')
      .notNull()
      .references(() => socialEvents.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['attending', 'not_attending', 'unsure'] }).notNull(),
    /** Kort, valgfri kommentar: kosthold, skyss, «kommer etter jobb». */
    comment: text('comment'),
    /** Tidspunktet svaret sist BLE «kommer». Null for alle andre statuser. */
    attendingSince: integer('attending_since', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.socialEventId, t.userId] }),
    index('social_signups_user_idx').on(t.userId),
    index('social_signups_queue_idx').on(t.socialEventId, t.attendingSince),
  ],
)
