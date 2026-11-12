/**
 * Reads a large Excel (.xlsx) or CSV file a few thousand rows at a time, without holding the whole sheet in memory.
 * The Kalyan dispatch file is about 750,000 rows (64 MB as a file, 380 MB once opened), so it cannot be read in one
 * go or sent in one request: the browser reads it here and sends the rows to the server in small batches.
 * Used in the browser (Uploads page) and by the tests.
 */
import { Unzip, UnzipInflate, strFromU8 } from 'fflate';

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => (s.includes('&') ? s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
	e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]) : s);
const texts = (xml: string) => {
	let out = '';
	for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += decode(m[1]);
	return out.replace(/_x000[dD]_/g, ' ');
};
const colIndex = (ref: string) => {
	let n = 0;
	for (let i = 0; i < ref.length; i++) { const c = ref.charCodeAt(i); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); }
	return n - 1;
};

export interface StreamOptions {
	/** rows handed over at a time */
	batch?: number;
	/** 0 to 1 */
	onProgress?: (fraction: number) => void;
}

/** Runs through one zip entry (or several small ones), giving its text in pieces. */
async function eachEntry(data: Uint8Array, want: (name: string) => boolean, onText: (name: string, text: string, final: boolean) => void, onStep?: (done: number) => Promise<void> | void) {
	const dec = new Map<string, TextDecoder>();
	let failed: Error | null = null;
	const unz = new Unzip();
	unz.register(UnzipInflate);
	unz.onfile = (file) => {
		if (!want(file.name)) return;
		dec.set(file.name, new TextDecoder('utf-8'));
		file.ondata = (err, chunk, final) => {
			if (err) { failed = err as Error; return; }
			onText(file.name, dec.get(file.name)!.decode(chunk, { stream: !final }), final);
		};
		file.start();
	};
	const STEP = 262_144;
	for (let i = 0; i < data.length; i += STEP) {
		try { unz.push(data.subarray(i, Math.min(data.length, i + STEP)), i + STEP >= data.length); } catch (e: any) { throw new Error('This file is not an Excel workbook (.xlsx), or it is damaged.'); }
		if (failed) throw new Error('This Excel file could not be read. Please save it again as .xlsx and try once more.');
		if (onStep) await onStep(Math.min(data.length, i + STEP));
	}
}

