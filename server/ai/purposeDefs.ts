/**
 * Reasons for contacting, kept in the database so admins and managers can manage the list in Settings without a
 * code change. The list in purposes.ts is the seed and the fallback. Built-in reasons keep their keyword rules and
 * subgroup mapping; keywords added in Settings work on top.
 */
import { one, q } from '../db';
import { HttpError } from '../http';
import { NO_PURPOSE_GROUPS, PURPOSES, PURPOSE_HINTS, PURPOSE_LABELS, keywordTest, setActivePurposes, type ActivePurpose } from './purposes';

export interface PurposeDef extends ActivePurpose { group_name: string; sort_order: number; locked: boolean; builtin: boolean; updated_at?: string }

export const DEFAULT_GROUPS: [string, string[]][] = [
	['Orders', ['book_order', 'order_tracking', 'availability_price', 'international', 'bulk_order', 'payment_refund', 'complaint']],
	['Kalyan', ['kalyan']],
	['Trade and events', ['dealer', 'book_fair_event']],
	['Suggestions', ['suggestion_content', 'suggestion_printing', 'translation', 'permission']],
	['Service and engagement', ['seva', 'donation', 'visit_stay', 'job', 'scripture_question', 'branch_address', 'ebook_website', 'other']],
];
export const LOCKED = ['kalyan', 'international', 'other'];
const MAX_REASONS = 60;

const cache = new Map<number, { at: number; defs: PurposeDef[] }>();
export const forgetPurposeDefs = (orgId: number) => { cache.delete(orgId); };

async function seed(orgId: number) {
	const rows: any[] = [];
	let n = 0;
	for (const [group, keys] of DEFAULT_GROUPS) for (const key of keys) rows.push({ key, label: (PURPOSE_LABELS as any)[key], description: (PURPOSE_HINTS as any)[key].slice(0, 200), group_name: group, sort_order: ++n * 10, locked: LOCKED.includes(key) });
	for (const key of PURPOSES) if (!rows.some((r) => r.key === key)) rows.push({ key, label: PURPOSE_LABELS[key], description: PURPOSE_HINTS[key].slice(0, 200), group_name: 'Service and engagement', sort_order: ++n * 10, locked: false });
	await q(
		`insert into purpose_defs (org_id, key, label, description, group_name, sort_order, locked, builtin)
		 select $1, x.key, x.label, x.description, x.group_name, x.sort_order, x.locked, true from jsonb_to_recordset($2::jsonb) as x(key text, label text, description text, group_name text, sort_order int, locked boolean)
		 on conflict do nothing`, [orgId, JSON.stringify(rows)]);
}

/** The list in use (cached for a short while; cleared on every change). Also loads it into the analysis code. */
export async function getPurposeDefs(orgId: number): Promise<PurposeDef[]> {
	const hit = cache.get(orgId);
	if (hit && Date.now() - hit.at < 30_000) return hit.defs;
	let defs = await q<PurposeDef>('select key, label, description, keywords, group_name, sort_order, hidden, locked, builtin, merged_into, updated_at from purpose_defs where org_id=$1 order by sort_order, label', [orgId]);
	if (!defs.length) { await seed(orgId); defs = await q<PurposeDef>('select key, label, description, keywords, group_name, sort_order, hidden, locked, builtin, merged_into, updated_at from purpose_defs where org_id=$1 order by sort_order, label', [orgId]); }
	cache.set(orgId, { at: Date.now(), defs });
	setActivePurposes(defs);
	return defs;
}

/** All definitions with counts, for the Settings tab, filters and labels. */
export async function purposeList(orgId: number) {
	const defs = await getPurposeDefs(orgId);
	const customers = await q<any>(`select p, count(*)::int as n from customers c, unnest(c.purposes) p where c.org_id=$1 group by 1`, [orgId]);
	const threads = await q<any>(`select p, count(*)::int as n from conversations c, unnest(c.purposes) p where c.org_id=$1 group by 1`, [orgId]);
	const cn = new Map(customers.map((r) => [r.p, r.n]));
	const tn = new Map(threads.map((r) => [r.p, r.n]));
	const retags = await q<any>(`select key, checked, tagged, status, created_at, finished_at from purpose_retags where org_id=$1 and (status='queued' or finished_at > now() - interval '1 day') order by id desc limit 20`, [orgId]);
	return {
		purposes: defs.map((d) => ({ ...d, active: !d.hidden && !d.merged_into, customers: cn.get(d.key) || 0, threads: tn.get(d.key) || 0 })),
		groups: [...new Set(defs.filter((d) => !d.hidden && !d.merged_into).map((d) => d.group_name))],
		retags, max: MAX_REASONS,
	};
}

