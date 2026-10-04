import { getCalendar } from './calendar';
import * as settings from './settings';
import * as events from './event-meta';
import * as posts from './posts';
import * as downloads from './downloads';
import { hasPermission, type Me } from './access';
import { MobileError } from '../lib/mobile-http';
import { mentionPlainText, mentionDraft } from '../lib/mentions';
import { postPlainText } from '../lib/markdown';
import { postEmailFrom } from '../lib/posts';
import { filterAction, action, choice, field, link, options, remove, row, section, select, text, dateLabel, directions, attendanceOptions, type Screen, type Field, type Values } from './mobile-ui';
export async function otherScreen(path: string[], me: Me, query: URLSearchParams): Promise<Screen | null> {
    const [area, id, sub] = path;
    if (area === 'calendar') {
        const d = await getCalendar();
        return { title: 'Kalender', searchable: true, subtitle: d.error ? 'Kalenderen er midlertidig utilgjengelig.' : undefined, sections: [section('events', 'Aktiviteter', d.events.filter(e => e.title.toLowerCase().includes((query.get('q') ?? '').toLowerCase())).map(e => link('events/' + e.occurrenceKey, e.title, new Date(e.start).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' }) + (d.keysWithPlan.includes(e.occurrenceKey) ? ' · Øvingsplan' : ''))))] };
    }
    if (area === 'settings') {
        if (!hasPermission(me, 'settings.manage'))
            throw new MobileError(403, 'forbidden', 'Du har ikke tilgang til administrasjon.');
        const d = await settings.getSettingsData();
        const fields: Field[] = [field('nameNo', 'Norsk navn', 'text', { required: true }), field('nameEn', 'Engelsk navn', 'text', { required: true }), select('section', 'Seksjon', d.sections.map(s => choice(s))), field('aliases', 'Alias — ett per linje', 'lines'), select('parentId', 'Overordnet stemme', options(d.parts.filter(p => !p.parentId), p => p.id, p => p.nameNo), true)];
        if (!id)
            return { title: 'Administrasjon', sections: [section('parts', 'Besetning', d.parts.map(p => link('settings/parts/' + p.id, p.nameNo, `${p.parentId ? 'Understemme · ' : ''}${p.inUse} i bruk`))), section('roles', 'Roller', d.roles.map(r => link('settings/roles/' + r.id, r.name, `${r.memberCount} medlemmer / invitasjoner`)))], actions: [action('settings.createPart', 'Ny stemme', { section: 'cornet', aliases: [], parentId: null }, fields), action('settings.createRole', 'Ny rolle', {}, [field('name', 'Rollenavn', 'text', { required: true })])] };
        if (id === 'parts') {
            const p = d.parts.find(p => p.id === sub);
            if (!p)
                throw new MobileError(404, 'not_found', 'Stemmen finnes ikke.');
            return { title: p.nameNo, sections: [section('part', 'Besetning', [text('en', 'Engelsk navn', p.nameEn), text('aliases', 'Alias', p.aliases.join('\n')), text('section', 'Seksjon', p.section)])], actions: [action('settings.updatePart', 'Rediger stemme', { id: p.id, nameNo: p.nameNo, nameEn: p.nameEn, section: p.section, aliases: p.aliases, parentId: p.parentId }, fields), action('settings.movePart', 'Flytt stemme', { id: p.id, direction: 'up' }, [select('direction', 'Retning', directions)]), action('settings.movePartTo', 'Plasser etter', { id: p.id, afterId: null }, [select('afterId', 'Etter stemme (tom = først)', options(d.parts.filter(x => x.id !== p.id && x.parentId === p.parentId), x => x.id, x => x.nameNo), true)]), ...(p.fileCount === 0 ? [remove('settings.deletePart', 'Slett stemme', { id: p.id })] : [])] };
        }
        if (id === 'roles') {
            const r = d.roles.find(r => r.id === sub);
            if (!r)
                throw new MobileError(404, 'not_found', 'Rollen finnes ikke.');
            return { title: r.name, sections: [section('permissions', 'Tilganger', d.permissionCatalog.map(p => row(p.key, p.label, p.hint, { body: r.isAdmin || r.permissions.includes(p.key) ? 'Tillatt' : 'Ikke tillatt', actions: r.isAdmin ? [] : [action('settings.setRolePermission', 'Endre tilgang', { roleId: r.id, permission: p.key, enabled: r.permissions.includes(p.key) }, [field('enabled', p.label, 'toggle')], { message: 'Endringen gjelder alle med denne rollen.' })] })))], actions: [action('settings.renameRole', 'Endre rollenavn', { roleId: r.id, name: r.name }, [field('name', 'Navn', 'text', { required: true })]), ...(!r.isSystem && r.memberCount === 0 ? [remove('settings.deleteRole', 'Slett rolle', { roleId: r.id })] : [])] };
        }
    }
    if (area === 'events' && id) {
        const d = await events.getEventDetail({ data: { occurrenceKey: id } });
        const sections = [section('event', 'Aktivitet', [text('date', 'Dato', d.event?.start ? new Date(d.event.start).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' }) : dateLabel(d.snapshot?.start)), text('location', 'Sted', d.event?.location), text('description', 'Beskrivelse', d.event?.description), ...(!d.found ? [text('missing', 'Kalender', 'Aktiviteten finnes ikke lenger i kalenderens tidsvindu.')] : []), ...(d.linkedProject ? [link('projects/' + d.linkedProject.id, 'Tilknyttet prosjekt', d.linkedProject.name)] : [])]), section('plan', 'Øvingsplan', d.setlist.map(s => row(s.id, s.workTitle || s.customTitle || 'Punkt', s.note ?? '', { ...(s.workLink ? { path: 'archive/' + s.workId } : {}), actions: d.canManagePlan ? [action('event-meta.updateSetlistItem', 'Rediger punkt', { occurrenceKey: id, id: s.id, customTitle: s.customTitle ?? '', note: s.note ?? '' }, [field('customTitle', 'Egen tittel'), field('note', 'Merknad', 'multiline')]), action('event-meta.moveSetlistItem', 'Flytt punkt', { occurrenceKey: id, id: s.id, direction: 'up' }, [select('direction', 'Retning', directions)]), remove('event-meta.removeSetlistItem', 'Fjern punkt', { occurrenceKey: id, id: s.id })] : [] }))), section('summary', 'Oppmøte', Object.entries(d.counts).map(([k, v]) => row(k, ({ attending: 'Kommer', notAttending: 'Kan ikke', unsure: 'Usikker', noReply: 'Ubesvart', total: 'Totalt' } as Record<string, string>)[k] ?? k, String(v))))];
        for (const g of d.groups ?? [])
            sections.push(section(g.section, g.label, g.members.map(m => row(m.userId, m.name, [m.partName, attendanceOptions.find(s => s.value === m.status)?.label ?? 'Ubesvart'].filter(Boolean).join(' · '), { body: m.comment ?? undefined, actions: m.canEdit ? [action('event-meta.setMemberAttendance', 'Registrer oppmøte', { occurrenceKey: id, userId: m.userId, status: m.status, comment: m.comment ?? '' }, [select('status', 'Svar', attendanceOptions, true), field('comment', 'Merknad', 'multiline')])] : [] }))));
        const actions = [action('event-meta.setMyAttendance', 'Ditt oppmøte', { occurrenceKey: id, status: d.myAttendance?.status ?? null, comment: d.myAttendance?.comment ?? '' }, [select('status', 'Svar', attendanceOptions, true), field('comment', 'Merknad', 'multiline')])];
        if (d.canManagePlan) {
            const w = await events.searchWorksForEvent({ data: {} });
            actions.push(action('event-meta.addSetlistItem', 'Legg til i øvingsplan', { occurrenceKey: id, workId: null }, [{ ...select('workId', 'Verk (eller skriv egen tittel)', options(w.works, w => w.id, w => w.title), true), lookup: 'event-works' }, field('customTitle', 'Egen tittel'), field('note', 'Merknad', 'multiline')]), action('event-meta.setLinkedProject', 'Koble til prosjekt', { occurrenceKey: id, projectId: d.linkedProject?.id ?? null }, [select('projectId', 'Prosjekt', options(d.projectOptions, p => p.id, p => p.name), true)]));
        }
        return { title: d.event?.title ?? d.snapshot?.summary ?? 'Aktivitet', sections, actions };
    }
    if (area === 'posts') {
        const fields: Field[] = [field('title', 'Tittel (valgfritt)'), field('body', 'Tekst', 'multiline', { required: true }), select('format', 'Tekstformat', [choice('plain_text', 'Vanlig tekst'), choice('markdown', 'Markdown')])];
        const privilegedFields: Field[] = [select('audience', 'Mottakere', [choice('all', 'Hele korpset'), choice('board', 'Bare styret')]), select('importance', 'Viktighet', [choice('normal', 'Vanlig'), choice('important', 'Viktig')]), field('official', 'Fra styret', 'toggle')];
        const archiveFields: Field[] = [select('importance', 'Viktighet', [choice('normal', 'Vanlig'), choice('important', 'Viktig')]), field('fromArchive', 'Fra notearkivar', 'toggle')];
        if (!id) {
            const d = await posts.listPosts();
            return { title: 'Innlegg og utkast', sections: [section('drafts', 'Utkast', d.drafts.map(p => link('posts/' + p.id, p.heading, postEmailFrom(p.author.name, p.official, p.fromArchive)))), section('posts', 'Publisert', d.posts.map(p => link('posts/' + p.id, p.heading, postEmailFrom(p.author.name, p.official, p.fromArchive))))], actions: [action('posts.createPost', 'Nytt utkast', { format: 'plain_text', audience: 'all', importance: 'normal', official: false }, [...fields, ...(d.canPublish ? [...privilegedFields, field('fromArchive', 'Fra notearkivar', 'toggle')] : d.canArchive ? archiveFields : [])])] };
        }
        const d = await posts.getPost({ data: { id } });
        const p = d.post;
        const canArchiveEdit = d.canArchive && p.canEdit && !p.official && p.audience === 'all';
        const editValues: Values = { id, title: p.title ?? '', body: mentionDraft(p.body, p.mentions).text, format: p.format, audience: p.audience, importance: p.importance, official: p.official, fromArchive: p.fromArchive };
        const actions = [action('posts.toggleReaction', p.likedByMe ? 'Fjern liker' : 'Lik innlegg', { postId: id }), action('posts.addComment', 'Kommenter', { postId: id }, [field('body', 'Kommentar', 'multiline', { required: true })])];
        if (p.canEdit)
            actions.push(action('posts.updatePost', 'Rediger innlegg', editValues, [...fields, ...(d.canPublish ? [...privilegedFields, field('fromArchive', 'Fra notearkivar', 'toggle')] : canArchiveEdit ? archiveFields : [])], { mentions: mentionDraft(p.body, p.mentions).chosen }), action('upload.image', 'Legg til bilde', { postId: id }, [], { upload: 'image' }), ...(p.publishedAt ? [action('posts.unpublishPost', 'Flytt til utkast', { id })] : [action('posts.publishPost', 'Publiser', { id, sendEmail: false }, d.canPublish || canArchiveEdit ? [field('sendEmail', 'Send beskjed på e-post', 'toggle')] : [])]), remove('posts.deletePost', 'Slett innlegg', { id }));
        if (d.delivery)
            actions.push(action('posts.resendPostNotifications', 'Send beskjedvarsler på nytt', { id }, [], { message: 'Sender e-post til mottakerne etter nettsidens regler.' }));
        return { title: p.heading, sections: [section('post', postEmailFrom(p.author.name, p.official, p.fromArchive), [row('body', '', p.publishedAt ? dateLabel(p.publishedAt) : 'Utkast', { body: mentionPlainText(postPlainText(p.body, p.format), p.mentions), ...(p.format === 'markdown' ? { markdown: mentionPlainText(p.body, p.mentions) } : {}) }), row('reactions', 'Liker', String(p.likeCount)), ...p.images.map(i => row(i.id, 'Bilde', i.fileName, { imagePath: '/api/post-images/' + i.id, actions: p.canEdit ? [remove('posts.deletePostImage', 'Slett bilde', { id: i.id })] : [] }))]), section('comments', 'Kommentarer', d.comments.map(c => row(c.id, c.author.name, dateLabel(c.createdAt), { body: mentionPlainText(c.body, c.mentions), actions: c.canDelete ? [remove('posts.deleteComment', 'Slett kommentar', { id: c.id })] : [] }))), ...(d.delivery ? [section('delivery', 'E-postlevering', Object.entries(d.delivery).map(([k, v]) => row(k, ({ sent: 'Sendt', logged: 'Logget', failed: 'Feilet', pending: 'Venter' } as Record<string, string>)[k] ?? k, String(v))))] : [])], actions };
    }
    if (area === 'downloads') {
        const page = Number(query.get('page') ?? 1);
        const pagePath = (n: number) => { const p = new URLSearchParams(query); p.delete('screen'); p.set('page', String(n)); return 'downloads?' + p.toString(); };
        const d = await downloads.listDownloads({ data: { ...Object.fromEntries(query), page } as never });
        return { title: 'Filtilganger', actions: [filterAction([select('projectId', 'Prosjekt', options(d.options.projects, p => p.id, p => p.name), true), select('workId', 'Verk', options(d.options.works, w => w.id, w => w.title), true), select('userId', 'Medlem', options(d.options.members, m => m.id, m => m.name), true), select('shareLinkId', 'Vikarlenke', options(d.options.shares, s => s.id, s => s.recipientName), true), field('from', 'Fra dato', 'date', { nullable: true }), field('to', 'Til dato', 'date', { nullable: true })], query)], sections: [section('log', `${d.total} filtilganger`, d.rows.map(r => row(r.id, r.workTitle ?? r.fileName, [r.userName ?? r.shareRecipient ?? 'Ukjent', dateLabel(r.at), r.fileName].filter(Boolean).join(' · ')))), section('pages', 'Sider', [...(page > 1 ? [link(pagePath(page - 1), 'Forrige side')] : []), ...(page * d.pageSize < d.total ? [link(pagePath(page + 1), 'Neste side')] : [])])] };
    }
    return null;
}
