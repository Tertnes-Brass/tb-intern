/**
 * Ren demodata (ingen Cloudflare-avhengigheter) — brukes både av
 * in-app-seeding i lokal dev (seed.ts) og av scripts/seed-remote.ts
 * som seeder produksjon utenfra (Workers gratisplan har for lite CPU
 * per request til å generere 210 PDF-er i én forespørsel).
 */

/** Fast vikartoken i demo, så vikarvisningen kan demonstreres uten oppsett. */
export const DEMO_SHARE_TOKEN = 'demo-vikar-sommerkonsert'

export type SeedMember = {
  name: string
  email: string
  roleId: 'admin' | 'archivist' | 'conductor' | 'member'
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
]

export const SEED_ROLES = [
  { id: 'admin', name: 'Administrator' },
  { id: 'archivist', name: 'Arkivar' },
  { id: 'conductor', name: 'Dirigent' },
  { id: 'member', name: 'Musiker' },
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
  /** [verkstittel, posisjon, merknad] */
  repertoire: Array<[title: string, position: number, note: string | null]>
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
    repertoire: [
      ['Where Eagles Sing', 1, null],
      ['I Dovregubbens hall', 2, null],
      ['Benedictus', 3, 'Solist: eufonium'],
      ['Cry of the Celts', 4, null],
      ['Sætergjentens søndag', 5, null],
      ['Tico-Tico no Fubá', 6, 'Ekstranummer'],
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