const slug = (label: string) => label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const tidyKeywords = (v: unknown) => {
	const list = [...new Set((Array.isArray(v) ? v : String(v || '').split(/[,;\n]/)).map((x) => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean))];
	if (list.length > 30) throw new HttpError(400, 'A reason can have at most 30 keywords');
	if (list.some((k) => k.length > 40)) throw new HttpError(400, 'A keyword can be at most 40 characters');
	if (list.some((k) => k.length < 2)) throw new HttpError(400, 'A keyword needs at least 2 characters');
	return list;
};

/**
 * Add, edit, reorder, regroup, hide or unhide. `reasons` holds only the entries being changed (or all of them);
 * an entry without a key is new. Returns the list before and after, for the audit log.
 */
export async function savePurposes(orgId: number, userId: number | null, input: { reasons?: any[] }) {
	const before = await getPurposeDefs(orgId);
	const byKey = new Map(before.map((d) => [d.key, { ...d }]));
	const retag: string[] = [];
	for (const r of Array.isArray(input.reasons) ? input.reasons : []) {
		const cur = r.key ? byKey.get(String(r.key)) : undefined;
		if (r.key && !cur) throw new HttpError(404, `Reason "${r.key}" was not found`);
		if (cur?.merged_into) throw new HttpError(400, `"${cur.label}" was merged into another reason and cannot be changed`);
		const label = r.label !== undefined ? String(r.label).replace(/\s+/g, ' ').trim().slice(0, 60) : cur?.label || '';
		const description = r.description !== undefined ? String(r.description).replace(/\s+/g, ' ').trim() : cur?.description || '';
		if (!label) throw new HttpError(400, 'A reason needs a name');
		if (!description) throw new HttpError(400, `"${label}" needs a description: it tells the AI when to use this reason`);
		if (description.length > 200) throw new HttpError(400, `The description of "${label}" is longer than 200 characters`);
		const keywords = r.keywords !== undefined ? tidyKeywords(r.keywords) : cur?.keywords || [];
		const group = r.group_name !== undefined ? String(r.group_name).replace(/\s+/g, ' ').trim().slice(0, 40) || 'Other' : cur?.group_name || 'Other';
		const hidden = r.hidden !== undefined ? !!r.hidden : cur?.hidden || false;
		if (cur?.locked && hidden) throw new HttpError(400, `"${cur.label}" is always needed and cannot be hidden`);
		const sort = Number.isFinite(Number(r.sort_order)) ? Math.round(Number(r.sort_order)) : cur?.sort_order ?? (Math.max(0, ...[...byKey.values()].map((d) => d.sort_order)) + 10);
		if (cur) {
			if (keywords.join('|') !== (cur.keywords || []).join('|') && keywords.length) retag.push(cur.key);
			Object.assign(cur, { label, description, keywords, group_name: group, hidden, sort_order: sort });
		} else {
			let key = slug(label) || 'reason';
			for (let i = 2; byKey.has(key); i++) key = `${slug(label) || 'reason'}_${i}`;
			byKey.set(key, { key, label, description, keywords, group_name: group, sort_order: sort, hidden, locked: false, builtin: false, merged_into: null });
			if (keywords.length) retag.push(key);
		}
	}
	const live = [...byKey.values()].filter((d) => !d.merged_into);
	if (live.length > MAX_REASONS) throw new HttpError(400, `There can be at most ${MAX_REASONS} reasons`);
	const labels = new Map<string, string>();
	for (const d of live) {
		const k = d.label.toLowerCase();
		if (labels.has(k)) throw new HttpError(400, `Two reasons cannot have the same name: "${d.label}"`);
		labels.set(k, d.key);
	}
	await q(
		`insert into purpose_defs (org_id, key, label, description, keywords, group_name, sort_order, hidden, locked, builtin, updated_by, updated_at)
		 select $1, x.key, x.label, x.description, x.keywords, x.group_name, x.sort_order, x.hidden, x.locked, x.builtin, $3, now()
		   from jsonb_to_recordset($2::jsonb) as x(key text, label text, description text, keywords text[], group_name text, sort_order int, hidden boolean, locked boolean, builtin boolean)
		 on conflict (org_id, key) do update set label=excluded.label, description=excluded.description, keywords=excluded.keywords, group_name=excluded.group_name, sort_order=excluded.sort_order, hidden=excluded.hidden,
		   updated_by=excluded.updated_by, updated_at=now()
		   where (purpose_defs.label, purpose_defs.description, purpose_defs.keywords, purpose_defs.group_name, purpose_defs.sort_order, purpose_defs.hidden)
		         is distinct from (excluded.label, excluded.description, excluded.keywords, excluded.group_name, excluded.sort_order, excluded.hidden)`,
		[orgId, JSON.stringify(live), userId]);
	for (const key of [...new Set(retag)]) {
		await q(`delete from purpose_retags where org_id=$1 and key=$2 and status='queued'`, [orgId, key]);
		await q(`insert into purpose_retags (org_id, key) values ($1,$2)`, [orgId, key]);
	}
	forgetPurposeDefs(orgId);
	const after = await getPurposeDefs(orgId);
	const pick = (d: PurposeDef) => ({ key: d.key, label: d.label, description: d.description, keywords: d.keywords, group: d.group_name, order: d.sort_order, hidden: d.hidden });
	const changed = after.filter((a) => JSON.stringify(pick(a)) !== JSON.stringify(before.find((b) => b.key === a.key) ? pick(before.find((b) => b.key === a.key)!) : null));
	return { before: changed.map((a) => before.find((b) => b.key === a.key)).filter(Boolean).map((d) => pick(d!)), after: changed.map(pick), retagging: [...new Set(retag)] };
}

