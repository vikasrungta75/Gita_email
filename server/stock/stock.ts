/**
 * Stock for draft replies. Tally stock summaries are uploaded in two slots, head office (HQ) and branches; every
 * upload is kept. The latest upload covering each location is that location's current stock.
 *
 * Rules agreed with Gita Press:
 *  - Gorakhpur stock available to readers = Main Stock + Retail Dispatch. Semi-finished (printed, not yet bound)
 *    is shown to staff only.
 *  - Readers are told exact quantities.
 *  - Price = the highest batch price at the location being quoted (in-stock batches first).
 *  - A reply quotes Gorakhpur (post and abroad are served only from there) and the branch nearest the reader.
 *  - Negative closing stock in Tally counts as zero.
 */
import { one, q } from '../db';
import { HttpError } from '../http';
import { getOrg, invalidateOrg } from '../settings';
import { readTable, writeXlsx } from '../xlsx';
import { detectScope, godownKind, readTally } from './tally';
import { ADDRESS_INTENT, BY_KEY, DIRECTORY, resolveDirectory, HQ_KEY, POST_NOTE, POST_NOTE_HI, entryText, isAbroad, locationForSheet, locationLabel, nearestBranch, placeInText, type Place } from '../directory';

// ── settings ───────────────────────────────────────────────────────────────

export interface InventorySettings {
	/** days of average sales a branch should hold */
	coverDays: number;
	/** days it takes to get books from Gorakhpur to a branch */
	leadDays: number;
	branches: Record<string, { coverDays?: number; leadDays?: number }>;
	/** branch godowns whose outwards are transfers to the shop, not sales (besides any named "...Godown...") */
	nonSalesGodowns: string[];
}
/**
 * Delhi's three godowns pass stock on rather than sell it (decided by Gita Press, November 2026): their outwards are
 * transfers. Every sales figure is an estimate from Tally stock movement until a real sales file is available.
 */
export const DELHI_TRANSFER_GODOWNS = ['Delhi Branch Location', 'Delhi Whole Sale Location', 'Delhi Retail Location'];
export const INVENTORY_DEFAULTS: InventorySettings = { coverDays: 60, leadDays: 21, branches: {}, nonSalesGodowns: DELHI_TRANSFER_GODOWNS };
export const SALES_ESTIMATE_NOTE = 'Estimated from Tally stock movement; Delhi godowns treated as transfers; true sales data not yet available';

export async function inventorySettings(orgId: number): Promise<InventorySettings> {
	const org = await getOrg(orgId);
	const s = (org.settings as any).inventory || {};
	return { ...INVENTORY_DEFAULTS, ...s, branches: { ...(s.branches || {}) }, nonSalesGodowns: s.nonSalesGodowns || DELHI_TRANSFER_GODOWNS };
}

export async function saveInventorySettings(orgId: number, input: any): Promise<InventorySettings> {
	const n = (v: any, lo: number, hi: number) => (v === '' || v === null || v === undefined ? undefined : Math.max(lo, Math.min(hi, Math.round(Number(v)) || lo)));
	const cur = await inventorySettings(orgId);
	const next: InventorySettings = {
		coverDays: n(input.coverDays, 7, 365) ?? cur.coverDays,
		leadDays: n(input.leadDays, 1, 120) ?? cur.leadDays,
		branches: {},
		nonSalesGodowns: Array.isArray(input.nonSalesGodowns) ? input.nonSalesGodowns.map((x: any) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 60) : cur.nonSalesGodowns,
	};
	for (const [k, v] of Object.entries((input.branches || cur.branches) as Record<string, any>)) {
		if (!BY_KEY.has(k)) continue;
		const b = { coverDays: n(v?.coverDays, 7, 365), leadDays: n(v?.leadDays, 1, 120) };
		if (b.coverDays || b.leadDays) next.branches[k] = b;
	}
	await q(`update organisations set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('inventory', $2::jsonb) where id=$1`, [orgId, JSON.stringify(next)]);
	invalidateOrg(orgId);
	if (JSON.stringify(next.nonSalesGodowns) !== JSON.stringify(cur.nonSalesGodowns)) await reclassifyGodowns(orgId, next.nonSalesGodowns);
	return next;
}

/** After the list of transfer-only godowns changes, re-mark branch rows (no re-upload needed). */
export async function reclassifyGodowns(orgId: number, nonSales: string[]) {
	const list = nonSales.map((x) => x.toLowerCase().replace(/\s+/g, ' ').trim());
	await q(
		`update stock_rows r set godown_kind = case when lower(regexp_replace(r.godown, '\\s+', ' ', 'g')) = any($2::text[]) or r.godown ilike '%godown%' then 'godown' else 'store' end
		   from stock_uploads u where u.id=r.upload_id and u.scope='branch' and r.org_id=$1`,
		[orgId, list],
	);
	cache.delete(orgId);
	await import('./inventory').then((m) => m.forgetFacts(orgId));
}

// ── upload ─────────────────────────────────────────────────────────────────

const displayName = (n: string) => n.replace(/\s*-?\s*\(\s*\d+\s*\)\s*$/, '').replace(/\s*-\s*\d{2,5}\s*$/, '').replace(/\s{2,}/g, ' ').trim() || n;

