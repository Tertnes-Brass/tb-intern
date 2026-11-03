/** Native presentation contract. All controls are rendered by SwiftUI. */
export type Value = string | number | boolean | null | string[];
export type Values = Record<string, Value>;
export type Choice = {
    value: string;
    label: string;
};
export type Field = {
    key: string;
    label: string;
    kind: 'text' | 'multiline' | 'date' | 'number' | 'toggle' | 'select' | 'multi' | 'password' | 'lines';
    required?: boolean;
    nullable?: boolean;
    options?: Choice[];
    hint?: string;
    lookup?: 'project-works' | 'event-works' | 'board-projects';
};
export type Action = {
    id: string;
    title: string;
    operation: string;
    values: Values;
    fields: Field[];
    destructive?: boolean;
    message?: string;
    upload?: 'work' | 'document' | 'image';
    mentions?: Array<{
        id: string;
        name: string;
    }>;
};
export type Row = {
    id: string;
    title: string;
    subtitle?: string;
    body?: string;
    markdown?: string;
    path?: string;
    url?: string;
    file?: {
        path: string;
        name: string;
        kind: string;
    };
    actions?: Action[];
    imagePath?: string;
};
export type Section = {
    id: string;
    title: string;
    rows: Row[];
};
export type Screen = {
    archive?: { name: string; files: Array<{ path: string; name: string; kind: string }> };
    title: string;
    subtitle?: string;
    sections: Section[];
    actions?: Action[];
    searchable?: boolean;
    refreshSeconds?: number;
    readAction?: {
        operation: string;
        values: Values;
    };
};
export const choice = (value: string, label = value): Choice => ({ value, label });
export const field = (key: string, label: string, kind: Field['kind'] = 'text', extra: Partial<Field> = {}): Field => ({ key, label, kind, ...extra });
export const select = (key: string, label: string, options: Choice[], nullable = false): Field => field(key, label, 'select', { options, nullable });
export const multi = (key: string, label: string, options: Choice[], hint?: string): Field => field(key, label, 'multi', { options, hint });
export function action(operation: string, title: string, values: Values = {}, fields: Field[] = [], extra: Partial<Action> = {}): Action {
    return { id: operation + ':' + JSON.stringify(values), operation, title, values, fields, ...extra };
}
export const remove = (operation: string, title: string, values: Values): Action => action(operation, title, values, [], { destructive: true, message: 'Dette kan ikke angres. Kontroller at du har valgt riktig innhold.' });
export const row = (id: string, title: string, subtitle = '', extra: Partial<Row> = {}): Row => ({ id, title, subtitle, ...extra });
export const section = (id: string, title: string, rows: Row[]): Section => ({ id, title, rows });
export const text = (id: string, title: string, body: string | null | undefined): Row => row(id, title, '', { body: body || 'Ikke oppgitt' });
export const link = (path: string, title: string, subtitle = ''): Row => row(path, title, subtitle, { path });
export const file = (id: string, title: string, name: string, kind = 'pdf', prefix = '/api/files/'): Row => row(id, title, name, { file: { path: prefix + encodeURIComponent(id), name, kind } });
export const dateLabel = (value: number | string | Date | null | undefined): string => value == null ? '' : new Date(value).toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo' });
export const options = <T>(rows: T[], value: (r: T) => string, label: (r: T) => string): Choice[] => rows.map(r => choice(value(r), label(r)));
export const directions = [choice('up', 'Opp'), choice('down', 'Ned')];
// Fravær er unntaket: «Kommer» (standard) og «Kan ikke komme». En gammel
// «usikker»-rad vises med eget valg der den finnes (se `attendanceChoices`).
export const attendanceOptions = [choice('attending', 'Kommer'), choice('not_attending', 'Kan ikke komme')];
export const attendanceChoices = (current: string | null | undefined): Choice[] => current === 'unsure' ? [...attendanceOptions, choice('unsure', 'Usikker')] : attendanceOptions;
export const taskStatuses = [choice('open', 'Åpen'), choice('in_progress', 'Pågår'), choice('done', 'Ferdig')];
export const projectStatuses = [choice('active', 'Aktiv'), choice('archived', 'Arkivert'), choice('done', 'Ferdig')];
export function filterAction(fields: Field[], query: URLSearchParams): Action {
    const values: Values = {};
    for (const f of fields) {
        const raw = query.get(f.key);
        values[f.key] = raw == null ? null : f.kind === 'number' ? Number(raw) : f.kind === 'toggle' ? raw === 'true' : f.kind === 'multi' ? raw.split(',') : raw;
    }
    return action('screen.filter', 'Filtrer og sorter', values, fields);
}
