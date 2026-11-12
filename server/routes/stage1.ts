/**
 * Routes added with master data, uploads, the customer database built from orders and Kalyan, and editable reasons
 * for contacting. Kept apart from api.ts so that file stays readable.
 */
import { one, q } from '../db';
import { HttpError, type Router } from '../http';
import { audit } from '../audit';
import { requireRole } from '../auth';
import { getOrg, invalidateOrg } from '../settings';
import { writeXlsx } from '../xlsx';
import { FLAG_LABEL, STATUS_LABEL, applyBooks, applyPrices, booksWorkbook, exportBooks, listBooks, parseBookFile, previewBooks, saveBook, setBookRemoved } from '../master/books';
import { COLUMNS, KIND_LABEL, addFilePart, addRows, batchFile, finishBatch, removeBatch, startBatch, uploadHistory, uploadStatus } from '../uploads/batches';
import { DEFAULT_MAPPINGS, clean, getMappings } from '../uploads/common';
import { monthCompleteness } from '../uploads/kalyan';
import { TIER_LABEL, computeTiers, customerHistory, dismissReview, listReviews, refreshStats, saveTierSettings, splitCustomer, tierSettings } from '../customers/link';
import { analyticsStatus, saveAnalyticsSchedule } from '../analytics';
import { mergePurpose, purposeList, savePurposes } from '../ai/purposeDefs';
import { printPage } from '../print';

