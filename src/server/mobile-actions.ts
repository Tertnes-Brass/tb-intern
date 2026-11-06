import { z } from 'zod';
import { MobileError } from '../lib/mobile-http';
import { PIN_ERRORS } from '../lib/pins';
import { getRequest } from '@tanstack/react-start/server';
import { getAuth } from './auth-instance';
import { memberNameSchema, passwordSchema } from '../lib/profile';
import { toMarkers, type MentionUser } from '../lib/mentions';
import * as m0 from './profile';
import * as m1 from './members';
import * as m2 from './works';
import * as m3 from './projects';
import * as m4 from './shares';
import * as m5 from './settings';
import * as m6 from './board';
import * as m7 from './gruppeledere';
import * as m8 from './event-meta';
import * as m9 from './posts';
// Explicit registry: never resolve a module/function name supplied by a client.
// Each registered operation runs its existing Zod validator and permission guard.
const operations = new Map<string, (input: never) => Promise<unknown>>([
    ['profile.updateMyPostNotifications', m0.updateMyPostNotifications],
    ['profile.updateMyBoardTaskNotifications', m0.updateMyBoardTaskNotifications],
    ['profile.updateMyMentionNotifications', m0.updateMyMentionNotifications],
    ['profile.updateMyPhone', m0.updateMyPhone],
    ['members.updateMemberParts', m1.updateMemberParts],
    ['members.setSectionLeaderParts', m1.setSectionLeaderParts],
    ['members.updateMemberRole', m1.updateMemberRole],
    ['members.updateMemberProfile', m1.updateMemberProfile],
    ['members.sendMemberPasswordReset', m1.sendMemberPasswordReset],
    ['members.inviteMember', m1.inviteMember],
    ['members.revokeInvitation', m1.revokeInvitation],
    ['works.createWork', m2.createWork],
    ['works.updateWork', m2.updateWork],
    ['works.deleteWork', m2.deleteWork],
    ['works.deleteWorkFile', m2.deleteWorkFile],
    ['works.setWorkFilePart', m2.setWorkFilePart],
    ['works.rematchWorkFiles', m2.rematchWorkFiles],
    ['works.addWorkLink', m2.addWorkLink],
    ['works.deleteWorkLink', m2.deleteWorkLink],
    ['projects.createProject', m3.createProject],
    ['projects.updateProject', m3.updateProject],
    ['projects.deleteProject', m3.deleteProject],
    ['projects.addWorkToProject', m3.addWorkToProject],
    ['projects.updateProjectWorkPercussion', m3.updateProjectWorkPercussion],
    ['projects.removeWorkFromProject', m3.removeWorkFromProject],
    ['projects.moveWorkInProject', m3.moveWorkInProject],
    ['shares.createShare', m4.createShare],
    ['shares.revokeShare', m4.revokeShare],
    ['settings.createPart', m5.createPart],
    ['settings.updatePart', m5.updatePart],
    ['settings.deletePart', m5.deletePart],
    ['settings.movePart', m5.movePart],
    ['settings.movePartTo', m5.movePartTo],
    ['settings.setRolePermission', m5.setRolePermission],
    ['settings.createRole', m5.createRole],
    ['settings.renameRole', m5.renameRole],
    ['settings.deleteRole', m5.deleteRole],
    ['board.createTask', m6.createTask],
    ['board.updateTask', m6.updateTask],
    ['board.setTaskStatus', m6.setTaskStatus],
    ['board.deleteTask', m6.deleteTask],
    ['board.addComment', m6.addComment],
    ['board.deleteComment', m6.deleteComment],
    ['board.createMeeting', m6.createMeeting],
    ['board.updateMeeting', m6.updateMeeting],
    ['board.deleteMeeting', m6.deleteMeeting],
    ['board.updateDocument', m6.updateDocument],
    ['board.deleteDocument', m6.deleteDocument],
    ['board.createBoardProject', m6.createBoardProject],
    ['board.updateBoardProject', m6.updateBoardProject],
    ['board.deleteBoardProject', m6.deleteBoardProject],
    ['board.createChannel', m6.createChannel],
    ['board.renameChannel', m6.renameChannel],
    ['board.setChannelArchived', m6.setChannelArchived],
    ['board.postMessage', m6.postMessage],
    ['board.deleteMessage', m6.deleteMessage],
    ['board.markChannelRead', m6.markChannelRead],
    ['gruppeledere.createChannel', m7.createChannel],
    ['gruppeledere.renameChannel', m7.renameChannel],
    ['gruppeledere.setChannelArchived', m7.setChannelArchived],
    ['gruppeledere.postMessage', m7.postMessage],
    ['gruppeledere.deleteMessage', m7.deleteMessage],
    ['gruppeledere.markChannelRead', m7.markChannelRead],
    ['event-meta.addSetlistItem', m8.addSetlistItem],
    ['event-meta.updateSetlistItem', m8.updateSetlistItem],
    ['event-meta.removeSetlistItem', m8.removeSetlistItem],
    ['event-meta.moveSetlistItem', m8.moveSetlistItem],
    ['event-meta.setLinkedProject', m8.setLinkedProject],
    ['event-meta.setMyAttendance', m8.setMyAttendance],
    ['event-meta.setMemberAttendance', m8.setMemberAttendance],
    ['posts.createPost', m9.createPost],
    ['posts.updatePost', m9.updatePost],
    ['posts.publishPost', m9.publishPost],
    ['posts.unpublishPost', m9.unpublishPost],
    ['posts.deletePost', m9.deletePost],
    ['posts.addComment', m9.addComment],
    ['posts.deleteComment', m9.deleteComment],
    ['posts.toggleReaction', m9.toggleReaction],
    ['posts.deletePostImage', m9.deletePostImage],
    ['posts.resendPostNotifications', m9.resendPostNotifications],
    ['posts.setPostPinned', m9.setPostPinned],
]);
export async function runMobileAction(operation: string, values: Record<string, unknown>, mentions: MentionUser[] = []) {
    if (typeof values.body === 'string' && mentions.length > 0)
        values = { ...values, body: toMarkers(values.body, mentions) };
    if (operation === 'account.name') {
        const body = z.object({ name: memberNameSchema }).strict().parse(values);
        await getAuth().api.updateUser({ headers: getRequest().headers, body });
        return { ok: true };
    }
    if (operation === 'account.password') {
        const body = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema, revokeOtherSessions: z.boolean() }).strict().parse(values);
        await getAuth().api.changePassword({ headers: getRequest().headers, body });
        return { ok: true };
    }
    const fn = operations.get(operation);
    if (!fn)
        throw new MobileError(404, 'unknown_action', 'Handlingen er ikke tilgjengelig.');
    // Festefeilene (taket, datoen, utkast) er ment for brukeren og røper ingenting;
    // uten dette ville appen bare vist den generiske 500-feilen.
    const result = operation === 'posts.setPostPinned'
        ? await fn({ data: values } as never).catch((err: unknown) => {
            if (err instanceof Error && PIN_ERRORS.includes(err.message))
                throw new MobileError(409, 'pin_rejected', err.message);
            throw err;
        })
        : await fn({ data: values } as never);
    if (operation === 'members.inviteMember') {
        const delivery = (result as {
            delivery: string;
        }).delivery;
        return { ok: true, message: delivery === 'sent' ? 'Invitasjonen er lagret og e-posten er sendt.' : delivery === 'skipped' ? 'Invitasjonen er lagret uten e-post.' : 'Invitasjonen er lagret, men e-posten ble ikke levert. Medlemmet kan logge inn med adressen sin.' };
    }
    if (operation === 'shares.createShare') {
        const value = result as {
            url: string;
        };
        return { ok: true, message: 'Lenken vises bare nå. Del den med riktig mottaker.', url: value.url };
    }
    // Only intentional user-facing outcomes leave the adapter; no arbitrary
    // return payload (e.g. raw share token) is passed through to presentation.
    return { ok: true };
}
