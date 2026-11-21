/**
 * Master data that changes rarely and is edited in Admin → Master data: bank details (with the payment QR),
 * discount slabs, freight (postage) slabs and Kalyan subscription prices. One value per key; every change is kept
 * in master_history with who made it, and bank changes are audited.
 *
 * The defaults are Gita Press's published figures (October 2026): Settings show them until someone edits them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { one, q } from '../db';
import { HttpError } from '../http';

export interface BankDetails {
	beneficiary: string;
	beneficiaryNote: string;
	account: string;
	bank: string;
	branch: string;
	ifsc: string;
	swift: string;
	upi: string;
	afterPaying: string[];
}
export interface DiscountSlab { from: number; to: number | null; pct: number; extraPct?: number }
export interface Discount { effectiveFrom: string; slabs: DiscountSlab[]; note: string }
export interface FreightSlab { to: number; postage: number }
export interface Freight { slabs: FreightSlab[]; freeAbove: number | null; international: string; note: string }
export interface KalyanPrices { prices: Record<string, number | null>; note: string }

export const DEFAULTS = {
	bank: {
		beneficiary: 'Gobind Bhawan Karyalaya',
		beneficiaryNote: 'Gita Press, Gorakhpur',
		account: '305201010035092',
		bank: 'Union Bank of India',
		branch: 'Sahebganj, Gorakhpur, Uttar Pradesh, India',
		ifsc: 'UBIN0530522',
		swift: 'UBININBBVRN',
		upi: 'QR918188087745-5092@unionbankofindia',
		afterPaying: [
			'Transaction details (reference / UTR no., date, amount)',
			'Complete postal address for dispatch',
			'Purpose of payment (e.g. purchase of books)',
		],
	} as BankDetails,
	discount: {
		effectiveFrom: '2026-07-01',
		slabs: [
			{ from: 2001, to: 5000, pct: 10 },
			{ from: 5001, to: 15000, pct: 20 },
			{ from: 15001, to: null, pct: 20, extraPct: 5 },
		],
		note: 'Applied only in email quotes and bulk-order replies, never on retail price lines. Above ₹15,000: 20% off, then a further 5% off the net.',
	} as Discount,
	freight: {
		slabs: [
			{ to: 100, postage: 40 },
			{ to: 300, postage: 70 },
			{ to: 700, postage: 150 },
			{ to: 1000, postage: 200 },
		],
		freeAbove: 1000,
		international: '',
		note: 'Postage within India by book value before discount. Above ₹1,000 postage is free.',
	} as Freight,
	kalyan_prices: { prices: { '1Y': null, FY: null, LM: null }, note: 'Kalyan subscription prices used in replies to new subscription requests.' } as KalyanPrices,
};
export type MasterKey = keyof typeof DEFAULTS;
export const MASTER_KEYS = Object.keys(DEFAULTS) as MasterKey[];
export const MASTER_LABEL: Record<MasterKey, string> = { bank: 'Bank details', discount: 'Discount details', freight: 'Freight charges', kalyan_prices: 'Kalyan subscription prices' };

const cache = new Map<string, { at: number; v: any }>();
export async function getMaster<K extends MasterKey>(orgId: number, key: K): Promise<(typeof DEFAULTS)[K]> {
	const ck = `${orgId}:${key}`;
	const hit = cache.get(ck);
	if (hit && Date.now() - hit.at < 30_000) return hit.v;
	const row = await one<any>('select value from master_values where org_id=$1 and key=$2', [orgId, key]);
	const v = { ...(DEFAULTS[key] as any), ...(row?.value || {}) };
	cache.set(ck, { at: Date.now(), v });
	return v;
}
export async function allMaster(orgId: number) {
	const out: Record<string, any> = {};
	for (const k of MASTER_KEYS) out[k] = await getMaster(orgId, k);
	const hist = await q<any>(
		`select h.key, h.changed_at, u.full_name as changed_by from master_history h left join users u on u.id=h.changed_by
		  where h.org_id=$1 order by h.changed_at desc limit 40`, [orgId]);
	const qr = await one<any>('select file_name, updated_at from master_files where org_id=$1 and key=$2', [orgId, 'bank_qr']);
	return { values: out, defaults: DEFAULTS, labels: MASTER_LABEL, history: hist, qr: qr || { file_name: 'bank-qr.png (default)', updated_at: null } };
}

const num = (v: unknown, what: string, min = 0, max = 10_000_000) => {
	const n = Number(v);
	if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${what} must be a number between ${min} and ${max}`);
	return n;
};
const text = (v: unknown, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Checks and tidies a value before it is saved. */
export function validate(key: MasterKey, input: any): any {
	if (key === 'bank') {
		const b: BankDetails = {
			beneficiary: text(input.beneficiary), beneficiaryNote: text(input.beneficiaryNote), account: text(input.account, 40).replace(/\s/g, ''),
			bank: text(input.bank), branch: text(input.branch), ifsc: text(input.ifsc, 20).toUpperCase(), swift: text(input.swift, 20).toUpperCase(), upi: text(input.upi, 120),
			afterPaying: (Array.isArray(input.afterPaying) ? input.afterPaying : String(input.afterPaying || '').split('\n')).map((x: unknown) => text(x, 200)).filter(Boolean).slice(0, 10),
		};
		if (!b.beneficiary || !b.account || !b.bank || !b.ifsc) throw new HttpError(400, 'Beneficiary name, account number, bank and IFSC are required');
		if (!/^\d{6,20}$/.test(b.account)) throw new HttpError(400, 'The account number should be 6 to 20 digits');
		if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(b.ifsc)) throw new HttpError(400, 'The IFSC should look like UBIN0530522 (4 letters, 0, then 6 letters or digits)');
		if (b.swift && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b.swift)) throw new HttpError(400, 'The SWIFT/BIC should be 8 or 11 letters and digits');
		return b;
	}
	if (key === 'discount') {
		const slabs: DiscountSlab[] = (Array.isArray(input.slabs) ? input.slabs : []).map((s: any, i: number) => ({
			from: num(s.from, `Slab ${i + 1} "from"`), to: s.to === null || s.to === '' || s.to === undefined ? null : num(s.to, `Slab ${i + 1} "to"`),
			pct: num(s.pct, `Slab ${i + 1} discount %`, 0, 90), ...(s.extraPct ? { extraPct: num(s.extraPct, `Slab ${i + 1} extra %`, 0, 90) } : {}),
		})).sort((a: DiscountSlab, b: DiscountSlab) => a.from - b.from);
		slabs.forEach((s, i) => { if (s.to !== null && s.to < s.from) throw new HttpError(400, `Slab ${i + 1}: "to" is below "from"`); });
		if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.effectiveFrom || ''))) throw new HttpError(400, 'Give the date the discount applies from');
		return { effectiveFrom: String(input.effectiveFrom), slabs, note: text(input.note, 400) };
	}
	if (key === 'freight') {
		const slabs: FreightSlab[] = (Array.isArray(input.slabs) ? input.slabs : []).map((s: any, i: number) => ({ to: num(s.to, `Slab ${i + 1} "up to"`, 1), postage: num(s.postage, `Slab ${i + 1} postage`) }))
			.sort((a: FreightSlab, b: FreightSlab) => a.to - b.to);
		if (!slabs.length) throw new HttpError(400, 'Add at least one postage slab');
		const freeAbove = input.freeAbove === null || input.freeAbove === '' || input.freeAbove === undefined ? null : num(input.freeAbove, 'Free postage above');
		return { slabs, freeAbove, international: text(input.international, 400), note: text(input.note, 400) };
	}
	const prices: Record<string, number | null> = {};
	for (const [k, v] of Object.entries(input.prices || {})) prices[text(k, 10).toUpperCase()] = v === null || v === '' ? null : num(v, `Price for ${k}`);
	return { prices, note: text(input.note, 400) };
}

