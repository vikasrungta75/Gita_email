/**
 * Settings for the email screen, kept in organisations.settings.email and edited in Settings:
 *  - the six primary groups (tabs) and their sub-tags, and which of the 22 reasons belongs to which group;
 *  - the facts a complete reply needs, per group and sub-tag (completeness);
 *  - criticality: the level each group or sub-tag starts at, and the reply-time target (SLA) per group;
 *  - sync window (30/60/90 days) and how often mail is read;
 *  - the start month of the "current year" for Kalyan customers;
 *  - auto-send: defined here for the future, but it cannot be switched on in this version.
 */
import { getOrg, invalidateOrg } from '../settings';
import { q } from '../db';
import { defaultOrgId } from '../auth';
import { HttpError } from '../http';

export const GROUPS = [
	{ key: 'order_issues', label: 'Book order issues', labelHi: 'पुस्तक ऑर्डर संबंधी', subTags: ['not_received', 'damaged_wrong', 'tracking', 'payment_refund', 'cancellation', 'others'] },
	{ key: 'kalyan', label: 'Kalyan', labelHi: 'कल्याण', subTags: ['membership_status', 'delivery_status', 'new_request', 'others'] },
	{ key: 'bulk_order', label: 'New order — bulk', labelHi: 'नया ऑर्डर — थोक', subTags: [] },
	{ key: 'retail_order', label: 'New order — retail', labelHi: 'नया ऑर्डर — फुटकर', subTags: [] },
	{ key: 'international', label: 'International orders', labelHi: 'विदेश के ऑर्डर', subTags: [] },
	{ key: 'others', label: 'Others', labelHi: 'अन्य', subTags: [] },
] as const;
export type GroupKey = (typeof GROUPS)[number]['key'];
export const GROUP_KEYS = GROUPS.map((g) => g.key) as GroupKey[];

export const SUBTAG_LABEL: Record<string, string> = {
	not_received: 'Not received', damaged_wrong: 'Damaged or wrong book', tracking: 'Tracking request', payment_refund: 'Payment / refund', cancellation: 'Cancellation',
	membership_status: 'Membership status', delivery_status: 'Delivery status', new_request: 'New Kalyan request', others: 'Others',
};

/** Every fact the enrichment can fill, with the question asked when it cannot. */
export const FACTS: Record<string, { label: string; question: string; kind: 'lookup' | 'value'; hint?: string; needsUpload?: string }> = {
	order_number: { label: 'Order number', question: 'Order not found — type the order number (e.g. GPHO_351981), or leave it to ask the reader', kind: 'lookup', hint: 'order', needsUpload: 'Book orders' },
	order_date: { label: 'Order date', question: 'Order date', kind: 'value' },
	order_amount: { label: 'Amount', question: 'Order amount', kind: 'value' },
	order_status: { label: 'Order status', question: 'Order status', kind: 'value', needsUpload: 'Book orders' },
	delivery_partner: { label: 'Delivery partner', question: 'Which courier or India Post sent this order?', kind: 'value', needsUpload: 'Book orders' },
	tracking: { label: 'Tracking number and link', question: 'Tracking number (not yet in the orders file)', kind: 'value', needsUpload: 'Book orders' },
	kalyan_custno: { label: 'Kalyan customer number', question: 'Kalyan customer number not found — type it, or leave it to ask the reader', kind: 'lookup', hint: 'custno' },
	kalyan_type: { label: 'Subscription type', question: 'Subscription type (1 year, 5 years or life member)', kind: 'value', needsUpload: 'Kalyan customers' },
	kalyan_dispatch: { label: 'Last dispatch (issue, date, mode)', question: 'Last Kalyan dispatch for this customer', kind: 'value', needsUpload: 'Kalyan tracking' },
	kalyan_tracking: { label: 'Registered post number or "ordinary post"', question: 'Registered post number', kind: 'value', needsUpload: 'Kalyan tracking' },
	kalyan_active: { label: 'Active this year', question: 'Is this customer active this year?', kind: 'value', needsUpload: 'Kalyan current-year customers' },
	kalyan_payment: { label: 'Last payment (date, receipt)', question: 'Last payment date and receipt number', kind: 'value', needsUpload: 'Kalyan current-year customers' },
	kalyan_renewal: { label: 'Estimated renewal', question: 'When is the renewal due?', kind: 'value' },
	kalyan_prices: { label: 'Kalyan subscription prices', question: 'Kalyan subscription prices (1 year, 5 years, life member)', kind: 'value' },
	kalyan_modes: { label: 'Dispatch modes', question: 'Kalyan dispatch modes', kind: 'value' },
	books: { label: 'Book code and title', question: 'Which book(s)? Type codes with quantities (e.g. 6 x 10, 1388 x 2)', kind: 'lookup', hint: 'books' },
	availability: { label: 'Availability and count', question: 'Stock not uploaded for this book', kind: 'value', needsUpload: 'Main stock / Branch stock' },
	price: { label: 'Price', question: 'Price of this book', kind: 'value', needsUpload: 'Book list (Suchi)' },
	discount: { label: 'Discount', question: 'Discount', kind: 'value' },
	postage: { label: 'Postage', question: 'Postage', kind: 'value' },
	intl_shipping: { label: 'International shipping', question: 'International shipping cost to this country', kind: 'value' },
	location: { label: 'Reader location', question: 'Reader\'s city or PIN code (for the nearest branch)', kind: 'lookup', hint: 'location' },
	bank: { label: 'Bank details', question: 'Bank details', kind: 'value' },
	buy_links: { label: 'Buy links', question: 'gitapress.org or Amazon link', kind: 'value', needsUpload: 'Book links' },
};

