import * as board from './board';
import * as leaders from './gruppeledere';
import * as members from './members';
import * as projects from './projects';
import { hasPermission, type Me } from './access';
import { isGroupLeader } from '../lib/gruppeledere';
import { mentionPlainText } from '../lib/mentions';
import { mobileMediaRow } from '../lib/message-media';
import { MobileError } from '../lib/mobile-http';
import { filterAction, action, field, file, link, options, remove, row, section, select, text, dateLabel, taskStatuses, projectStatuses, type Screen, type Field } from './mobile-ui';
const tasksToRows = (tasks: board.BoardTaskRow[]) => tasks.map(t => link('board/tasks/' + t.id, t.title, [taskStatuses.find(s => s.value === t.status)?.label, t.assigneeName, t.dueDate].filter(Boolean).join(' · ')));
const taskFields: Field[] = [field('title', 'Tittel', 'text', { required: true }), field('description', 'Beskrivelse', 'multiline'), field('dueDate', 'Frist', 'date', { nullable: true })];
const meetingFields: Field[] = [field('title', 'Tittel', 'text', { required: true }), field('date', 'Dato', 'date', { required: true }), field('agenda', 'Saksliste', 'multiline'), field('notes', 'Notater / referat', 'multiline')];
export async function boardScreen(path: string[], me: Me, query: URLSearchParams): Promise<Screen | null> {
    const [area, kind, id] = path;
    if (area !== 'board' && area !== 'leaders')
        return null;
    if (area === 'board' && !hasPermission(me, 'board.manage'))
        throw new MobileError(403, 'forbidden', 'Styreområdet krever styretilgang.');
    if (area === 'leaders' && !isGroupLeader(me))
        throw new MobileError(403, 'forbidden', 'Området krever gruppelederansvar.');
    if (!kind) {
        if (area === 'leaders') {
            const d = await leaders.getLeaderOverview();
            return { title: 'Gruppelederne', sections: [section('tools', 'Samarbeid', [link('leaders/chat', 'Chat', 'Samtaler mellom gruppelederne'), link('members', 'Stemmetildeling', 'Administrer medlemmer innenfor ditt ansvarsområde')]), section('leaders', 'Hvem leder hva?', d.leaders.map(l => row(l.userId, l.name, l.parts.map(p => p.nameNo).join(', '))))] };
        }
        return { title: 'Styret', sections: [section('work', 'Styrearbeid', [link('board/tasks', 'Oppgaver', 'Frister, ansvar og kommentarer'), link('board/projects', 'Styreprosjekter', 'Mål og fremdrift'), link('board/meetings', 'Møter', 'Sakslister, referater og vedtak'), link('board/chat', 'Chat', 'Felleskanal og prosjekttråder'), link('board/documents', 'Dokumenter', 'Styrets filer')])] };
    }
    if (kind === 'chat') {
        const api = area === 'board' ? board : leaders;
        const channels = await api.listChannels();
        if (!id)
            return { title: 'Chat', sections: [section('channels', 'Kanaler', channels.channels.map(c => link(area + '/chat/' + encodeURIComponent(c.channel), c.title, c.archived ? 'Arkivert' : `${c.unread} uleste${c.mentionsMe ? ' · Du er omtalt' : ''}`)))], actions: [action(area === 'board' ? 'board.createChannel' : 'gruppeledere.createChannel', 'Ny kanal', {}, [field('name', 'Kanalnavn', 'text', { required: true })])], refreshSeconds: 20 };
        const channel = decodeURIComponent(id);
        const selected = channels.channels.find(c => c.channel === channel);
        if (!selected)
            throw new MobileError(404, 'not_found', 'Kanalen finnes ikke.');
        const d = await api.listMessages({ data: { channel } });
        const namespace = area === 'board' ? 'board' : 'gruppeledere';
        const fields = [field('body', 'Melding', 'multiline', { required: true, hint: 'Bruk @ for omtaler.' })];
        const names = Object.entries(d.mentionNames).map(([id, name]) => ({ id, name }));
        const actions = [];
        if (!selected.archived)
            actions.push(action(namespace + '.postMessage', 'Ny melding', { channel }, fields));
        if (selected.kind === 'custom') {
            const channelID = channel.slice(channel.indexOf(':') + 1);
            actions.push(action(namespace + '.renameChannel', 'Endre kanalnavn', { id: channelID, name: selected.title }, [field('name', 'Navn', 'text', { required: true })]), action(namespace + '.setChannelArchived', selected.archived ? 'Gjenåpne kanal' : 'Arkiver kanal', { id: channelID, archived: !selected.archived }));
        }
        return { title: selected.title, readAction: { operation: namespace + '.markChannelRead', values: { channel, at: d.serverTime } }, subtitle: selected.archived ? 'Arkivert kanal' : undefined, refreshSeconds: 15, sections: [section('messages', 'Samtalen', d.messages.map(m => row(m.id, m.authorName ?? 'Ukjent', dateLabel(m.createdAt), { ...((media) => ({ ...media, body: (m.replyTo ? (m.replyTo.deleted ? 'Svar på slettet melding' : `Svar til ${m.replyTo.authorName ?? 'Ukjent'}: ${m.replyTo.excerpt}`) + '\n\n' : '') + media.body }))(mobileMediaRow(mentionPlainText(m.body, names), m.media ?? [])), actions: [...(!selected.archived ? [action(namespace + '.postMessage', 'Svar', { channel, replyToId: m.id }, fields)] : []), ...(m.authorId === me.id ? [remove(namespace + '.deleteMessage', 'Slett melding', { id: m.id })] : [])] })))], actions };
    }
    if (kind === 'tasks') {
        if (!id) {
            const [d, m, p, meetings, bp] = await Promise.all([board.listTasks({ data: { ...Object.fromEntries(query), ...(query.get('mine') === 'true' ? { mine: true } : { mine: undefined }) } as never }), members.listMembers(), projects.listProjects({ data: {} }), board.listMeetings(), board.listBoardProjects()]);
            return { title: 'Oppgaver', sections: [section('progress', 'Pågår', tasksToRows(d.inProgress)), section('open', 'Åpne', tasksToRows(d.open)), section('done', 'Ferdige', tasksToRows(d.done))], actions: [filterAction([select('status','Status',taskStatuses,true),field('mine','Bare mine oppgaver','toggle'),select('boardProjectId','Styreprosjekt',options(d.projectOptions,p=>p.id,p=>p.title),true)],query),action('board.createTask', 'Ny oppgave', {}, [...taskFields, select('assigneeUserId', 'Ansvarlig', options(m.members.filter(m => m.isActive), m => m.id, m => m.name), true), select('meetingId', 'Møte', options(meetings.meetings, m => m.id, m => m.title), true), select('boardProjectId', 'Styreprosjekt', options(bp.projects, p => p.id, p => p.title), true), select('projectId', 'Konsert / prosjekt', options(p.seasons.flatMap(s => s.projects), p => p.id, p => p.name), true)])] };
        }
        const d = await board.getTask({ data: { id } });
        const t = d.task;
        const projectOptions = await board.searchProjectsForTask({ data: {} });
        return { title: t.title, sections: [section('task', 'Oppgave', [text('description', 'Beskrivelse', t.description), text('status', 'Status', taskStatuses.find(s => s.value === t.status)?.label), text('due', 'Frist', t.dueDate), text('who', 'Ansvarlig', t.assigneeName), ...(t.meetingId ? [link('board/meetings/' + t.meetingId, 'Møte', t.meetingTitle ?? '')] : []), ...(t.boardProjectId ? [link('board/projects/' + t.boardProjectId, 'Styreprosjekt', t.boardProjectTitle ?? '')] : [])]), section('comments', 'Kommentarer', d.comments.map(c => row(c.id, c.authorName ?? 'Ukjent', dateLabel(c.createdAt), { body: c.body, actions: c.authorId === me.id ? [remove('board.deleteComment', 'Slett kommentar', { id: c.id })] : [] })))], actions: [action('board.setTaskStatus', 'Endre status', { id, status: t.status }, [select('status', 'Status', taskStatuses)]), action('board.updateTask', 'Rediger oppgave', { id, title: t.title, description: t.description ?? '', dueDate: t.dueDate, assigneeUserId: t.assigneeUserId, meetingId: t.meetingId, boardProjectId: t.boardProjectId, projectId: t.projectId }, [...taskFields, select('assigneeUserId', 'Ansvarlig', options(d.assignees, m => m.id, m => m.name), true), select('meetingId', 'Møte', options(d.meetings, m => m.id, m => m.title), true), select('boardProjectId', 'Styreprosjekt', options(d.boardProjects, p => p.id, p => p.title), true), { ...select('projectId', 'Konsert / prosjekt', options(projectOptions.projects, p => p.id, p => p.name), true), lookup: 'board-projects' }]), action('board.addComment', 'Legg til kommentar', { taskId: id }, [field('body', 'Kommentar', 'multiline', { required: true })]), remove('board.deleteTask', 'Slett oppgave', { id })] };
    }
    if (kind === 'meetings') {
        if (!id) {
            const d = await board.listMeetings();
            return { title: 'Møter', sections: [section('meetings', 'Styremøter', d.meetings.map(m => link('board/meetings/' + m.id, m.title, `${m.date} · ${m.openTaskCount} åpne oppgaver · ${m.documentCount} dokumenter`)))], actions: [action('board.createMeeting', 'Nytt møte', { date: new Date().toISOString().slice(0, 10) }, meetingFields)] };
        }
        const d = await board.getMeeting({ data: { id } });
        const m = d.meeting;
        return { title: m.title, sections: [section('meeting', m.date, [text('agenda', 'Saksliste', m.agenda), text('notes', 'Referat', m.notes), text('decisions', 'Vedtak', m.decisions)]), section('tasks', 'Oppgaver', tasksToRows(d.tasks)), section('documents', 'Dokumenter', d.documents.map(doc => file(doc.id, doc.title, doc.fileName, 'document', '/api/board-files/')))], actions: [action('board.updateMeeting', 'Rediger møte', { id, title: m.title, date: m.date, agenda: m.agenda ?? '', notes: m.notes ?? '', decisions: m.decisions ?? '' }, [...meetingFields, field('decisions', 'Vedtak', 'multiline')]), action('board.createTask', 'Ny oppgave fra møtet', { meetingId: id }, taskFields), action('upload.document', 'Last opp møtedokument', { meetingId: id }, [field('title', 'Tittel')], { upload: 'document' }), remove('board.deleteMeeting', 'Slett møte', { id })] };
    }
    if (kind === 'projects') {
        const projectsData = await board.searchProjectsForTask({ data: {} });
        const fields: Field[] = [field('title', 'Tittel', 'text', { required: true }), field('goal', 'Mål', 'multiline'), field('dueDate', 'Frist', 'date', { nullable: true }), { ...select('linkedProjectId', 'Konsert / prosjekt', options(projectsData.projects, p => p.id, p => p.name), true), lookup: 'board-projects' }];
        if (!id) {
            const [d, m] = await Promise.all([board.listBoardProjects(), members.listMembers()]);
            return { title: 'Styreprosjekter', sections: [section('projects', 'Prosjekter', d.projects.map(p => link('board/projects/' + p.id, p.title, [projectStatuses.find(s => s.value === p.status)?.label, p.ownerName, p.dueDate].filter(Boolean).join(' · '))))], actions: [action('board.createBoardProject', 'Nytt styreprosjekt', {}, [...fields, select('ownerUserId', 'Prosjekteier', options(m.members.filter(m => m.isActive), m => m.id, m => m.name), true)])] };
        }
        const d = await board.getBoardProject({ data: { id } });
        const p = d.project;
        return { title: p.title, sections: [section('project', 'Mål og ansvar', [text('goal', 'Mål', p.goal), text('owner', 'Prosjekteier', p.ownerName), text('due', 'Frist', p.dueDate), link('board/chat/' + encodeURIComponent(d.channel), 'Prosjektchat')]), section('progress', 'Pågående oppgaver', tasksToRows(d.inProgress)), section('open', 'Åpne oppgaver', tasksToRows(d.open)), section('done', 'Ferdige oppgaver', tasksToRows(d.done))], actions: [action('board.updateBoardProject', 'Rediger styreprosjekt', { id, title: p.title, goal: p.goal ?? '', dueDate: p.dueDate, linkedProjectId: p.linkedProjectId, ownerUserId: p.ownerUserId, status: p.status }, [...fields, select('ownerUserId', 'Prosjekteier', options(d.assignees, m => m.id, m => m.name), true), select('status', 'Status', projectStatuses)]), action('board.createTask', 'Ny oppgave', { boardProjectId: id }, taskFields), remove('board.deleteBoardProject', 'Slett styreprosjekt', { id })] };
    }
    if (kind === 'documents') {
        const d = await board.listDocuments();
        return { title: 'Dokumenter', sections: [section('files', 'Styredokumenter', d.documents.map(doc => ({ ...file(doc.id, doc.title, doc.fileName, 'document', '/api/board-files/'), actions: [action('board.updateDocument', 'Rediger dokument', { id: doc.id, title: doc.title, meetingId: doc.meetingId }, [field('title', 'Tittel', 'text', { required: true }), select('meetingId', 'Møte', options(d.meetings, m => m.id, m => m.title), true)]), remove('board.deleteDocument', 'Slett dokument', { id: doc.id })] })))], actions: [action('upload.document', 'Last opp dokument', { meetingId: null }, [field('title', 'Tittel'), select('meetingId', 'Møte', options(d.meetings, m => m.id, m => m.title), true)], { upload: 'document' })] };
    }
    return null;
}
