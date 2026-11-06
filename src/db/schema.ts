import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'
import { session, user } from './auth-schema'

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

// Domeneprofil knyttet 1:1 til en better-auth-bruker. Holder RBAC (rolle +
// aktiv-status) adskilt fra autentiseringen. Navn/e-post bor på better-auth user.
export const memberProfiles = sqliteTable('member_profiles', {
  authUserId: text('auth_user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id),
  phone: text('phone'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

// Invitasjoner: admin forhåndsoppretter tillatt e-post + rolle + stemmer.
// create-hooken i better-auth slipper kun gjennom e-poster som finnes her
// (eller ADMIN_EMAIL-bootstrap). E-post lagres alltid med små bokstaver.
export const invitations = sqliteTable('invitations', {
  email: text('email').primaryKey(),
  name: text('name'), // valgfritt fullt navn — settes på brukeren ved første innlogging
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id),
  partIds: text('part_ids').notNull().default('[]'), // JSON-array av parts.id
  invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
})

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
    // Null er originalutgaven. Tilhørighet valideres i serverlaget.
    currentEditionId: text('current_edition_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('works_title_idx').on(t.title)],
)

export const workEditions = sqliteTable('work_editions', {
  id: text('id').primaryKey(),
  workId: text('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [index('work_editions_work_idx').on(t.workId)])

export const workFiles = sqliteTable(
  'work_files',
  {
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    editionId: text('edition_id').references(() => workEditions.id),
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

// Historisk fysisk katalog: arkivnummer endres aldri av importen.
export const legacyArchiveEntries = sqliteTable('legacy_archive_entries', {
  id: text('id').primaryKey(),
  archiveNumber: text('archive_number'),
  title: text('title').notNull(),
  composer: text('composer'),
  arranger: text('arranger'),
  missingParts: text('missing_parts'),
  lastChecked: text('last_checked'),
  categoryCode: text('category_code'),
  notes: text('notes'),
  loanedTo: text('loaned_to'),
  markedDigitized: integer('marked_digitized', { mode: 'boolean' }).notNull().default(false),
  sourceRow: integer('source_row').notNull(),
  sourceData: text('source_data').notNull(),
}, (t) => [index('legacy_archive_number_idx').on(t.archiveNumber), index('legacy_archive_title_idx').on(t.title)])

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
    editionId: text('edition_id').references(() => workEditions.id),
    position: integer('position').notNull(),
    note: text('note'),
    // Slagverksoppsettet for DETTE stykket i DETTE prosjektet — hvilke
    // instrumenter som trengs og hvem som spiller hva. Én linje per instrument.
    percussionSetup: text('percussion_setup'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.workId] })],
)

// ---------- Sceneoppsett ----------

// Tegninger av hvordan korpset og slagverket står på scenen (Excalidraw).
// Et prosjekt kan ha flere (korps, slagverk, konkurranse), og de forsvinner med
// prosjektet. `scene` er JSON — `{ elements, appState }` — validert av
// `parseStageScene` i `src/lib/stage-scene.ts`; bilder lagres ikke.
// `revision` er optimistisk låsing: en lagring må oppgi revisjonen den bygger
// på, så to som redigerer samtidig aldri overskriver hverandre i stillhet.
export const stageSetups = sqliteTable(
  'stage_setups',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // Merknader til arrangøren — kommer med i PDF-en.
    notes: text('notes'),
    // Den arrangøren skal kontakte om riggen — kommer med i PDF-en. Fylles ut
    // med den som lager oppsettet, og kan endres.
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    scene: text('scene').notNull(),
    revision: integer('revision').notNull().default(1),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('stage_setups_project_idx').on(t.projectId, t.createdAt)],
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
    fromArchive: integer('from_archive', { mode: 'boolean' }).notNull().default(false),
    // Festet øverst på veggen (kun `posts.publish`, se src/lib/pins.ts).
    // `pinned_at` = når det ble festet (null = ikke festet); `pinned_until` er
    // en norsk kalenderdato «YYYY-MM-DD», festet TIL OG MED den dagen
    // (null = til noen løsner det). En utløpt festing ryddes aldri — den
    // teller bare ikke lenger, verken på veggen eller mot taket.
    pinnedAt: integer('pinned_at', { mode: 'timestamp_ms' }),
    pinnedUntil: text('pinned_until'),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('posts_published_idx').on(t.publishedAt)],
)

// Kommentartråd under et innlegg. To nivåer (svar på svar, se `src/lib/threads.ts`):
// `parent_id` er toppkommentaren svaret står under, `reply_to_id` den konkrete
// kommentaren det svarer på (lik `parent_id`, eller et annet svar i samme tråd).
// En kommentar som noen har svart på, blir et «slettet»-merke (`deleted_at`,
// tom tekst, ingen forfatter) i stedet for å forsvinne — ellers ville svarene
// mistet sammenhengen. Fremmednøklene er SET NULL som siste skanse; slettingen
// i `deleteComment` lar dem aldri slå inn.
export const postComments = sqliteTable(
  'post_comments',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    parentId: text('parent_id').references((): AnySQLiteColumn => postComments.id, { onDelete: 'set null' }),
    replyToId: text('reply_to_id').references((): AnySQLiteColumn => postComments.id, { onDelete: 'set null' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('post_comments_post_idx').on(t.postId, t.createdAt),
    index('post_comments_parent_idx').on(t.parentId),
    index('post_comments_reply_to_idx').on(t.replyToId),
  ],
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

// Lest-kvittering: hvem har ÅPNET hvilket innlegg (detaljsiden på web, eller
// detaljvisningen i mobil-API-et). Grunnlaget for ulest-tallet på Beskjeder-
// fanen og app-ikonet, og for «Viktig»-varselet øverst på Hjem. Skrives bare
// av en eksplisitt POST (`markPostRead`), aldri av en GET — ruteren
// forhåndslaster detaljsiden ved hover, og det er ikke det samme som å lese.
// Bare innlegg fra de siste dagene telles som uleste (`UNREAD_WINDOW_DAYS` i
// src/lib/unread.ts), så tabellen trenger ingen historikk fra før den fantes.
export const postReads = sqliteTable(
  'post_reads',
  {
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    readAt: integer('read_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index('post_reads_user_idx').on(t.userId)],
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

// Vedlegg følger innleggets tilgang; bytene nås kun via /api/post-attachments.
export const postAttachments = sqliteTable('post_attachments', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  r2Key: text('r2_key').notNull(),
  fileName: text('file_name').notNull(),
  size: integer('size').notNull(),
  uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [index('post_attachments_post_idx').on(t.postId, t.createdAt)])

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
  // Push-varsel dagen før en hendelse du ikke har svart på (kun push — det går
  // aldri e-post om dette). Standarden er på; varselet går uansett bare til
  // enheter der medlemmet selv har slått på varsler.
  rsvpReminders: text('rsvp_reminders', { enum: ['all', 'off'] })
    .notNull()
    .default('all'),
  // Push-varsel om nye svar i forumtråder du følger (kun push, aldri e-post).
  // Hvilke tråder du følger, står i `forum_follows` og `followsForumTopic`.
  forumReplies: text('forum_replies', { enum: ['all', 'off'] })
    .notNull()
    .default('all'),
})

// Web Push: én rad per nettleser/enhet som har slått på varsler (PWA på
// Hjem-skjermen, Android, desktop). Nøklene er nettleserens egne og brukes til å
// kryptere hver melding til akkurat den enheten (src/lib/web-push.ts).
// `endpoint` er unik: logger noen andre inn på samme enhet og slår på varsler,
// flyttes raden til dem i stedet for å bli liggende hos forrige bruker.
// Raden slettes når push-tjenesten svarer 404/410 (abonnementet er borte), ved
// utlogging fra enheten, og når brukeren slår varsler av.
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    // «iPhone · Safari» osv. — bare for å kunne vise hvilke enheter som får varsler.
    label: text('label'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
    // Innloggingen på enheten (migrasjon 0024). Varsler hører til en innlogget
    // enhet: «Logg ut andre enheter», passordbytte og utestengelse sletter
    // økten, og CASCADE tar abonnementet med seg — en mistet iPad skal ikke
    // fortsette å vise «Viktig fra styret» på låseskjermen. Utsendingen hopper
    // også over rader uten aktiv økt (utløpt).
    sessionId: text('session_id').references(() => session.id, { onDelete: 'cascade' }),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId), index('push_subscriptions_session_idx').on(t.sessionId)],
)

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
    // Kobling til et prosjekt/konsert (#26). SET NULL: slettes prosjektet,
    // består øvingsplanen — den er ikke prosjektets eiendom.
    linkedProjectId: text('linked_project_id').references(() => projects.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('event_meta_uid_idx').on(t.uid)],
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

// ---------- Diskusjonsforum ----------
export const forumTopics = sqliteTable('forum_topics', {
  id: text('id').primaryKey(),
  authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  activityAt: integer('activity_at').notNull(),
  // Trådstarten er slettet, men andre har svart: tittelen og svarene står, mens
  // teksten, forfatteren, bildene og reaksjonene er borte (se `deleteForumText`).
  deletedAt: integer('deleted_at'),
}, (t) => [index('forum_topics_activity_idx').on(t.activityAt)])

// Svar på svar (se `src/lib/threads.ts`): `parent_id` er svaret på tråden som
// dette står under (null = svar rett på tråden), `reply_to_id` det konkrete
// svaret det svarer på. Et svar som noen har svart på, blir et «slettet»-merke
// (`deleted_at`, tom tekst, ingen forfatter) i stedet for å forsvinne — ellers
// ville svarene mistet sammenhengen. SET NULL er siste skanse; `deleteForumText`
// lar den aldri slå inn.
export const forumReplies = sqliteTable('forum_replies', {
  id: text('id').primaryKey(),
  topicId: text('topic_id').notNull().references(() => forumTopics.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  parentId: text('parent_id').references((): AnySQLiteColumn => forumReplies.id, { onDelete: 'set null' }),
  replyToId: text('reply_to_id').references((): AnySQLiteColumn => forumReplies.id, { onDelete: 'set null' }),
  deletedAt: integer('deleted_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [
  index('forum_replies_topic_idx').on(t.topicId, t.createdAt),
  index('forum_replies_parent_idx').on(t.parentId, t.createdAt),
  index('forum_replies_reply_to_idx').on(t.replyToId),
])

// Exact reply receipts: opening one page never clears unread replies on another.
export const forumReplyReads = sqliteTable('forum_reply_reads', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  replyId: text('reply_id').notNull().references(() => forumReplies.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.replyId] }), index('forum_reply_reads_reply_idx').on(t.replyId)])

// Eksplisitte valg om å følge en tråd. Den som startet tråden eller har svart i
// den, følger den uten rad; en rad med `following = false` demper tråden, en med
// `true` følger den uten å ha skrevet noe. Regelen er `followsForumTopic`.
export const forumFollows = sqliteTable('forum_follows', {
  topicId: text('topic_id').notNull().references(() => forumTopics.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  following: integer('following', { mode: 'boolean' }).notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [primaryKey({ columns: [t.topicId, t.userId] }), index('forum_follows_user_idx').on(t.userId)])

// ---------- Bilder og GIF-er i samtalene ----------
// Ett bilde, én GIF, en sticker eller et meme i forumet, i en kommentar på
// veggen eller i en av chattene (src/lib/message-media.ts). To kilder:
//
// - `upload`: medlemmets egen fil. Bytene ligger i R2 under `r2_key` (bygd av en
//   fersk id), `content_type` kommer fra bytene, aldri fra klienten.
// - `klipy`: valgt i GIF-velgeren. Ingen bytes hos oss — KLIPYs vilkår krever at
//   medieadressen brukes slik den kom (`external_url`, kun KLIPYs CDN-er, se
//   `isKlipyMediaUrl`), og leserens nettleser henter den derfra.
//
// Lages FØR teksten sendes: til da er `target_kind`/`target_id` null, og bare
// eieren ser raden. Når meldingen sendes, kobles den til raden den står i — én
// gang, med compare-and-set på `target_id IS NULL`. Ingen fremmednøkkel til
// målet (det kan være fem tabeller); `/api/message-media/$mediaId` sjekker at
// målet finnes og at leseren kan se det, og den daglige cron-en rydder bort
// rader som står uten mål (se `sweepMessageMedia`).
export const messageMedia = sqliteTable(
  'message_media',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'set null' }),
    targetKind: text('target_kind', {
      enum: ['forum_topic', 'forum_reply', 'post_comment', 'board_message', 'leader_message'],
    }),
    targetId: text('target_id'),
    source: text('source', { enum: ['upload', 'klipy'] }).notNull().default('upload'),
    r2Key: text('r2_key'),
    externalUrl: text('external_url'),
    externalKind: text('external_kind', { enum: ['gif', 'sticker', 'meme'] }),
    externalSlug: text('external_slug'),
    title: text('title'),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    attachedAt: integer('attached_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('message_media_target_idx').on(t.targetKind, t.targetId, t.sortOrder),
    index('message_media_owner_idx').on(t.ownerId, t.targetId),
  ],
)

// ---------- Emoji-reaksjoner ----------
// Én rad per medlem per emoji per innlegg/kommentar/forumtråd/forumsvar
// (src/lib/reactions.ts). Erstatter `post_reactions` (bare «👍 Liker»), som er
// kopiert hit med emojien 👍 i migrasjon 0031 og ikke skrives til lenger — men
// står igjen, så en eldre versjon av Workeren fortsatt kan lese den.
// Mobil-API v1 sin «like» er 👍 i denne tabellen.
//
// Ingen fremmednøkkel til målet (fire tabeller): `canReactTo` sjekker at det
// finnes og at medlemmet kan lese det, sletting av innlegg/kommentarer rydder
// reaksjonene, og den daglige cron-en tar resten (`sweepReactions`).
export const reactions = sqliteTable(
  'reactions',
  {
    targetKind: text('target_kind', { enum: ['post', 'post_comment', 'forum_topic', 'forum_reply'] }).notNull(),
    targetId: text('target_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.targetKind, t.targetId, t.userId, t.emoji] }),
    index('reactions_target_idx').on(t.targetKind, t.targetId, t.createdAt),
  ],
)