const fileBytes = (b: any) => {
	const data = String(b?.data || '').replace(/^data:[^,]*,/, '');
	if (!data) throw new HttpError(400, 'No file received');
	return new Uint8Array(Buffer.from(data, 'base64'));
};
const xlsx = (bytes: Uint8Array, name: string) => new Response(bytes as any, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${name}"` } });
const stamp = () => new Date().toISOString().slice(0, 10);

export const EXPECT_DEFAULT: Record<string, number> = { hq: 7, branch: 7, orders: 4, kalyan: 31 };
export const FESTIVAL_DEFAULTS = [
	{ name: 'Gita Jayanti', date: '', upliftPct: 50, leadDays: 30 }, { name: 'Diwali', date: '', upliftPct: 30, leadDays: 30 }, { name: 'Ram Navami', date: '', upliftPct: 30, leadDays: 30 },
	{ name: 'Janmashtami', date: '', upliftPct: 30, leadDays: 30 }, { name: 'Navratri (Sharad)', date: '', upliftPct: 20, leadDays: 30 }, { name: 'Guru Purnima', date: '', upliftPct: 20, leadDays: 21 },
	{ name: 'Hanuman Jayanti', date: '', upliftPct: 20, leadDays: 21 }, { name: 'Maha Shivaratri', date: '', upliftPct: 20, leadDays: 21 },
];
const setting = async (orgId: number, key: string, value: unknown) => {
	await q(`update organisations set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb) where id=$1`, [orgId, key, JSON.stringify(value)]);
	invalidateOrg(orgId);
};

export function registerStage1(r: Router, deps: { kickUploads: () => Promise<void> }) {
	// ── Uploads (orders, Kalyan dispatch; history of every kind) ──────────────
	r.get('/api/uploads', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const orgId = ctx.user!.orgId;
		const s: any = (await getOrg(orgId)).settings;
		const expect = { ...EXPECT_DEFAULT, ...(s.uploadExpect || {}) };
		const [status, history, months] = await Promise.all([uploadStatus(orgId, expect), uploadHistory(orgId, ctx.query), monthCompleteness(orgId)]);
		if (ctx.query.get('format') === 'xlsx' || ctx.query.get('format') === 'print') {
			const header = ['Uploaded', 'Kind', 'File', 'Rows', 'New', 'Updated', 'Unchanged', 'Not used', 'Status', 'Uploaded by', 'Removed'];
			const rows = history.map((h) => [new Date(h.uploaded_at).toISOString().slice(0, 16).replace('T', ' '), KIND_LABEL[h.kind] || h.kind, h.file_name, h.rows_total, h.rows_new, h.rows_updated, h.rows_unchanged, h.rows_rejected, h.error || h.status, h.uploaded_by || '', h.deleted_at ? 'Removed' : '']);
			await audit(ctx, 'export.uploads', null, null, { rows: rows.length });
			return ctx.query.get('format') === 'print' ? printPage('Upload history', header, rows) : xlsx(writeXlsx([{ name: 'Uploads', header, rows }]), `gitamail-uploads-${stamp()}.xlsx`);
		}
		return { ...status, history, expect, kalyanMonths: months, columns: Object.fromEntries(Object.entries(COLUMNS).map(([k, v]) => [k, v.filter((c) => !c.optional).map((c) => c.label)])) };
	});
	r.put('/api/uploads/settings', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const next: Record<string, number> = {};
		for (const k of Object.keys(EXPECT_DEFAULT)) { const n = Number(ctx.body?.[k]); next[k] = Number.isFinite(n) && n >= 1 && n <= 365 ? Math.round(n) : EXPECT_DEFAULT[k]; }
		await setting(ctx.user!.orgId, 'uploadExpect', next);
		await audit(ctx, 'settings.upload_expect', 'organisation', ctx.user!.orgId, next);
		return { expect: next };
	});
	r.post('/api/uploads/start', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const res = await startBatch(ctx.user!.orgId, ctx.user!.id, ctx.body || {});
		await audit(ctx, 'upload.started', 'upload', res.id, { kind: res.kind, fileName: ctx.body?.fileName });
		return res;
	});
	r.post('/api/uploads/:id/rows', async (ctx) => { requireRole(ctx.user, 'manager'); return addRows(ctx.user!.orgId, Number(ctx.params.id), ctx.body || {}); });
	r.post('/api/uploads/:id/part', async (ctx) => { requireRole(ctx.user, 'manager'); return addFilePart(ctx.user!.orgId, Number(ctx.params.id), Number(ctx.body?.seq), fileBytes(ctx.body)); });
	r.post('/api/uploads/:id/finish', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const b = await finishBatch(ctx.user!.orgId, Number(ctx.params.id), ctx.body || {});
		await audit(ctx, 'upload.received', 'upload', b.id, { kind: b.kind, rows: b.rows_total });
		await deps.kickUploads();
		return { id: b.id, status: b.status, rows: b.rows_total };
	});
	r.get('/api/uploads/:id', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const b = await one<any>('select id, kind, file_name, status, step, rows_received, rows_total, rows_new, rows_updated, rows_unchanged, rows_rejected, profile, warnings, error, timing, uploaded_at, finished_at from upload_batches where id=$1 and org_id=$2', [Number(ctx.params.id), ctx.user!.orgId]);
		if (!b) throw new HttpError(404, 'Upload not found');
		const run = b.status === 'done' ? await one<any>(`select status, steps, error, finished_at from analytics_runs where org_id=$1 and trigger like $2 order by id desc limit 1`, [ctx.user!.orgId, `upload:${b.kind}:${b.id}`]) : null;
		return { ...b, analytics: run };
	});
	r.get('/api/uploads/:id/file', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const f = await batchFile(ctx.user!.orgId, Number(ctx.params.id));
		if (!f) throw new HttpError(404, 'The original file was not kept for this upload');
		await audit(ctx, 'upload.downloaded', 'upload', Number(ctx.params.id), { fileName: f.fileName });
		return new Response(f.bytes as any, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${f.fileName.replace(/[^\w.() -]+/g, '_')}"` } });
	});
	r.del('/api/uploads/:id', async (ctx) => {
		const permanent = ctx.query.get('permanent') === '1';
		requireRole(ctx.user, permanent ? 'admin' : 'manager');
		const res = await removeBatch(ctx.user!.orgId, Number(ctx.params.id), ctx.user!.id, permanent);
		await audit(ctx, permanent ? 'upload.erased' : 'upload.removed', 'upload', Number(ctx.params.id), res);
		if (!permanent) await deps.kickUploads();
		return res;
	});

	// ── Analytics run ─────────────────────────────────────────────────────────
	r.get('/api/analytics', async (ctx) => { requireRole(ctx.user, 'analyst'); return analyticsStatus(ctx.user!.orgId); });
	r.put('/api/analytics/schedule', async (ctx) => {
		requireRole(ctx.user, 'admin');
		const s = await saveAnalyticsSchedule(ctx.user!.orgId, ctx.body || {});
		await audit(ctx, 'settings.analytics_schedule', 'organisation', ctx.user!.orgId, s as any);
		return analyticsStatus(ctx.user!.orgId);
	});
	r.post('/api/analytics/run', async (ctx) => {
		requireRole(ctx.user, 'manager');
		await q(`insert into analytics_runs (org_id, trigger, status) values ($1, 'run now', 'queued')`, [ctx.user!.orgId]);
		await audit(ctx, 'analytics.run_now', null, null);
		await deps.kickUploads();
		return { queued: true };
	});

	// ── Master data: books ────────────────────────────────────────────────────
	r.get('/api/master/books', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const format = ctx.query.get('format');
		if (format === 'xlsx') { await audit(ctx, 'export.books', null, null); return xlsx(await booksWorkbook(ctx.user!.orgId, ctx.query), `gitamail-book-list-${stamp()}.xlsx`); }
		if (format === 'print') { const { header, rows } = await exportBooks(ctx.user!.orgId, ctx.query); return printPage('Book list', header, rows); }
		return { ...(await listBooks(ctx.user!.orgId, ctx.query)), statusLabels: STATUS_LABEL, flagLabels: FLAG_LABEL };
	});
	r.post('/api/master/books', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const b = await saveBook(ctx.user!.orgId, ctx.user!.id, ctx.body || {}, true);
		await audit(ctx, 'master.book_added', 'book', b.code, { name: b.name });
		return b;
	});
	r.post('/api/master/books/preview', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const { rows, problems } = await parseBookFile(ctx.user!.orgId, String(ctx.body?.fileName || 'books.xlsx'), fileBytes(ctx.body));
		return { ...(await previewBooks(ctx.user!.orgId, rows)), problems };
	});
	r.post('/api/master/books/upload', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const res = await applyBooks(ctx.user!.orgId, ctx.user!.id, String(ctx.body?.fileName || 'books.xlsx'), fileBytes(ctx.body));
		await audit(ctx, 'master.books_uploaded', 'upload', res.batchId, { total: res.total, new: res.new, changed: res.changed });
		return res;
	});
	r.post('/api/master/prices/upload', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const res = await applyPrices(ctx.user!.orgId, ctx.user!.id, String(ctx.body?.fileName || 'prices.xlsx'), fileBytes(ctx.body));
		await audit(ctx, 'master.prices_uploaded', 'upload', res.batchId, { total: res.total, changed: res.changed });
		return res;
	});
	r.patch('/api/master/books/:code', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const code = decodeURIComponent(ctx.params.code);
		const before = await one<any>('select name, language, hindi_title, aliases, gitapress_url, amazon_url, family, category, mrp, status from book_titles where org_id=$1 and code=$2', [ctx.user!.orgId, code]);
		const b = await saveBook(ctx.user!.orgId, ctx.user!.id, { ...(ctx.body || {}), code });
		await audit(ctx, 'master.book_edited', 'book', code, { before, fields: Object.keys(ctx.body || {}) });
		return b;
	});
	r.del('/api/master/books/:code', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const res = await setBookRemoved(ctx.user!.orgId, ctx.user!.id, decodeURIComponent(ctx.params.code), true);
		await audit(ctx, 'master.book_removed', 'book', decodeURIComponent(ctx.params.code));
		return res;
	});
	r.post('/api/master/books/:code/restore', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const res = await setBookRemoved(ctx.user!.orgId, ctx.user!.id, decodeURIComponent(ctx.params.code), false);
		await audit(ctx, 'master.book_restored', 'book', decodeURIComponent(ctx.params.code));
		return res;
	});

	// ── Master data: catalogues (a file or link per category, sent when a reader asks for a category) ──
	r.get('/api/master/catalogues', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		return { catalogues: await q<any>(`select c.id, c.category, c.title, c.url, c.file_name, length(c.bytes) as file_size, c.keywords, c.updated_at, u.full_name as updated_by from catalogues c left join users u on u.id=c.updated_by where c.org_id=$1 and c.deleted_at is null order by c.category, c.title`, [ctx.user!.orgId]) };
	});
	r.post('/api/master/catalogues', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const b = ctx.body || {};
		const category = clean(b.category, 80);
		if (!category) throw new HttpError(400, 'A catalogue needs a category, for example "Children\'s books"');
		const url = clean(b.url, 500);
		if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'The link must start with http:// or https://');
		const bytes = b.data ? fileBytes(b) : null;
		if (bytes && bytes.length > 15_000_000) throw new HttpError(413, 'The catalogue file is larger than 15 MB. Please upload a smaller file or use a link.');
		const id = Number(b.id) || 0;
		if (!id && !url && !bytes) throw new HttpError(400, 'Add a link or choose a file');
		const keywords = [...new Set(String(b.keywords || '').split(/[,;\n]/).map((x) => clean(x, 40)).filter(Boolean))].slice(0, 20);
		const row = id
			? await one<any>(`update catalogues set category=$3, title=$4, url=nullif($5,''), keywords=$6, file_name=coalesce($7, file_name), bytes=coalesce($8, bytes), content_type=coalesce($9, content_type), updated_at=now(), updated_by=$10 where id=$1 and org_id=$2 returning id`,
				[id, ctx.user!.orgId, category, clean(b.title, 200), url, keywords, bytes ? clean(b.fileName, 200) : null, bytes ? Buffer.from(bytes) : null, bytes ? clean(b.contentType, 100) || 'application/pdf' : null, ctx.user!.id])
			: await one<any>(`insert into catalogues (org_id, category, title, url, keywords, file_name, bytes, content_type, updated_by) values ($1,$2,$3,nullif($4,''),$5,$6,$7,$8,$9) returning id`,
				[ctx.user!.orgId, category, clean(b.title, 200), url, keywords, bytes ? clean(b.fileName, 200) : null, bytes ? Buffer.from(bytes) : null, bytes ? clean(b.contentType, 100) || 'application/pdf' : null, ctx.user!.id]);
		if (!row) throw new HttpError(404, 'Catalogue not found');
		await audit(ctx, id ? 'master.catalogue_edited' : 'master.catalogue_added', 'catalogue', row.id, { category });
		return { id: row.id };
	});
	r.get('/api/master/catalogues/:id/file', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const c = await one<any>('select file_name, bytes, content_type from catalogues where id=$1 and org_id=$2 and deleted_at is null', [Number(ctx.params.id), ctx.user!.orgId]);
		if (!c?.bytes) throw new HttpError(404, 'No file is stored for this catalogue');
		return new Response(c.bytes as any, { headers: { 'content-type': c.content_type || 'application/octet-stream', 'content-disposition': `attachment; filename="${String(c.file_name || 'catalogue').replace(/[^\w.() -]+/g, '_')}"` } });
	});
	r.del('/api/master/catalogues/:id', async (ctx) => {
		requireRole(ctx.user, 'manager');
		await q('update catalogues set deleted_at=now(), updated_by=$3 where id=$1 and org_id=$2', [Number(ctx.params.id), ctx.user!.orgId, ctx.user!.id]);
		await audit(ctx, 'master.catalogue_removed', 'catalogue', Number(ctx.params.id));
		return { success: true };
	});

	// ── Master data: mappings and festival calendar ───────────────────────────
	r.get('/api/master/mappings', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const s: any = (await getOrg(ctx.user!.orgId)).settings;
		const seen = await q<any>(`select partner as k, count(*)::int as n from orders where org_id=$1 and partner is not null group by 1 order by 2 desc limit 50`, [ctx.user!.orgId]);
		const states = await q<any>(`select state as k, count(*)::int as n from kalyan_subscribers where org_id=$1 and state_norm is null and state <> '' group by 1 order by 2 desc limit 100`, [ctx.user!.orgId]);
		return { mappings: await getMappings(ctx.user!.orgId), defaults: DEFAULT_MAPPINGS, saved: s.mappings || {}, festivals: s.festivals || FESTIVAL_DEFAULTS, couriersSeen: seen, statesNotRecognised: states };
	});
	r.put('/api/master/mappings', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const out: any = {};
		for (const k of Object.keys(DEFAULT_MAPPINGS)) {
			const v = ctx.body?.[k];
			if (!v || typeof v !== 'object') continue;
			out[k] = {};
			for (const [a, b] of Object.entries(v).slice(0, 500)) {
				const key = k === 'states' ? clean(a, 80).toUpperCase().replace(/[^A-Z]/g, '') : k === 'courierSites' || k === 'subperiod' || k === 'dispMode' || k === 'orderStatus' ? clean(a, 80) : clean(a, 80).toLowerCase();
				const val = clean(b, 200);
				if (!key || !val) continue;
				if (k === 'courierSites' && !/^https?:\/\//i.test(val)) throw new HttpError(400, `The tracking website for ${a} must start with http:// or https://`);
				out[k][key] = val;
			}
		}
		const s: any = (await getOrg(ctx.user!.orgId)).settings;
		const next = { ...(s.mappings || {}), ...out };
		await setting(ctx.user!.orgId, 'mappings', next);
		await audit(ctx, 'master.mappings_updated', 'organisation', ctx.user!.orgId, { sections: Object.keys(out) });
		// names already stored are tidied with the new spellings
		const m = await getMappings(ctx.user!.orgId);
		for (const [alias, name] of Object.entries(m.couriers)) await q(`update orders set partner=$3 where org_id=$1 and lower(partner_raw)=$2 and partner is distinct from $3`, [ctx.user!.orgId, alias, name]);
		for (const [alias, name] of Object.entries(out.states || {})) await q(`update kalyan_subscribers set state_norm=$3 where org_id=$1 and state_norm is null and regexp_replace(upper(state), '[^A-Z]', '', 'g')=$2`, [ctx.user!.orgId, alias, name]);
		return { mappings: m };
	});
	r.put('/api/master/festivals', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const list = (Array.isArray(ctx.body?.festivals) ? ctx.body.festivals : []).slice(0, 40).map((f: any) => ({
			name: clean(f.name, 80), date: /^\d{4}-\d{2}-\d{2}$/.test(String(f.date || '')) ? String(f.date) : '', upliftPct: Math.max(0, Math.min(300, Math.round(Number(f.upliftPct) || 0))), leadDays: Math.max(0, Math.min(180, Math.round(Number(f.leadDays) || 0))),
		})).filter((f: any) => f.name);
		await setting(ctx.user!.orgId, 'festivals', list);
		await audit(ctx, 'master.festivals_updated', 'organisation', ctx.user!.orgId, { count: list.length });
		return { festivals: list };
	});

	// ── Customers: tiers, history, review list, split ─────────────────────────
	r.get('/api/settings/tiers', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const counts = await q<any>(`select buyer_tier as k, count(*)::int as n from customers where org_id=$1 and (orders_count > 0 or kalyan_buyer or buyer_points > 0) group by 1`, [ctx.user!.orgId]);
		return { settings: await tierSettings(ctx.user!.orgId), labels: TIER_LABEL, counts: Object.fromEntries(counts.map((c) => [c.k, c.n])) };
	});
	r.put('/api/settings/tiers', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const s = await saveTierSettings(ctx.user!.orgId, ctx.body || {});
		const res = await computeTiers(ctx.user!.orgId);
		await audit(ctx, 'settings.tiers', 'organisation', ctx.user!.orgId, s as any);
		return { settings: s, result: res };
	});
	r.get('/api/customer-db/:id/history', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const id = Number(ctx.params.id);
		if (!(await one('select 1 from customers where id=$1 and org_id=$2', [id, ctx.user!.orgId]))) throw new HttpError(404, 'Customer not found');
		return customerHistory(ctx.user!.orgId, id);
	});
	r.post('/api/customer-db/:id/split', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const res = await splitCustomer(ctx.user!.orgId, Number(ctx.params.id), ctx.body || {});
		await audit(ctx, 'customer.split', 'customer', Number(ctx.params.id), { newCustomer: res.id, ...(ctx.body || {}) });
		return res;
	});
	r.get('/api/customer-reviews', async (ctx) => { requireRole(ctx.user, 'analyst'); return listReviews(ctx.user!.orgId, ctx.query.get('status') || 'open'); });
	r.post('/api/customer-reviews/:id/dismiss', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const res = await dismissReview(ctx.user!.orgId, Number(ctx.params.id), ctx.user!.id);
		await audit(ctx, 'customer.review_dismissed', 'customer_review', Number(ctx.params.id));
		return res;
	});
	r.post('/api/customers/refresh-figures', async (ctx) => {
		requireRole(ctx.user, 'manager');
		await refreshStats(ctx.user!.orgId);
		return computeTiers(ctx.user!.orgId);
	});

	// ── Reasons for contacting ────────────────────────────────────────────────
	r.get('/api/purposes', async (ctx) => {
		const res = await purposeList(ctx.user!.orgId);
		// "hint" is kept for older screens
		return { ...res, purposes: res.purposes.map((p) => ({ ...p, hint: p.description })) };
	});
	r.put('/api/settings/purposes', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const res = await savePurposes(ctx.user!.orgId, ctx.user!.id, ctx.body || {});
		await audit(ctx, 'settings.purposes_updated', 'organisation', ctx.user!.orgId, { before: res.before, after: res.after });
		if (res.retagging.length) await deps.kickUploads();
		return { ...(await purposeList(ctx.user!.orgId)), retagging: res.retagging };
	});
	r.post('/api/settings/purposes/merge', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const res = await mergePurpose(ctx.user!.orgId, ctx.user!.id, String(ctx.body?.from || ''), String(ctx.body?.into || ''));
		await audit(ctx, 'settings.purposes_merged', 'organisation', ctx.user!.orgId, { before: { from: ctx.body?.from }, after: { into: ctx.body?.into }, threads: res.threads, customers: res.customers });
		return { ...res, ...(await purposeList(ctx.user!.orgId)) };
	});
	// "Re-check with AI for a date range": the same mechanism as Settings → Reply drafts → Re-analyse, for chosen dates
	const range = (b: any) => {
		const from = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.from || '')) ? String(b.from) : null;
		const to = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.to || '')) ? String(b.to) : null;
		if (!from || !to || from > to) throw new HttpError(400, 'Choose a start and an end date');
		return [from, to];
	};
	r.get('/api/settings/purposes/recheck', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const [from, to] = range({ from: ctx.query.get('from'), to: ctx.query.get('to') });
		const row = await one<any>(
			`select count(*)::int as threads, coalesce(sum(message_count), 0)::int as emails from conversations where org_id=$1 and message_count > 0 and last_message_at >= $2::date and last_message_at < $3::date + 1`, [ctx.user!.orgId, from, to]);
		return { ...row, from, to };
	});
	r.post('/api/settings/purposes/recheck', async (ctx) => {
		requireRole(ctx.user, 'manager');
		const [from, to] = range(ctx.body);
		const marked = (await q(`update conversations set needs_analysis=true, updated_at=now() where org_id=$1 and message_count > 0 and last_message_at >= $2::date and last_message_at < $3::date + 1 returning id`, [ctx.user!.orgId, from, to])).length;
		await audit(ctx, 'settings.purposes_recheck', null, null, { from, to, threads: marked });
		return { marked };
	});
}
