/**
 * The book master (Settings → Master data → Books). One row per book code; the code is the key for everything:
 * stock, sales, links, recommendations and the books readers ask about. It replaces the old Hindi-titles upload.
 *
 * The list comes from the file Gita Press keeps (Code, English name, Language, Hindi title, Other names,
 * gitapress.org link, Amazon link) and can be edited row by row. A code that first appears in a Tally stock file
 * is added automatically and marked "Needs details".
 */
import { one, q, tx } from '../db';
import { HttpError } from '../http';
import { readTable, writeXlsx } from '../xlsx';
import { forgetStock, titleKey } from '../stock/stock';
import { blank, clean, getMappings, headKey } from '../uploads/common';

export const BOOK_COLUMNS = ['Code', 'English name', 'Language', 'Hindi title', 'Other names (separate with ;)', 'gitapress.org Website Link', 'Amazon Website Link'];
export const BOOK_EXTRA_COLUMNS = ['Title family', 'Category', 'Price (MRP)', 'Print lead time (days)', 'Cover days', 'Minimum print run', 'Status'];
export const STATUS_LABEL: Record<string, string> = { active: 'Active', needs_details: 'Needs details', removed: 'Removed' };
export const FLAG_LABEL: Record<string, string> = {
	no_hindi_title: 'No Hindi title', no_gitapress_link: 'No gitapress.org link', no_amazon_link: 'No Amazon link', bad_gitapress_link: 'gitapress.org link looks wrong',
	bad_amazon_link: 'Amazon link looks wrong', shared_link: 'Link shared with another code', odd_other_names: 'Other names look wrong',
};

/** Codes are text: 1, "1", "1.0" and "001" are the same book; letters are kept ("CB035"). */
export function normCode(v: unknown): string {
	const s = clean(v, 40).replace(/\.0+$/, '');
	return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s.toUpperCase();
}

/** Hindi titles in the list carry the code ("गीता-तत्त्व-विवेचनी - ( 1 )", "श्री नारायणीयम्-639"): shown and matched without it. */
export function stripCode(title: string, code: string): string {
	const c = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return title.replace(new RegExp(`\\s*[-–—]?\\s*\\(\\s*0*${c}\\s*\\)\\s*$`, 'i'), '').replace(new RegExp(`\\s*[-–—]\\s*0*${c}\\s*$`, 'i'), '').replace(/\s{2,}/g, ' ').trim() || title.trim();
}

const url = (v: unknown) => {
	const s = clean(v, 500);
	if (blank(s)) return '';
	return /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+\//.test(s) ? `https://${s}` : s;
};
const host = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const okGita = (u: string) => /^(www\.)?gitapress\.org$/.test(host(u));
const okAmazon = (u: string) => /^(www\.)?amazon\.(in|com)$/.test(host(u)) || /^(amzn\.in|amzn\.to|a\.co)$/.test(host(u));

export interface BookRow {
	code: string; name: string; language: string; hindi: string; hindi_raw: string; aliases: string[]; gitapress_url: string; amazon_url: string;
	family?: string; category?: string; mrp?: number | null; lead_days?: number | null; cover_days?: number | null; min_print?: number | null; status?: string;
}

export function bookFlags(b: { hindi?: string | null; gitapress_url?: string | null; amazon_url?: string | null; aliases?: string[] }): string[] {
	const f: string[] = [];
	if (!b.hindi) f.push('no_hindi_title');
	if (!b.gitapress_url) f.push('no_gitapress_link');
	else if (!okGita(b.gitapress_url)) f.push('bad_gitapress_link');
	if (!b.amazon_url) f.push('no_amazon_link');
	else if (!okAmazon(b.amazon_url)) f.push('bad_amazon_link');
	if ((b.aliases || []).some((a) => a.length < 2)) f.push('odd_other_names');
	return f;
}

