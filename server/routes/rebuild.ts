/**
 * Routes for the rebuilt Gita Mail: the Outlook-style email screen (groups, completeness, open questions, send with
 * undo and send later), bulk orders and quotes, master data (bank, discount, freight, Suchi, combined books), the
 * stock and tracking uploads' check summary and data viewer, Kalyan customers and their dashboard, Settings
 * (pending questions, completeness summary, email rules, auto-send), and "delete everything and rebuild".
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { one, q, tx, databaseUrl } from '../db';
import { HttpError, type Router } from '../http';
import { audit } from '../audit';
import { requireRole } from '../auth';
import { writeXlsx, readTable } from '../xlsx';
import { headKey } from '../uploads/common';
import { getDraftForConversation, placeholders, stripOk, saveDraft } from '../drafts';
import { enrichConversation, markAllForEnrich, booksWithQty, isHindi } from '../email/enrich';
import { emailConfig, saveEmailConfig, GROUPS, SUBTAG_LABEL, FACTS, LEVELS, LEVEL_LABEL, DEFAULT_CONFIG, KALYAN_MASTER_FIELDS, type GroupKey } from '../email/config';
import { queueSend, cancelSend, UNDO_SECONDS } from '../email/sendQueue';
import { STAGES, STAGE_KEYS, makeQuote, priceItems } from '../email/quote';
import { allMaster, saveMaster, bankQr, saveBankQr, MASTER_KEYS, type MasterKey } from '../master/values';
import { readSuchi, previewSuchi, applySuchi, SUCHI_COLUMNS, suchiRows, type SuchiEntry } from '../master/suchi';
import { confirmBatch, cancelBatch } from '../uploads/batches';
import { importStock } from '../stock/stock';
import { listKalyanCustomers, kalyanDashboard, KALYAN_EXPORT_HEADER, kalyanExportRows } from '../kalyan/customers';
import { kalyanYearOf } from '../kalyan/year';
import { gmailAttachment } from '../connectors/gmail';
import type { MailboxRow } from '../connectors/types';

const run = promisify(execFile);
const stamp = () => new Date().toISOString().slice(0, 10);
const fileBytes = (b: any) => {
	const data = String(b?.data || '').replace(/^data:[^,]*,/, '');
	if (!data) throw new HttpError(400, 'No file received');
	return new Uint8Array(Buffer.from(data, 'base64'));
};
const xlsx = (bytes: Uint8Array, name: string) => new Response(bytes as any, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${name}"` } });
const csv = (header: string[], rows: unknown[][], name: string) => {
	const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
	return new Response(`﻿${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}`, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` } });
};

// ── email list ──────────────────────────────────────────────────────────────
const EMAIL_SORTS: Record<string, string> = {
	received: 'c.last_inbound_at', subject: 'lower(c.subject)', sender: 'lower(li.from_name)', group: 'c.primary_group', criticality: `array_position(array['critical','high','medium','low'], c.criticality)`,
	completeness: 'c.completeness', status: 'c.reply_status', waiting: 'c.last_inbound_at', questions: 'jsonb_array_length(c.open_questions)', mailbox: 'mb.addresses[1]',
};

function emailWhere(orgId: number, qs: URLSearchParams) {
	const params: unknown[] = [orgId];
	const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
	const where = ['c.org_id=$1', 'c.primary_group is not null'];
	const tab = qs.get('tab') || 'all';
	if (tab === 'not_for_reply') where.push('c.not_for_reply');
	else {
		where.push('not c.not_for_reply');
		if ((GROUPS as readonly any[]).some((g) => g.key === tab)) where.push(`c.primary_group = ${p(tab)}`);
	}
	const list = (k: string) => (qs.get(k) || '').split(',').map((x) => x.trim()).filter(Boolean);
	if (list('status').length) where.push(`c.reply_status = any(${p(list('status'))}::text[])`);
	else if (qs.get('showSent') !== '1' && tab !== 'not_for_reply') where.push(`c.reply_status <> 'sent'`);
	if (list('criticality').length) where.push(`c.criticality = any(${p(list('criticality'))}::text[])`);
	if (list('subtag').length) where.push(`c.sub_tags && ${p(list('subtag'))}::text[]`);
	if (list('reason').length) where.push(`c.purposes && ${p(list('reason'))}::text[]`);
	if (list('group').length) where.push(`c.primary_group = any(${p(list('group'))}::text[])`);
	if (qs.get('mailbox')) where.push(`${p(Number(qs.get('mailbox')))}::bigint = any(c.mailbox_ids)`);
	if (qs.get('minComp')) where.push(`coalesce(c.completeness,0) >= ${p(Number(qs.get('minComp')))}`);
	if (qs.get('maxComp')) where.push(`coalesce(c.completeness,0) <= ${p(Number(qs.get('maxComp')))}`);
	if (qs.get('from')) where.push(`c.last_inbound_at >= ${p(qs.get('from'))}::date`);
	if (qs.get('to')) where.push(`c.last_inbound_at < ${p(qs.get('to'))}::date + 1`);
	if (qs.get('attachments') === '1') where.push(`exists (select 1 from emails e where e.conversation_id=c.id and e.has_attachments)`);
	if (qs.get('question')) where.push(`c.open_questions @> ${p(JSON.stringify([{ key: qs.get('question') }]))}::jsonb`);
	const text = (qs.get('q') || '').trim();
	if (text) {
		const t = p(`%${text}%`);
		// sender, subject, body, order number, Kalyan customer number and book code
		where.push(`(c.subject ilike ${t} or exists (select 1 from emails e where e.conversation_id=c.id and (e.from_address ilike ${t} or e.from_name ilike ${t} or e.body_clean ilike ${t}))
			or c.facts::text ilike ${t} or c.answers::text ilike ${t})`);
	}
	return { where: where.join(' and '), params };
}

export function registerRebuild(r: Router, deps: { kickWorker: (mailboxId?: number) => Promise<unknown>; kickUploads: () => Promise<void> }) {
	// ── Emails ──
	r.get('/api/emails', async (ctx) => {
		const qs = ctx.query;
		const { where, params } = emailWhere(ctx.user!.orgId, qs);
		const dir = qs.get('dir') === 'asc' ? 'asc' : 'desc';
		const sortKey = qs.get('sort') || 'received';
		const sort = `${EMAIL_SORTS[sortKey] || EMAIL_SORTS.received} ${sortKey === 'waiting' ? (dir === 'asc' ? 'desc' : 'asc') : dir} nulls last, c.id desc`;
		const limit = Math.min(Number(qs.get('limit')) || 100, 500);
		const offset = Math.max(0, Number(qs.get('offset')) || 0);
		const rows = await q<any>(
			`select c.id, c.subject, c.primary_group, c.sub_tags, c.purposes, c.criticality, c.completeness, c.reply_status, c.not_for_reply, c.last_inbound_at, c.last_message_at,
			        jsonb_array_length(c.open_questions) as questions, c.reader_language, c.summary, c.message_count,
			        li.from_name, li.from_address, li.snippet, li.has_attachments, mb.addresses as mailboxes, d.id as draft_id, d.status as draft_status, d.send_at
			   from conversations c
			   left join lateral (select from_name, from_address, snippet, has_attachments from emails e where e.conversation_id=c.id and e.direction='inbound' and not e.is_duplicate order by sent_at desc limit 1) li on true
			   left join lateral (select array_agg(m.address order by m.address) as addresses from mailboxes m where m.id = any(c.mailbox_ids)) mb on true
			   left join reply_drafts d on d.conversation_id=c.id
			  where ${where} order by ${sort} limit ${limit} offset ${offset}`, params);
		const total = (await one<any>(`select count(*)::int n from conversations c where ${where}`, params))!.n;
		const cfg = await emailConfig(ctx.user!.orgId);
		return { rows, total, offset, limit, sla: cfg.slaWorkingDays };
	});

	r.get('/api/emails/meta', async (ctx) => {
		const orgId = ctx.user!.orgId;
		const counts = await q<any>(
			`select coalesce(primary_group,'others') as g, not_for_reply as nfr, reply_status as s, count(*)::int as n from conversations where org_id=$1 and primary_group is not null group by 1,2,3`, [orgId]);
		const mailboxes = await q<any>(`select id, address, provider, status from mailboxes where org_id=$1 order by address`, [orgId]);
		const cfg = await emailConfig(orgId);
		const openQ = (await one<any>(`select count(distinct x->>'key')::int as n from conversations c, jsonb_array_elements(c.open_questions) x where c.org_id=$1 and not c.not_for_reply and c.reply_status in ('pending','ready')`, [orgId]))!.n;
		const bulk = (await one<any>(`select count(*)::int n from bulk_requests where org_id=$1 and stage not in ('closed')`, [orgId]))!.n;
		const views = await q<any>('select id, name, query from saved_views where user_id=$1 order by name', [ctx.user!.id]);
		return { groups: GROUPS, subTags: SUBTAG_LABEL, levels: LEVELS.map((l) => ({ key: l, label: LEVEL_LABEL[l] })), counts, mailboxes, syncDays: cfg.syncDays, openQuestions: openQ, bulkOpen: bulk, views, stages: STAGES, undoSeconds: UNDO_SECONDS };
	});

	r.get('/api/emails/:id', async (ctx) => {
		const id = Number(ctx.params.id);
		const c = await one<any>(`select c.* from conversations c where c.id=$1 and c.org_id=$2`, [id, ctx.user!.orgId]);
		if (!c) throw new HttpError(404, 'Email not found');
		const emails = await q<any>(
			`select e.id, e.direction, e.from_address, e.from_name, e.to_addresses, e.cc_addresses, e.subject, e.body_clean, e.body_text, e.sent_at, e.has_attachments, e.attachments, e.web_link, m.address as mailbox
			   from emails e left join mailboxes m on m.id=e.mailbox_id where e.conversation_id=$1 and not e.is_duplicate order by e.sent_at`, [id]);
		const mailboxes = await q<any>('select address from mailboxes where id = any($1::bigint[])', [c.mailbox_ids]);
		const draft = await getDraftForConversation(id, ctx.user!.orgId);
		const bulk = await one<any>('select id, stage, items, totals, value, quote_no, quote_at, notes, updated_at from bulk_requests where conversation_id=$1', [id]);
		return { conversation: c, emails, mailboxes: mailboxes.map((m) => m.address), draft, bulk, facts: FACTS };
	});

	/** Staff edit the group, sub-tags, criticality or "not for reply"; their choice is kept. */
	r.patch('/api/emails/:id', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const id = Number(ctx.params.id);
		const b = ctx.body || {};
		const sets: string[] = [];
		const params: unknown[] = [id, ctx.user!.orgId];
		const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
		if (b.primary_group !== undefined) {
			if (!(GROUPS as readonly any[]).some((g) => g.key === b.primary_group)) throw new HttpError(400, 'Unknown group');
			const allowed = GROUPS.find((g) => g.key === b.primary_group)!.subTags as readonly string[];
			const tags = (Array.isArray(b.sub_tags) ? b.sub_tags : []).filter((t: string) => allowed.includes(t));
			sets.push(`primary_group=${p(b.primary_group)}`, `sub_tags=${p(tags)}`, 'group_locked=true');
		} else if (Array.isArray(b.sub_tags)) sets.push(`sub_tags=${p(b.sub_tags.map(String).slice(0, 6))}`, 'group_locked=true');
		if (b.criticality !== undefined) {
			if (b.criticality === null) sets.push('criticality_locked=false');
			else { if (!LEVELS.includes(b.criticality)) throw new HttpError(400, 'Unknown criticality'); sets.push(`criticality=${p(b.criticality)}`, 'criticality_locked=true'); }
		}
		if (b.not_for_reply !== undefined) sets.push(`not_for_reply=${p(!!b.not_for_reply)}`, 'not_for_reply_locked=true');
		if (b.unlockGroup) sets.push('group_locked=false');
		if (!sets.length) throw new HttpError(400, 'Nothing to change');
		await q(`update conversations set ${sets.join(', ')}, needs_enrich=true where id=$1 and org_id=$2`, params);
		await audit(ctx, 'email.tagged', 'conversation', id, b);
		await enrichConversation(id);
		return { success: true };
	});

	r.post('/api/emails/:id/refresh', async (ctx) => {
		const id = Number(ctx.params.id);
		const c = await one<any>('select id from conversations where id=$1 and org_id=$2', [id, ctx.user!.orgId]);
		if (!c) throw new HttpError(404, 'Email not found');
		await enrichConversation(id);
		return { success: true };
	});

	/**
	 * Answers to the questions at the top of an email. A lookup (order number, Kalyan number, books, place) runs the
	 * lookups again; a value fills the yellow item. "Save for all emails" keeps it as a standing answer.
	 */
	r.post('/api/emails/:id/answers', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const id = Number(ctx.params.id);
		const c = await one<any>('select id, org_id, answers, open_questions, primary_group from conversations where id=$1 and org_id=$2', [id, ctx.user!.orgId]);
		if (!c) throw new HttpError(404, 'Email not found');
		const list = (Array.isArray(ctx.body?.answers) ? ctx.body.answers : []).map((a: any) => ({ key: String(a.key || '').slice(0, 200), value: String(a.value ?? '').trim().slice(0, 2000), standing: !!a.standing }))
			.filter((a: any) => a.key && a.value);
		if (!list.length) throw new HttpError(400, 'Type at least one answer');
		const answers: Record<string, string> = { ...(c.answers || {}) };
		const qs: any[] = c.open_questions || [];
		let standing = 0;
		for (const a of list) {
			const qn = qs.find((x) => x.key === a.key);
			const key = qn?.hint || a.key;
			answers[key] = a.value;
			if (a.standing && qn?.kind !== 'lookup') {
				await q(
					`insert into standing_answers (org_id, question_key, question, answer, group_key, created_by) values ($1,$2,$3,$4,$5,$6)
					 on conflict (org_id, question_key) do update set answer=excluded.answer, question=excluded.question, updated_at=now()`,
					[ctx.user!.orgId, a.key, qn?.text || a.key, a.value, c.primary_group, ctx.user!.id]);
				standing++;
			}
		}
		await q('update conversations set answers=$2, needs_enrich=true where id=$1', [id, JSON.stringify(answers)]);
		// a draft someone has edited by hand keeps their text: the answers go straight into its yellow items
		const d = await one<any>('select id, body, edited, status from reply_drafts where conversation_id=$1', [id]);
		if (d?.edited && d.status === 'draft') {
			let body = d.body;
			for (const a of list) {
				const qn = qs.find((x) => x.key === a.key);
				if (!qn) continue;
				body = body.split(`[[provide: ${qn.text}]]`).join(`[[ok: ${a.value}]]`);
			}
			await q('update reply_drafts set body=$2, updated_at=now(), updated_by=$3 where id=$1', [d.id, body, ctx.user!.id]);
		}
		await enrichConversation(id);
		if (standing) await markAllForEnrich(ctx.user!.orgId);
		await audit(ctx, 'email.answered', 'conversation', id, { keys: list.map((a: any) => a.key), standing });
		return { success: true, standing };
	});

	/** Rewrite the reply properly (AI), keeping every fact; shown side by side before it is accepted. */
	r.post('/api/emails/:id/rewrite', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const id = Number(ctx.params.id);
		const d = await getDraftForConversation(id, ctx.user!.orgId);
		if (!d) throw new HttpError(404, 'There is no reply draft for this email');
		const { askLLM, aiPaused, aiProvider } = await import('../ai/llm');
		if (aiProvider() === 'heuristic') throw new HttpError(400, 'Rewriting needs an AI key (ANTHROPIC_API_KEY or GEMINI_API_KEY in .env). Without it, edit the text directly.');
		if (await aiPaused()) throw new HttpError(503, 'The AI is paused (quota). Try again later or edit the text directly.');
		const last = await one<any>(`select from_name, body_clean, body_text from emails where conversation_id=$1 and direction='inbound' order by sent_at desc limit 1`, [id]);
		const before = stripOk(d.body);
		const open = placeholders(before).length;
		const hindi = isHindi(last?.body_clean || last?.body_text || '');
		const system = `You polish email replies for Gita Press, Gorakhpur. Rewrite the draft into a finished, courteous email in ${hindi ? 'Hindi (Devanagari)' : 'English'}, the reader's language.
Rules:
- Keep every fact exactly: numbers, codes, prices, dates, tracking numbers, links, bank details and addresses must stay character for character.
- Keep the greeting and the signature block.
- Do not add any promise, date, price or policy that is not in the draft.
- Keep every [[provide: …]] item exactly as written.
- Lists of books, totals and bank details may stay as lists.
- Return only the email text: no preamble, no quotation marks, no markdown.`;
		const out = (await askLLM(ctx.user!.orgId, system, `Reader's email:\n${String(last?.body_clean || last?.body_text || '').slice(0, 2500)}\n\nDraft:\n${before}`))?.trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
		if (!out || out.length < before.length * 0.4 || placeholders(out).length !== open) throw new HttpError(502, 'The rewrite did not keep all the facts, so it was not used. Edit the text directly or try again.');
		// every number in the draft must still be there
		const nums = (s: string) => [...new Set(s.match(/\d[\d,./-]*\d|\d/g) || [])];
		const lost = nums(before).filter((n) => n.length > 1 && !out.includes(n));
		if (lost.length) throw new HttpError(502, `The rewrite dropped some figures (${lost.slice(0, 4).join(', ')}), so it was not used. Edit the text directly or try again.`);
		return { before, after: out };
	});
	r.post('/api/emails/:id/rewrite/accept', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const d = await getDraftForConversation(Number(ctx.params.id), ctx.user!.orgId);
		if (!d) throw new HttpError(404, 'Draft not found');
		await saveDraft(ctx.user!, d.id, { body: String(ctx.body?.body || '') });
		await audit(ctx, 'reply.rewritten', 'conversation', d.conversation_id);
		return getDraftForConversation(Number(ctx.params.id), ctx.user!.orgId);
	});

	r.post('/api/emails/:id/send', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const d = await getDraftForConversation(Number(ctx.params.id), ctx.user!.orgId);
		if (!d) throw new HttpError(404, 'There is no reply draft for this email');
		const b = ctx.body || {};
		return queueSend(ctx, ctx.user!, d.id, { body: b.body, to: b.to, cc: b.cc, subject: b.subject }, b.sendAt || null);
	});
	r.post('/api/emails/:id/send/cancel', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const d = await getDraftForConversation(Number(ctx.params.id), ctx.user!.orgId);
		if (!d) throw new HttpError(404, 'Draft not found');
		const res = await cancelSend(ctx, ctx.user!, d.id);
		await enrichConversation(Number(ctx.params.id));
		return res;
	});

	// attachments: fetched from Gmail when opened
	r.get('/api/emails/attachment/:emailId/:idx', async (ctx) => {
		const e = await one<any>(`select e.provider_message_id, e.attachments, e.mailbox_id from emails e where e.id=$1 and e.org_id=$2`, [Number(ctx.params.emailId), ctx.user!.orgId]);
		const a = e?.attachments?.[Number(ctx.params.idx)];
		if (!a) throw new HttpError(404, 'Attachment not found');
		const mb = await one<MailboxRow>('select * from mailboxes where id=$1', [e.mailbox_id]);
		if (!mb || !['gmail', 'gmail_app'].includes(mb.provider)) throw new HttpError(400, 'This attachment can only be opened in the mailbox itself');
		const bytes = await gmailAttachment(mb, e.provider_message_id, a.id);
		const inline = /^(image\/|application\/pdf)/.test(a.mimeType) && ctx.query.get('download') !== '1';
		return new Response(bytes as any, { headers: { 'content-type': a.mimeType || 'application/octet-stream', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${String(a.filename).replace(/"/g, '')}"`, 'cache-control': 'private, max-age=3600' } });
	});
	/** Reads book codes and quantities from an attached order list (Excel, CSV or PDF) for the quote builder. */
	r.post('/api/emails/attachment/:emailId/:idx/read', async (ctx) => {
		const e = await one<any>(`select e.provider_message_id, e.attachments, e.mailbox_id from emails e where e.id=$1 and e.org_id=$2`, [Number(ctx.params.emailId), ctx.user!.orgId]);
		const a = e?.attachments?.[Number(ctx.params.idx)];
		if (!a) throw new HttpError(404, 'Attachment not found');
		const mb = await one<MailboxRow>('select * from mailboxes where id=$1', [e.mailbox_id]);
		if (!mb) throw new HttpError(400, 'Mailbox not found');
		const bytes = new Uint8Array(await gmailAttachment(mb, e.provider_message_id, a.id));
		const items = await readOrderList(a.filename, a.mimeType, bytes);
		return { items, note: items.length ? `${items.length} book lines read from ${a.filename}. Check them before making the quote.` : `No book codes with quantities were found in ${a.filename}. Type them in the quote builder.` };
	});

	r.get('/api/open-questions', async (ctx) => {
		const rows = await q<any>(
			`select x->>'key' as key, x->>'text' as text, x->>'fact' as fact, x->>'kind' as kind, x->>'needsUpload' as needs_upload, x->>'group' as grp,
			        count(*)::int as emails, (array_agg(c.id order by c.last_inbound_at desc))[1:5] as examples, max(c.last_inbound_at) as latest
			   from conversations c, jsonb_array_elements(c.open_questions) x
			  where c.org_id=$1 and not c.not_for_reply and c.reply_status in ('pending','ready')
			  group by 1,2,3,4,5,6 order by count(*) desc, max(c.last_inbound_at) desc limit 500`, [ctx.user!.orgId]);
		const byType = new Map<string, any>();
		for (const r2 of rows) {
			const t = byType.get(r2.fact) || { fact: r2.fact, label: FACTS[r2.fact]?.label || r2.fact, needsUpload: r2.needs_upload, kind: r2.kind, emails: 0, questions: [] as any[] };
			t.emails += r2.emails;
			t.questions.push(r2);
			byType.set(r2.fact, t);
		}
		return { types: [...byType.values()].sort((a, b) => b.emails - a.emails), total: rows.length };
	});

	r.get('/api/saved-views', async (ctx) => q('select id, name, query from saved_views where user_id=$1 order by name', [ctx.user!.id]));
	r.post('/api/saved-views', async (ctx) => {
		const name = String(ctx.body?.name || '').trim().slice(0, 80);
		if (!name) throw new HttpError(400, 'Give the view a name');
		return one('insert into saved_views (org_id, user_id, name, query) values ($1,$2,$3,$4) returning id, name, query', [ctx.user!.orgId, ctx.user!.id, name, String(ctx.body?.query || '').slice(0, 1000)]);
	});
	r.del('/api/saved-views/:id', async (ctx) => { await q('delete from saved_views where id=$1 and user_id=$2', [Number(ctx.params.id), ctx.user!.id]); return { success: true }; });

	/** Sync now, optionally with a new window (30/60/90 days); mailboxes read again from that far back. */
	r.post('/api/emails/sync', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const days = Number(ctx.body?.days);
		if (days) {
			const cfg = await saveEmailConfig(ctx.user!.orgId, { syncDays: days });
			await q(`update mailboxes set backfill_days=$2, sync_state='{}'::jsonb where org_id=$1`, [ctx.user!.orgId, cfg.syncDays]);
		}
		await audit(ctx, 'mail.sync_requested', 'organisation', ctx.user!.orgId, { days: days || null });
		await deps.kickWorker();
		return { queued: true };
	});

	// ── Bulk orders and quotes ──
	r.get('/api/bulk', async (ctx) => {
		const qs = ctx.query;
		const params: unknown[] = [ctx.user!.orgId];
		const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
		const where = ['b.org_id=$1'];
		const stages = (qs.get('stage') || '').split(',').filter((s) => STAGE_KEYS.includes(s));
		if (stages.length) where.push(`b.stage = any(${p(stages)}::text[])`);
		const t = (qs.get('q') || '').trim();
		if (t) { const x = p(`%${t}%`); where.push(`(c.subject ilike ${x} or b.quote_no ilike ${x} or li.from_name ilike ${x} or li.from_address ilike ${x} or b.items::text ilike ${x})`); }
		const SORT: Record<string, string> = { updated: 'b.updated_at', received: 'c.last_inbound_at', value: 'b.value', stage: `array_position(array[${STAGE_KEYS.map((s) => `'${s}'`).join(',')}], b.stage)`, sender: 'lower(li.from_name)', subject: 'lower(c.subject)', criticality: `array_position(array['critical','high','medium','low'], c.criticality)` };
		const dir = qs.get('dir') === 'asc' ? 'asc' : 'desc';
		return q<any>(
			`select b.id, b.conversation_id, b.stage, b.value::float as value, b.quote_no, b.quote_at, b.updated_at, jsonb_array_length(b.items) as lines, c.subject, c.criticality, c.completeness, c.last_inbound_at, c.reply_status,
			        li.from_name, li.from_address
			   from bulk_requests b join conversations c on c.id=b.conversation_id
			   left join lateral (select from_name, from_address from emails e where e.conversation_id=c.id and e.direction='inbound' order by sent_at desc limit 1) li on true
			  where ${where.join(' and ')} order by ${SORT[qs.get('sort') || 'updated'] || SORT.updated} ${dir} nulls last limit 500`, params);
	});
	r.patch('/api/bulk/:id', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const b = ctx.body || {};
		if (b.stage && !STAGE_KEYS.includes(b.stage)) throw new HttpError(400, 'Unknown stage');
		await q(`update bulk_requests set stage=coalesce($3, stage), notes=coalesce($4, notes), updated_at=now(), updated_by=$5 where id=$1 and org_id=$2`, [Number(ctx.params.id), ctx.user!.orgId, b.stage || null, b.notes ?? null, ctx.user!.id]);
		await audit(ctx, 'bulk.updated', 'bulk_request', Number(ctx.params.id), b);
		return { success: true };
	});
	r.post('/api/quote/price', async (ctx) => priceItems(ctx.user!.orgId, Array.isArray(ctx.body?.items) ? ctx.body.items : [], !!ctx.body?.international));
	r.post('/api/bulk/:id/quote', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const res = await makeQuote(ctx.user!.orgId, ctx.user!.id, Number(ctx.params.id), Array.isArray(ctx.body?.items) ? ctx.body.items : []);
		await audit(ctx, 'bulk.quote_made', 'bulk_request', Number(ctx.params.id), { quoteNo: res.quoteNo, total: res.totals.total });
		return res;
	});
	r.get('/api/bulk/:id/quote.pdf', async (ctx) => {
		const b = await one<any>('select quote_no, quote_pdf from bulk_requests where id=$1 and org_id=$2', [Number(ctx.params.id), ctx.user!.orgId]);
		if (!b?.quote_pdf) throw new HttpError(404, 'No quote has been made yet');
		return new Response(b.quote_pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="Gita-Press-Quote-${b.quote_no}.pdf"` } });
	});

	// ── Master data: bank, discount, freight, Kalyan prices ──
	r.get('/api/master/values', async (ctx) => { requireRole(ctx.user, 'analyst'); return allMaster(ctx.user!.orgId); });
	r.put('/api/master/values/:key', async (ctx) => {
		requireRole(ctx.user, ctx.params.key === 'bank' ? 'admin' : 'manager');
		const key = ctx.params.key as MasterKey;
		if (!MASTER_KEYS.includes(key)) throw new HttpError(404, 'Unknown master data');
		const before = (await allMaster(ctx.user!.orgId)).values[key];
		const value = await saveMaster(ctx.user!.orgId, ctx.user!.id, key, ctx.body || {});
		await audit(ctx, `master.${key}_updated`, 'master', key, { before, after: value });
		await markAllForEnrich(ctx.user!.orgId);
		return value;
	});
	r.get('/api/master/bank-qr', async (ctx) => {
		const qr = await bankQr(ctx.user!.orgId);
		if (!qr) throw new HttpError(404, 'No QR image');
		return new Response(qr.bytes as any, { headers: { 'content-type': qr.type, 'cache-control': 'private, max-age=300' } });
	});
	r.post('/api/master/bank-qr', async (ctx) => {
		requireRole(ctx.user, 'admin');
		await saveBankQr(ctx.user!.orgId, String(ctx.body?.fileName || 'qr.png'), String(ctx.body?.type || 'image/png'), fileBytes(ctx.body));
		await audit(ctx, 'master.bank_qr_updated', 'master', 'bank_qr', { fileName: ctx.body?.fileName });
		return { success: true };
	});

	// ── Book list (Suchi) ──
	const suchiCache = new Map<number, { at: number; name: string; bytes: Uint8Array; entries: SuchiEntry[] }>();
	r.post('/api/master/suchi/preview', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const bytes = fileBytes(ctx.body);
		const name = String(ctx.body?.fileName || 'suchi.pdf');
		const { entries, problems, reader } = await readSuchi(name, bytes);
		suchiCache.set(ctx.user!.id, { at: Date.now(), name, bytes, entries });
		return { ...(await previewSuchi(ctx.user!.orgId, entries)), problems, reader, sample: entries.slice(0, 8) };
	});
	r.post('/api/master/suchi/apply', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const c = suchiCache.get(ctx.user!.id);
		if (!c || Date.now() - c.at > 30 * 60_000) throw new HttpError(400, 'Check the file again first (the preview has expired)');
		const res = await applySuchi(ctx.user!.orgId, ctx.user!.id, c.name, c.bytes, c.entries, !!ctx.body?.replaceEdits);
		suchiCache.delete(ctx.user!.id);
		const { refreshFlags, autoFamilies } = await import('../master/books');
		await autoFamilies(ctx.user!.orgId);
		await refreshFlags(ctx.user!.orgId);
		const { forgetStock } = await import('../stock/stock');
		forgetStock(ctx.user!.orgId);
		await markAllForEnrich(ctx.user!.orgId);
		await audit(ctx, 'master.suchi_uploaded', 'master', 'suchi', { file: c.name, rows: res.rows, new: res.new, changed: res.changed });
		return res;
	});
	r.get('/api/master/suchi/export', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const rows = await q<any>(`select code, coalesce(suchi_title, name) as title, best_seller, binding, editions, set_code, size_en, pages, carton, coalesce(suchi_price, mrp)::float as price from book_titles where org_id=$1 and in_suchi and status <> 'removed' order by case when code ~ '^\\d+$' then lpad(code, 10, '0') else code end`, [ctx.user!.orgId]);
		const sets = new Map((await q<any>('select set_code, codes from book_sets where org_id=$1', [ctx.user!.orgId])).map((s) => [s.set_code, s.codes]));
		const entries: SuchiEntry[] = rows.map((r2) => ({ code: r2.code, title: r2.title, nativeTitle: null, flags: [r2.binding, r2.best_seller ? 'Best Seller' : null].filter(Boolean), binding: r2.binding, bestSeller: r2.best_seller, editions: r2.editions || [],
			set: r2.set_code ? { setCode: r2.set_code, codes: sets.get(r2.set_code) || [], volumes: null } : null, sizeEn: r2.size_en, pages: r2.pages, carton: r2.carton, price: r2.price }));
		return xlsx(writeXlsx([{ name: 'Book list (Suchi)', header: SUCHI_COLUMNS, rows: suchiRows(entries), widths: [8, 60, 22, 50, 20, 10, 10, 8, 10, 8] }]), `gita-press-suchi-${stamp()}.xlsx`);
	});
	r.get('/api/master/sets', async (ctx) => q('select set_code, codes, volumes from book_sets where org_id=$1 order by set_code', [ctx.user!.orgId]));
	r.get('/api/master/uploads', async (ctx) => q(`select m.id, m.kind, m.file_name, m.summary, m.uploaded_at, u.full_name as uploaded_by from master_uploads m left join users u on u.id=m.uploaded_by where m.org_id=$1 order by m.id desc limit 100`, [ctx.user!.orgId]));
	r.get('/api/master/uploads/:id/file', async (ctx) => {
		const m = await one<any>('select file_name, bytes from master_uploads where id=$1 and org_id=$2', [Number(ctx.params.id), ctx.user!.orgId]);
		if (!m?.bytes) throw new HttpError(404, 'File not found');
		return new Response(m.bytes, { headers: { 'content-type': /\.pdf$/i.test(m.file_name) ? 'application/pdf' : 'application/octet-stream', 'content-disposition': `attachment; filename="${m.file_name}"` } });
	});

	// ── Stock and tracking: check summary and data viewer ──
	r.post('/api/stock/preview', async (ctx) => {
		requireRole(ctx.user, 'manager');
		return importStock(ctx.user!.orgId, ctx.user!.id, ctx.body?.slot, String(ctx.body?.fileName || 'stock.xlsx'), fileBytes(ctx.body), true);
	});
	r.post('/api/uploads/:id/confirm', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const b = await confirmBatch(ctx.user!.orgId, Number(ctx.params.id), ctx.body || {});
		await audit(ctx, 'upload.confirmed', 'upload_batch', b.id, { kind: b.kind, rows: b.rows_total, year: ctx.body?.year || null });
		await deps.kickUploads();
		return b;
	});
	r.post('/api/uploads/:id/cancel', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const res = await cancelBatch(ctx.user!.orgId, Number(ctx.params.id));
		await audit(ctx, 'upload.cancelled', 'upload_batch', Number(ctx.params.id));
		return res;
	});
	/** Browse the rows any upload brought in (search, paging). */
	r.get('/api/data/:kind/:id/rows', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const id = Number(ctx.params.id);
		const kind = ctx.params.kind;
		const t = (ctx.query.get('q') || '').trim();
		const limit = Math.min(Number(ctx.query.get('limit')) || 100, 1000);
		const offset = Math.max(0, Number(ctx.query.get('offset')) || 0);
		const orgId = ctx.user!.orgId;
		const like = `%${t}%`;
		let sql = '', params: unknown[] = [];
		if (kind === 'hq' || kind === 'branch') {
			sql = `select location as "Location", godown as "Godown", code as "Code", name as "Book", language as "Language", batch as "Batch", price::float as "Rate", opening_qty::float as "Opening", in_qty::float as "Inwards", out_qty::float as "Outwards", closing_qty::float as "Closing"
			         from stock_rows where upload_id=$1 and org_id=$2 and ($3 = '' or code ilike $4 or name ilike $4 or location ilike $4) order by location, case when code ~ '^\\d+$' then lpad(code,10,'0') else code end`;
			params = [id, orgId, t, like];
		} else if (kind === 'orders') {
			sql = `select o.order_id as "Order", o.ordered_at as "Date", o.customer_name as "Customer", o.email as "Email", o.phone as "Phone", o.total::float as "Amount", h.status_label as "Status", h.tracking_id as "Tracking", o.partner as "Partner", o.ship_city as "City", o.ship_pin as "PIN"
			         from order_status_history h join orders o on o.org_id=h.org_id and o.order_key=h.order_key where h.org_id=$2 and h.batch_id=$1 and ($3 = '' or o.order_id ilike $4 or o.customer_name ilike $4 or o.email ilike $4 or o.phone ilike $4 or h.tracking_id ilike $4) order by o.ordered_at desc`;
			params = [id, orgId, t, like];
		} else if (kind === 'kalyan') {
			sql = `select d.custno as "Customer no", d.subperiod as "Type", d.dispdate as "Dispatch date", d.from_issue as "From issue", d.to_issue as "To issue", d.mode as "Mode", d.barcode as "Barcode", s.name as "Name", s.city as "City", s.state as "State"
			         from kalyan_dispatches d left join kalyan_subscribers s on s.org_id=d.org_id and s.custno=d.custno where d.org_id=$2 and d.batch_id=$1 and ($3 = '' or d.custno ilike $4 or s.name ilike $4 or d.barcode ilike $4 or s.city ilike $4) order by d.dispdate desc, d.custno`;
			params = [id, orgId, t, like];
		} else if (kind === 'kalyan_current') {
			sql = `select custno as "Customer no", year as "Year", sub_type as "Type", name as "Name", city as "City", state as "State", pin as "PIN", receipt_no as "Receipt no", paid_on as "Payment date"
			         from kalyan_customer_years where org_id=$2 and batch_id=$1 and ($3 = '' or custno ilike $4 or name ilike $4 or city ilike $4 or receipt_no ilike $4) order by custno`;
			params = [id, orgId, t, like];
		} else throw new HttpError(400, 'Rows for this upload are shown in its own section');
		const rows = await q<any>(`${sql} limit ${limit} offset ${offset}`, params);
		return { rows, columns: rows[0] ? Object.keys(rows[0]) : [], offset, limit };
	});

	// ── Kalyan customers ──
	r.get('/api/kalyan/customers', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const cfg = await emailConfig(ctx.user!.orgId);
		const tab = ctx.query.get('tab') === 'current' ? 'current' : 'all';
		const res = await listKalyanCustomers(ctx.user!.orgId, { tab, qs: ctx.query, year: kalyanYearOf(cfg, new Date()) });
		const masked = ctx.user!.role === 'viewer';
		const rows = masked ? res.rows.map((r2: any) => ({ ...r2, address: '•••', pin: '•••' })) : res.rows;
		const format = ctx.query.get('format');
		if (format === 'xlsx' || format === 'csv') {
			if (masked) throw new HttpError(403, 'Viewers cannot download customer lists');
			await audit(ctx, 'export.kalyan_customers', null, null, { tab, rows: rows.length, filters: Object.fromEntries(ctx.query.entries()) });
			const name = `kalyan-customers-${tab}-${stamp()}`;
			return format === 'csv' ? csv(KALYAN_EXPORT_HEADER, kalyanExportRows(rows), `${name}.csv`) : xlsx(writeXlsx([{ name: 'Kalyan customers', header: KALYAN_EXPORT_HEADER, rows: kalyanExportRows(rows) }]), `${name}.xlsx`);
		}
		const states = await q<any>(`select coalesce(state_norm, nullif(state,'')) as k, count(*)::int n from kalyan_customers where org_id=$1 group by 1 order by 2 desc limit 60`, [ctx.user!.orgId]);
		const years = await q<any>(`select year, count(*)::int n from kalyan_customer_years where org_id=$1 group by 1 order by 1 desc`, [ctx.user!.orgId]);
		return { ...res, rows, year: kalyanYearOf(cfg, new Date()), states, years };
	});
	r.get('/api/kalyan/customers/:custno', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const orgId = ctx.user!.orgId;
		const custno = ctx.params.custno;
		const c = await one<any>('select * from kalyan_customers where org_id=$1 and custno=$2', [orgId, custno]);
		if (!c) throw new HttpError(404, 'Customer not found');
		const years = await q<any>('select year, sub_type, receipt_no, paid_on::text as paid_on, city, state from kalyan_customer_years where org_id=$1 and custno=$2 order by year desc', [orgId, custno]);
		const dispatches = await q<any>('select dispdate::text as dispdate, from_issue, to_issue, mode, barcode, subperiod from kalyan_dispatches where org_id=$1 and custno=$2 order by dispdate desc limit 60', [orgId, custno]);
		const emails = await q<any>(
			`select c.id, c.subject, c.last_inbound_at, c.primary_group, c.reply_status from conversations c
			  where c.org_id=$1 and (c.answers->>'custno' = $2 or c.facts @> $3::jsonb) order by c.last_inbound_at desc limit 30`,
			[orgId, custno, JSON.stringify([{ key: 'kalyan_custno', value: custno }])]);
		return { customer: c, years, dispatches, emails };
	});
	r.get('/api/kalyan/dashboard', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const cfg = await emailConfig(ctx.user!.orgId);
		const year = Number(ctx.query.get('year')) || kalyanYearOf(cfg, new Date());
		return { ...(await kalyanDashboard(ctx.user!.orgId, year)), yearStartMonth: cfg.kalyanYearStartMonth };
	});

	// ── Settings: email rules, pending questions, summary, auto-send ──
	r.get('/api/settings/email', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const { PURPOSE_LABELS } = await import('../ai/purposes');
		return { config: await emailConfig(ctx.user!.orgId), defaults: DEFAULT_CONFIG, groups: GROUPS, subTags: SUBTAG_LABEL, facts: FACTS, levels: LEVELS, reasons: PURPOSE_LABELS, kalyanMasterFields: KALYAN_MASTER_FIELDS };
	});
	r.put('/api/settings/email', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const before = await emailConfig(ctx.user!.orgId);
		const next = await saveEmailConfig(ctx.user!.orgId, ctx.body || {});
		if (next.syncDays !== before.syncDays) await q(`update mailboxes set backfill_days=$2 where org_id=$1`, [ctx.user!.orgId, next.syncDays]);
		await audit(ctx, 'settings.email_updated', 'organisation', ctx.user!.orgId, { keys: Object.keys(ctx.body || {}) });
		return next;
	});
	r.get('/api/standing-answers', async (ctx) => q(`select s.*, u.full_name as created_by_name from standing_answers s left join users u on u.id=s.created_by where s.org_id=$1 order by s.updated_at desc`, [ctx.user!.orgId]));
	r.post('/api/standing-answers', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const key = String(ctx.body?.question_key || '').slice(0, 200);
		const answer = String(ctx.body?.answer || '').trim().slice(0, 2000);
		if (!key || !answer) throw new HttpError(400, 'A question and an answer are needed');
		const row = await one(
			`insert into standing_answers (org_id, question_key, question, answer, group_key, created_by) values ($1,$2,$3,$4,$5,$6)
			 on conflict (org_id, question_key) do update set answer=excluded.answer, question=excluded.question, updated_at=now() returning *`,
			[ctx.user!.orgId, key, String(ctx.body?.question || key).slice(0, 500), answer, ctx.body?.group_key || null, ctx.user!.id]);
		await markAllForEnrich(ctx.user!.orgId);
		await audit(ctx, 'standing_answer.saved', 'standing_answer', key, { answer });
		return row;
	});
	r.del('/api/standing-answers/:id', async (ctx) => {
		requireRole(ctx.user, 'manager');
		await q('delete from standing_answers where id=$1 and org_id=$2', [Number(ctx.params.id), ctx.user!.orgId]);
		await markAllForEnrich(ctx.user!.orgId);
		await audit(ctx, 'standing_answer.deleted', 'standing_answer', ctx.params.id);
		return { success: true };
	});
	r.get('/api/settings/completeness', async (ctx) => {
		const orgId = ctx.user!.orgId;
		const byGroup = await q<any>(
			`select primary_group as g, coalesce(sub_tags[1], '') as t, count(*)::int as emails, count(*) filter (where completeness >= 100)::int as complete, round(avg(completeness))::int as avg,
			        count(*) filter (where reply_status='ready')::int as ready, count(*) filter (where reply_status='pending')::int as pending
			   from conversations where org_id=$1 and not not_for_reply and primary_group is not null and reply_status in ('pending','ready','queued') group by 1,2 order by 1,2`, [orgId]);
		const questions = await q<any>(
			`select x->>'fact' as fact, count(*)::int as n, count(distinct x->>'key')::int as distinct_questions from conversations c, jsonb_array_elements(c.open_questions) x
			  where c.org_id=$1 and not c.not_for_reply and c.reply_status in ('pending','ready') group by 1 order by 2 desc`, [orgId]);
		const unlocked = await q<any>(
			`select s.id, s.question_key, s.question, s.answer, s.updated_at,
			        (select count(*) from conversations c where c.org_id=$1 and c.facts @> jsonb_build_array(jsonb_build_object('source','standing answer')) and c.facts::text like '%' || s.answer || '%')::int as emails
			   from standing_answers s where s.org_id=$1 order by s.updated_at desc limit 100`, [orgId]);
		const trend = await q<any>(
			`select to_char(date_trunc('week', day), 'YYYY-MM-DD') as week, round(sum(avg_pct * emails) / nullif(sum(emails),0))::int as avg, sum(emails)::int as emails, sum(complete)::int as complete
			   from completeness_daily where org_id=$1 and day > now() - interval '26 weeks' group by 1 order by 1`, [orgId]);
		return { byGroup, questions: questions.map((x) => ({ ...x, label: FACTS[x.fact]?.label || x.fact })), unlocked, trend, groups: GROUPS, subTags: SUBTAG_LABEL };
	});

	// ── Delete everything and rebuild ──
	r.get('/api/system/reset', async (ctx) => {
		requireRole(ctx.user, 'admin');
		const orgId = ctx.user!.orgId;
		const n = async (sql: string) => (await one<any>(sql, [orgId]))?.n ?? 0;
		return {
			delete: {
				Emails: await n('select count(*)::int n from emails where org_id=$1'),
				'Email threads': await n('select count(*)::int n from conversations where org_id=$1'),
				'Reply drafts': await n('select count(*)::int n from reply_drafts where org_id=$1'),
				'Email senders and old customer records': await n('select count(*)::int n from customers where org_id=$1'),
				'Orders (tracking)': await n('select count(*)::int n from orders where org_id=$1'),
				'Kalyan dispatches': await n('select count(*)::int n from kalyan_dispatches where org_id=$1'),
				'Kalyan customers': await n('select count(*)::int n from kalyan_customers where org_id=$1'),
				'Stock uploads': await n('select count(*)::int n from stock_uploads where org_id=$1'),
				'Books (list and links)': await n('select count(*)::int n from book_titles where org_id=$1'),
				'Bulk requests and quotes': await n('select count(*)::int n from bulk_requests where org_id=$1'),
			},
			keep: ['Branch locations', 'Delivery partners and tracking websites', 'Kalyan subscription types and dispatch modes', 'Bank, discount and freight details', 'Groups, sub-tags, reasons and email rules',
				'Standing answers', 'Templates and help', 'Settings, users and mailboxes (they will read mail again)', 'Audit log'],
		};
	});
	r.post('/api/system/reset', async (ctx) => {
		requireRole(ctx.user, 'admin');
		if (ctx.body?.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm');
		const orgId = ctx.user!.orgId;
		// 1. a backup first (pg_dump); if it cannot be made, the admin must confirm they have one
		let backup: string | null = null;
		try {
			const dir = path.resolve(process.env.BACKUP_DIR || 'backups');
			fs.mkdirSync(dir, { recursive: true });
			backup = path.join(dir, `gitamail-before-reset-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
			await run('pg_dump', ['--format=custom', '--no-owner', `--dbname=${databaseUrl().replace(/\?.*$/, '')}`, `--file=${backup}`], { timeout: 15 * 60_000 });
		} catch (e: any) {
			backup = null;
			if (!ctx.body?.haveBackup) throw new HttpError(400, `An automatic backup could not be made (${String(e.message).slice(0, 120)}). Make a backup yourself (deploy/windows/backup.ps1 or scripts/backup.sh), then tick "I have a backup" and try again.`);
		}
		// 2. delete
		await tx(async (c) => {
			const del = async (sql: string) => c.query(sql, [orgId]);
			await del(`update reply_drafts set status='dismissed' where org_id=$1 and status='queued'`);
			await del('delete from bulk_requests where org_id=$1');
			await del('delete from book_requests where org_id=$1');
			await del('delete from emails where org_id=$1');
			await del('delete from conversations where org_id=$1');
			await del('delete from alerts where org_id=$1');
			await del('delete from contacts where org_id=$1');
			await del('delete from customers where org_id=$1');
			await del('delete from order_status_history where org_id=$1');
			await del('delete from orders where org_id=$1');
			await del('delete from kalyan_dispatches where org_id=$1');
			await del('delete from kalyan_subscribers where org_id=$1');
			await del('delete from kalyan_customer_years where org_id=$1');
			await del('delete from kalyan_customers where org_id=$1');
			await del(`delete from upload_batches where org_id=$1`);
			await del('delete from stock_uploads where org_id=$1');
			await del('delete from book_titles where org_id=$1');
			await del('delete from book_sets where org_id=$1');
			await del(`delete from master_uploads where org_id=$1 and kind='suchi'`);
			await del('delete from completeness_daily where org_id=$1');
			await del('delete from analytics_runs where org_id=$1');
			await del(`update mailboxes set sync_state='{}'::jsonb, messages_synced=0, last_synced_at=null, last_error=null where org_id=$1`);
		});
		const { forgetStock } = await import('../stock/stock');
		forgetStock(orgId);
		await audit(ctx, 'system.reset', 'organisation', orgId, { backup });
		if (ctx.body?.sync !== false) await deps.kickWorker();
		return { success: true, backup };
	});
}

/** Book codes and quantities from an order list: Excel/CSV columns (Code, Qty) or "code x qty" text in a PDF. */
export async function readOrderList(fileName: string, mime: string, bytes: Uint8Array): Promise<{ code: string; qty: number | null }[]> {
	if (/\.(xlsx|xls|csv)$/i.test(fileName) || /spreadsheet|excel|csv/.test(mime)) {
		const sheets = readTable(bytes, fileName);
		for (const sh of sheets) {
			const hi = sh.rows.slice(0, 15).findIndex((r) => r.some((c) => /^(book)?code$|^codeno$|^bookno$/.test(headKey(c))));
			if (hi < 0) continue;
			const head = sh.rows[hi].map(headKey);
			const ci = head.findIndex((h) => /^(book)?code$|^codeno$|^bookno$/.test(h));
			const qi = head.findIndex((h) => /^(qty|quantity|copies|nos|no ofcopies|noofcopies|sankhya)$/.test(h) || /qty|quantity|copies/.test(h));
			return sh.rows.slice(hi + 1).map((r) => ({ code: String(r[ci] ?? '').trim().replace(/\.0+$/, ''), qty: qi >= 0 ? Number(r[qi]) || null : null })).filter((x) => /^[A-Z]{0,3}\d{1,5}[A-Z]?$/i.test(x.code)).slice(0, 200);
		}
		return [];
	}
	if (/\.pdf$/i.test(fileName) || mime === 'application/pdf') {
		const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
		const doc = await getDocument({ data: bytes, disableFontFace: true, verbosity: 0, isEvalSupported: false } as any).promise;
		let text = '';
		for (let p = 1; p <= Math.min(doc.numPages, 20); p++) text += `${((await (await doc.getPage(p)).getTextContent()).items as any[]).map((i) => i.str).join(' ')}\n`;
		await doc.destroy();
		return booksWithQty(text);
	}
	return [];
}

export const GROUP_KEYS_LIST = GROUPS.map((g) => g.key) as GroupKey[];
