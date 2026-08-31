import {
  type AnySQLiteColumn,
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
  },
  (t) => [primaryKey({ columns: [t.projectId, t.workId] })],
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
    // Ren tekst med avsnitt. Ikke markdown — URL-er auto-lenkes ved rendring.
    body: text('body').notNull(),
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

// Én rad per bruker som har valgt noe annet enn standarden. Ingen rad = 'all'.
export const notificationPreferences = sqliteTable('notification_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  posts: text('posts', { enum: ['all', 'important', 'off'] })
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
