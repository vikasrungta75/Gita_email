/**
 * Reads a Tally "Stock Summary" Excel export as Gita Press sends it: one sheet per godown group (HQ: MAIN STOCK,
 * RETAIL STOCK, SEMI FINISHED) or one sheet per branch. A few title lines (unit name, address, e-mail, period such
 * as "4-Nov-26 to 6-Nov-26"), then a header row "Sl No | Code | Product Name | GodownName | BatchName | Category |
 * Unit" followed by Qty/Rate/Value for Opening, Inwards, Outwards and Closing Balance, and a Total row.
 */
import { readXlsx } from '../xlsx';

export interface TallyRow {
	code: string;
	name: string;
	godown: string;
	batch: string;
	language: string;
	/** price from the batch label ("80_Rs.850"), else the closing or opening rate */
	price: number | null;
	opening: number;
	inward: number;
	outward: number;
	closing: number;
	outValue: number;
	closingValue: number;
}

export interface TallySheet {
	sheet: string;
	title: string[];
	period: { from: string; to: string } | null;
	rows: TallyRow[];
	skipped: number;
}

/** Strip Excel escape sequences (_x000D_ etc.) and stray whitespace. */
export const clean = (v: unknown) => String(v ?? '').replace(/_x[0-9A-Fa-f]{4}_/g, ' ').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

const num = (v: unknown) => {
	if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
	const s = clean(v).replace(/,/g, '');
	const n = Number(s);
	return s && Number.isFinite(n) ? n : 0;
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function tallyDate(s: string): string | null {
	const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
	if (!m || !MONTHS[m[2].toLowerCase()]) return null;
	const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
	return `${y}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
export function parsePeriod(text: string): { from: string; to: string } | null {
	const m = text.match(/(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s*to\s*(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i);
	if (!m) return null;
	const from = tallyDate(m[1]);
	const to = tallyDate(m[2]);
	return from && to ? { from, to } : null;
}

export function batchPrice(batch: string): number | null {
	const m = batch.match(/rs\.?\s*([\d]+(?:\.\d+)?)/i);
	return m ? Number(m[1]) : null;
}

export function readTally(data: Uint8Array): TallySheet[] {
	const out: TallySheet[] = [];
	for (const ws of readXlsx(data)) {
		const grid = ws.rows;
		const hi = grid.findIndex((r) => /^sl\.?\s*no/i.test(clean(r[0])) && r.some((c) => /^code$/i.test(clean(c))));
		if (hi < 0) {
			out.push({ sheet: ws.name, title: [], period: null, rows: [], skipped: 0 });
			continue;
		}
		const header = grid[hi].map((c) => clean(c).toLowerCase());
		const groups = (grid[hi - 1] || []).map((c) => clean(c).toLowerCase());
		const col = (re: RegExp) => header.findIndex((h) => re.test(h));
		const ix = {
			code: col(/^code$/), name: col(/^product ?name$|^item|^name$/), godown: col(/^godown/), batch: col(/^batch/), language: col(/^category$/), unit: col(/^unit$/),
		};
		const group = (re: RegExp, offset: number) => {
			// the label sits above a Qty column (some exports repeat a label one column early)
			const g = groups.findIndex((h, i) => re.test(h) && header[i] === 'qty');
			return g >= 0 ? g : ix.unit + 1 + offset;
		};
		const op = group(/^opening/, 0);
		const inw = group(/^inward/, 3);
		const outw = group(/^outward/, 6);
		const cl = group(/^closing/, 9);
		const title = grid.slice(0, hi).map((r) => r.map(clean).filter(Boolean).join(' ')).filter(Boolean);
		const period = parsePeriod(title.join(' | '));
		const rows: TallyRow[] = [];
		let skipped = 0;
		for (const r of grid.slice(hi + 1)) {
			const first = clean(r[0]).toLowerCase();
			const batchLabel = ix.batch >= 0 ? clean(r[ix.batch]) : '';
			// combo sets sometimes have no code; the batch label starts with it ("CB035_Rs.100")
			const code = (clean(r[ix.code]) || (first !== 'total' && clean(r[ix.name]) ? batchLabel.split('_')[0] : '')).replace(/\.0+$/, '');
			if (first === 'total' || !code) { if (r.some((c) => clean(c))) skipped += first === 'total' ? 0 : 1; continue; }
			const batch = batchLabel;
			const rate = num(r[cl + 1]) || num(r[op + 1]) || num(r[inw + 1]) || num(r[outw + 1]);
			rows.push({
				code,
				name: clean(r[ix.name]),
				godown: ix.godown >= 0 ? clean(r[ix.godown]) : ws.name,
				batch,
				language: ix.language >= 0 ? clean(r[ix.language]).replace(/not applicable/i, '').trim() : '',
				price: batchPrice(batch) ?? (rate || null),
				opening: num(r[op]),
				inward: num(r[inw]),
				outward: num(r[outw]),
				closing: num(r[cl]),
				outValue: num(r[outw + 2]),
				closingValue: num(r[cl + 2]),
			});
		}
		out.push({ sheet: ws.name, title, period, rows, skipped });
	}
	return out;
}

/** HQ (Main, Retail, Semi-finished) or one sheet per branch. */
export function detectScope(sheets: TallySheet[]): 'hq' | 'branch' {
	const names = sheets.map((s) => s.sheet.toLowerCase()).join(' ');
	const godowns = sheets.flatMap((s) => s.rows.slice(0, 50).map((r) => r.godown.toLowerCase())).join(' ');
	return /main stock|retail stock|semi finished/.test(names) || /main stock location|retail dispatch|semi finished/.test(godowns) ? 'hq' : 'branch';
}

/**
 * What a godown is used for. Sales are counted from 'retail' (HQ retail dispatch) and 'store' (branch shops);
 * 'main' and 'godown' only move stock on to them; 'semi' is printed but not yet bound.
 */
export function godownKind(scope: 'hq' | 'branch', sheet: string, godown: string, nonSales: string[] = []): 'main' | 'retail' | 'semi' | 'store' | 'godown' {
	const g = `${sheet} ${godown}`.toLowerCase();
	if (scope === 'hq') return /semi/.test(g) ? 'semi' : /retail/.test(g) ? 'retail' : 'main';
	if (nonSales.some((n) => n && godown.toLowerCase().replace(/\s+/g, ' ').trim() === n.toLowerCase().replace(/\s+/g, ' ').trim())) return 'godown';
	return /godown/i.test(godown) ? 'godown' : 'store';
}