export const DEFAULT_FACTS: Record<string, string[]> = {
	'order_issues': ['order_number', 'order_date', 'order_amount', 'order_status', 'delivery_partner', 'tracking'],
	'order_issues/payment_refund': ['order_number', 'order_date', 'order_amount', 'order_status'],
	'order_issues/cancellation': ['order_number', 'order_date', 'order_amount', 'order_status'],
	'kalyan/delivery_status': ['kalyan_custno', 'kalyan_type', 'kalyan_dispatch', 'kalyan_tracking'],
	'kalyan/membership_status': ['kalyan_custno', 'kalyan_type', 'kalyan_active', 'kalyan_payment', 'kalyan_renewal'],
	'kalyan/new_request': ['kalyan_prices', 'kalyan_modes', 'bank'],
	'kalyan/others': ['kalyan_custno'],
	'kalyan': ['kalyan_custno'],
	'retail_order': ['books', 'availability', 'price', 'postage', 'bank', 'buy_links'],
	'bulk_order': ['books', 'availability', 'price', 'discount', 'postage', 'bank'],
	'international': ['books', 'availability', 'price', 'intl_shipping', 'bank'],
	'others': [],
};

export type Level = 'critical' | 'high' | 'medium' | 'low';
export const LEVELS: Level[] = ['critical', 'high', 'medium', 'low'];
export const LEVEL_LABEL: Record<Level, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
export const DEFAULT_BASE_LEVEL: Record<string, Level> = {
	'order_issues/not_received': 'high', 'order_issues/damaged_wrong': 'critical', 'order_issues/payment_refund': 'high', 'order_issues/tracking': 'medium',
	'order_issues/cancellation': 'medium', 'order_issues/others': 'medium', 'order_issues': 'medium',
	'kalyan/delivery_status': 'high', 'kalyan/membership_status': 'medium', 'kalyan/new_request': 'medium', 'kalyan/others': 'low', 'kalyan': 'medium',
	bulk_order: 'high', international: 'high', retail_order: 'medium', others: 'low',
};

export interface EmailConfig {
	syncDays: 30 | 60 | 90;
	syncEveryMinutes: number;
	slaWorkingDays: Record<string, number>;
	baseLevel: Record<string, Level>;
	facts: Record<string, string[]>;
	reasonGroup: Record<string, GroupKey>;
	kalyanYearStartMonth: number;
	kalyanMasterFields: string[];
	autoSend: { enabled: false; groups: string[] };
}

/** Default primary group for each of the 22 reasons for contacting (editable). */
export const DEFAULT_REASON_GROUP: Record<string, GroupKey> = {
	kalyan: 'kalyan', book_order: 'retail_order', order_tracking: 'order_issues', availability_price: 'retail_order', international: 'international', bulk_order: 'bulk_order',
	dealer: 'bulk_order', suggestion_content: 'others', suggestion_printing: 'others', seva: 'others', complaint: 'order_issues', payment_refund: 'order_issues',
	translation: 'others', permission: 'others', scripture_question: 'others', branch_address: 'others', ebook_website: 'others', book_fair_event: 'others',
	donation: 'others', visit_stay: 'others', job: 'others', other: 'others',
};

export const KALYAN_MASTER_FIELDS = ['CustNo', 'BookID', 'SubPeriod', 'Custtype', 'title', 'firstname', 'midname', 'lastname', 'add1', 'add2', 'add3', 'city', 'pin', 'state', 'country', 'regdate',
	'Yearstart', 'YearEnd', 'DispMode', 'ForceDispMode', 'VppStatus', 'vppst', 'Nextyr_novpp', 'DeadCustomer', 'dead', 'DeadReason', 'MailStatus', 'RejReason', 'oldcustno', 'nqty', 'hqty',
	'BalAmt', 'CurYearBal', 'LastYearBal', 'MaxissueNo', 'subbranch', 'Postalcenter', 'LTITLE', 'LFIRSTNAME', 'LMIDNAME', 'LLASTNAME', 'LADD1', 'LADD2', 'LADD3', 'LCITY', 'LPIN', 'LSTATE', 'LCOUNTRY'];

export const DEFAULT_CONFIG: EmailConfig = {
	syncDays: 90,
	syncEveryMinutes: 5,
	slaWorkingDays: { order_issues: 2, kalyan: 2, bulk_order: 2, retail_order: 2, international: 2, others: 2 },
	baseLevel: DEFAULT_BASE_LEVEL,
	facts: DEFAULT_FACTS,
	reasonGroup: DEFAULT_REASON_GROUP,
	kalyanYearStartMonth: 1,
	kalyanMasterFields: KALYAN_MASTER_FIELDS,
	autoSend: { enabled: false, groups: [] },
};

