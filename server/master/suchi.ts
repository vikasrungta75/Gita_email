/**
 * The book list (सूची-पत्र, "Suchi"): Gita Press's code-wise catalogue with size, pages, books per carton and price.
 * It arrives as a PDF (Final_Gita_Press_Suchi_Codewise_Oct_2026_V8.pdf: 47 pages, 1,911 titles) or as an Excel file
 * in the layout Gita Mail downloads (Code · Title · Flags · Other editions · Set codes · Set code · Size · Pages ·
 * Books per carton · Price).
 *
 * Reading the PDF: each page is a table whose columns are found from the header row (CODE, TITLE, SIZE, PAGES,
 * BOOKS/CARTON, PRICE/BOOK). An entry starts on a line with a code and a price; the lines below it (other-language
 * editions, the SET line) belong to the same entry. With poppler's pdftotext (installed on the cloud server) the
 * Hindi titles come out cleanly; without it the built-in reader is used, which reads the numbers, sizes, editions and
 * sets correctly but may garble Hindi letters, so the Hindi title from the book links file is preferred for display.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { one, q, tx } from '../db';
import { HttpError } from '../http';
import { readTable } from '../xlsx';
import { headKey } from '../uploads/common';
import { normCode } from './books';

const run = promisify(execFile);

export interface SuchiEntry {
	code: string;
	title: string;
	nativeTitle: string | null;
	flags: string[];
	binding: string | null;
	bestSeller: boolean;
	editions: { language: string; codes: string[] }[];
	set: { setCode: string; codes: string[]; volumes: number | null } | null;
	sizeEn: string | null;
	pages: number | null;
	carton: number | null;
	price: number | null;
}

export const SIZE_HI: Record<string, string> = { Jumbo: 'बृहदाकार', Large: 'ग्रन्थाकार', Medium: 'पुस्तकाकार', Small: 'पॉकेट', Tiny: 'लघु आकार', Sticker: 'स्टीकर' };
const LANGS = ['Hindi', 'Sanskrit', 'English', 'Marathi', 'Gujarati', 'Bengali', 'Bangla', 'Odia', 'Oriya', 'Kannada', 'Tamil', 'Telugu', 'Assamese', 'Assamiya', 'Nepali', 'Malayalam', 'Punjabi', 'Urdu'];
const EDITION_RE = new RegExp(`\\b(${LANGS.join('|')})\\s+((?:[A-Z]{0,3}\\d+[A-Z]?(?:-\\d+)?)(?:\\s*,\\s*[A-Z]{0,3}\\d+[A-Z]?(?:-\\d+)?)*)`, 'g');
const SET_RE = /SET\s*\((\d+)\s*VOLUMES?\)\s*[—–-]\s*codes?\s*([A-Z0-9 ,]+?)\s*·\s*Set\s*Code\s*([A-Z0-9]+)/i;
const CODE_RE = /^[A-Z]{0,3}\d{1,5}[A-Z]?$/;

interface Item { x: number; y: number; s: string }

/** Words with positions from pdftotext (bbox), or null when the program is not installed. */
async function itemsFromPdftotext(bytes: Uint8Array): Promise<Item[][] | null> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suchi-'));
	const file = path.join(dir, 'suchi.pdf');
	try {
		fs.writeFileSync(file, bytes);
		const { stdout } = await run('pdftotext', ['-bbox', file, '-'], { maxBuffer: 200 * 1024 * 1024 });
		const pages: Item[][] = [];
		for (const page of stdout.split(/<page /).slice(1)) {
			const h = Number(page.match(/height="([\d.]+)"/)?.[1] || 842);
			const items: Item[] = [];
			for (const m of page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
				const s = m[4].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
				// the middle of the word: Hindi and Latin words on one line have different tops and bottoms
				items.push({ x: Number(m[1]), y: h - (Number(m[2]) + Number(m[3])) / 2, s: `${s} ` });
			}
			pages.push(items);
		}
		return pages.length ? pages : null;
	} catch {
		return null;
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** Text items with positions from the built-in PDF reader (works everywhere, including Windows). */
async function itemsFromPdfjs(bytes: Uint8Array): Promise<Item[][]> {
	const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const doc = await getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0, isEvalSupported: false } as any).promise;
	const pages: Item[][] = [];
	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p);
		const tc = await page.getTextContent();
		pages.push((tc.items as any[]).filter((i) => typeof i.str === 'string' && i.str !== '').map((i) => ({ x: i.transform[4], y: i.transform[5], s: String(i.str).replace(/\u0000/g, '') })));
	}
	await doc.destroy();
	return pages;
}