export async function importStock(orgId: number, userId: number | null, slot: 'hq' | 'branch', fileName: string, data: Uint8Array) {
	if (!['hq', 'branch'].includes(slot)) throw new HttpError(400, 'Choose the HQ or the branch upload');
	let sheets;
	try {
		sheets = readTally(data);
	} catch (e: any) {
		throw new HttpError(400, e.message);
	}
	const useful = sheets.filter((s) => s.rows.length);
	if (!useful.length) throw new HttpError(400, 'No stock rows found. Upload the Tally "Stock Summary" export with the Sl No, Code, Product Name and GodownName columns.');
	const scope = detectScope(useful);
	if (scope !== slot) throw new HttpError(400, scope === 'hq'
		? 'This looks like the head office file (Main, Retail and Semi-finished stock). Please upload it in the HQ slot.'
		: 'This looks like the branch file (one sheet per branch). Please upload it in the Branches slot.');
	const period = useful.find((s) => s.period)?.period;
	if (!period) throw new HttpError(400, 'The period line ("1-Oct-26 to 31-Oct-26") was not found at the top of the sheets, so the stock date is unknown.');
	const warnings: string[] = [];
	const mismatch = useful.filter((s) => s.period && (s.period.from !== period.from || s.period.to !== period.to)).map((s) => s.sheet);
	if (mismatch.length) warnings.push(`Sheets with a different period were included under ${period.from} to ${period.to}: ${mismatch.join(', ')}`);
	const settings = await inventorySettings(orgId);

	const rows: any[] = [];
	const sheetInfo: { sheet: string; location: string | null; rows: number }[] = [];
	let negative = 0;
	const foreign = new Map<string, number>();
	for (const s of useful) {
		const location = scope === 'hq' ? HQ_KEY : locationForSheet(s.sheet, s.rows.map((r) => r.godown));
		sheetInfo.push({ sheet: s.sheet, location, rows: s.rows.length });
		if (!location) { warnings.push(`Sheet "${s.sheet}" was skipped: it does not match any Gita Press branch`); continue; }
		if (scope === 'branch' && location === HQ_KEY) { warnings.push(`Sheet "${s.sheet}" looks like Gorakhpur stock; Gorakhpur stock comes from the HQ file, so it was skipped`); continue; }
		for (const r of s.rows) {
			// a godown of another branch (or of Gorakhpur) listed on this branch's sheet is not counted for any branch
			if (scope === 'branch') {
				const other = locationForSheet('', [r.godown]);
				if ((other && other !== location) || /^main stock/i.test(r.godown.trim())) { foreign.set(`${s.sheet}: ${r.godown.trim()}`, (foreign.get(`${s.sheet}: ${r.godown.trim()}`) || 0) + 1); continue; }
			}
			if (r.closing < 0) negative++;
			rows.push({ location, kind: godownKind(scope, s.sheet, r.godown, settings.nonSalesGodowns), ...r });
		}
	}
	if (!rows.length) throw new HttpError(400, `No sheet in this file matched a Gita Press location. ${warnings.join('. ')}`);
	if (negative) warnings.push(`${negative} rows have a negative closing stock in Tally; they count as zero`);
	if (foreign.size) warnings.push(`${[...foreign.values()].reduce((a, b) => a + b, 0)} rows were ignored because the godown belongs to another location: ${[...foreign.entries()].map(([k, n]) => `${k} (${n})`).join('; ')}`);
	const locations = [...new Set(rows.map((r) => r.location))];
	if (scope === 'branch') {
		const missing = DIRECTORY.filter((d) => !d.head_office && !d.no_stock && !locations.includes(d.key)).map((d) => d.city);
		if (missing.length) warnings.push(`No sheet for: ${missing.join(', ')}. Their last uploaded stock stays in use`);
	}

	// the same period uploaded again replaces the earlier figures for the same locations (so a branch file may be split in two).
	// Nothing is erased: the older upload keeps its rows and file; the replaced locations are only taken out of use.
	const replaced = await q<any>(
		`update stock_uploads set replaced_locations = array(select distinct x from unnest(replaced_locations || (select array_agg(y) from unnest(locations) y where y = any($5::text[]))) x),
		        locations = array(select x from unnest(locations) x where not (x = any($5::text[])))
		  where org_id=$1 and scope=$2 and period_from=$3 and period_to=$4 and deleted_at is null and locations && $5::text[] returning id, cardinality(locations) as left`,
		[orgId, scope, period.from, period.to, locations],
	);
	const emptied = replaced.filter((r) => r.left === 0).map((r) => r.id);
	if (emptied.length) await q(`update stock_uploads set deleted_at=now(), deleted_by=$2, deleted_reason='replaced' where id = any($1::bigint[])`, [emptied, userId]);
	const up = await one<any>(
		`insert into stock_uploads (org_id, scope, file_name, period_from, period_to, locations, sheets, row_count, warnings, uploaded_by)
		 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
		[orgId, scope, fileName.slice(0, 200), period.from, period.to, locations, JSON.stringify(sheetInfo), rows.length, warnings, userId],
	);
	// the original Excel file is kept, so it can always be downloaded again exactly as uploaded
	await q('insert into stock_files (upload_id, bytes) values ($1, $2)', [up.id, Buffer.from(data)]);
	const CHUNK = 4000;
	for (let i = 0; i < rows.length; i += CHUNK) {
		const part = rows.slice(i, i + CHUNK);
		const col = (f: (r: any) => unknown) => part.map(f);
		await q(
			`insert into stock_rows (upload_id, org_id, location, godown, godown_kind, code, name, language, batch, price, opening_qty, in_qty, out_qty, closing_qty, out_value, closing_value)
			 select $1, $2, * from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::numeric[], $11::numeric[], $12::numeric[], $13::numeric[], $14::numeric[], $15::numeric[], $16::numeric[])`,
			[up.id, orgId, col((r) => r.location), col((r) => r.godown.slice(0, 120)), col((r) => r.kind), col((r) => r.code.slice(0, 40)), col((r) => r.name.slice(0, 300)),
				col((r) => r.language.slice(0, 40)), col((r) => r.batch.slice(0, 80)), col((r) => r.price), col((r) => r.opening), col((r) => r.inward), col((r) => r.outward),
				col((r) => r.closing), col((r) => r.outValue), col((r) => r.closingValue)],
		);
	}
	// the catalogue: one name and language per code (most common), Hindi titles are kept
	const byCode = new Map<string, { names: Map<string, number>; langs: Map<string, number> }>();
	for (const r of rows) {
		const e = byCode.get(r.code) || { names: new Map(), langs: new Map() };
		const nm = displayName(r.name);
		if (nm) e.names.set(nm, (e.names.get(nm) || 0) + 1);
		if (r.language) e.langs.set(r.language, (e.langs.get(r.language) || 0) + 1);
		byCode.set(r.code, e);
	}
	const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
	const codes = [...byCode.keys()];
	await q(
		`insert into book_titles (org_id, code, name, language, status) select $1, x.*, 'needs_details' from unnest($2::text[], $3::text[], $4::text[]) x
		 on conflict (org_id, code) do update set name = case when book_titles.in_master and book_titles.name <> '' then book_titles.name when excluded.name <> '' then excluded.name else book_titles.name end,
		   language = case when book_titles.in_master and book_titles.language <> '' then book_titles.language when excluded.language <> '' then excluded.language else book_titles.language end`,
		[orgId, codes.map((c) => c.slice(0, 40)), codes.map((c) => top(byCode.get(c)!.names).slice(0, 300)), codes.map((c) => top(byCode.get(c)!.langs).slice(0, 40))],
	);
	cache.delete(orgId);
	return { upload: up, scope, period, locations, rows: rows.length, sheets: sheetInfo, warnings, replaced: replaced.length };
}

export async function listUploads(orgId: number) {
	return q<any>(
		`select u.id, u.scope, u.file_name, u.period_from, u.period_to, u.locations, u.replaced_locations, u.sheets, u.row_count, u.warnings, u.uploaded_at,
		        us.full_name as uploaded_by, u.deleted_at, u.deleted_reason, ud.full_name as deleted_by, exists (select 1 from stock_files f where f.upload_id=u.id) as has_file
		   from stock_uploads u left join users us on us.id=u.uploaded_by left join users ud on ud.id=u.deleted_by
		  where u.org_id=$1 order by u.deleted_at is not null, u.period_to desc, u.uploaded_at desc limit 1000`,
		[orgId],
	);
}

/** Removing an upload hides it from stock and sales; it can be restored. Only an admin can erase it for good. */
export async function deleteUpload(orgId: number, id: number, userId: number | null, permanent = false) {
	if (permanent) {
		const r = await q(`delete from stock_uploads where id=$1 and org_id=$2 and deleted_at is not null returning id`, [id, orgId]);
		if (!r.length) throw new HttpError(400, 'Only a removed upload can be erased permanently. Remove it first.');
	} else {
		const r = await q(`update stock_uploads set deleted_at=now(), deleted_by=$3, deleted_reason='removed' where id=$1 and org_id=$2 and deleted_at is null returning id`, [id, orgId, userId]);
		if (!r.length) throw new HttpError(404, 'Upload not found');
	}
	await forgetAll(orgId);
	return { success: true };
}

export async function restoreUpload(orgId: number, id: number) {
	const u = await one<any>('select * from stock_uploads where id=$1 and org_id=$2', [id, orgId]);
	if (!u || !u.deleted_at) throw new HttpError(404, 'Removed upload not found');
	if (u.deleted_reason === 'replaced') throw new HttpError(400, 'This upload was replaced by a newer upload for the same period. Remove the newer one first, then upload this file again (download it here).');
	const clash = await one<any>(
		`select id from stock_uploads where org_id=$1 and scope=$2 and period_from=$3 and period_to=$4 and deleted_at is null and locations && $5::text[] and id<>$6`,
		[orgId, u.scope, u.period_from, u.period_to, u.locations, id],
	);
	if (clash) throw new HttpError(400, 'Another upload for the same period and locations is in use. Remove it first.');
	await q('update stock_uploads set deleted_at=null, deleted_by=null, deleted_reason=null where id=$1', [id]);
	await forgetAll(orgId);
	return { success: true };
}

export async function uploadFile(orgId: number, id: number) {
	return one<any>('select u.file_name, f.bytes, f.content_type from stock_uploads u join stock_files f on f.upload_id=u.id where u.id=$1 and u.org_id=$2', [id, orgId]);
}

async function forgetAll(orgId: number) {
	cache.delete(orgId);
	await import('./inventory').then((m) => m.forgetFacts(orgId));
}

// ── current stock ──────────────────────────────────────────────────────────

export interface LocStock {
	/** available to readers: HQ main + retail; branch: every godown */
	qty: number;
	/** HQ only: printed but not yet bound (staff only) */
	semi: number;
	/** highest batch price at this location: in-stock batches first, else any batch */
	price: number | null;
	byKind: Record<string, number>;
}
export interface Book {
	code: string;
	name: string;
	language: string;
	hindi: string | null;
	aliases: string[];
	locs: Map<string, LocStock>;
}
interface Current {
	at: number;
	books: Map<string, Book>;
	asOf: Record<string, string>;
	uploadFor: Record<string, number>;
	index: Indexed[];
}
const cache = new Map<number, Current>();

/** The latest upload for each location (by period end, then upload time). */
export async function latestUploads(orgId: number): Promise<Record<string, { id: number; to: string }>> {
	const ups = await q<any>('select id, locations, period_to::text as period_to from stock_uploads where org_id=$1 and deleted_at is null order by period_to desc, uploaded_at desc', [orgId]);
	const out: Record<string, { id: number; to: string }> = {};
	for (const u of ups) for (const l of u.locations) if (!out[l]) out[l] = { id: u.id, to: u.period_to };
	return out;
}

export async function currentStock(orgId: number): Promise<Current> {
	const c = cache.get(orgId);
	if (c && Date.now() - c.at < 120_000) return c;
	const latest = await latestUploads(orgId);
	const locs = Object.keys(latest);
	const rows = locs.length
		? await q<any>(
			`select r.location, r.godown_kind as kind, r.code, r.price::float as price, sum(greatest(r.closing_qty, 0))::float as qty
			   from stock_rows r join unnest($2::bigint[], $3::text[]) as l(upload_id, location) on l.upload_id=r.upload_id and l.location=r.location
			  where r.org_id=$1 group by 1,2,3,4`,
			[orgId, locs.map((l) => latest[l].id), locs],
		)
		: [];
	const titles = await q<any>('select code, name, language, hindi_title, aliases from book_titles where org_id=$1', [orgId]);
	const books = new Map<string, Book>();
	for (const t of titles) books.set(t.code, { code: t.code, name: t.name, language: t.language, hindi: t.hindi_title, aliases: t.aliases || [], locs: new Map() });
	const best = new Map<string, { inStock: number | null; any: number | null }>();
	for (const r of rows) {
		const b = books.get(r.code) || { code: r.code, name: r.code, language: '', hindi: null, aliases: [], locs: new Map() };
		books.set(r.code, b);
		const l = b.locs.get(r.location) || { qty: 0, semi: 0, price: null, byKind: {} };
		b.locs.set(r.location, l);
		l.byKind[r.kind] = (l.byKind[r.kind] || 0) + r.qty;
		if (r.kind === 'semi') { l.semi += r.qty; continue; }
		l.qty += r.qty;
		const k = `${r.code}|${r.location}`;
		const p = best.get(k) || { inStock: null, any: null };
		if (r.price !== null && r.price !== undefined) {
			p.any = Math.max(p.any ?? 0, r.price);
			if (r.qty > 0) p.inStock = Math.max(p.inStock ?? 0, r.price);
		}
		best.set(k, p);
	}
	for (const b of books.values()) for (const [loc, l] of b.locs) { const p = best.get(`${b.code}|${loc}`); l.price = p?.inStock ?? p?.any ?? null; }
	const cur: Current = {
		at: Date.now(),
		books,
		asOf: Object.fromEntries(locs.map((l) => [l, latest[l].to])),
		uploadFor: Object.fromEntries(locs.map((l) => [l, latest[l].id])),
		index: [...books.values()].map(indexBook),
	};
	cache.set(orgId, cur);
	return cur;
}
export const forgetStock = (orgId: number) => cache.delete(orgId);

// ── matching book names (Latin or Devanagari) ─────────────────────────────

const DEV: Record<string, string> = {
	'क': 'k', 'ख': 'k', 'ग': 'g', 'घ': 'g', 'ङ': 'n', 'च': 'c', 'छ': 'c', 'ज': 'j', 'झ': 'j', 'ञ': 'n', 'ट': 't', 'ठ': 't', 'ड': 'd', 'ढ': 'd', 'ण': 'n',
	'त': 't', 'थ': 't', 'द': 'd', 'ध': 'd', 'न': 'n', 'प': 'p', 'फ': 'p', 'ब': 'b', 'भ': 'b', 'म': 'm', 'य': '', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 's', 'ष': 's',
	'स': 's', 'ह': '', 'ळ': 'l', 'ं': 'n', 'ँ': 'n', 'ृ': 'r', 'ऋ': 'r', 'क़': 'k', 'ख़': 'k', 'ग़': 'g', 'ज़': 'j', 'ड़': 'd', 'ढ़': 'd', 'फ़': 'p', 'य़': '',
};
/** Consonant key of a word, the same for "Ramcharitmanas", "Ramacharitamanasa" and "रामचरितमानस". */
export function skeleton(word: string): string {
	let s = word.normalize('NFC').toLowerCase();
	if (/[ऀ-ॿ]/.test(s)) s = [...s].map((ch) => DEV[ch] ?? (/[a-z]/.test(ch) ? ch : '')).join('');
	else s = s.replace(/gy/g, 'jn').replace(/ph/g, 'p').replace(/x/g, 'ks').replace(/ck/g, 'k').replace(/[wz qf]/g, (c) => ({ w: 'v', z: 'j', q: 'k', f: 'p', ' ': '' })[c] || '')
		.replace(/[^a-z]/g, '').replace(/[aeiouyh]/g, '');
	return s.replace(/m(?=[bp])/g, 'n').replace(/(.)\1+/g, '$1');
}
const WORD = /[\p{L}\p{M}]+/gu;
const STOP = new Set(['shri', 'shree', 'sri', 'shrimad', 'srimad', 'the', 'of', 'and', 'set', 'part', 'vol', 'volume', 'edition', 'size', 'pocket', 'gutka', 'mota', 'type', 'big', 'small',
	'deluxe', 'delux', 'special', 'hindi', 'english', 'sanskrit', 'gujarati', 'marathi', 'bangla', 'bengali', 'telugu', 'tamil', 'kannada', 'oriya', 'odia', 'nepali', 'assamiya', 'book', 'books', 'pustak', 'with', 'in', 'only', 'no']);
const DEV_STOP = new Set(['श्री', 'श्रीमद्', 'की', 'का', 'के', 'और', 'भाग', 'खण्ड', 'सहित']);

/** One key for a title however it is spelt or scripted, without filler words: used to group the editions of one work. */
export function titleKey(title: string): string {
	const words = (title.replace(/\(\s*\d+\s*\)|\b\d+\b/g, ' ').match(WORD) || []).filter((w) => !STOP.has(w.toLowerCase()) && !DEV_STOP.has(w));
	return words.map(skeleton).join('');
}

interface Indexed { code: string; lists: { skel: string[]; core: boolean[] }[] }
function indexBook(b: Book): Indexed {
	const lists = [b.name, b.hindi || '', ...b.aliases].filter(Boolean).map((t) => {
		const words = (t.replace(/\(\s*\d+\s*\)|\b\d+\b/g, ' ').match(WORD) || []);
		return { skel: words.map(skeleton), core: words.map((w) => !STOP.has(w.toLowerCase()) && !DEV_STOP.has(w) && skeleton(w).length > 0) };
	}).filter((l) => l.skel.some(Boolean));
	return { code: b.code, lists };
}

const LANGS = ['hindi', 'english', 'sanskrit', 'gujarati', 'marathi', 'bangla', 'bengali', 'telugu', 'tamil', 'kannada', 'oriya', 'odia', 'nepali', 'assamiya', 'assamese', 'malayalam', 'punjabi', 'urdu'];
const LANG_NORM: Record<string, string> = { bengali: 'bangla', odia: 'oriya', assamese: 'assamiya', malayalam: 'malyalam' };

/** Codes the reader quotes: "code 26", "book no. 1388", "कोड 1362", "पुस्तक संख्या 6". */
export function citedCodes(text: string): string[] {
	return [...text.matchAll(/(?:code|cod|book\s*no\.?|no\.|number|item|#|कोड|क्रमांक|पुस्तक\s*संख्या|पुस्तक\s*सं\.?)\s*[:#-]?\s*(\d{1,5}(?:\s*(?:,|and|&|और)\s*\d{1,5})*)/gi)]
		.flatMap((m) => m[1].split(/\s*(?:,|and|&|और)\s*/)).map((x) => x.trim().replace(/^0+/, '')).filter(Boolean);
}

export interface Match { code: string; score: number; certain: boolean }
export function matchBooks(cur: Current, text: string, max = 6): Match[] {
	const words = (text.slice(0, 20000).match(WORD) || []).slice(0, 3000);
	const sk = words.map(skeleton);
	const windows = new Set<string>();
	for (let i = 0; i < sk.length; i++) {
		let s = '';
		for (let j = i; j < Math.min(sk.length, i + 8); j++) { s += sk[j]; if (s.length >= 4) windows.add(s); }
	}
	const cited = new Set(citedCodes(text));
	const lower = text.toLowerCase();
	const asked = LANGS.filter((l) => new RegExp(`\\b${l}\\b`).test(lower)).map((l) => LANG_NORM[l] || l);
	const out: Match[] = [];
	for (const it of cur.index) {
		let score = cited.has(it.code.replace(/^0+/, '')) ? 20 : 0;
		for (const l of it.lists) {
			const coreTotal = l.core.filter(Boolean).length || l.skel.length;
			let best = 0;
			for (let i = 0; i < l.skel.length; i++) {
				let s = '';
				for (let j = i; j < l.skel.length; j++) {
					s += l.skel[j];
					const n = j - i + 1;
					if (s.length < 5 || (n === 1 && s.length < 6)) continue;
					if (!windows.has(s)) continue;
					const core = l.core.slice(i, j + 1).filter(Boolean).length || n;
					best = Math.max(best, Math.min(1, core / coreTotal));
				}
			}
			if (best >= 0.5) score = Math.max(score, Math.round(12 * best));
		}
		if (!score) continue;
		const lang = (cur.books.get(it.code)?.language || '').toLowerCase();
		const certain = score >= 12;
		// the language asked for; otherwise Hindi first (and English for an English letter)
		if (lang && asked.length) score += asked.includes(lang) ? 2 : -3;
		else if (lang) score += lang === 'hindi' ? 2 : lang === 'english' && !/[\u0900-\u097F]/.test(text) ? 1 : lang === 'sanskrit' ? 0 : -2;
		if (score >= 6) out.push({ code: it.code, score, certain });
	}
	const hq = (c: string) => cur.books.get(c)?.locs.get(HQ_KEY)?.qty || 0;
	const sorted = out.sort((a, b) => b.score - a.score || hq(b.code) - hq(a.code));
	// keep the close candidates only (other languages and editions drop out when a better match exists)
	return sorted.filter((m) => m.score >= (sorted[0]?.score ?? 0) - 3).slice(0, max);
}

// ── stock and addresses for one email ──────────────────────────────────────

export interface BookStock {
	code: string;
	name: string;
	language: string;
	hindi: string | null;
	certain: boolean;
	/** the reader quoted this book's code */
	cited: boolean;
	hq: { qty: number; price: number | null; semi: number } | null;
	nearest: { key: string; label: string; qty: number; price: number | null } | null;
	/** every location with stock (staff view) */
	all: { key: string; label: string; qty: number; price: number | null; asOf: string }[];
}

const inr = (n: number | null) => (n === null || n === undefined ? 'price not in Tally' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const qtyText = (n: number) => `${Math.round(n).toLocaleString('en-IN')} ${Math.round(n) === 1 ? 'copy' : 'copies'}`;
const fmtDay = (d?: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'unknown date');

export async function stockContext(orgId: number, text: string, place: Place) {
	const cur = await currentStock(orgId);
	const abroad = isAbroad(place);
	const near = abroad ? null : nearestBranch({ ...place, text });
	const nearKey = near && near.key !== HQ_KEY && !BY_KEY.get(near.key)?.no_stock ? near.key : null;
	const matches = cur.books.size ? matchBooks(cur, text) : [];
	const books: BookStock[] = matches.map((m) => {
		const b = cur.books.get(m.code)!;
		const h = b.locs.get(HQ_KEY);
		const n = nearKey ? b.locs.get(nearKey) : undefined;
		return {
			code: b.code, name: b.name, language: b.language, hindi: b.hindi, certain: m.certain, cited: m.score >= 20,
			hq: cur.asOf[HQ_KEY] ? { qty: h?.qty || 0, price: h?.price ?? null, semi: h?.semi || 0 } : null,
			nearest: nearKey && cur.asOf[nearKey] ? { key: nearKey, label: locationLabel(nearKey), qty: n?.qty || 0, price: n?.price ?? null } : null,
			all: [...b.locs.entries()].filter(([, l]) => l.qty > 0).map(([k, l]) => ({ key: k, label: locationLabel(k), qty: l.qty, price: l.price, asOf: cur.asOf[k] }))
				.sort((a, z) => (a.key === HQ_KEY ? -1 : z.key === HQ_KEY ? 1 : z.qty - a.qty)),
		};
	});

	const lines: string[] = [];
	if (books.length) {
		const dates = [cur.asOf[HQ_KEY] && `Gorakhpur as of ${fmtDay(cur.asOf[HQ_KEY])}`, nearKey && cur.asOf[nearKey] && `${locationLabel(nearKey)} branch as of ${fmtDay(cur.asOf[nearKey])}`].filter(Boolean).join('; ');
		lines.push(`Stock from the Tally stock summary (${dates}). Quote these exact quantities and prices and no other figures. Prices are the highest batch price at that location. If you are not sure which of these books the reader means, name the likely ones with their codes and ask the reader to confirm.`);
		for (const b of books) {
			const parts = [b.hq ? `Gorakhpur ${b.hq.qty > 0 ? `${qtyText(b.hq.qty)} at ${inr(b.hq.price)}` : 'out of stock'}` : 'Gorakhpur stock not uploaded'];
			if (b.nearest) parts.push(`${b.nearest.label} branch (nearest to the reader: ${near!.why}) ${b.nearest.qty > 0 ? `${qtyText(b.nearest.qty)} at ${inr(b.nearest.price)}` : 'out of stock'}`);
			lines.push(`- Code ${b.code}, ${b.name}${b.language ? ` (${b.language})` : ''}${b.hindi ? ` / ${b.hindi}` : ''}${b.certain ? '' : ' [possible match]'}: ${parts.join('; ')}`);
		}
		lines.push(abroad ? `The reader is outside India: ${POST_NOTE}` : POST_NOTE);
	}

	// addresses: the place the reader named, else the full list, when they ask; otherwise the nearest shop
	const wantsAddress = ADDRESS_INTENT.test(text);
	const named = wantsAddress ? placeInText(text.replace(/gita press,? gorakhpur|gitapress|गीताप्रेस,? गोरखपुर/gi, ' ')) : null;
	let addressKeys: string[] = [];
	let fullList = false;
	if (wantsAddress && named) addressKeys = [named, HQ_KEY];
	else if (wantsAddress && near) addressKeys = [near.key, HQ_KEY];
	else if (wantsAddress) { fullList = true; addressKeys = DIRECTORY.map((d) => d.key); }
	else if (books.length && nearKey) addressKeys = [nearKey];
	addressKeys = [...new Set(addressKeys)];
	const dir = new Map(resolveDirectory((await getOrg(orgId)).settings).map((d) => [d.key, d]));
	const entries = addressKeys.map((k) => dir.get(k)!).filter(Boolean);
	const addrLines = entries.length
		? [
			wantsAddress
				? fullList
					? 'The reader asks for Gita Press addresses without naming a place: give the full list below (Hindi lines for a Hindi reply).'
					: 'The reader asks for an address: give the one(s) below (Hindi lines for a Hindi reply).'
				: 'Address of the branch nearest the reader, if you suggest buying there:',
			'The Hindi address is the official one. If the English line ever differs from it, follow the Hindi.',
			...entries.map((d) => `- ${entryText(d, true)}\n  ${entryText(d)}${d.needs_english_check ? ' (English being checked: write the address from the Hindi line)' : ''}`),
			...(wantsAddress ? [POST_NOTE] : []),
		]
		: [];

	return {
		books, nearest: near, nearKey, abroad, asOf: cur.asOf, wantsAddress, addresses: entries, fullList,
		prompt: [...lines, ...(addrLines.length ? ['', ...addrLines] : [])].join('\n'),
	};
}

/** Plain text for a rules-engine draft (no AI): stock and/or addresses, in English or Hindi. */
export function draftAddition(ctx: Awaited<ReturnType<typeof stockContext>>, hindi: boolean): string {
	const out: string[] = [];
	if (ctx.books.length) {
		out.push(hindi ? 'हमारे स्टॉक में:' : 'Current stock:');
		for (const b of ctx.books.filter((x) => x.certain).slice(0, 4)) {
			const p = [b.hq ? (b.hq.qty > 0 ? (hindi ? `गोरखपुर: ${Math.round(b.hq.qty)} प्रतियाँ, ${inr(b.hq.price)}` : `Gorakhpur: ${qtyText(b.hq.qty)} at ${inr(b.hq.price)}`) : hindi ? 'गोरखपुर: अभी उपलब्ध नहीं' : 'Gorakhpur: currently out of stock') : ''];
			if (b.nearest) p.push(b.nearest.qty > 0 ? (hindi ? `${BY_KEY.get(b.nearest.key)?.city_hi} शाखा: ${Math.round(b.nearest.qty)} प्रतियाँ, ${inr(b.nearest.price)}` : `${b.nearest.label} branch: ${qtyText(b.nearest.qty)} at ${inr(b.nearest.price)}`) : (hindi ? `${BY_KEY.get(b.nearest.key)?.city_hi} शाखा: अभी उपलब्ध नहीं` : `${b.nearest.label} branch: currently out of stock`));
			out.push(`- ${hindi && b.hindi ? b.hindi : b.name} (${hindi ? 'कोड' : 'code'} ${b.code}): ${p.filter(Boolean).join('; ')}`);
		}
		if (out.length === 1) out.pop();
	}
	if (ctx.wantsAddress && ctx.addresses.length) {
		out.push('', hindi ? 'गीताप्रेसका पता:' : 'Gita Press addresses:', ...ctx.addresses.map((d) => `- ${entryText(d, hindi)}`), hindi ? POST_NOTE_HI : POST_NOTE);
	}
	return out.join('\n').trim();
}

/** Remember which books a reader asked for, and whether they were in stock (unmet demand, back-in-stock). */
export async function recordRequests(orgId: number, conversationId: number, customerId: number | null, ctx: Awaited<ReturnType<typeof stockContext>>) {
	// a quoted code, or a name that points to one book (several editions with the same name are not counted)
	const sameName = (b: BookStock) => ctx.books.filter((x) => x.certain && x.name.toLowerCase() === b.name.toLowerCase()).length;
	for (const b of ctx.books.filter((x) => x.cited || (x.certain && sameName(x) === 1))) {
		await q(
			`insert into book_requests (org_id, conversation_id, customer_id, code, nearest, hq_qty, near_qty) values ($1,$2,$3,$4,$5,$6,$7)
			 on conflict (conversation_id, code) do update set customer_id=excluded.customer_id, nearest=excluded.nearest`,
			[orgId, conversationId, customerId, b.code, b.nearest?.key || null, b.hq?.qty ?? null, b.nearest?.qty ?? null],
		).catch(() => {});
	}
}

// ── Hindi title list ───────────────────────────────────────────────────────

export async function importTitles(orgId: number, fileName: string, data: Uint8Array) {
	let sheets;
	try {
		sheets = readTable(data, fileName);
	} catch (e: any) {
		throw new HttpError(400, e.message);
	}
	let updated = 0;
	let added = 0;
	let skipped = 0;
	for (const sh of sheets) {
		const hi = sh.rows.slice(0, 15).findIndex((r) => r.some((c) => /^(book\s*)?code$|^कोड$|^क्रमांक$/i.test(String(c).trim())));
		if (hi < 0) continue;
		const header = sh.rows[hi].map((c) => String(c).trim().toLowerCase());
		const codeCol = header.findIndex((h) => /^(book\s*)?code$|^कोड$|^क्रमांक$/.test(h));
		const data = sh.rows.slice(hi + 1);
		const dev = (i: number) => data.slice(0, 200).filter((r) => /[ऀ-ॿ]/.test(String(r[i] ?? ''))).length;
		const candidates = header.map((h, i) => ({ i, h, dev: dev(i) })).filter((x) => x.i !== codeCol && !/alias|other|keyword/.test(x.h));
		const hindiCol = candidates.filter((x) => /hindi|हिन्दी|हिंदी|devanagari|नाम|शीर्षक/.test(x.h) && x.dev).sort((a, b) => b.dev - a.dev)[0]?.i ?? candidates.sort((a, b) => b.dev - a.dev)[0]?.i;
		if (hindiCol === undefined || !dev(hindiCol)) throw new HttpError(400, 'No column with Hindi (Devanagari) titles was found. Use the template: Code, English name, Hindi title, Other names.');
		const aliasCol = header.findIndex((h) => /alias|other names|keyword/.test(h));
		const nameCol = header.findIndex((h, i) => i !== hindiCol && /english|name|title/.test(h) && !dev(i));
		for (const r of data) {
			const code = String(r[codeCol] ?? '').trim().replace(/\.0+$/, '');
			const hindi = String(r[hindiCol] ?? '').trim();
			if (!code || !hindi) { if (code || hindi) skipped++; continue; }
			const aliases = aliasCol >= 0 ? String(r[aliasCol] ?? '').split(/[;|,]/).map((x) => x.trim()).filter(Boolean).slice(0, 10) : [];
			const name = nameCol >= 0 ? String(r[nameCol] ?? '').trim() : '';
			const res = await one<any>(
				`insert into book_titles (org_id, code, name, hindi_title, aliases) values ($1,$2,$3,$4,$5)
				 on conflict (org_id, code) do update set hindi_title=excluded.hindi_title,
				   aliases = case when array_length(excluded.aliases,1) > 0 then excluded.aliases else book_titles.aliases end,
				   name = case when book_titles.name = '' then excluded.name else book_titles.name end, updated_at=now()
				 returning (xmax = 0) as inserted`,
				[orgId, code.slice(0, 40), name.slice(0, 300), hindi.slice(0, 300), aliases],
			);
			if (res?.inserted) added++;
			else updated++;
		}
	}
	if (!added && !updated) throw new HttpError(400, `No titles were read${skipped ? ` (${skipped} rows had a code or a title missing)` : ''}. The file needs a Code column and a Hindi title column.`);
	cache.delete(orgId);
	return { updated, added, skipped };
}

/** Template pre-filled with every code and English name, for the team to add Hindi titles. */
export async function titlesTemplate(orgId: number): Promise<Uint8Array> {
	const rows = await q<any>(`select code, name, language, coalesce(hindi_title,'') as hindi, array_to_string(aliases, '; ') as aliases from book_titles where org_id=$1
		order by case when code ~ '^\\d+$' then lpad(code, 8, '0') else code end`, [orgId]);
	return writeXlsx([{ name: 'Hindi titles', header: ['Code', 'English name', 'Language', 'Hindi title', 'Other names (separate with ;)'], rows: rows.map((r) => [r.code, r.name, r.language, r.hindi, r.aliases]) }]);
}

export async function titlesSummary(orgId: number) {
	return one<any>(`select count(*)::int as codes, count(hindi_title)::int as with_hindi, max(updated_at) filter (where hindi_title is not null) as hindi_updated from book_titles where org_id=$1`, [orgId]);
}

// ── staff view for a thread ───────────────────────────────────────────────

export async function stockForConversation(orgId: number, conversationId: number) {
	const conv = await one<any>('select c.id, c.customer_id, cu.profile, cu.profile_manual from conversations c left join customers cu on cu.id=c.customer_id where c.id=$1 and c.org_id=$2', [conversationId, orgId]);
	if (!conv) throw new HttpError(404, 'Conversation not found');
	const emails = await q<any>(`select subject, coalesce(body_clean, body_text, '') as body from emails where conversation_id=$1 and direction='inbound' and not is_duplicate order by sent_at desc limit 8`, [conversationId]);
	const p = { ...(conv.profile || {}), ...(conv.profile_manual || {}) };
	const text = emails.map((e) => `${e.subject || ''}\n${e.body}`).join('\n');
	const ctx = await stockContext(orgId, text, { city: p.city, state: p.state, pin: p.pin, address: p.address, country: p.country });
	const cur = await currentStock(orgId);
	const books = ctx.books.map((b) => ({ ...b, semi: b.hq?.semi || 0 }));
	return { books, nearest: ctx.nearest ? { ...ctx.nearest, label: locationLabel(ctx.nearest.key) } : null, abroad: ctx.abroad, asOf: cur.asOf, addresses: ctx.wantsAddress ? ctx.addresses : [], hasStock: Object.keys(cur.asOf).length > 0 };
}
