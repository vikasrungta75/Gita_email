/**
 * Minimal Excel (.xlsx) reader and writer. Reads every sheet's cell values (shared strings, inline strings,
 * numbers, booleans); writes a plain workbook with one or more sheets. Enough for Tally exports, title lists
 * and customer downloads, without a large spreadsheet library.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
	e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]);
const texts = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((m) => decode(m[1] || '')).join('');
const colIndex = (ref: string) => {
	let n = 0;
	for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n - 1;
};

export interface Sheet { name: string; rows: unknown[][] }

export function readXlsx(data: Uint8Array): Sheet[] {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(data);
	} catch {
		throw new Error('This file is not an Excel workbook (.xlsx). In Tally, export the Stock Summary as Excel, or save the file as .xlsx.');
	}
	const get = (p: string) => (files[p] ? strFromU8(files[p]) : '');
	const wb = get('xl/workbook.xml');
	if (!wb) throw new Error('This file is not an Excel workbook (.xlsx).');
	const rels = Object.fromEntries([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [
		m[1].match(/\bId="([^"]+)"/)?.[1], m[1].match(/\bTarget="([^"]+)"/)?.[1],
	]));
	const shared = [...get('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => texts(m[1] || ''));
	const sheets: Sheet[] = [];
	for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
		const name = decode(m[1].match(/\bname="([^"]*)"/)?.[1] || '');
		const rid = m[1].match(/\br:id="([^"]+)"/)?.[1] || m[1].match(/\bid="([^"]+)"/)?.[1] || '';
		let target = rels[rid] || '';
		target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
		const xml = get(target);
		const rows: unknown[][] = [];
		for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
			const rIdx = Number((rm[1] || rm[3] || '').match(/\br="(\d+)"/)?.[1] || rows.length + 1) - 1;
			const row: unknown[] = [];
			let next = 0;
			for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
				const attrs = cm[1];
				const ref = attrs.match(/\br="([A-Z]+\d*)"/)?.[1];
				const ci = ref ? colIndex(ref) : next;
				next = ci + 1;
				const t = attrs.match(/\bt="([^"]+)"/)?.[1] || 'n';
				const inner = cm[2] || '';
				const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
				let val: unknown = '';
				if (t === 's') val = v !== undefined ? shared[Number(v)] ?? '' : '';
				else if (t === 'inlineStr') val = texts(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] || '');
				else if (t === 'str' || t === 'e') val = v !== undefined ? decode(v) : '';
				else if (t === 'b') val = v === '1';
				else val = v !== undefined && v !== '' ? Number(v) : '';
				row[ci] = val;
			}
			for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
			rows[rIdx] = row;
		}
		for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
		sheets.push({ name, rows });
	}
	return sheets;
}

/** Reads a .xlsx or a .csv file into sheets (a CSV becomes one sheet). */
export function readTable(data: Uint8Array, fileName = ''): Sheet[] {
	const zip = data[0] === 0x50 && data[1] === 0x4b;
	if (zip || /\.xlsx$/i.test(fileName)) return readXlsx(data);
	const text = strFromU8(data).replace(/^﻿/, '');
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
		} else if (c === '"') quoted = true;
		else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
		else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(cell); cell = '';
			rows.push(row); row = [];
		} else cell += c;
	}
	row.push(cell);
	if (row.some((x) => x.trim())) rows.push(row);
	return [{ name: fileName.replace(/\.\w+$/, '') || 'Sheet1', rows }];
}

// ── writer ─────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i: number) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/** A workbook with a bold header row on each sheet; numbers stay numbers, everything else is text. */
export function writeXlsx(sheets: { name: string; header: string[]; rows: unknown[][]; widths?: number[] }[]): Uint8Array {
	const files: Record<string, Uint8Array> = {};
	const names = sheets.map((s, i) => (s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`));
	files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
	files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
	files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
	files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
	files['xl/styles.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`);
	sheets.forEach((s, si) => {
		const cell = (v: unknown, r: number, c: number, style = '') => {
			const ref = `${colName(c)}${r}`;
			if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
			const str = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
			return str ? `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(str)}</t></is></c>` : '';
		};
		const widths = s.widths || s.header.map((h, c) => Math.min(60, Math.max(h.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[c] ?? '').length + 2))));
		const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData><row r="1">${s.header.map((h, c) => cell(h, 1, c, ' s="1"')).join('')}</row>${s.rows.map((r, ri) => `<row r="${ri + 2}">${r.map((v, c) => cell(v, ri + 2, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
		files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(xml);
	});
	return zipSync(files, { level: 6 });
}
