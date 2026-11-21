/**
 * Email completeness: for every email that needs a reply, work out
 *   1. its primary group (one of six tabs) and sub-tags, from the analysis, the reasons for contacting and the text;
 *   2. the facts a complete reply needs (Settings → Completeness), looked up in the latest uploads and master data:
 *      orders, Kalyan tracking and customers, stock, the book list (Suchi) and links, discount, freight, bank;
 *   3. a specific question for every fact that could not be found (staff answer it on the email, or once for all
 *      emails as a standing answer);
 *   4. a reply draft in the reader's language with found facts marked [[ok: …]] (shown green) and missing ones
 *      [[provide: question]] (shown yellow);
 *   5. the completeness %, the reply status (Ready to send / Pending information / Sent) and the criticality.
 *
 * Free: database lookups and rules only. A person's edits to a draft are never overwritten.
 */
import { one, q } from '../db';
import { getOrg } from '../settings';
import { upsertDraft } from '../drafts';
import { stockContext, currentStock } from '../stock/stock';
import { HQ_KEY, locationLabel, placeInText, BY_KEY, isAbroad, nearestBranch, type Place } from '../directory';
import { getMappings, phone10 } from '../uploads/common';
import { normCode } from '../master/books';
import { getMaster, quoteTotals, bankText, postageFor } from '../master/values';
import { SIZE_HI } from '../master/suchi';
import { kalyanYearOf } from '../kalyan/year';
import { emailConfig, factsFor, baseLevelFor, workingDaysSince, FACTS, LEVELS, type EmailConfig, type GroupKey, type Level } from './config';

