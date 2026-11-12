/**
 * Shared rules for the files Gita Press uploads (orders, Kalyan dispatch, book list): how phones, emails, order
 * numbers, tracking numbers, courier names, states and languages are tidied before anything is matched or stored.
 * The name lists can be extended in Settings → Master data → Mappings; a saved entry adds to the ones here.
 */
import { createHash } from 'node:crypto';
import { getOrg } from '../settings';
import { stateFromPin } from '../enrich';

export const clean = (v: unknown, n = 300) => String(v ?? '').replace(/_x[0-9A-Fa-f]{4}_/g, ' ').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, n);
/** "#N/A", "NULL", "-" and the like mean the cell is empty. */
export const blank = (v: unknown) => /^(#n\/a|n\/a|na|null|nil|none|-+|\.+|0)?$/i.test(clean(v));
export const hash = (parts: unknown[]) => createHash('sha1').update(parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('\u0001')).digest('hex').slice(0, 20);

/** The last 10 digits of an Indian mobile number, or null when it is not one. */
export function phone10(v: unknown): string | null {
	const d = String(v ?? '').replace(/\.0+$/, '').replace(/\D/g, '');
	const p = d.length > 10 ? d.slice(-10) : d;
	return /^[6-9]\d{9}$/.test(p) && !/^(\d)\1{9}$/.test(p) ? p : null;
}

/** A usable email address, lower-cased; cut-short ones ("name@domain" with no ".com") are refused. */
export function validEmail(v: unknown): string | null {
	const e = clean(v, 200).toLowerCase().replace(/^mailto:/, '').replace(/[,;]+$/, '');
	return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e) && !/\.\./.test(e) ? e : null;
}

/**
 * The order number as written, in capitals and without spaces. Imported orders ("GPHO341633") and online orders
 * ("GPHO_341633") are two different numbering series: the same digits with and without the underscore are two
 * different orders (checked on the October–November 2026 file: 243 such pairs, all different customers), so the
 * underscore is kept.
 */
export const orderKey = (v: unknown) => clean(v, 60).toUpperCase().replace(/\s+/g, '');

export const pin6 = (v: unknown) => { const p = String(v ?? '').replace(/\.0+$/, '').replace(/\D/g, ''); return /^[1-9]\d{5}$/.test(p) ? p : ''; };

/**
 * A tracking number as the courier issued it. Excel turns long numbers into "5.0E+12", which cannot be tracked:
 * those are kept as text and marked damaged, and never put in a link.
 */
export function tracking(v: unknown): { id: string | null; ok: boolean; damaged: boolean } {
	const raw = clean(v, 80);
	if (blank(raw)) return { id: null, ok: false, damaged: false };
	if (/^\d(\.\d+)?e\+?\d+$/i.test(raw)) return { id: raw, ok: false, damaged: true };
	const id = raw.toUpperCase().replace(/\s+/g, '');
	const ok = /^[A-Z0-9-]{8,30}$/.test(id) && /\d{5}/.test(id) && !/\s/.test(raw.trim());
	return { id: ok ? id : raw, ok, damaged: false };
}

// ── mappings (defaults here, additions from Settings) ───────────────────────

export interface Mappings {
	/** courier name as written in the orders file (lower case) → the name Gita Mail shows */
	couriers: Record<string, string>;
	/** courier name → tracking website */
	courierSites: Record<string, string>;
	/** state as written (letters only, upper case) → state */
	states: Record<string, string>;
	/** language as written (lower case) → language as in the book master */
	languages: Record<string, string>;
	orderStatus: Record<string, string>;
	subperiod: Record<string, string>;
	dispMode: Record<string, string>;
}

export const INDIA_POST = 'India Post';
export const INDIA_POST_URL = 'https://www.indiapost.gov.in/';