/** Merge one reason into another: every thread and customer tagged `from` becomes `into`. Cannot be undone. */
export async function mergePurpose(orgId: number, userId: number | null, from: string, into: string) {
	const defs = await getPurposeDefs(orgId);
	const a = defs.find((d) => d.key === from);
	const b = defs.find((d) => d.key === into);
	if (!a || !b) throw new HttpError(404, 'Reason not found');
	if (from === into) throw new HttpError(400, 'Choose a different reason to merge into');
	if (a.locked) throw new HttpError(400, `"${a.label}" is always needed and cannot be merged away`);
	if (a.merged_into) throw new HttpError(400, `"${a.label}" is already merged`);
	if (b.hidden || b.merged_into) throw new HttpError(400, `"${b.label}" is hidden or merged, so nothing can be merged into it`);
	const SWAP = `(select coalesce(array_agg(distinct case when p=$2 then $3 else p end), '{}') from unnest(purposes) p)`;
	const threads = (await q(`update conversations set purposes = ${SWAP} where org_id=$1 and $2 = any(purposes) returning id`, [orgId, from, into])).length;
	const customers = (await q(`update customers set purposes = ${SWAP} where org_id=$1 and $2 = any(purposes) returning id`, [orgId, from, into])).length;
	await q(`update purpose_defs set merged_into=$3, hidden=true, updated_by=$4, updated_at=now() where org_id=$1 and key=$2`, [orgId, from, into, userId]);
	await q(`delete from purpose_retags where org_id=$1 and key=$2 and status='queued'`, [orgId, from]);
	forgetPurposeDefs(orgId);
	await getPurposeDefs(orgId);
	return { success: true, threads, customers, from: a.label, into: b.label };
}

/**
 * Free re-tagging: after a reason is added or its keywords change, older analysed threads whose inbound text
 * matches get the reason added. No AI. Nothing is removed; threads a person has set by hand, and internal,
 * automated and supplier threads, are skipped. Runs in the background, in batches.
 */
export async function retagTick(orgId: number, deadline = Date.now() + 20_000) {
	const defs = await getPurposeDefs(orgId);
	let tagged = 0;
	for (;;) {
		const job = await one<any>(`select * from purpose_retags where org_id=$1 and status='queued' order by id limit 1`, [orgId]);
		if (!job) break;
		const def = defs.find((d) => d.key === job.key);
		if (!def || def.hidden || def.merged_into || !def.keywords.length) { await q(`update purpose_retags set status='done', finished_at=now() where id=$1`, [job.id]); continue; }
		const tests = def.keywords.map(keywordTest);
		const rows = await q<any>(
			`select c.id, c.customer_id, c.subject,
			        (select string_agg(left(coalesce(e.body_clean, e.body_text, ''), 3000), ' ') from (select * from emails e where e.conversation_id=c.id and e.direction='inbound' and not e.is_duplicate order by e.sent_at desc limit 5) e) as body
			   from conversations c
			  where c.org_id=$1 and c.id > $2 and c.analysed_at is not null and not c.purposes_locked and not c.is_internal and not c.is_automated and c.customer_id is not null
			    and coalesce(c.business_category, '') <> all($3::text[]) and not ($4 = any(c.purposes))
			  order by c.id limit 400`,
			[orgId, job.last_conversation_id, NO_PURPOSE_GROUPS as string[], def.key]);
		if (!rows.length) { await q(`update purpose_retags set status='done', finished_at=now() where id=$1`, [job.id]); continue; }
		const hits = rows.filter((r) => { const t = `${r.subject || ''}\n${r.body || ''}`; const l = t.toLowerCase(); return tests.some((f) => f(t, l)); });
		if (hits.length) {
			// "other" stands alone: a thread that now has a real reason drops it
			await q(`update conversations set purposes = array_remove(purposes, 'other') || $2::text, purposes_at=now() where id = any($1::bigint[]) and not purposes_locked`, [hits.map((h) => h.id), def.key]);
			const { refreshCustomerPurposes } = await import('../analyze');
			for (const c of new Set(hits.map((h) => h.customer_id))) await refreshCustomerPurposes(c);
		}
		tagged += hits.length;
		await q(`update purpose_retags set last_conversation_id=$2, checked=checked+$3, tagged=tagged+$4 where id=$1`, [job.id, rows[rows.length - 1].id, rows.length, hits.length]);
		if (Date.now() > deadline) break;
	}
	return tagged;
}