// ── text helpers ────────────────────────────────────────────────────────────
const ok = (v: unknown) => `[[ok: ${String(v).replace(/\]\]/g, '] ]')}]]`;
const ask = (question: string) => `[[provide: ${question.replace(/\]\]/g, '] ]')}]]`;
const inr = (n: number | null | undefined) => (n === null || n === undefined ? '' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const day = (d: string | Date | null | undefined, hindi = false) =>
	d ? new Date(typeof d === 'string' && d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString(hindi ? 'hi-IN' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
export const isHindi = (text: string) => {
	const dev = (text.match(/[ऀ-ॿ]/g) || []).length;
	const lat = (text.match(/[A-Za-z]/g) || []).length;
	return dev >= 4 && dev > lat / 3;
};

// ── what the reader wrote: order numbers, Kalyan numbers, books with quantities, place ──
export function orderIdsIn(text: string): string[] {
	const out = new Set<string>();
	for (const m of text.matchAll(/\bGPHO[\s_-]?(\d{4,8})\b/gi)) out.add(m[0].toUpperCase().replace(/[\s-]/g, '_').replace(/^GPHO_?/, (p) => (p.endsWith('_') ? 'GPHO_' : 'GPHO')));
	for (const m of text.matchAll(/\b(?:order|ऑर्डर|आर्डर)\s*(?:no\.?|number|id|#|संख्या|नं\.?)?\s*[:#-]?\s*([A-Z]{0,5}[_-]?\d{5,8})\b/gi)) out.add(m[1].toUpperCase());
	return [...out].slice(0, 5);
}
export function custnosIn(text: string): string[] {
	const out = new Set<string>();
	const re = /(?:kalyan|कल्याण|customer|cust\.?|subscriber|subscription|member(?:ship)?|ग्राहक|सदस्य(?:ता)?)\s*(?:no\.?|number|id|code|#|संख्या|सं\.?|क्रमांक|नं\.?|नंबर)\s*[:#.-]?\s*([A-Z]{0,4}-?\d{3,7})\b/gi;
	for (const m of text.matchAll(re)) out.add(m[1].toUpperCase().replace(/^[A-Z]+-/, ''));
	return [...out].slice(0, 3);
}
/** "6 x 10, 1388 x 2" or "code 6 - 10 copies" → [{code, qty}] */
export function booksWithQty(text: string): { code: string; qty: number | null }[] {
	const out = new Map<string, number | null>();
	for (const m of text.matchAll(/\b([A-Z]{0,3}\d{1,5}[A-Z]?)\s*(?:x|×|\*|-|:|=)\s*(\d{1,6})\b/gi)) out.set(normCode(m[1]), Number(m[2]));
	for (const m of text.matchAll(/(?:code|कोड|book\s*no\.?)\s*[:#-]?\s*(\d{1,5})[^\n\d]{0,25}?(\d{1,6})\s*(?:copies|copy|nos|pcs|प्रति|प्रतियाँ|प्रतियां|books)/gi)) out.set(normCode(m[1]), Number(m[2]));
	return [...out.entries()].map(([code, qty]) => ({ code, qty }));
}
export function parseBooksAnswer(v: string): { code: string; qty: number | null }[] {
	return String(v || '').split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => {
		const m = p.match(/^([A-Z]{0,3}\d{1,5}[A-Z]?)\s*(?:(?:x|×|\*|-|:|=)\s*(\d{1,6}))?/i);
		return m ? { code: normCode(m[1]), qty: m[2] ? Number(m[2]) : null } : null;
	}).filter(Boolean) as { code: string; qty: number | null }[];
}
const PIN_RE = /\b([1-8]\d{5})\b/;

// ── classification ─────────────────────────────────────────────────────────
const NOT_FOR_REPLY_GROUPS = new Set(['notifications', 'internal', 'vendor_partner']);

export function classify(conv: any, text: string, cfg: EmailConfig, abroad: boolean): { group: GroupKey; subTags: string[] } {
	const bc = conv.business_category || '';
	const sub = conv.subcategory || '';
	const purposes: string[] = conv.purposes || [];
	const t = text.toLowerCase();
	const has = (re: RegExp) => re.test(t);
	const kalyanSub = (): string[] => {
		if (sub === 'new_subscription' || has(/new subscription|subscribe|सदस्य बनना|नया ग्राहक|ग्राहक बनना|सदस्यता लेनी/)) return ['new_request'];
		if (sub === 'issue_not_received' || has(/not received|nahi mila|नहीं मिल|नही मिल|dispatch|tracking|registered|रजिस्टर्ड|अंक नहीं/)) return ['delivery_status'];
		if (sub === 'renewal' || has(/renew|membership|status|expire|नवीनीकरण|सदस्यता|शुल्क|valid/)) return ['membership_status'];
		return ['others'];
	};
	if (abroad || purposes.includes('international') || sub === 'international') return { group: 'international', subTags: [] };
	if (bc === 'kalyan' || purposes.includes('kalyan')) return { group: 'kalyan', subTags: kalyanSub() };
	if (bc === 'sales_proposal' || purposes.includes('bulk_order') || purposes.includes('dealer')) return { group: 'bulk_order', subTags: [] };
	const issue = (tag: string) => ({ group: 'order_issues' as GroupKey, subTags: [tag] });
	if (bc === 'book_orders') {
		if (sub === 'order_status') return issue(has(/not (yet )?(received|arrived|delivered)|नहीं मिल|नही मिल/) ? 'not_received' : 'tracking');
		if (sub === 'payment_issue') return issue('payment_refund');
		if (sub === 'cancellation') return issue('cancellation');
		if (sub === 'new_order' || sub === 'availability') return { group: 'retail_order', subTags: [] };
	}
	if (bc === 'customer_service') {
		if (sub === 'damaged_book' || sub === 'wrong_item') return issue('damaged_wrong');
		if (sub === 'not_received') return issue('not_received');
	}
	if (bc === 'dispatch') {
		if (sub === 'courier_damage') return issue('damaged_wrong');
		if (sub === 'delivery_delay') return issue('not_received');
		if (sub === 'tracking') return issue('tracking');
		return issue('others');
	}
	if (bc === 'billing_finance') return issue('payment_refund');
	// the reader's own words, when the analysis put it in a general group
	const aboutOrder = has(/\border(ed|s)?\b|ऑर्डर|आर्डर|parcel|पार्सल|books? (i|we) (bought|ordered|paid)|पुस्तकें मंगाई/);
	if (aboutOrder) {
		if (has(/damag|torn|wet|missing pages|wrong (book|item|edition|language)|फट|गलत पुस्तक|खराब/)) return issue('damaged_wrong');
		if (has(/refund|deducted|debited|payment (failed|done|made)|money|पैसे वापस|भुगतान/)) return issue('payment_refund');
		if (has(/cancel|रद्द|निरस्त/)) return issue('cancellation');
		if (has(/not (yet )?(received|arrived|delivered|reached|come)|has not (arrived|come|reached)|haven'?t (received|got)|नहीं मिल|नही मिल|नहीं पहुं|नहीं आ/)) return issue('not_received');
		if (has(/track|status|where is|kab tak|dispatch|shipped|भेजा गया|कब तक/)) return issue('tracking');
	}
	if (purposes.includes('order_tracking')) return issue('tracking');
	if (purposes.includes('payment_refund')) return issue('payment_refund');
	if (purposes.includes('complaint')) return issue(has(/damag|torn|wrong|फट|गलत/) ? 'damaged_wrong' : 'not_received');
	for (const p of purposes) { const g = cfg.reasonGroup[p]; if (g && g !== 'others') return g === 'order_issues' ? issue('others') : g === 'kalyan' ? { group: 'kalyan', subTags: kalyanSub() } : { group: g, subTags: [] }; }
	return { group: 'others', subTags: [] };
}

export function criticality(cfg: EmailConfig, group: string, subTags: string[], conv: any, text: string, waitingDays: number): Level {
	let level = baseLevelFor(cfg, group, subTags);
	const raise = (to: Level) => { if (LEVELS.indexOf(to) < LEVELS.indexOf(level)) level = to; };
	const sla = cfg.slaWorkingDays[group] ?? 2;
	if (waitingDays > sla * 2) raise('critical');
	else if (waitingDays > sla) raise('high');
	// money taken but the books not received
	if (group === 'order_issues' && (subTags.includes('not_received') || subTags.includes('payment_refund'))
		&& /paid|payment|deducted|debited|money|amount|भुगतान|पैसे|राशि|कट गए|कटे/.test(text.toLowerCase())) raise('critical');
	if (conv.rag === 'red' || conv.legal_or_churn_signal) raise('high');
	return level;
}

// ── the facts ─────────────────────────────────────────────────────────────
export interface Fact { key: string; label: string; value: string | null; source: string | null }
export interface Question { key: string; fact: string; text: string; kind: 'lookup' | 'value'; hint?: string; needsUpload?: string; group: string }

interface Ctx {
	orgId: number;
	conv: any;
	cfg: EmailConfig;
	group: GroupKey;
	subTags: string[];
	text: string;
	hindi: boolean;
	sender: { address: string; name: string };
	answers: Record<string, string>;
	standing: Map<string, string>;
	place: Place;
}

async function findOrder(c: Ctx) {
	const ids = c.answers.order ? [c.answers.order.trim().toUpperCase()] : orderIdsIn(c.text);
	for (const id of ids) {
		const variants = [id, id.replace(/^GPHO_?/, 'GPHO_'), id.replace(/^GPHO_?/, 'GPHO')];
		const o = await one<any>(`select * from orders where org_id=$1 and (order_key = any($2::text[]) or mongo_id=$3) order by updated_at desc limit 1`, [c.orgId, variants, id.toLowerCase()]);
		if (o) return { order: o, how: `order number ${o.order_id}` };
	}
	if (c.answers.order) return null;
	const phones = [...new Set([...(c.text.match(/(?:\+?91[\s-]?)?[6-9]\d{9}/g) || [])].map(phone10).filter(Boolean))] as string[];
	const o = await one<any>(
		`select * from orders where org_id=$1 and ((email_ok and lower(email)=lower($2)) or (phone10 = any($3::text[])) or (ship_phone10 = any($3::text[])))
		 order by ordered_at desc nulls last limit 1`, [c.orgId, c.sender.address, phones]);
	return o ? { order: o, how: o.email && o.email.toLowerCase() === c.sender.address.toLowerCase() ? 'the sender\'s email' : 'the phone number in the email' } : null;
}

async function findKalyan(c: Ctx) {
	const asked = c.answers.custno ? [c.answers.custno.trim().replace(/^[A-Z]+-/i, '')] : custnosIn(c.text);
	let custno: string | null = null;
	for (const n of asked) {
		const hit = await one<any>(
			`select $2::text as custno where exists (select 1 from kalyan_customers where org_id=$1 and custno=$2)
			    or exists (select 1 from kalyan_dispatches where org_id=$1 and custno=$2) or exists (select 1 from kalyan_customer_years where org_id=$1 and custno=$2)`, [c.orgId, n]);
		if (hit) { custno = n; break; }
	}
	if (!custno && !c.answers.custno) {
		const phones = [...new Set([...(c.text.match(/(?:\+?91[\s-]?)?[6-9]\d{9}/g) || [])].map(phone10).filter(Boolean))] as string[];
		const s = await one<any>(`select custno from kalyan_subscribers where org_id=$1 and ((email_ok and lower(email)=lower($2)) or phone10 = any($3::text[])) order by last_dispatch desc nulls last limit 1`, [c.orgId, c.sender.address, phones]);
		custno = s?.custno || null;
	}
	if (!custno) return null;
	const [cust, year, disp, sub] = await Promise.all([
		one<any>('select * from kalyan_customers where org_id=$1 and custno=$2', [c.orgId, custno]),
		one<any>('select * from kalyan_customer_years where org_id=$1 and custno=$2 order by year desc limit 1', [c.orgId, custno]),
		one<any>(`select * from kalyan_dispatches where org_id=$1 and custno=$2 order by dispdate desc, to_issue desc limit 1`, [c.orgId, custno]),
		one<any>('select * from kalyan_subscribers where org_id=$1 and custno=$2', [c.orgId, custno]),
	]);
	return { custno, cust, year, disp, sub };
}

export const kalyanYear = (cfg: EmailConfig, now = new Date()) => kalyanYearOf(cfg, now);

interface BookLine { code: string; title: string; hindi: string | null; qty: number; qtyKnown: boolean; price: number | null; priceFrom: string; hqQty: number | null; near: { label: string; qty: number } | null; links: string[]; size: string | null; stockAsOf: string | null }

async function findBooks(c: Ctx, needBulkQty: boolean): Promise<{ lines: BookLine[]; nearest: string | null; abroad: boolean; uncertain: string[] }> {
	const asked = c.answers.books ? parseBooksAnswer(c.answers.books) : [];
	const fromText = asked.length ? asked : booksWithQty(c.text);
	const ctx = await stockContext(c.orgId, c.text, c.place);
	const cur = await currentStock(c.orgId);
	const codes = new Map<string, number | null>();
	for (const b of fromText) codes.set(b.code, b.qty);
	if (!asked.length) for (const b of ctx.books) if (b.certain && !codes.has(b.code)) codes.set(b.code, null);
	const uncertain = asked.length ? [] : ctx.books.filter((b) => !b.certain && !codes.has(b.code)).map((b) => b.code);
	const list = [...codes.keys()].slice(0, 25);
	const meta = list.length ? await q<any>(`select code, name, hindi_title, suchi_title, suchi_price::float as suchi_price, mrp::float as mrp, gitapress_url, amazon_url, size_en from book_titles where org_id=$1 and code = any($2::text[])`, [c.orgId, list]) : [];
	const byCode = new Map(meta.map((m) => [m.code, m]));
	const nearKey = ctx.nearKey;
	const lines: BookLine[] = list.map((code) => {
		const m = byCode.get(code);
		const s = cur.books.get(code);
		const hq = s?.locs.get(HQ_KEY);
		const near = nearKey ? s?.locs.get(nearKey) : undefined;
		const batchPrice = hq?.price ?? null;
		const price = m?.suchi_price ?? m?.mrp ?? batchPrice ?? null;
		const qty = codes.get(code);
		return {
			code, title: m?.name || s?.name || m?.suchi_title || `Code ${code}`, hindi: m?.hindi_title || (m?.suchi_title && /[ऀ-ॿ]/.test(m.suchi_title) ? m.suchi_title : null),
			qty: qty ?? 1, qtyKnown: qty !== null && qty !== undefined, price, priceFrom: m?.suchi_price ? 'book list' : m?.mrp ? 'price list' : batchPrice ? 'Gorakhpur batch' : '',
			hqQty: cur.asOf[HQ_KEY] ? (hq?.qty ?? 0) : null,
			near: nearKey && cur.asOf[nearKey] ? { label: locationLabel(nearKey), qty: near?.qty ?? 0 } : null,
			links: [m?.gitapress_url, m?.amazon_url].filter(Boolean), size: m?.size_en || null, stockAsOf: cur.asOf[HQ_KEY] || null,
		};
	});
	void needBulkQty;
	return { lines, nearest: nearKey, abroad: ctx.abroad, uncertain };
}

// ── composing the reply ───────────────────────────────────────────────────
interface Built { facts: Fact[]; questions: Question[]; body: string | null; bulk?: { items: any[]; totals: any } }

export async function buildReply(c: Ctx): Promise<Built> {
	const facts: Fact[] = [];
	const questions: Question[] = [];
	const H = c.hindi;
	const L = (en: string, hi: string) => (H ? hi : en);
	const needed = factsFor(c.cfg, c.group, c.subTags);
	const sig = ((await getOrg(c.orgId)).settings.replySignature || '').trim() || L('Regards,\nGita Press, Gorakhpur', 'सादर,\nगीताप्रेस, गोरखपुर');
	const first = (c.sender.name || '').split(/\s+/)[0];
	const greeting = H ? `आदरणीय ${first ? `${first} जी` : 'महोदय/महोदया'},` : `Dear ${first || 'Sir/Madam'},`;
	const m = await getMappings(c.orgId);

	/** a found fact (green) or a question (yellow); returns the text to put in the draft */
	const put = (key: string, value: string | null | undefined, source: string | null, qKey = key, qText?: string): string => {
		const def = FACTS[key];
		let v = value ?? null;
		let src = source;
		if (v === null) {
			const stand = c.standing.get(qKey) ?? c.answers[qKey];
			if (stand) { v = stand; src = c.answers[qKey] ? 'answered on this email' : 'standing answer'; }
		}
		if (!facts.some((f) => f.key === key)) facts.push({ key, label: def?.label || key, value: v, source: v === null ? null : src });
		else if (v === null) { const f = facts.find((x) => x.key === key)!; f.value = null; f.source = null; }
		if (v !== null) return ok(v);
		const text = qText || def?.question || key;
		if (!questions.some((x) => x.key === qKey)) questions.push({ key: qKey, fact: key, text, kind: def?.kind || 'value', hint: def?.hint, needsUpload: def?.needsUpload, group: c.group });
		return ask(text);
	};
	/** a free-text question that is not one of the standard facts (answered on this email or by a standing answer) */
	const askOnce = (qKey: string, text: string): string => {
		const v = c.answers[qKey] ?? c.standing.get(qKey);
		if (v) return ok(v);
		if (!questions.some((x) => x.key === qKey)) questions.push({ key: qKey, fact: qKey, text, kind: 'value', group: c.group });
		return ask(text);
	};
	const parts: string[] = [];
	const bankBlock = async (international = false) => {
		const b = await getMaster(c.orgId, 'bank');
		return put('bank', bankText(b, H, international), 'Bank details (master data)');
	};

	// ── Book order issues ──
	if (c.group === 'order_issues') {
		const found = await findOrder(c);
		const o = found?.order;
		const tag = c.subTags[0] || 'others';
		parts.push(L(
			{ not_received: 'We are sorry that your books have not reached you yet. Here are the details of your order:', damaged_wrong: 'We are very sorry that the books did not reach you in proper condition. Here are the details of your order:', tracking: 'Thank you for your email. Here are the details of your order:', payment_refund: 'Thank you for writing to us about the payment. Here are the details of your order:', cancellation: 'Thank you for your email about cancelling your order. Here are the details:' }[tag] || 'Thank you for your email. Here are the details of your order:',
			{ not_received: 'खेद है कि आपकी पुस्तकें अभी तक आपको नहीं मिली हैं। आपके ऑर्डर का विवरण इस प्रकार है:', damaged_wrong: 'हमें खेद है कि पुस्तकें आपको ठीक स्थिति में नहीं मिलीं। आपके ऑर्डर का विवरण इस प्रकार है:', tracking: 'आपके पत्र के लिए धन्यवाद। आपके ऑर्डर का विवरण इस प्रकार है:', payment_refund: 'भुगतान के विषय में लिखने के लिए धन्यवाद। आपके ऑर्डर का विवरण इस प्रकार है:', cancellation: 'ऑर्डर निरस्त करने के विषय में आपके पत्र के लिए धन्यवाद। विवरण इस प्रकार है:' }[tag] || 'आपके पत्र के लिए धन्यवाद। आपके ऑर्डर का विवरण इस प्रकार है:',
		));
		const rows: string[] = [];
		const need = (k: string) => needed.includes(k);
		rows.push(`${L('Order number', 'ऑर्डर संख्या')}: ${put('order_number', o ? o.order_id : null, found ? `orders (${found.how})` : null)}`);
		if (o) {
			if (need('order_date')) rows.push(`${L('Order date', 'ऑर्डर की तिथि')}: ${put('order_date', o.ordered_at ? day(o.ordered_at, H) : null, 'orders')}`);
			if (need('order_amount')) rows.push(`${L('Amount', 'राशि')}: ${put('order_amount', o.total !== null ? inr(Number(o.total)) : null, 'orders')}`);
			if (need('order_status')) rows.push(`${L('Status', 'स्थिति')}: ${put('order_status', o.status_label || m.orderStatus[o.status_code] || null, 'orders')}`);
			const shipped = String(o.status_code) === '4' || /ship|dispatch|deliver/i.test(o.status_label || '');
			if (need('delivery_partner')) rows.push(`${L('Sent by', 'प्रेषक')}: ${put('delivery_partner', o.partner || (shipped ? null : L('not yet dispatched', 'अभी भेजा नहीं गया')), 'orders')}`);
			if (need('tracking')) {
				const site = o.partner ? m.courierSites[o.partner] : null;
				const tr = o.tracking_ok && o.tracking_id ? `${o.tracking_id}${site ? ` (${L('track at', 'यहाँ देखें')} ${site})` : ''}` : !shipped ? L('will be shared once the order is dispatched', 'ऑर्डर भेजे जाने पर दी जाएगी') : null;
				rows.push(`${L('Tracking number', 'ट्रैकिंग संख्या')}: ${put('tracking', tr, 'orders', 'tracking', o.tracking_id && !o.tracking_ok ? `Tracking number for ${o.order_id} is damaged in the orders file ("${o.tracking_id}") — type the correct number` : `Tracking number for ${o.order_id}`)}`);
			}
		} else {
			// the details of an order not found are asked once, through the order number
			for (const k of needed.filter((x) => x !== 'order_number')) facts.push({ key: k, label: FACTS[k]?.label || k, value: null, source: null });
		}
		parts.push(rows.join('\n'));
		if (tag === 'damaged_wrong') parts.push(L('Please reply with a photograph of the books received and we will arrange a replacement.', 'कृपया प्राप्त पुस्तकों का फोटो भेजें, हम बदलकर भेजने की व्यवस्था करेंगे।'));
		if (tag === 'not_received' && o) parts.push(L('If the parcel does not reach you within 7 days of dispatch, please write to us again and we will take it up with the delivery partner.', 'यदि भेजे जाने के 7 दिनों में पार्सल न मिले तो कृपया पुनः लिखें, हम डाक/कूरियर से संपर्क करेंगे।'));
		if (tag === 'cancellation' && o) parts.push(String(o.status_code) === '4' ? L('As the order has already been dispatched, it cannot be cancelled now.', 'ऑर्डर भेजा जा चुका है, इसलिए अब इसे निरस्त नहीं किया जा सकता।') : askOnce(`cancel:${o.order_id}`, `Can order ${o.order_id} still be cancelled? (yes / no, and how the refund will be made)`));
		if (tag === 'payment_refund' && o) parts.push(askOnce(`refund:${o.order_id}`, `What happened to the payment for ${o.order_id} (received / refund made / refund date)?`));
	}

	// ── Kalyan ──
	if (c.group === 'kalyan') {
		const tag = c.subTags[0] || 'others';
		if (tag === 'new_request') {
			const prices = await getMaster(c.orgId, 'kalyan_prices');
			const priced = Object.entries(prices.prices).filter(([, v]) => v !== null && v !== undefined);
			const priceText = priced.length === Object.keys(prices.prices).length && priced.length ? priced.map(([k, v]) => `${m.subperiod[k] || k}: ${inr(Number(v))}`).join('; ') : null;
			parts.push(L('Thank you for your interest in subscribing to Kalyan. The subscription options are:', 'कल्याण की सदस्यता में रुचि के लिए धन्यवाद। सदस्यता के विकल्प इस प्रकार हैं:'));
			parts.push(`${L('Subscription', 'सदस्यता')}: ${put('kalyan_prices', priceText, 'Kalyan prices (master data)')}`);
			parts.push(`${L('Dispatch', 'प्रेषण')}: ${put('kalyan_modes', Object.entries(m.dispMode).filter(([k]) => k !== 'BY SHOP').map(([, v]) => v).join('; '), 'Kalyan dispatch modes (master data)')}`);
			parts.push(L('You can pay by bank transfer to:', 'आप बैंक द्वारा इस खाते में भुगतान कर सकते हैं:'));
			parts.push(await bankBlock());
		} else {
			const k = await findKalyan(c);
			const rows: string[] = [];
			rows.push(`${L('Kalyan customer number', 'कल्याण ग्राहक संख्या')}: ${put('kalyan_custno', k?.custno || null, k ? 'Kalyan customers / tracking' : null)}`);
			const subType = k?.year?.sub_type || k?.cust?.sub_type || k?.disp?.subperiod || k?.sub?.sub_type || '';
			if (k) {
				if (needed.includes('kalyan_type')) rows.push(`${L('Subscription', 'सदस्यता')}: ${put('kalyan_type', subType ? (m.subperiod[subType] || subType) : null, 'Kalyan customers')}`);
				if (needed.includes('kalyan_dispatch')) {
					const d = k.disp;
					const issues = d ? (d.from_issue === d.to_issue ? `${L('issue', 'अंक')} ${d.to_issue}` : `${L('issues', 'अंक')} ${d.from_issue}–${d.to_issue}`) : '';
					rows.push(`${L('Last dispatch', 'पिछला प्रेषण')}: ${put('kalyan_dispatch', d ? `${issues}, ${day(d.dispdate, H)}, ${m.dispMode[d.mode] || d.mode}` : null, 'Kalyan tracking')}`);
				}
				if (needed.includes('kalyan_tracking')) {
					const d = k.disp;
					const t = !d ? null : d.barcode ? `${d.barcode} (${L('track at', 'यहाँ देखें')} https://www.indiapost.gov.in/)` : d.mode === 'BY SHOP' ? L('collected at the shop, no tracking', 'दुकान से प्राप्त, ट्रैकिंग नहीं') : L('sent by ordinary post, which has no tracking number', 'साधारण डाक से भेजा गया, जिसकी ट्रैकिंग संख्या नहीं होती');
					rows.push(`${L('Tracking', 'ट्रैकिंग')}: ${put('kalyan_tracking', t, 'Kalyan tracking')}`);
				}
				if (needed.includes('kalyan_active')) {
					const yr = kalyanYear(c.cfg);
					const active = k.year ? Number(k.year.year) >= yr : null;
					const anyYear = (await one<any>('select 1 from kalyan_customer_years where org_id=$1 limit 1', [c.orgId])) !== null;
					rows.push(`${L('Active this year', 'इस वर्ष सक्रिय')}: ${put('kalyan_active', active === true ? L(`yes (${yr})`, `हाँ (${yr})`) : anyYear ? L(`not yet renewed for ${yr}`, `${yr} के लिए नवीनीकरण नहीं हुआ`) : null, 'Kalyan current-year customers')}`);
				}
				if (needed.includes('kalyan_payment')) rows.push(`${L('Last payment', 'पिछला भुगतान')}: ${put('kalyan_payment', k.year?.paid_on ? `${day(k.year.paid_on, H)}${k.year.receipt_no ? `, ${L('receipt', 'रसीद')} ${k.year.receipt_no}` : ''}` : null, 'Kalyan current-year customers')}`);
				if (needed.includes('kalyan_renewal')) {
					const r = subType === 'LM' ? L('life member: no renewal needed', 'आजीवन सदस्य: नवीनीकरण आवश्यक नहीं') : k.sub?.renewal_est ? `${day(k.sub.renewal_est, H)} (${L('estimated', 'अनुमानित')})` : k.cust?.year_end ? `${L('subscription year', 'सदस्यता वर्ष')} ${k.cust.year_end}` : null;
					rows.push(`${L('Renewal', 'नवीनीकरण')}: ${put('kalyan_renewal', r, 'Kalyan tracking / customers')}`);
				}
			} else {
				for (const key of needed.filter((x) => x !== 'kalyan_custno')) facts.push({ key, label: FACTS[key]?.label || key, value: null, source: null });
			}
			parts.push(L('Thank you for your email about Kalyan. Here are the details we have:', 'कल्याण के विषय में आपके पत्र के लिए धन्यवाद। हमारे पास उपलब्ध विवरण इस प्रकार है:'));
			parts.push(rows.join('\n'));
		}
	}

	// ── New orders (retail, bulk) and international ──
	let bulk: Built['bulk'];
	if (c.group === 'retail_order' || c.group === 'bulk_order' || c.group === 'international') {
		const intl = c.group === 'international';
		const b = await findBooks(c, c.group === 'bulk_order');
		const isBulk = c.group === 'bulk_order';
		const booksOk = b.lines.length > 0 && (!isBulk || b.lines.every((l) => l.qtyKnown));
		put('books', booksOk ? b.lines.map((l) => `${l.code} × ${l.qty}`).join(', ') : null, 'the email', 'books',
			b.lines.length && isBulk ? `Quantities for ${b.lines.filter((l) => !l.qtyKnown).map((l) => l.code).join(', ')} — type codes with quantities (e.g. ${b.lines[0].code} x 10)` : b.uncertain.length ? `Which book(s)? Possible: ${b.uncertain.join(', ')}. Type codes with quantities (e.g. 6 x 10)` : undefined);
		parts.push(L(isBulk ? 'Thank you for your enquiry. The details for the books you asked about are:' : 'Thank you for your email. The books you asked about:', isBulk ? 'आपकी पूछताछ के लिए धन्यवाद। आपके द्वारा पूछी गई पुस्तकों का विवरण इस प्रकार है:' : 'आपके पत्र के लिए धन्यवाद। आपके द्वारा पूछी गई पुस्तकें:'));
		if (!b.lines.length) parts.push(ask(FACTS.books.question));
		let value = 0, priceMissing = false;
		const lines: string[] = [];
		for (const l of b.lines) {
			const name = H && l.hindi ? l.hindi : l.title;
			const av = l.hqQty === null ? null
				: `${l.hqQty > 0 ? L(`available at Gorakhpur (${Math.round(l.hqQty)} copies)`, `गोरखपुर में उपलब्ध (${Math.round(l.hqQty)} प्रतियाँ)`) : L('currently out of stock at Gorakhpur', 'गोरखपुर में अभी उपलब्ध नहीं')}${!intl && l.near ? `; ${l.near.qty > 0 ? L(`${l.near.label} branch: ${Math.round(l.near.qty)} copies`, `${BY_KEY.get(b.nearest!)?.city_hi || l.near.label} शाखा: ${Math.round(l.near.qty)} प्रतियाँ`) : L(`${l.near.label} branch: out of stock`, `${BY_KEY.get(b.nearest!)?.city_hi || l.near.label} शाखा: उपलब्ध नहीं`)}` : ''}`;
			const avText = put('availability', av, `stock as of ${l.stockAsOf || '–'}`, `availability:${l.code}`, `Stock for code ${l.code} is not uploaded — is it available, and how many copies?`);
			const prText = put('price', l.price !== null ? inr(l.price) : null, l.priceFrom, `price:${l.code}`, `Price of code ${l.code}`);
			if (l.price === null) priceMissing = true; else value += l.price * l.qty;
			lines.push(`- ${L('Code', 'कोड')} ${l.code}, ${name}${l.size ? ` (${H ? SIZE_HI[l.size] || l.size : l.size})` : ''}: ${avText}; ${L('price', 'मूल्य')} ${prText}${l.qtyKnown || isBulk ? ` × ${l.qty}` : ''}`);
			if (!intl && c.group === 'retail_order') {
				const links = l.links.length ? l.links.join(' , ') : null;
				lines.push(`  ${L('Buy online', 'ऑनलाइन खरीदें')}: ${put('buy_links', links, 'Book links', `links:${l.code}`, `gitapress.org or Amazon link for code ${l.code}`)}`);
			}
		}
		if (lines.length) parts.push(lines.join('\n'));
		if (b.lines.length) {
			const d = await getMaster(c.orgId, 'discount');
			const f = await getMaster(c.orgId, 'freight');
			const totals = quoteTotals(d, f, value, { discount: isBulk, international: intl });
			const rows: string[] = [];
			if (!priceMissing) {
				rows.push(`${L('Book value', 'पुस्तकों का मूल्य')}: ${ok(inr(totals.bookValue))}`);
				if (isBulk) put('discount', totals.discount.amount ? `${totals.discount.label} = ${inr(totals.discount.amount)}` : L('no discount below ₹2,001', '₹2,001 से कम पर छूट नहीं'), 'Discount details (master data)');
				if (isBulk) rows.push(`${L('Discount', 'छूट')}: ${ok(totals.discount.amount ? `${totals.discount.label} = − ${inr(totals.discount.amount)}` : L('none (applies from ₹2,001)', 'नहीं (₹2,001 से लागू)'))}`);
				if (!intl) {
					const p = postageFor(f, totals.bookValue);
					rows.push(`${L('Postage', 'डाक खर्च')}: ${put('postage', p === 0 ? L('free (order above ₹1,000)', 'निःशुल्क (₹1,000 से अधिक)') : inr(p), 'Freight charges (master data)')}`);
					rows.push(`${L('Total payable', 'कुल देय राशि')}: ${ok(inr(totals.total))}`);
				} else {
					const intlRate = f.international || null;
					rows.push(`${L('International shipping', 'विदेश भेजने का खर्च')}: ${put('intl_shipping', intlRate, 'Freight charges (master data)')}`);
				}
			} else {
				if (isBulk) put('discount', null, null, 'discount', 'Discount (needs the price of every book first)');
				if (!intl) put('postage', null, null, 'postage', 'Postage (needs the price of every book first)');
			}
			if (rows.length) parts.push(rows.join('\n'));
			if (isBulk) bulk = { items: b.lines.map((l) => ({ code: l.code, title: l.title, hindi: l.hindi, qty: l.qty, price: l.price, available: l.hqQty })), totals: priceMissing ? null : totals };
		}
		parts.push(intl
			? L('Books are sent abroad only from Gorakhpur. Payment can be made by bank transfer to:', 'विदेश में पुस्तकें केवल गोरखपुर से भेजी जाती हैं। भुगतान बैंक द्वारा इस खाते में कर सकते हैं:')
			: L('Payment can be made by bank transfer to:', 'भुगतान बैंक द्वारा इस खाते में कर सकते हैं:'));
		parts.push(await bankBlock(intl));
	}

	// make sure every needed fact appears in the list (found or not)
	for (const k of needed) if (!facts.some((f) => f.key === k)) facts.push({ key: k, label: FACTS[k]?.label || k, value: null, source: null });
	if (c.group === 'others') return { facts: [], questions: [], body: null };
	const closing = L('With regards and best wishes,', 'सादर शुभकामनाओं सहित,');
	const body = [greeting, '', ...parts.flatMap((p) => [p, '']), closing, sig].join('\n').replace(/\n{3,}/g, '\n\n');
	return { facts, questions, body, bulk };
}

// ── one conversation ──────────────────────────────────────────────────────
export async function enrichConversation(conversationId: number): Promise<void> {
	const conv = await one<any>(`select c.*, (select count(*) from reply_drafts d where d.conversation_id=c.id and d.status in ('sent')) as sent_drafts from conversations c where c.id=$1`, [conversationId]);
	if (!conv) return;
	const cfg = await emailConfig(conv.org_id);
	const inbound = await q<any>(
		`select id, from_address, from_name, subject, body_clean, body_text, sent_at, attachments from emails where conversation_id=$1 and direction='inbound' and not is_duplicate order by sent_at desc limit 5`, [conversationId]);
	const lastIn = inbound[0];
	const text = inbound.map((e) => `${e.subject}\n${e.body_clean || e.body_text || ''}`).reverse().join('\n\n').slice(0, 20000);
	const answers: Record<string, string> = conv.answers || {};
	// not for reply: internal, automated and supplier mail (staff can move it back)
	const nfr = conv.not_for_reply_locked ? conv.not_for_reply : !lastIn || !!conv.is_internal || !!conv.is_automated || NOT_FOR_REPLY_GROUPS.has(conv.business_category || '');
	const place: Place = { text };
	if (answers.location) Object.assign(place, PIN_RE.test(answers.location) ? { pin: answers.location.match(PIN_RE)![1] } : { city: answers.location });
	else {
		const pin = text.match(PIN_RE)?.[1];
		if (pin) place.pin = pin;
		const named = placeInText(text);
		if (named) place.city = BY_KEY.get(named)?.city || named;
	}
	const abroad = isAbroad(place) || /\b(usa|u\.s\.a|united states|uk|united kingdom|canada|australia|nepal|singapore|dubai|uae|germany|new zealand|south africa|mauritius|fiji)\b/i.test(text.slice(0, 4000)) && !/india/i.test(text.slice(0, 300));
	const auto = conv.group_locked ? { group: conv.primary_group as GroupKey, subTags: conv.sub_tags || [] } : classify(conv, text, cfg, abroad);
	const standing = new Map((await q<any>('select question_key, answer from standing_answers where org_id=$1', [conv.org_id])).map((r) => [r.question_key, r.answer]));
	const c: Ctx = { orgId: conv.org_id, conv, cfg, group: auto.group, subTags: auto.subTags, text, hindi: isHindi(lastIn?.body_clean || lastIn?.body_text || ''), sender: { address: lastIn?.from_address || '', name: lastIn?.from_name || '' }, answers, standing, place };
	// a lookup the reader's text did not give, but staff typed, comes from answers (order, custno, books, location)
	let built: Built = { facts: [], questions: [], body: null };
	if (!nfr) {
		try { built = await buildReply(c); } catch (e: any) { console.error('[enrich]', conversationId, e.message); }
	}
	const needed = built.facts.length;
	const found = built.facts.filter((f) => f.value !== null).length;
	const completeness = nfr ? null : needed ? Math.round((found / needed) * 100) : 100;
	const waiting = conv.awaiting_reply && conv.last_inbound_at ? workingDaysSince(new Date(conv.last_inbound_at)) : 0;
	const level = conv.criticality_locked ? conv.criticality : nfr ? 'low' : criticality(cfg, c.group, c.subTags, conv, text, waiting);

	// the draft: composed from the facts for the five data groups; Others keeps the analysis draft
	if (!nfr && built.body && conv.awaiting_reply) await upsertDraft({ ...conv }, true, built.body, 'gitamail-facts');
	const draft = await one<any>('select body, status, edited from reply_drafts where conversation_id=$1', [conversationId]);
	const open = draft ? (draft.body.match(/\[\[\s*provide\s*:/gi) || []).length : 0;
	const sentLater = conv.last_outbound_at && conv.last_inbound_at && new Date(conv.last_outbound_at) >= new Date(conv.last_inbound_at);
	const status = nfr ? 'not_for_reply' : draft?.status === 'queued' ? 'queued' : draft?.status === 'sent' || (!conv.awaiting_reply && sentLater) ? 'sent'
		: (completeness ?? 0) >= 100 && open === 0 && draft ? 'ready' : 'pending';
	await q(
		`update conversations set primary_group=$2, sub_tags=$3, criticality=$4, completeness=$5, facts=$6, open_questions=$7, reply_status=$8,
		   not_for_reply=$9, reader_language=$10, enriched_at=now(), needs_enrich=false where id=$1`,
		[conversationId, c.group, c.subTags, level, completeness, JSON.stringify(built.facts), JSON.stringify(nfr ? [] : built.questions), status, nfr, c.hindi ? 'hi' : 'en'],
	);
	if (built.bulk && c.group === 'bulk_order') {
		await q(
			`insert into bulk_requests (org_id, conversation_id, items, totals, value) values ($1,$2,$3,$4,$5)
			 on conflict (conversation_id) do update set items = case when bulk_requests.quote_no is null then excluded.items else bulk_requests.items end,
			   totals = case when bulk_requests.quote_no is null then excluded.totals else bulk_requests.totals end,
			   value = case when bulk_requests.quote_no is null then excluded.value else bulk_requests.value end`,
			[conv.org_id, conversationId, JSON.stringify(built.bulk.items), JSON.stringify(built.bulk.totals || {}), built.bulk.totals?.total ?? null],
		);
	} else if (c.group === 'bulk_order') {
		await q(`insert into bulk_requests (org_id, conversation_id) values ($1,$2) on conflict (conversation_id) do nothing`, [conv.org_id, conversationId]);
	}
}

/** Background: enrich every email marked as needing it (new mail, new uploads, new answers). */
export async function enrichPending(orgId: number, deadline = Date.now() + 60_000, limit = 400): Promise<number> {
	let n = 0;
	while (Date.now() < deadline - 2000 && n < limit) {
		const rows = await q<any>(`select id from conversations where org_id=$1 and needs_enrich and analysed_at is not null order by last_message_at desc limit 25`, [orgId]);
		if (!rows.length) break;
		for (const r of rows) {
			try { await enrichConversation(r.id); } catch (e: any) { console.error('[enrich]', r.id, e.message); await q('update conversations set needs_enrich=false where id=$1', [r.id]); }
			n++;
			if (Date.now() > deadline - 2000) break;
		}
	}
	if (n) await snapshotCompleteness(orgId).catch(() => {});
	return n;
}

/** Every open email is worked out again (after an upload, a master data change or a standing answer). */
export const markAllForEnrich = (orgId: number) => q(`update conversations set needs_enrich=true where org_id=$1 and not not_for_reply and reply_status <> 'sent'`, [orgId]);

/** Today's completeness per group, for the weekly trend chart. */
export async function snapshotCompleteness(orgId: number) {
	await q(
		`insert into completeness_daily (org_id, day, group_key, emails, complete, avg_pct)
		 select $1, (now() at time zone 'Asia/Kolkata')::date, coalesce(primary_group,'others'), count(*), count(*) filter (where completeness >= 100), coalesce(avg(completeness),0)
		   from conversations where org_id=$1 and not not_for_reply and primary_group is not null and reply_status in ('pending','ready') group by 3
		 on conflict (org_id, day, group_key) do update set emails=excluded.emails, complete=excluded.complete, avg_pct=excluded.avg_pct`, [orgId]);
}

export { nearestBranch };