export const DEFAULT_MAPPINGS: Mappings = {
	couriers: {
		'india post': INDIA_POST, indiapost: INDIA_POST, 'speed post': INDIA_POST, 'registered post': INDIA_POST, post: INDIA_POST,
		trackon: 'Trackon', 'www.trackon.in': 'Trackon', 'trackon.in': 'Trackon', 'trackon courier': 'Trackon',
		delhivery: 'Delhivery', 'www.delhivery.in': 'Delhivery', 'delhivery.in': 'Delhivery', 'www.delhivery.com': 'Delhivery',
		ekart: 'Ekart', 'www.ekart.in': 'Ekart', 'ekart.in': 'Ekart', 'ekart logistics': 'Ekart',
		dtdc: 'DTDC', 'www.dtdc.in': 'DTDC', 'dtdc.in': 'DTDC', 'dtdc courier.in': 'DTDC', 'dtdc courier': 'DTDC',
	},
	courierSites: {
		[INDIA_POST]: INDIA_POST_URL, Trackon: 'https://www.trackon.in/', Delhivery: 'https://www.delhivery.com/', Ekart: 'https://ekartlogistics.com/', DTDC: 'https://www.dtdc.in/',
	},
	states: {
		UP: 'Uttar Pradesh', UTTARPRADESH: 'Uttar Pradesh', UTTERPRADESH: 'Uttar Pradesh', MP: 'Madhya Pradesh', MADHYAPRADESH: 'Madhya Pradesh', HP: 'Himachal Pradesh', AP: 'Andhra Pradesh',
		UK: 'Uttarakhand', UTTARANCHAL: 'Uttarakhand', UTTRAKHAND: 'Uttarakhand', UTTARAKHAND: 'Uttarakhand', ORISSA: 'Odisha', ODISHA: 'Odisha', WB: 'West Bengal', WESTBENGAL: 'West Bengal',
		TN: 'Tamil Nadu', TAMILNADU: 'Tamil Nadu', MH: 'Maharashtra', MAHARASTRA: 'Maharashtra', MAHARASHTRA: 'Maharashtra', GUJRAT: 'Gujarat', GUJARAT: 'Gujarat', RAJ: 'Rajasthan', RAJASTHAN: 'Rajasthan',
		CG: 'Chhattisgarh', CHATTISGARH: 'Chhattisgarh', CHHATISGARH: 'Chhattisgarh', CHHATTISGARH: 'Chhattisgarh', JK: 'Jammu and Kashmir', JAMMUKASHMIR: 'Jammu and Kashmir', JAMMUANDKASHMIR: 'Jammu and Kashmir',
		NEWDELHI: 'Delhi', DELHI: 'Delhi', NCTOFDELHI: 'Delhi', PONDICHERRY: 'Puducherry', PUDUCHERRY: 'Puducherry', KARNATAK: 'Karnataka', KARNATAKA: 'Karnataka', TELANGANA: 'Telangana', TELENGANA: 'Telangana',
		ANDHRAPRADESH: 'Andhra Pradesh', ARUNACHALPRADESH: 'Arunachal Pradesh', ASSAM: 'Assam', BIHAR: 'Bihar', GOA: 'Goa', HARYANA: 'Haryana', HARIYANA: 'Haryana', HIMACHALPRADESH: 'Himachal Pradesh',
		JHARKHAND: 'Jharkhand', KERALA: 'Kerala', MANIPUR: 'Manipur', MEGHALAYA: 'Meghalaya', MIZORAM: 'Mizoram', NAGALAND: 'Nagaland', PUNJAB: 'Punjab', SIKKIM: 'Sikkim', TRIPURA: 'Tripura',
		CHANDIGARH: 'Chandigarh', LADAKH: 'Ladakh', NEPAL: 'Nepal', ANDAMANANDNICOBAR: 'Andaman and Nicobar', ANDAMANNICOBAR: 'Andaman and Nicobar', DAMANANDDIU: 'Dadra and Nagar Haveli and Daman and Diu', DADRAANDNAGARHAVELI: 'Dadra and Nagar Haveli and Daman and Diu',
	},
	languages: { bengali: 'Bangla', odia: 'Oriya', malayalam: 'Malyalam', assamese: 'Assamiya' },
	orderStatus: { '4': 'Shipped' },
	subperiod: { '1Y': '1 year', FY: '5 years', LM: 'Life member' },
	dispMode: { ORDINARY: 'Ordinary post (no tracking)', REGISTERED: 'Registered post (tracked)', 'BY SHOP': 'Collected at a shop' },
};

export function mergeMappings(saved: any): Mappings {
	const out: any = {};
	for (const k of Object.keys(DEFAULT_MAPPINGS) as (keyof Mappings)[]) out[k] = { ...DEFAULT_MAPPINGS[k], ...((saved && typeof saved[k] === 'object' && saved[k]) || {}) };
	return out;
}
export async function getMappings(orgId: number): Promise<Mappings> {
	return mergeMappings(((await getOrg(orgId)).settings as any).mappings);
}

/** The courier name Gita Mail shows, and whether the name in the file was recognised. */
export function courier(m: Mappings, v: unknown): { name: string | null; known: boolean } {
	const raw = clean(v, 80);
	if (blank(raw)) return { name: null, known: false };
	const k = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
	const hit = m.couriers[k] || m.couriers[k.replace(/^www\./, '')];
	return hit ? { name: hit, known: true } : { name: raw, known: false };
}

/** The state from the PIN code when there is one (most reliable), else from the name as written. */
export function stateName(m: Mappings, state: unknown, pin?: unknown): string | null {
	const p = pin6(pin);
	const byPin = p ? stateFromPin(p) : null;
	if (byPin) return byPin;
	const k = clean(state, 80).toUpperCase().replace(/[^A-Z]/g, '');
	return (k && m.states[k]) || null;
}

export const subType = (v: unknown) => clean(v, 10).toUpperCase();
export const SUB_LABEL: Record<string, string> = { '1Y': '1 year', FY: '5 years', LM: 'Life member' };

/** Excel serial date, ISO date or dd-mm-yyyy → 'YYYY-MM-DD'. */
export function dateOnly(v: unknown): string | null {
	if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400_000)).toISOString().slice(0, 10);
	const s = clean(v, 40);
	if (/^\d{5}(\.\d+)?$/.test(s)) return dateOnly(Number(s));
	let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
	if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
	m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
	if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
	return null;
}

export const amount = (v: unknown): number | null => {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	const s = clean(v, 40).replace(/[₹,\s]/g, '');
	if (!s) return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : NaN;
};

/** Header names are compared without case, spaces or punctuation ("subTotal" = "subtotal" = "Sub total"). */
export const headKey = (h: unknown) => clean(h, 80).toLowerCase().replace(/[^a-z0-9]/g, '');