/** Every row of the first sheet of a workbook, in batches. Cells are strings, numbers or booleans; empty cells are ''. */
export async function streamXlsxRows(data: Uint8Array, onRows: (rows: unknown[][]) => Promise<void> | void, opts: StreamOptions = {}): Promise<{ rows: number; sheet: string }> {
	if (!(data[0] === 0x50 && data[1] === 0x4b)) throw new Error('This file is not an Excel workbook (.xlsx).');
	const batch = opts.batch || 4000;
	// pass 1: the workbook's list of sheets and the shared text table (it can sit after the sheet inside the file)
	const small: Record<string, string> = {};
	const shared: string[] = [];
	let sbuf = '';
	await eachEntry(data, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml', (name, text) => {
		if (name !== 'xl/sharedStrings.xml') { small[name] = (small[name] || '') + text; return; }
		sbuf += text;
		const end = sbuf.lastIndexOf('</si>');
		if (end < 0) return;
		const part = sbuf.slice(0, end + 5);
		sbuf = sbuf.slice(end + 5);
		for (const m of part.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(m[1] ? texts(m[1]) : '');
	}, (done) => opts.onProgress?.(0.12 * (done / data.length)));
	const wb = small['xl/workbook.xml'] || '';
	if (!wb) throw new Error('This file is not an Excel workbook (.xlsx).');
	const first = wb.match(/<sheet\b([^>]*)\/?>/);
	const sheetName = decode(first?.[1].match(/\bname="([^"]*)"/)?.[1] || 'Sheet1');
	const rid = first?.[1].match(/\br:id="([^"]+)"/)?.[1] || '';
	const rel = [...(small['xl/_rels/workbook.xml.rels'] || '').matchAll(/<Relationship\b([^>]*)\/?>/g)].find((m) => m[1].match(/\bId="([^"]+)"/)?.[1] === rid);
	let target = rel?.[1].match(/\bTarget="([^"]+)"/)?.[1] || 'worksheets/sheet1.xml';
	target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;

	// pass 2: the sheet, row by row
	let buf = '';
	let out: unknown[][] = [];
	let total = 0;
	const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
	const parseRows = (xml: string) => {
		let from = 0;
		for (;;) {
			const a = xml.indexOf('<row', from);
			if (a < 0) { from = Math.max(from, xml.length - 4); break; }
			const gt = xml.indexOf('>', a);
			if (gt < 0) break;
			// "<rowBreaks>" and the like are not rows
			if (xml[a + 4] !== ' ' && xml[a + 4] !== '>' && xml[a + 4] !== '/') { from = gt + 1; continue; }
			if (xml[gt - 1] === '/') { from = gt + 1; out.push([]); total++; continue; }
			const b = xml.indexOf('</row>', gt);
			if (b < 0) break;
			const body = xml.slice(gt + 1, b);
			from = b + 6;
			const row: unknown[] = [];
			let next = 0;
			CELL.lastIndex = 0;
			let cm: RegExpExecArray | null;
			while ((cm = CELL.exec(body))) {
				const attrs = cm[1];
				const r = attrs.match(/\br="([A-Z]+)\d*"/);
				const ci = r ? colIndex(r[1]) : next;
				next = ci + 1;
				const t = attrs.match(/\bt="([^"]+)"/)?.[1] || 'n';
				const inner = cm[2] || '';
				const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
				const v = vm ? vm[1] : undefined;
				let val: unknown = '';
				if (t === 's') val = v !== undefined ? shared[Number(v)] ?? '' : '';
				else if (t === 'inlineStr') val = texts(inner);
				else if (t === 'str') val = v !== undefined ? decode(v) : '';
				else if (t === 'e') val = v !== undefined ? decode(v) : '';
				else if (t === 'b') val = v === '1';
				else val = v !== undefined && v !== '' ? Number(v) : '';
				while (row.length < ci) row.push('');
				row[ci] = val;
			}
			out.push(row);
			total++;
		}
		return from;
	};
	let seen = false;
	await eachEntry(data, (n) => n === target, (_n, text) => {
		seen = true;
		buf += text;
		const used = parseRows(buf);
		buf = buf.slice(used);
	}, async (done) => {
		while (out.length >= batch) await onRows(out.splice(0, batch));
		opts.onProgress?.(0.12 + 0.88 * (done / data.length));
	});
	if (!seen) throw new Error(`The sheet "${sheetName}" could not be found inside this workbook.`);
	if (out.length) await onRows(out);
	opts.onProgress?.(1);
	return { rows: total, sheet: sheetName };
}

/** Every row of a CSV file, in batches. Every cell stays text, so phone numbers, PIN codes and tracking numbers are not altered. */
export async function streamCsvRows(data: Uint8Array, onRows: (rows: unknown[][]) => Promise<void> | void, opts: StreamOptions = {}): Promise<{ rows: number; sheet: string }> {
	const batch = opts.batch || 4000;
	const text = strFromU8(data).replace(/^﻿/, '');
	let out: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	let total = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') { row.push(cell); cell = ''; }
		else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(cell); cell = '';
			if (row.some((x) => x !== '')) { out.push(row); total++; }
			row = [];
			if (out.length >= batch) { await onRows(out); out = []; opts.onProgress?.(i / text.length); }
		} else cell += c;
	}
	row.push(cell);
	if (row.some((x) => x.trim())) { out.push(row); total++; }
	if (out.length) await onRows(out);
	opts.onProgress?.(1);
	return { rows: total, sheet: 'CSV' };
}

export const streamTableRows = (data: Uint8Array, fileName: string, onRows: (rows: unknown[][]) => Promise<void> | void, opts: StreamOptions = {}) =>
	(data[0] === 0x50 && data[1] === 0x4b) || /\.xlsx$/i.test(fileName) ? streamXlsxRows(data, onRows, opts) : streamCsvRows(data, onRows, opts);