export async function saveMaster(orgId: number, userId: number | null, key: MasterKey, input: any) {
	if (!MASTER_KEYS.includes(key)) throw new HttpError(404, 'Unknown master data');
	const value = validate(key, input || {});
	await q(
		`insert into master_values (org_id, key, value, updated_by) values ($1,$2,$3,$4)
		 on conflict (org_id, key) do update set value=excluded.value, updated_at=now(), updated_by=excluded.updated_by`,
		[orgId, key, JSON.stringify(value), userId],
	);
	await q('insert into master_history (org_id, key, value, changed_by) values ($1,$2,$3,$4)', [orgId, key, JSON.stringify(value), userId]);
	cache.delete(`${orgId}:${key}`);
	return value;
}

// ── Payment QR image ────────────────────────────────────────────────────────
const DEFAULT_QR = (() => { try { return fs.readFileSync(path.resolve('server/static/bank-qr.png')); } catch { return null; } })();
export async function bankQr(orgId: number): Promise<{ bytes: Buffer; type: string } | null> {
	const row = await one<any>('select bytes, content_type from master_files where org_id=$1 and key=$2', [orgId, 'bank_qr']);
	if (row) return { bytes: row.bytes, type: row.content_type };
	return DEFAULT_QR ? { bytes: DEFAULT_QR, type: 'image/png' } : null;
}
export async function saveBankQr(orgId: number, fileName: string, type: string, bytes: Uint8Array) {
	if (!/^image\/(png|jpeg)$/.test(type)) throw new HttpError(400, 'Upload the QR as a PNG or JPEG image');
	if (bytes.length > 2_000_000) throw new HttpError(400, 'The image is larger than 2 MB');
	await q(
		`insert into master_files (org_id, key, file_name, content_type, bytes) values ($1,'bank_qr',$2,$3,$4)
		 on conflict (org_id, key) do update set file_name=excluded.file_name, content_type=excluded.content_type, bytes=excluded.bytes, updated_at=now()`,
		[orgId, fileName.slice(0, 200), type, Buffer.from(bytes)],
	);
}