/** Groups items into lines (top to bottom), each line's items left to right. */
function lines(items: Item[]): Item[][] {
	const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
	const out: Item[][] = [];
	for (const it of sorted) {
		const last = out[out.length - 1];
		if (last && Math.abs(last[0].y - it.y) <= 3) last.push(it);
		else out.push([it]);
	}
	return out.map((l) => l.sort((a, b) => a.x - b.x));
}
const join = (items: Item[]) => items.map((i) => i.s).join('').replace(/\s+/g, ' ').trim();

/** Reads every entry of the catalogue PDF. */
export async function parseSuchiPdf(bytes: Uint8Array): Promise<{ entries: SuchiEntry[]; reader: string; problems: string[] }> {
	if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new HttpError(400, 'This is not a PDF file');
	let pages = await itemsFromPdftotext(bytes);
	const reader = pages ? 'pdftotext' : 'built-in';
	if (!pages) pages = await itemsFromPdfjs(bytes);
	const raw: { code: string; text: string[]; size: string; pages: string; carton: string; price: string }[] = [];
	const problems: string[] = [];
	let cols: { title: number; size: number; pages: number; carton: number; price: number } | null = null;
	pages.forEach((items, pi) => {
		const ls = lines(items);
		// the column starts come from the header row of the page (CODE · TITLE · SIZE · PAGES; BOOKS/CARTON and PRICE/BOOK on two lines)
		const head = ls.find((l) => l.some((i) => /^TITLE\b/.test(i.s.trim())) && l.some((i) => /^SIZE\b/.test(i.s.trim())));
		const top = ls.find((l) => l.some((i) => /^BOOKS\//.test(i.s.trim())));
		if (head) {
			const at = (re: RegExp, l: Item[] = head) => l.find((i) => re.test(i.s.trim()))?.x;
			const title = at(/^TITLE/), size = at(/^SIZE/), pg = at(/^PAGES/), carton = top ? at(/^BOOKS\//, top) : undefined, price = top ? at(/^PRICE\//, top) : undefined;
			if (title && size && pg && carton && price) cols = { title, size, pages: pg, carton, price };
		}
		if (!cols) { problems.push(`Page ${pi + 1}: the column headings were not found`); return; }
		const c = cols;
		const headY = head ? head[0].y : Infinity;
		for (const l of ls) {
			if (l[0].y >= headY - 1) continue; // page title and header rows
			const all = join(l);
			if (/Gita Press, Gorakhpur — |titles · \d+\/\d+|^BOOKS\/|^CARTON|Code-wise Catalogue/.test(all)) continue;
			const part = (from: number, to: number) => join(l.filter((i) => i.x >= from - 4 && i.x < to - 4));
			const code = part(-Infinity, c.title).replace(/\s/g, '');
			const price = part(c.price, Infinity);
			if (code && CODE_RE.test(code) && /₹\s*[\d,]+/.test(price)) {
				raw.push({ code, text: [part(c.title, c.size)], size: part(c.size, c.pages), pages: part(c.pages, c.carton), carton: part(c.carton, c.price), price });
			} else if (raw.length) {
				const t = part(c.title, c.size) || all;
				if (t) raw[raw.length - 1].text.push(t);
			}
		}
	});
	const entries = raw.map((r) => toEntry(r.code, r.text.join(' '), r.size, r.pages, r.carton, r.price));
	if (!entries.length) throw new HttpError(400, 'No books were found in this PDF. Is it the code-wise Suchi (सूची-पत्र)?');
	return { entries, reader, problems };
}

const intOrNull = (s: string) => { const n = Number(String(s).replace(/[^\d]/g, '')); return String(s).replace(/[^\d]/g, '') && Number.isFinite(n) ? n : null; };

/** One catalogue entry from its title text and columns. */
export function toEntry(codeRaw: string, text: string, size: string, pages: string, carton: string, price: string): SuchiEntry {
	const code = normCode(codeRaw);
	// tidy Hindi spacing that PDF text extraction adds ("संस्कृ त" → "संस्कृत", "तत्त्व -विवेचनी" → "तत्त्व-विवेचनी")
	const t = text.replace(/\s+/g, ' ').replace(/ृ (?=[\u0915-\u0939])/g, 'ृ').replace(/([\u0900-\u097F]) -(?=[\u0900-\u097F])/g, '$1-').trim();
	const set = t.match(SET_RE);
	const withoutSet = set ? t.replace(set[0], '').trim() : t;
	const editions: { language: string; codes: string[] }[] = [];
	const lang = (l: string) => ({ Bangla: 'Bengali', Oriya: 'Odia', Assamiya: 'Assamese' } as Record<string, string>)[l] || l;
	for (const m of withoutSet.matchAll(EDITION_RE)) editions.push({ language: lang(m[1]), codes: m[2].split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean) });
	const flags = ['Hardbound', 'Best Seller', 'Deluxe Edition'].filter((f) => withoutSet.includes(f));
	// the title is what comes before the first flag, native title or edition list
	const cut = [' Hardbound', ' Best Seller', ' Deluxe Edition', ' — ', ' · '].map((k) => withoutSet.indexOf(k)).filter((i) => i > 0);
	const title = (cut.length ? withoutSet.slice(0, Math.min(...cut)) : withoutSet).replace(/[·—\s]+$/, '').trim();
	const native = withoutSet.match(/ — ([^·]+?)(?: · |$)/);
	const sizeEn = size.match(/\b(Jumbo|Large|Medium|Small|Tiny|Sticker)\b/i)?.[1]?.replace(/^./, (c) => c.toUpperCase()) || null;
	return {
		code, title, nativeTitle: native && !/^codes?\b/i.test(native[1]) ? native[1].trim() : null, flags,
		binding: flags.includes('Hardbound') ? 'Hardbound' : null, bestSeller: flags.includes('Best Seller'), editions,
		set: set ? { setCode: set[3].toUpperCase(), codes: set[2].split(/\s*,\s*/).map((x) => normCode(x)).filter(Boolean), volumes: Number(set[1]) || null } : null,
		sizeEn, pages: intOrNull(pages), carton: /—|-/.test(carton) && !/\d/.test(carton) ? null : intOrNull(carton), price: intOrNull(price),
	};
}

export const SUCHI_COLUMNS = ['Code', 'Title', 'Flags', 'Other editions', 'Set codes', 'Set code', 'Size', 'Pages', 'Books per carton', 'Price'];
const editionsText = (e: SuchiEntry['editions']) => e.map((x) => `${x.language} ${x.codes.join(', ')}`).join(' · ');

/** The catalogue as rows for the Excel download (the same layout the Excel upload reads). */
export function suchiRows(entries: SuchiEntry[]): unknown[][] {
	return entries.map((e) => [e.code, e.title, e.flags.join(', '), editionsText(e.editions), e.set?.codes.join(', ') || '', e.set?.setCode || '', e.sizeEn || '', e.pages ?? '', e.carton ?? '', e.price ?? '']);
}

/** Reads the Excel/CSV version of the catalogue. */
export function parseSuchiTable(bytes: Uint8Array, fileName: string): { entries: SuchiEntry[]; problems: string[] } {
	let sheets;
	try { sheets = readTable(bytes, fileName); } catch (e: any) { throw new HttpError(400, e.message); }
	const problems: string[] = [];
	for (const sh of sheets) {
		const hi = sh.rows.slice(0, 10).findIndex((r) => r.some((c) => headKey(c) === 'code') && r.some((c) => headKey(c) === 'price'));
		if (hi < 0) continue;
		const head = sh.rows[hi].map(headKey);
		const ix = (k: string) => head.indexOf(headKey(k));
		const entries: SuchiEntry[] = [];
		sh.rows.slice(hi + 1).forEach((r, i) => {
			const code = normCode(r[ix('Code')]);
			if (!code) return;
			const flags = String(r[ix('Flags')] ?? '');
			const setCodes = String(r[ix('Set codes')] ?? '');
			const e = toEntry(code, `${r[ix('Title')] ?? ''}${flags ? ` ${flags.split(/\s*,\s*/).join(' · ')}` : ''}${r[ix('Other editions')] ? ` · ${r[ix('Other editions')]}` : ''}`,
				String(r[ix('Size')] ?? ''), String(r[ix('Pages')] ?? ''), String(r[ix('Books per carton')] ?? ''), String(r[ix('Price')] ?? ''));
			e.title = String(r[ix('Title')] ?? '').trim();
			if (setCodes && r[ix('Set code')]) e.set = { setCode: String(r[ix('Set code')]).trim().toUpperCase(), codes: setCodes.split(/\s*,\s*/).map(normCode).filter(Boolean), volumes: setCodes.split(',').length };
			if (e.price === null) problems.push(`Row ${hi + i + 2} (code ${code}): no price`);
			entries.push(e);
		});
		return { entries, problems };
	}
	throw new HttpError(400, `No sheet with a "Code" and a "Price" column was found. The book list needs: ${SUCHI_COLUMNS.join(', ')}.`);
}

/** What applying the catalogue would change, shown before anything is saved. */
export async function previewSuchi(orgId: number, entries: SuchiEntry[]) {
	const cur = new Map((await q<any>('select code, suchi_price, size_en, pages, carton, in_suchi, in_links, edited_fields from book_titles where org_id=$1', [orgId])).map((r) => [r.code, r]));
	let fresh = 0, changed = 0, same = 0, priceChanges = 0;
	const examples: string[] = [];
	for (const e of entries) {
		const c = cur.get(e.code);
		if (!c || !c.in_suchi) { fresh++; continue; }
		const diff = Number(c.suchi_price) !== e.price || c.size_en !== e.sizeEn || c.pages !== e.pages || c.carton !== e.carton;
		if (diff) { changed++; if (Number(c.suchi_price) !== e.price) { priceChanges++; if (examples.length < 8) examples.push(`${e.code}: ₹${c.suchi_price ?? '–'} → ₹${e.price ?? '–'}`); } } else same++;
	}
	const codes = new Set(entries.map((e) => e.code));
	const onlyLinks = [...cur.values()].filter((c) => c.in_links && !codes.has(c.code)).length;
	const last = await one<any>(`select summary, uploaded_at from master_uploads where org_id=$1 and kind='suchi' order by id desc limit 1`, [orgId]);
	return {
		rows: entries.length, new: fresh, changed, unchanged: same, priceChanges, examples,
		withoutPrice: entries.filter((e) => e.price === null).length, sets: new Set(entries.filter((e) => e.set).map((e) => e.set!.setCode)).size,
		bestSellers: entries.filter((e) => e.bestSeller).length, onlyInLinks: onlyLinks,
		previous: last ? { rows: last.summary?.rows ?? null, at: last.uploaded_at } : null,
	};
}

/** Saves the catalogue onto the combined Books record (fields edited by hand in Gita Mail are kept unless replaceEdits). */
export async function applySuchi(orgId: number, userId: number | null, fileName: string, bytes: Uint8Array, entries: SuchiEntry[], replaceEdits = false) {
	const summary = await previewSuchi(orgId, entries);
	const keep = (f: string) => replaceEdits ? 'false' : `('${f}' = any(book_titles.edited_fields))`;
	await tx(async (c) => {
		const CHUNK = 500;
		for (let i = 0; i < entries.length; i += CHUNK) {
			const part = entries.slice(i, i + CHUNK);
			await c.query(
				`insert into book_titles (org_id, code, name, language, status, suchi_title, native_title, size_en, pages, carton, binding, best_seller, editions, set_code, suchi_price, mrp, in_suchi, flags)
				 select $1, x.code, x.title, '', 'active', x.title, x.native, x.size, x.pages, x.carton, x.binding, x.best, x.editions, x.set_code, x.price, x.price, true, '{}'
				   from jsonb_to_recordset($2::jsonb) as x(code text, title text, native text, size text, pages int, carton int, binding text, best boolean, editions jsonb, set_code text, price numeric)
				 on conflict (org_id, code) do update set
				   suchi_title = excluded.suchi_title, native_title = excluded.native_title,
				   size_en = case when ${keep('size_en')} then book_titles.size_en else excluded.size_en end,
				   pages = case when ${keep('pages')} then book_titles.pages else excluded.pages end,
				   carton = case when ${keep('carton')} then book_titles.carton else excluded.carton end,
				   binding = excluded.binding, best_seller = excluded.best_seller, editions = excluded.editions, set_code = excluded.set_code,
				   suchi_price = case when ${keep('suchi_price')} then book_titles.suchi_price else excluded.suchi_price end,
				   mrp = case when ${keep('suchi_price')} then book_titles.mrp else excluded.suchi_price end,
				   name = case when book_titles.name = '' then excluded.name else book_titles.name end,
				   status = case when book_titles.status = 'needs_details' then 'active' else book_titles.status end,
				   in_suchi = true, updated_at = now(), updated_by = $3`,
				[orgId, JSON.stringify(part.map((e) => ({ code: e.code, title: e.title, native: e.nativeTitle, size: e.sizeEn, pages: e.pages, carton: e.carton, binding: e.binding, best: e.bestSeller, editions: e.editions, set_code: e.set?.setCode || null, price: e.price }))), userId],
			);
		}
		const codes = entries.map((e) => e.code);
		await c.query(`update book_titles set in_suchi=false where org_id=$1 and in_suchi and not (code = any($2::text[]))`, [orgId, codes]);
		const sets = new Map<string, { codes: string[]; volumes: number | null }>();
		for (const e of entries) if (e.set) sets.set(e.set.setCode, { codes: e.set.codes, volumes: e.set.volumes });
		await c.query('delete from book_sets where org_id=$1', [orgId]);
		for (const [setCode, s] of sets) await c.query('insert into book_sets (org_id, set_code, codes, volumes) values ($1,$2,$3,$4)', [orgId, setCode, s.codes, s.volumes]);
		await c.query(`insert into master_uploads (org_id, kind, file_name, bytes, summary, uploaded_by) values ($1,'suchi',$2,$3,$4,$5)`, [orgId, fileName.slice(0, 200), Buffer.from(bytes), JSON.stringify(summary), userId]);
	});
	return summary;
}

/** Reads a Suchi upload: PDF or Excel/CSV. */
export async function readSuchi(fileName: string, bytes: Uint8Array) {
	if (/\.pdf$/i.test(fileName) || (bytes[0] === 0x25 && bytes[1] === 0x50)) {
		const r = await parseSuchiPdf(bytes);
		return { entries: r.entries, problems: r.problems, reader: r.reader };
	}
	const r = parseSuchiTable(bytes, fileName);
	return { entries: r.entries, problems: r.problems, reader: 'excel' };
}