export async function emailConfig(orgId: number): Promise<EmailConfig> {
	const saved: any = ((await getOrg(orgId)).settings as any).email || {};
	return {
		...DEFAULT_CONFIG, ...saved,
		slaWorkingDays: { ...DEFAULT_CONFIG.slaWorkingDays, ...(saved.slaWorkingDays || {}) },
		baseLevel: { ...DEFAULT_CONFIG.baseLevel, ...(saved.baseLevel || {}) },
		facts: { ...DEFAULT_CONFIG.facts, ...(saved.facts || {}) },
		reasonGroup: { ...DEFAULT_CONFIG.reasonGroup, ...(saved.reasonGroup || {}) },
		kalyanMasterFields: Array.isArray(saved.kalyanMasterFields) && saved.kalyanMasterFields.length ? saved.kalyanMasterFields : KALYAN_MASTER_FIELDS,
		// sending is never automatic in this version, whatever is stored
		autoSend: { enabled: false, groups: Array.isArray(saved.autoSend?.groups) ? saved.autoSend.groups : [] },
	};
}

export async function saveEmailConfig(orgId: number, input: any): Promise<EmailConfig> {
	const cur = await emailConfig(orgId);
	const next: any = { ...cur };
	if (input.syncDays !== undefined) {
		if (![30, 60, 90].includes(Number(input.syncDays))) throw new HttpError(400, 'Choose 30, 60 or 90 days');
		next.syncDays = Number(input.syncDays);
	}
	if (input.syncEveryMinutes !== undefined) next.syncEveryMinutes = Math.max(1, Math.min(60, Math.round(Number(input.syncEveryMinutes) || 5)));
	if (input.slaWorkingDays) for (const [k, v] of Object.entries(input.slaWorkingDays)) if (GROUP_KEYS.includes(k as GroupKey)) next.slaWorkingDays[k] = Math.max(0.5, Math.min(30, Number(v) || 2));
	if (input.baseLevel) for (const [k, v] of Object.entries(input.baseLevel)) if (LEVELS.includes(v as Level)) next.baseLevel[k] = v;
	if (input.facts) for (const [k, v] of Object.entries(input.facts)) if (Array.isArray(v)) next.facts[k] = (v as string[]).filter((f) => FACTS[f]);
	if (input.reasonGroup) for (const [k, v] of Object.entries(input.reasonGroup)) if (GROUP_KEYS.includes(v as GroupKey)) next.reasonGroup[k] = v;
	if (input.kalyanYearStartMonth !== undefined) next.kalyanYearStartMonth = Math.max(1, Math.min(12, Math.round(Number(input.kalyanYearStartMonth) || 1)));
	if (Array.isArray(input.kalyanMasterFields)) next.kalyanMasterFields = input.kalyanMasterFields.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 80);
	if (input.autoSend) {
		if (input.autoSend.enabled) throw new HttpError(400, 'Automatic sending is coming later and cannot be switched on yet. Every reply is sent by a person pressing Send.');
		next.autoSend = { enabled: false, groups: (Array.isArray(input.autoSend.groups) ? input.autoSend.groups : []).filter((g: string) => GROUP_KEYS.includes(g as GroupKey)) };
	}
	await q(`update organisations set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('email', $2::jsonb) where id=$1`, [orgId, JSON.stringify(next)]);
	invalidateOrg(orgId);
	// a change of rules means every open email is worked out again
	await q(`update conversations set needs_enrich=true where org_id=$1 and not not_for_reply`, [orgId]);
	return emailConfig(orgId);
}

/** How often the server reads mail (minutes). */
export async function syncIntervalMinutes(): Promise<number> {
	return (await emailConfig(await defaultOrgId())).syncEveryMinutes;
}

/** The facts needed for a group and sub-tag: the sub-tag's list, else the group's. */
export function factsFor(cfg: EmailConfig, group: string, subTags: string[]): string[] {
	for (const t of subTags) if (cfg.facts[`${group}/${t}`]) return cfg.facts[`${group}/${t}`];
	return cfg.facts[group] || [];
}
export function baseLevelFor(cfg: EmailConfig, group: string, subTags: string[]): Level {
	const levels = subTags.map((t) => cfg.baseLevel[`${group}/${t}`]).filter(Boolean) as Level[];
	if (levels.length) return levels.sort((a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b))[0];
	return cfg.baseLevel[group] || 'low';
}

/** Working days between a time and now (Monday to Saturday count; Sunday does not). */
export function workingDaysSince(from: Date, now = new Date()): number {
	let days = 0;
	const d = new Date(from);
	while (d < now) {
		const next = new Date(d.getTime() + 3600_000);
		if (d.getUTCDay() !== 0) days += (Math.min(next.getTime(), now.getTime()) - d.getTime()) / 86400_000;
		d.setTime(next.getTime());
		if (days > 60) break;
	}
	return Math.round(days * 100) / 100;
}