const numOrNull = (v: unknown, lo: number, hi: number) => {
	const s = clean(v, 30).replace(/[₹,]/g, '');
	if (blank(s) && s !== '0') return null;
	const n = Number(s);
	return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

/** Reads the book list file. Refuses a file without the Code and English name columns, with a plain message. */
export async function parseBookFile(orgId: number, fileName: string, data: Uint8Array): Promise<{ rows: BookRow[]; problems: string[]; extra: string[] }> {
	let sheets;
	try { sheets = readTable(data, fileName); } catch (e: any) { throw new HttpError(400, e.message); }
	const m = await getMappings(orgId);
	const rows = new Map<string, BookRow>();
	const problems: string[] = [];
	let found = false;
	let extra: string[] = [];
	for (const sh of sheets) {
		const hi = sh.rows.slice(0, 15).findIndex((r) => r.some((c) => /^(book)?code$/.test(headKey(c))));
		if (hi < 0) continue;
		const head = sh.rows[hi].map(headKey);
		const col = (...re: RegExp[]) => { for (const x of re) { const i = head.findIndex((h) => x.test(h)); if (i >= 0) return i; } return -1; };
		const ix = {
			code: col(/^(book)?code$/), name: col(/^englishname$/, /^name$/, /^title$/, /^englishtitle$/), language: col(/^language$/, /^category$/), hindi: col(/^hindititle$/, /^hindi/),
			aliases: col(/^othernames/, /^alias/), gita: col(/gitapress/), amazon: col(/amazon/), family: col(/^titlefamily$/, /^family$/), category: col(/^bookcategory$/, /^category$/),
			mrp: col(/^pricemrp$/, /^mrp$/, /^price$/), lead: col(/leadtime/), cover: col(/^coverdays$/), minPrint: col(/minimumprint/), status: col(/^status$/),
		};
		if (ix.category === ix.language) ix.category = -1;
		if (ix.name < 0) throw new HttpError(400, `The "English name" column was not found on sheet "${sh.name}". The file needs these columns: ${BOOK_COLUMNS.join(', ')}.`);
		found = true;
		extra = Object.entries(ix).filter(([k, v]) => v >= 0 && ['family', 'category', 'mrp', 'lead', 'cover', 'minPrint', 'status'].includes(k)).map(([k]) => k);
		const missing = [['Language', ix.language], ['Hindi title', ix.hindi], ['gitapress.org Website Link', ix.gita], ['Amazon Website Link', ix.amazon]].filter(([, i]) => (i as number) < 0).map(([n]) => n);
		if (missing.length) problems.push(`Columns not in the file, so left as they are: ${missing.join(', ')}`);
		sh.rows.slice(hi + 1).forEach((r, i) => {
			const code = normCode(r[ix.code]);
			const name = clean(r[ix.name]);
			if (!code && !name) return;
			if (!code) { problems.push(`Row ${hi + i + 2}: no code, skipped (${name.slice(0, 40)})`); return; }
			if (rows.has(code)) problems.push(`Code ${code} appears more than once; the rows were combined (a blank cell never replaces a filled one)`);
			const hindiRaw = ix.hindi >= 0 && !blank(r[ix.hindi]) ? clean(r[ix.hindi]) : '';
			const lang = ix.language >= 0 ? clean(r[ix.language], 40) : '';
			const st = ix.status >= 0 ? clean(r[ix.status], 30).toLowerCase().replace(/\s+/g, '_') : '';
			const prev = rows.get(code);
			const next: BookRow = {
				code, name, language: m.languages[lang.toLowerCase()] || lang, hindi_raw: hindiRaw, hindi: hindiRaw ? stripCode(hindiRaw, code) : '',
				aliases: ix.aliases >= 0 && !blank(r[ix.aliases]) ? [...new Set(String(r[ix.aliases]).split(/[;|]/).map((x) => clean(x, 120)).filter(Boolean))].slice(0, 12) : [],
				gitapress_url: ix.gita >= 0 ? url(r[ix.gita]) : '', amazon_url: ix.amazon >= 0 ? url(r[ix.amazon]) : '',
				family: ix.family >= 0 ? clean(r[ix.family], 200) : undefined, category: ix.category >= 0 ? clean(r[ix.category], 80) : undefined,
				mrp: ix.mrp >= 0 ? numOrNull(r[ix.mrp], 0, 1e6) : undefined, lead_days: ix.lead >= 0 ? numOrNull(r[ix.lead], 1, 720) : undefined,
				cover_days: ix.cover >= 0 ? numOrNull(r[ix.cover], 1, 720) : undefined, min_print: ix.minPrint >= 0 ? numOrNull(r[ix.minPrint], 0, 1e7) : undefined,
				status: ['active', 'needs_details', 'removed'].includes(st) ? st : undefined,
			};
			if (prev) for (const [k, v] of Object.entries(prev)) if ((next as any)[k] === '' || (next as any)[k] === undefined || (Array.isArray((next as any)[k]) && !(next as any)[k].length)) (next as any)[k] = v;
			rows.set(code, next);
		});
	}
	if (!found) throw new HttpError(400, `No "Code" column was found. The file needs these columns: ${BOOK_COLUMNS.join(', ')}.`);
	if (!rows.size) throw new HttpError(400, 'No books were read from the file.');
	return { rows: [...rows.values()], problems: [...new Set(problems)].slice(0, 60), extra };
}

const SAME = (a: any, b: any) => (Array.isArray(a) ? a.join('|') === (b || []).join('|') : (a ?? '') === (b ?? ''));

/** What applying the file would change, shown before anything is saved. */
export async function previewBooks(orgId: number, rows: BookRow[]) {
	const cur = new Map((await q<any>('select * from book_titles where org_id=$1', [orgId])).map((r) => [r.code, r]));
	const tally = new Set((await q<any>('select distinct code from stock_rows where org_id=$1', [orgId])).map((r) => r.code));
	const fresh: BookRow[] = [];
	const changed: { code: string; name: string; fields: string[] }[] = [];
	let unchanged = 0;
	for (const r of rows) {
		const c = cur.get(r.code);
		if (!c) { fresh.push(r); continue; }
		const fields = [
			!SAME(r.name, c.name) && r.name && 'English name', !SAME(r.language, c.language) && r.language && 'Language', !SAME(r.hindi, c.hindi_title) && 'Hindi title',
			!SAME(r.aliases, c.aliases) && 'Other names', !SAME(r.gitapress_url, c.gitapress_url) && 'gitapress.org link', !SAME(r.amazon_url, c.amazon_url) && 'Amazon link',
			r.family !== undefined && !SAME(r.family, c.family) && 'Title family', r.category !== undefined && !SAME(r.category, c.category) && 'Category',
			r.mrp !== undefined && !SAME(r.mrp, c.mrp) && 'Price', r.status !== undefined && !SAME(r.status, c.status) && 'Status', !c.in_master && 'Added to the book list',
		].filter(Boolean) as string[];
		if (fields.length) changed.push({ code: r.code, name: r.name || c.name, fields });
		else unchanged++;
	}
	const inFile = new Set(rows.map((r) => r.code));
	const notInTally = tally.size ? rows.filter((r) => !tally.has(r.code)).map((r) => r.code) : [];
	const notInFile = [...tally].filter((c) => !inFile.has(c));
	const links = new Map<string, string[]>();
	for (const r of rows) for (const u of [r.gitapress_url, r.amazon_url]) if (u) links.set(u, [...(links.get(u) || []), r.code]);
	const shared = [...links.entries()].filter(([, c]) => c.length > 1).map(([u, c]) => ({ url: u, codes: c }));
	const flags: Record<string, number> = {};
	for (const r of rows) for (const f of bookFlags(r)) flags[f] = (flags[f] || 0) + 1;
	const languages: Record<string, number> = {};
	for (const r of rows) languages[r.language || 'Not stated'] = (languages[r.language || 'Not stated'] || 0) + 1;
	return {
		total: rows.length, new: fresh.length, changed: changed.length, unchanged, notInTally: notInTally.length, notInFile: notInFile.length, hasStock: tally.size > 0,
		flags, languages, shared: shared.length,
		samples: { new: fresh.slice(0, 15).map((r) => ({ code: r.code, name: r.name })), changed: changed.slice(0, 25), notInTally: notInTally.slice(0, 30), notInFile: notInFile.slice(0, 30), shared: shared.slice(0, 10) },
	};
}

/** Saves the file: rows are updated by code, nothing is deleted. The original file is kept with the upload. */
export async function applyBooks(orgId: number, userId: number | null, fileName: string, data: Uint8Array) {
	const started = Date.now();
	const { rows, problems } = await parseBookFile(orgId, fileName, data);
	const preview = await previewBooks(orgId, rows);
	const batch = await tx(async (c) => {
		const b = (await c.query(
			`insert into upload_batches (org_id, kind, file_name, file_size, status, rows_received, rows_total, rows_new, rows_updated, rows_unchanged, warnings, profile, uploaded_by, finished_at)
			 values ($1,'books',$2,$3,'done',$4,$4,$5,$6,$7,$8,$9,$10, now()) returning *`,
			[orgId, fileName.slice(0, 200), data.length, rows.length, preview.new, preview.changed, preview.unchanged, problems, JSON.stringify({ flags: preview.flags, languages: preview.languages, notInTally: preview.notInTally, notInFile: preview.notInFile, shared: preview.shared }), userId],
		)).rows[0];
		await c.query('insert into upload_file_parts (batch_id, seq, bytes) values ($1, 0, $2)', [b.id, Buffer.from(data)]);
		const CH = 1000;
		for (let i = 0; i < rows.length; i += CH) {
			const part = rows.slice(i, i + CH);
			await c.query(
				`insert into book_titles (org_id, code, name, language, hindi_title, hindi_raw, aliases, gitapress_url, amazon_url, family, family_manual, category, mrp, lead_days, cover_days, min_print, status, in_master, updated_by, updated_at)
				 select $1, x.code, x.name, x.language, nullif(x.hindi,''), nullif(x.hindi_raw,''), coalesce(x.aliases, '{}'), nullif(x.gita,''), nullif(x.amazon,''), nullif(x.family,''), x.family is not null and x.family <> '',
				        nullif(x.category,''), x.mrp, x.lead, x.cover, x.minp, coalesce(x.status, 'active'), true, $2, now()
				   from jsonb_to_recordset($3::jsonb) as x(code text, name text, language text, hindi text, hindi_raw text, aliases text[], gita text, amazon text, family text, category text, mrp numeric, lead int, cover int, minp int, status text)
				 on conflict (org_id, code) do update set
				   name = case when excluded.name <> '' then excluded.name else book_titles.name end,
				   language = case when excluded.language <> '' then excluded.language else book_titles.language end,
				   hindi_title = excluded.hindi_title, hindi_raw = excluded.hindi_raw, aliases = excluded.aliases, gitapress_url = excluded.gitapress_url, amazon_url = excluded.amazon_url,
				   family = case when excluded.family is not null then excluded.family else book_titles.family end,
				   family_manual = book_titles.family_manual or excluded.family_manual,
				   category = coalesce(excluded.category, book_titles.category), mrp = coalesce(excluded.mrp, book_titles.mrp), lead_days = coalesce(excluded.lead_days, book_titles.lead_days),
				   cover_days = coalesce(excluded.cover_days, book_titles.cover_days), min_print = coalesce(excluded.min_print, book_titles.min_print),
				   status = case when $4::boolean then excluded.status when book_titles.status = 'removed' then 'removed' else 'active' end, in_master = true, updated_by = $2, updated_at = now()`,
				[orgId, userId, JSON.stringify(part.map((r) => ({
					code: r.code, name: r.name, language: r.language, hindi: r.hindi, hindi_raw: r.hindi_raw, aliases: r.aliases, gita: r.gitapress_url, amazon: r.amazon_url, family: r.family ?? null,
					category: r.category ?? null, mrp: r.mrp ?? null, lead: r.lead_days ?? null, cover: r.cover_days ?? null, minp: r.min_print ?? null, status: r.status ?? null,
				}))), part.some((r) => r.status !== undefined)],
			);
		}
		return b;
	});
	const families = await autoFamilies(orgId);
	await refreshFlags(orgId);
	forgetStock(orgId);
	await q(`update upload_batches set timing = jsonb_build_object('ms', $2::int) where id=$1`, [batch.id, Date.now() - started]);
	return { batchId: batch.id, ...preview, problems, families };
}

/** Flags are worked out from the saved rows, so the filters and the Gaps list always agree with the table. */
export async function refreshFlags(orgId: number) {
	const rows = await q<any>(`select code, hindi_title as hindi, gitapress_url, amazon_url, aliases from book_titles where org_id=$1 and status <> 'removed'`, [orgId]);
	const links = new Map<string, number>();
	for (const r of rows) for (const u of [r.gitapress_url, r.amazon_url]) if (u) links.set(u, (links.get(u) || 0) + 1);
	const out = rows.map((r) => ({ code: r.code, flags: [...bookFlags(r), ...([r.gitapress_url, r.amazon_url].some((u) => u && links.get(u)! > 1) ? ['shared_link'] : [])] }));
	for (let i = 0; i < out.length; i += 2000) {
		await q(`update book_titles b set flags = x.flags from jsonb_to_recordset($2::jsonb) as x(code text, flags text[]) where b.org_id=$1 and b.code=x.code and b.flags is distinct from x.flags`, [orgId, JSON.stringify(out.slice(i, i + 2000))]);
	}
}

/**
 * Title family: the language editions of one work (e.g. Gita Sadhak Sanjivani in Hindi, English and Gujarati).
 * Codes are grouped when their English names match by sound or their Hindi titles are the same. A family set by
 * hand is never changed.
 */
export async function autoFamilies(orgId: number) {
	const rows = await q<any>(`select code, name, language, hindi_title, family, family_manual from book_titles where org_id=$1 and status <> 'removed'`, [orgId]);
	const parent = new Map<string, string>();
	const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
	const byKey = new Map<string, string>();
	for (const r of rows) {
		parent.set(r.code, r.code);
		const keys = [titleKey(r.name).length >= 5 ? `n:${titleKey(r.name)}` : '', r.hindi_title && titleKey(r.hindi_title).length >= 4 ? `h:${titleKey(r.hindi_title)}` : ''].filter(Boolean);
		for (const k of keys) {
			const other = byKey.get(k);
			if (other) parent.set(find(r.code), find(other));
			else byKey.set(k, r.code);
		}
	}
	const groups = new Map<string, any[]>();
	for (const r of rows) { const g = find(r.code); groups.set(g, [...(groups.get(g) || []), r]); }
	const updates: { code: string; family: string }[] = [];
	for (const list of groups.values()) {
		const manual = list.find((r) => r.family_manual && r.family)?.family;
		const lead = list.find((r) => /^hindi$/i.test(r.language)) || list.find((r) => /^sanskrit$/i.test(r.language)) || list[0];
		const label = manual || clean(lead.name.replace(/\s*-?\s*\(\s*\d+\s*\)\s*$/, ''), 200) || lead.code;
		for (const r of list) if (!r.family_manual && r.family !== label) updates.push({ code: r.code, family: label });
	}
	for (let i = 0; i < updates.length; i += 2000) {
		await q(`update book_titles b set family = x.family from jsonb_to_recordset($2::jsonb) as x(code text, family text) where b.org_id=$1 and b.code=x.code and not b.family_manual`, [orgId, JSON.stringify(updates.slice(i, i + 2000))]);
	}
	return { families: groups.size, updated: updates.length };
}

const SORTS: Record<string, string> = {
	code: `case when b.code ~ '^\\d+$' then lpad(b.code, 10, '0') else b.code end`, name: 'lower(b.name)', language: 'b.language', hindi: 'b.hindi_title', family: 'lower(b.family)',
	status: 'b.status', mrp: 'b.mrp', category: 'lower(b.category)', gitapress: 'b.gitapress_url', amazon: 'b.amazon_url', updated: 'b.updated_at',
};

export async function listBooks(orgId: number, qs: URLSearchParams) {
	const params: unknown[] = [orgId];
	const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
	const where = ['b.org_id=$1'];
	const status = qs.get('status') || '';
	if (status === 'removed') where.push(`b.status='removed'`);
	else if (status) where.push(`b.status=${p(status)}`);
	else where.push(`b.status <> 'removed'`);
	const text = (qs.get('q') || '').trim();
	if (text) { const t = p(`%${text}%`); where.push(`(b.code ilike ${t} or b.name ilike ${t} or b.hindi_title ilike ${t} or b.family ilike ${t} or array_to_string(b.aliases,' ') ilike ${t} or b.code = ${p(normCode(text))})`); }
	if (qs.get('language')) where.push(`b.language = ${p(qs.get('language'))}`);
	if (qs.get('family')) where.push(`b.family = ${p(qs.get('family'))}`);
	const missing = qs.get('missing');
	if (missing && FLAG_LABEL[missing]) where.push(`${p(missing)} = any(b.flags)`);
	const dir = qs.get('dir') === 'desc' ? 'desc' : 'asc';
	const sort = `${SORTS[qs.get('sort') || 'code'] || SORTS.code} ${dir} nulls last, b.code`;
	const all = ['xlsx', 'print'].includes(qs.get('format') || '');
	const limit = all ? 20000 : Math.min(Number(qs.get('limit')) || 100, 500);
	const offset = Math.max(0, Number(qs.get('offset')) || 0);
	const W = where.join(' and ');
	const rows = await q<any>(
		`select b.code, b.name, b.language, b.hindi_title, b.hindi_raw, b.aliases, b.gitapress_url, b.amazon_url, b.family, b.family_manual, b.status, b.category, b.mrp::float as mrp, b.lead_days, b.cover_days, b.min_print,
		        b.in_master, b.flags, b.updated_at, u.full_name as updated_by
		   from book_titles b left join users u on u.id=b.updated_by where ${W} order by ${sort} limit ${limit} offset ${offset}`,
		params,
	);
	if (all) return { rows, total: rows.length };
	const totals = await one<any>(
		`select count(*) filter (where status <> 'removed')::int as books, count(*) filter (where status='needs_details')::int as needs_details, count(*) filter (where status='removed')::int as removed,
		        count(distinct family) filter (where status <> 'removed')::int as families
		   from book_titles where org_id=$1`, [orgId]);
	const flags = await q<any>(`select f as k, count(*)::int as n from book_titles b, unnest(b.flags) f where b.org_id=$1 and b.status <> 'removed' group by 1`, [orgId]);
	const languages = await q<any>(`select language as k, count(*)::int as n from book_titles where org_id=$1 and status <> 'removed' and language <> '' group by 1 order by 2 desc`, [orgId]);
	const total = (await one<any>(`select count(*)::int as n from book_titles b where ${W}`, params))?.n || 0;
	return { rows, total, offset, limit, totals: { ...totals, flags: Object.fromEntries(flags.map((f) => [f.k, f.n])), languages } };
}

/** Add a book, or change one. Only the fields sent are changed. */
export async function saveBook(orgId: number, userId: number | null, input: any, create = false) {
	const code = normCode(input.code);
	if (!code) throw new HttpError(400, 'A book needs a code');
	const cur = await one<any>('select * from book_titles where org_id=$1 and code=$2', [orgId, code]);
	if (create && cur && cur.status !== 'removed') throw new HttpError(400, `Code ${code} is already in the book list (${cur.name})`);
	if (!create && !cur) throw new HttpError(404, 'Book not found');
	const has = (k: string) => input[k] !== undefined;
	const text = (k: string, n = 300) => (has(k) ? clean(input[k], n) : undefined);
	const next: any = {
		name: text('name'), language: text('language', 40), hindi_title: has('hindi_title') ? stripCode(clean(input.hindi_title), code) : undefined,
		aliases: has('aliases') ? [...new Set((Array.isArray(input.aliases) ? input.aliases : String(input.aliases).split(/[;|]/)).map((x: unknown) => clean(x, 120)).filter(Boolean))].slice(0, 12) : undefined,
		gitapress_url: has('gitapress_url') ? url(input.gitapress_url) : undefined, amazon_url: has('amazon_url') ? url(input.amazon_url) : undefined,
		family: text('family', 200), category: text('category', 80),
		mrp: has('mrp') ? numOrNull(input.mrp, 0, 1e6) : undefined, lead_days: has('lead_days') ? numOrNull(input.lead_days, 1, 720) : undefined,
		cover_days: has('cover_days') ? numOrNull(input.cover_days, 1, 720) : undefined, min_print: has('min_print') ? numOrNull(input.min_print, 0, 1e7) : undefined,
		status: has('status') ? String(input.status) : undefined,
	};
	if (create && !next.name) throw new HttpError(400, 'A book needs an English name');
	if (next.name === '') throw new HttpError(400, 'The English name cannot be empty');
	if (next.status && !STATUS_LABEL[next.status]) throw new HttpError(400, 'Unknown status');
	if (next.gitapress_url && !okGita(next.gitapress_url)) throw new HttpError(400, 'The gitapress.org link must be a page on gitapress.org');
	if (next.amazon_url && !okAmazon(next.amazon_url)) throw new HttpError(400, 'The Amazon link must be a page on amazon.in or amazon.com');
	if (!cur) await q(`insert into book_titles (org_id, code, name, status, in_master) values ($1,$2,$3,'active',true)`, [orgId, code, next.name]);
	const sets: string[] = [];
	const params: unknown[] = [orgId, code];
	for (const [k, v] of Object.entries(next)) {
		if (v === undefined) continue;
		params.push(k === 'hindi_title' || k.endsWith('_url') || k === 'family' || k === 'category' ? v || null : v);
		sets.push(`${k}=$${params.length}`);
	}
	if (next.family !== undefined) sets.push(`family_manual=${next.family ? 'true' : 'false'}`);
	if (next.hindi_title !== undefined) { params.push(clean(input.hindi_title) || null); sets.push(`hindi_raw=$${params.length}`); }
	// a book someone has completed is no longer "needs details", unless the status itself was chosen
	if (next.status === undefined && (create || cur?.status === 'needs_details') && (next.hindi_title || next.gitapress_url || next.amazon_url || create)) sets.push(`status='active'`);
	params.push(userId);
	await q(`update book_titles set ${sets.join(', ')}${sets.length ? ', ' : ''}in_master=true, updated_by=$${params.length}, updated_at=now() where org_id=$1 and code=$2`, params);
	if (next.family === '' || next.name !== undefined || next.hindi_title !== undefined) await autoFamilies(orgId);
	await refreshFlags(orgId);
	forgetStock(orgId);
	return one<any>('select * from book_titles where org_id=$1 and code=$2', [orgId, code]);
}

/** Removing hides a book from the list and from replies; its stock and history stay, and it can be restored. */
export async function setBookRemoved(orgId: number, userId: number | null, code: string, removed: boolean) {
	const r = await q(
		`update book_titles set status = case when $3::boolean then 'removed' when hindi_title is null and gitapress_url is null and amazon_url is null then 'needs_details' else 'active' end, updated_by=$4, updated_at=now()
		  where org_id=$1 and code=$2 returning code`, [orgId, normCode(code), removed, userId]);
	if (!r.length) throw new HttpError(404, 'Book not found');
	await refreshFlags(orgId);
	forgetStock(orgId);
	return { success: true };
}

export async function exportBooks(orgId: number, qs = new URLSearchParams()): Promise<{ header: string[]; rows: unknown[][] }> {
	const p = new URLSearchParams(qs);
	p.set('format', 'xlsx');
	const { rows } = await listBooks(orgId, p);
	return {
		header: [...BOOK_COLUMNS, ...BOOK_EXTRA_COLUMNS],
		rows: rows.map((r: any) => [r.code, r.name, r.language, r.hindi_raw || r.hindi_title || '', (r.aliases || []).join('; '), r.gitapress_url || '', r.amazon_url || '', r.family || '', r.category || '', r.mrp ?? '', r.lead_days ?? '', r.cover_days ?? '', r.min_print ?? '', STATUS_LABEL[r.status]]),
	};
}

/** Price list (code, price): used for a reply only when the book has no batch at Gorakhpur. */
export async function applyPrices(orgId: number, userId: number | null, fileName: string, data: Uint8Array) {
	let sheets;
	try { sheets = readTable(data, fileName); } catch (e: any) { throw new HttpError(400, e.message); }
	const prices = new Map<string, number>();
	const problems: string[] = [];
	for (const sh of sheets) {
		const hi = sh.rows.slice(0, 15).findIndex((r) => r.some((c) => /^(book)?code$/.test(headKey(c))));
		if (hi < 0) continue;
		const head = sh.rows[hi].map(headKey);
		const cc = head.findIndex((h) => /^(book)?code$/.test(h));
		const pc = head.findIndex((h) => /^(pricemrp|mrp|price|rate)$/.test(h));
		if (pc < 0) throw new HttpError(400, 'No "Price" or "MRP" column was found. The price list needs two columns: Code and Price.');
		sh.rows.slice(hi + 1).forEach((r, i) => {
			const code = normCode(r[cc]);
			if (!code) return;
			const n = numOrNull(r[pc], 0, 1e6);
			if (n === null) { if (!blank(r[pc])) problems.push(`Row ${hi + i + 2}: price not readable for code ${code}`); return; }
			prices.set(code, n);
		});
	}
	if (!prices.size) throw new HttpError(400, 'No prices were read. The price list needs two columns: Code and Price.');
	const list = [...prices.entries()].map(([code, mrp]) => ({ code, mrp }));
	const known = await q<any>(`select code, mrp::float as mrp from book_titles where org_id=$1 and code = any($2::text[])`, [orgId, list.map((x) => x.code)]);
	const cur = new Map(known.map((k) => [k.code, k.mrp]));
	const unknown = list.filter((x) => !cur.has(x.code)).map((x) => x.code);
	const changed = list.filter((x) => cur.has(x.code) && cur.get(x.code) !== x.mrp);
	await q(`update book_titles b set mrp = x.mrp, updated_by=$3, updated_at=now() from jsonb_to_recordset($2::jsonb) as x(code text, mrp numeric) where b.org_id=$1 and b.code=x.code and b.mrp is distinct from x.mrp`, [orgId, JSON.stringify(changed), userId]);
	if (unknown.length) problems.push(`${unknown.length} codes are not in the book list and were skipped: ${unknown.slice(0, 20).join(', ')}${unknown.length > 20 ? '…' : ''}`);
	const b = await one<any>(
		`insert into upload_batches (org_id, kind, file_name, file_size, status, rows_received, rows_total, rows_updated, rows_unchanged, rows_rejected, warnings, uploaded_by, finished_at)
		 values ($1,'prices',$2,$3,'done',$4,$4,$5,$6,$7,$8,$9, now()) returning id`,
		[orgId, fileName.slice(0, 200), data.length, list.length, changed.length, list.length - changed.length - unknown.length, unknown.length, problems.slice(0, 60), userId]);
	await q('insert into upload_file_parts (batch_id, seq, bytes) values ($1, 0, $2)', [b.id, Buffer.from(data)]);
	forgetStock(orgId);
	return { batchId: b.id, total: list.length, changed: changed.length, unknown: unknown.length, problems };
}

export const booksWorkbook = async (orgId: number, qs?: URLSearchParams) => {
	const { header, rows } = await exportBooks(orgId, qs);
	return writeXlsx([{ name: 'Book list', header, rows }]);
};
