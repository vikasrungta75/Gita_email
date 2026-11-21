/**
 * Sending, with a safety window. Only a staff member pressing Send puts a reply in the queue:
 *  - Send:        the reply waits 30 seconds (Undo is shown), then goes out;
 *  - Send later:  the reply waits until the chosen date and time (it can be cancelled until then).
 * The server checks the queue every 10 seconds. Nothing is ever sent automatically.
 */
import { one, q } from '../db';
import { HttpError } from '../http';
import { audit } from '../audit';
import type { SessionUser } from '../auth';
import { placeholders, saveDraft, sendDraft } from '../drafts';

export const UNDO_SECONDS = 30;

export async function queueSend(ctx: any, user: SessionUser, id: number, edits: any, sendAt?: string | null) {
	if (edits && (edits.body !== undefined || edits.to !== undefined || edits.cc !== undefined || edits.subject !== undefined)) await saveDraft(user, id, edits);
	const d = await one<any>('select * from reply_drafts where id=$1 and org_id=$2', [id, user.orgId]);
	if (!d) throw new HttpError(404, 'Draft not found');
	if (d.status === 'sent') throw new HttpError(400, 'This reply has already been sent');
	const open = placeholders(d.body);
	if (open.length) throw new HttpError(400, `Answer the ${open.length} yellow item${open.length > 1 ? 's' : ''} before sending: ${open.slice(0, 3).join('; ')}`);
	if (!d.to_addresses?.length) throw new HttpError(400, 'Add at least one recipient');
	if (!d.send_mailbox_id) throw new HttpError(400, 'No connected mailbox received this email, so it cannot be answered from here');
	let at = new Date(Date.now() + UNDO_SECONDS * 1000);
	if (sendAt) {
		const t = new Date(sendAt);
		if (Number.isNaN(t.getTime())) throw new HttpError(400, 'The send-later time is not a valid date');
		if (t.getTime() < Date.now() + 60_000) throw new HttpError(400, 'Choose a send-later time at least a minute from now');
		if (t.getTime() > Date.now() + 60 * 86400_000) throw new HttpError(400, 'Send later can be at most 60 days ahead');
		at = t;
	}
	await q(`update reply_drafts set status='queued', send_at=$2, queued_by=$3, last_error=null, updated_at=now() where id=$1`, [id, at.toISOString(), user.id]);
	await q(`update conversations set reply_status='queued' where id=$1`, [d.conversation_id]);
	await audit(ctx, sendAt ? 'reply.send_later' : 'reply.queued', 'conversation', d.conversation_id, { draftId: id, sendAt: at.toISOString() });
	return { queued: true, sendAt: at.toISOString(), undoSeconds: sendAt ? null : UNDO_SECONDS };
}

/** Undo (within 30 seconds) or cancel a send-later. */
export async function cancelSend(ctx: any, user: SessionUser, id: number) {
	const r = await q<any>(`update reply_drafts set status='draft', send_at=null, updated_at=now() where id=$1 and org_id=$2 and status='queued' returning conversation_id`, [id, user.orgId]);
	if (!r.length) throw new HttpError(400, 'Too late: this reply has already been sent');
	await q(`update conversations set reply_status='pending', needs_enrich=true where id=$1`, [r[0].conversation_id]);
	await audit(ctx, 'reply.send_cancelled', 'conversation', r[0].conversation_id, { draftId: id });
	return { success: true };
}

let busy = false;
/** Sends every queued reply whose time has come (called every 10 seconds by the server). */
export async function runSendQueue() {
	if (busy) return 0;
	busy = true;
	let sent = 0;
	try {
		const due = await q<any>(
			`update reply_drafts set send_at = now() + interval '5 minutes' where id in (
			   select id from reply_drafts where status='queued' and send_at <= now() order by send_at limit 10 for update skip locked)
			 returning id, org_id, queued_by`);
		for (const d of due) {
			const u = d.queued_by ? await one<any>('select id, org_id, email, full_name, role from users where id=$1', [d.queued_by]) : null;
			if (!u) { await q(`update reply_drafts set status='draft', send_at=null, last_error='The person who pressed Send no longer exists' where id=$1`, [d.id]); continue; }
			const user: SessionUser = { id: u.id, orgId: u.org_id, email: u.email, fullName: u.full_name, role: u.role, allMailboxes: true, sessionId: 'send-queue', authProvider: 'queue', timezone: 'Asia/Kolkata' };
			try {
				await sendDraft({ user, ip: '', ua: 'send-queue' }, user, d.id, {});
				sent++;
			} catch (e: any) {
				console.error('[send-queue]', d.id, e.message);
				await q(`update reply_drafts set status='draft', send_at=null, last_error=$2 where id=$1`, [d.id, String(e.message).slice(0, 500)]);
				const c = await one<any>('select conversation_id from reply_drafts where id=$1', [d.id]);
				if (c) await q(`update conversations set reply_status='pending' where id=$1`, [c.conversation_id]);
			}
		}
	} finally {
		busy = false;
	}
	return sent;
}