// ── The rules themselves ────────────────────────────────────────────────────
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Postage within India for a book value (before discount). */
export function postageFor(f: Freight, bookValue: number): number {
	if (bookValue <= 0) return 0;
	if (f.freeAbove !== null && bookValue > f.freeAbove) return 0;
	const slab = f.slabs.find((s) => bookValue <= s.to);
	return slab ? slab.postage : f.slabs[f.slabs.length - 1]?.postage ?? 0;
}

/** Discount on a book value: the slab percentage, then any extra percentage on the net. */
export function discountFor(d: Discount, bookValue: number): { pct: number; extraPct: number; amount: number; net: number; label: string } {
	// slabs are contiguous (2,001–5,000, 5,001–15,000, 15,001+): the highest slab whose start has been reached
	const v = Math.ceil(bookValue - 1e-9);
	const slab = [...d.slabs].sort((a, b) => a.from - b.from).filter((s) => v >= s.from).pop();
	if (!slab) return { pct: 0, extraPct: 0, amount: 0, net: bookValue, label: 'No discount' };
	const afterFirst = bookValue * (1 - slab.pct / 100);
	const net = slab.extraPct ? afterFirst * (1 - slab.extraPct / 100) : afterFirst;
	const amount = round2(bookValue - net);
	return { pct: slab.pct, extraPct: slab.extraPct || 0, amount, net: round2(net), label: slab.extraPct ? `${slab.pct}% + ${slab.extraPct}% on net` : `${slab.pct}%` };
}

/** Book value, discount (quotes only), postage (on the pre-discount value) and total payable. */
export function quoteTotals(d: Discount, f: Freight, bookValue: number, opts: { discount: boolean; international?: boolean }) {
	const disc = opts.discount ? discountFor(d, bookValue) : { pct: 0, extraPct: 0, amount: 0, net: bookValue, label: 'No discount' };
	const postage = opts.international ? null : postageFor(f, bookValue);
	return { bookValue: round2(bookValue), discount: disc, postage, total: round2(disc.net + (postage ?? 0)) };
}

/** Bank details as plain text for a reply (English or Hindi headings). */
export function bankText(b: BankDetails, hindi = false, international = false): string {
	const rows = [
		[hindi ? 'लाभार्थी' : 'Beneficiary name', `${b.beneficiary}${b.beneficiaryNote ? ` (${b.beneficiaryNote})` : ''}`],
		[hindi ? 'खाता संख्या' : 'Account number', b.account],
		[hindi ? 'बैंक' : 'Bank', b.bank],
		[hindi ? 'शाखा' : 'Branch', b.branch],
		['IFSC', b.ifsc],
		...(international && b.swift ? [['SWIFT / BIC', b.swift]] : []),
		...(b.upi ? [['UPI', b.upi]] : []),
	];
	const after = b.afterPaying.length ? `\n${hindi ? 'भुगतान के बाद कृपया भेजें:' : 'After paying, please send:'}\n${b.afterPaying.map((a) => `- ${a}`).join('\n')}` : '';
	return `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${after}`;
}
