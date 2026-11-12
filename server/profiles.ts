/**
 * Customer database. For every reader, bookseller, institution or supplier, Gita Mail keeps a profile
 * gathered from their emails: phone numbers, postal address, PIN code, language, order and Kalyan
 * subscriber numbers, books asked about, GSTIN and organisation. The rules engine fills it for everyone
 * (free); the AI refines it for active customers when available. Fields staff edit are never overwritten.
 */
import { one, q } from './db';
import { HttpError } from './http';

export interface Profile {
	type?: string; // reader, bookseller, distributor, institution, supplier, other
	organisation?: string;
	emails?: string[];
	phones?: string[];
	address?: string;
	city?: string;
	state?: string;
	pin?: string;
	country?: string;
	language?: string;
	order_refs?: string[];
	subscriber_numbers?: string[];
	books?: string[];
	gstin?: string;
	notes?: string;
}
export const PROFILE_FIELDS: (keyof Profile)[] = ['type', 'organisation', 'emails', 'phones', 'address', 'city', 'state', 'pin', 'country', 'language', 'order_refs', 'subscriber_numbers', 'books', 'gstin', 'notes'];
export const CUSTOMER_TYPES = ['reader', 'bookseller', 'distributor', 'institution', 'supplier', 'other'];

const uniq = (a: (string | undefined | null)[], n = 10) => [...new Set(a.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, n);
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh'];
const STATE_RE = new RegExp(`\\b(${STATES.map((x) => x.replace(/ /g, '\\s+')).join('|')}|U\\.?P\\.?|M\\.?P\\.?)\\b`, 'i');

/** The part of an email a person wrote: drop quoted replies and our own text. */
const own = (b: string) => b.split(/\n(?:On .{5,80}wrote:|-{2,} ?Original Message|From: .+\nSent:|>)/)[0];

/** Rules engine: everything that can be read reliably with patterns. */
export function rulesProfile(texts: string[], refs: { orders: string[]; books: string[] }, email: string): Profile {
	const all = texts.map(own).join('\n\n');
	const phones = uniq([...all.matchAll(/(?:\+91[\s-]?|\b0)?\b([6-9]\d{4}[\s-]?\d{5})\b/g)].map((m) => m[1].replace(/[\s-]/g, '')).filter((p) => !/^(\d)\1{9}$/.test(p)), 4);
	// an address is the lines leading up to a 6-digit PIN code
	let address = '';
	let pin = '';
	const lines = all.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	for (let i = lines.length - 1; i >= 0; i--) {
		const m = lines[i].match(/\b([1-9]\d{2}\s?\d{3})\b/);
		if (m && !/order|invoice|amount|rs\.?|₹|inr|code|no\.|number|track|awb|utr|txn|transaction/i.test(lines[i]) && lines[i].length < 140) {
			pin = m[1].replace(/\s/g, '');
			const start = Math.max(0, i - 3);
			// the address lines just above the PIN line: short, not sentences, not greetings or sign-offs
			let k = i;
			while (k > start && lines[k - 1].length < 70 && !/[।?!]|\.\s*$|[.!?]\s/.test(lines[k - 1]) && !/^(regards|thanks|thank you|dear|respected|sir|madam|jai shri|jai sri|radhe|hari om|pranam|sent from|on .* wrote|mob|mobile|ph|phone|tel|whatsapp)\b/i.test(lines[k - 1])) k--;
			const block = lines.slice(k, i + 1).filter((l) => l.length < 140);
			address = block.join(', ').replace(/\s+/g, ' ').slice(0, 300);
			break;
		}
	}
	const state = address.match(STATE_RE)?.[0] || '';
	const city = address ? (address.split(',').map((x) => x.trim()).reverse().find((x) => /^[A-Za-zऀ-ॿ .]{3,30}$/.test(x) && !STATE_RE.test(x) && !/india|dist|district|post|po\b|near|road|nagar|colony|street|sector|house|flat|village/i.test(x) && !/^(respected|dear|sir|madam|hello|hi|namaste|pranam|regards|thanks|my|our|please|kindly|आदरणीय|महोदय|प्रणाम|नमस्ते)\b/i.test(x)) || '') : '';
	const dev = (all.match(/[ऀ-ॿ]/g) || []).length;
	const lat = (all.match(/[A-Za-z]/g) || []).length;
	const gstin = all.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/)?.[0] || '';
	// Kalyan subscriber numbers: quoted as such, or SUB- references; never order numbers
	const subs = uniq([
		...[...all.matchAll(/(?:subscriber|grahak|ग्राहक)\s*(?:no\.?|number|संख्या|सं\.?|id)?\s*(?:is|है)?\s*[:#-]?\s*((?:SUB-?)?\d{3,8})\b/gi)].map((m) => m[1]),
		...[...all.matchAll(/\bSUB-?\d{3,8}\b/gi)].map((m) => m[0]),
		...refs.orders.filter((r) => /^SUB-?\d/i.test(r)),
	].map((x) => x.toUpperCase()), 6);
	const orgM = all.match(/\b((?:shri |sri |shree )?[A-Z][A-Za-z.& ]{2,50}(?:Mandir|Temple|Trust|Ashram|School|Vidyalaya|College|Library|Samiti|Sansthan|Book (?:Depot|Stall|Store|House)|Pustak Bhandar|Publishers?|Traders?|Enterprises?|Pvt\.? Ltd\.?|Ltd\.?))\b/)?.[1] || '';
	const org = /^(near|opp|opposite|behind|beside|in front of)\b/i.test(orgM) ? '' : orgM;
	const type = /book (depot|stall|store|house)|pustak bhandar|bookseller|dealer|stockist/i.test(all) ? 'bookseller'
		: /distributor/i.test(all) ? 'distributor'
		: /mandir|temple|trust|ashram|school|vidyalaya|college|library|samiti|sansthan/i.test(org || all.slice(0, 2000)) && org ? 'institution'
		: /invoice|quotation|purchase order|our rates|supplier/i.test(all) && gstin ? 'supplier' : 'reader';
	return {
		type, organisation: org || undefined, emails: [email], phones, address: address || undefined, city: city || undefined, state: state || undefined,
		pin: pin || undefined, country: pin ? 'India' : undefined, language: dev > lat / 3 && dev > 20 ? 'Hindi' : lat > 20 ? 'English' : undefined,
		order_refs: uniq(refs.orders.filter((r) => !/^SUB-?\d/i.test(r) && !subs.includes(r.toUpperCase())), 10), subscriber_numbers: subs, books: uniq(refs.books, 10), gstin: gstin || undefined,
	};
}

const AI_SCHEMA = {
	type: 'object',
	properties: {
		type: { type: 'string', enum: CUSTOMER_TYPES, description: 'reader = individual buying or reading; bookseller or distributor = trade; institution = temple, school, trust, library; supplier = sells to Gita Press' },
		organisation: { type: ['string', 'null'] },
		phones: { type: 'array', items: { type: 'string' }, description: 'Phone or WhatsApp numbers the person gave as their own, digits only' },
		address: { type: ['string', 'null'], description: 'Full postal address the person gave as their own, one line' },
		city: { type: ['string', 'null'] }, state: { type: ['string', 'null'] }, pin: { type: ['string', 'null'] }, country: { type: ['string', 'null'] },
		language: { type: ['string', 'null'], description: 'Language they write in: Hindi, English, or another' },
		order_refs: { type: 'array', items: { type: 'string' } },
		subscriber_numbers: { type: 'array', items: { type: 'string' }, description: 'Kalyan or Kalyana-Kalpataru subscriber numbers' },
		books: { type: 'array', items: { type: 'string' }, description: 'Books or book codes they asked about or ordered' },
		gstin: { type: ['string', 'null'] },
		notes: { type: ['string', 'null'], description: 'One short line on who they are and what they usually write about. No opinions, no sensitive personal details.' },
	},
	required: ['type', 'phones', 'order_refs', 'books'],
} as const;

async function aiProfile(orgId: number, name: string, texts: string[]): Promise<Profile | null> {
	const { aiPaused, aiProvider, extractJson } = await import('./ai/llm');
	if (aiProvider() === 'heuristic' || (await aiPaused())) return null;
	const out = await extractJson(orgId, 'You build a customer record for Gita Press from the emails a person sent. Use only what the emails state about the sender themselves; never guess. Leave a field empty when it is not stated. Do not record health, religion, caste, finances or other sensitive personal details.',
		`Sender: ${name}\n\nTheir emails (newest first):\n${texts.map((t, i) => `--- email ${i + 1}\n${own(t).slice(0, 1800)}`).join('\n')}`, AI_SCHEMA, 'record_customer');
	if (!out) return null;
	const clean = (v: any) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : undefined);
	const arr = (v: any, n = 10) => (Array.isArray(v) ? uniq(v.map(String), n) : []);
	return {
		type: CUSTOMER_TYPES.includes(out.type) ? out.type : 'reader', organisation: clean(out.organisation), phones: arr(out.phones, 4).map((p) => p.replace(/[^\d+]/g, '')),
		address: clean(out.address), city: clean(out.city), state: clean(out.state), pin: clean(out.pin), country: clean(out.country), language: clean(out.language),
		order_refs: arr(out.order_refs), subscriber_numbers: arr(out.subscriber_numbers, 5), books: arr(out.books), gstin: clean(out.gstin), notes: clean(out.notes),
	};
}

/** Rules first, then the AI's reading on top where it found something. */
export async function buildProfile(customerId: number, useAi: boolean) {
	const c = await one<any>('select id, org_id, name, upload_profile from customers where id=$1', [customerId]);
	if (!c) throw new HttpError(404, 'Customer not found');
	const emails = await q<any>(
		`select e.body_clean, e.body_text, e.subject, e.from_address from emails e join conversations cv on cv.id=e.conversation_id
		  where cv.customer_id=$1 and e.direction='inbound' and not e.is_duplicate order by e.sent_at desc limit 12`,
		[customerId],
	);
	const refs = await one<any>(
		`select coalesce(array_agg(distinct r) filter (where r is not null), '{}') as orders,
		        coalesce((select array_agg(distinct b) from conversations c2, jsonb_array_elements_text(coalesce(c2.entities->'vehicle_regs','[]')) b where c2.customer_id=$1), '{}') as books
		   from conversations cv left join lateral jsonb_array_elements_text(coalesce(cv.entities->'shipment_refs','[]')) r on true where cv.customer_id=$1`,
		[customerId],
	);
	const addresses = uniq((await q<any>('select email from contacts where customer_id=$1', [customerId])).map((r) => r.email.toLowerCase()), 5);
	const texts = emails.map((e) => `${e.subject || ''}\n${e.body_clean || e.body_text || ''}`);
	let profile = rulesProfile(texts, { orders: refs?.orders || [], books: refs?.books || [] }, addresses[0] || emails[0]?.from_address || '');
	profile.emails = addresses.length ? addresses : profile.emails;
	let source = 'rules';
	if (useAi && texts.length) {
		try {
			const ai = await aiProfile(c.org_id, c.name, texts.slice(0, 6));
			if (ai) {
				const merged: any = { ...profile };
				for (const k of PROFILE_FIELDS) {
					const v = (ai as any)[k];
					if (Array.isArray(v) ? v.length : v) merged[k] = Array.isArray(v) && Array.isArray(merged[k]) ? uniq([...v, ...merged[k]]) : v;
				}
				profile = merged;
				source = 'ai';
			}
		} catch (e: any) {
			console.error('[profiles] AI failed, rules only:', e.message);
		}
	}
	// what the order and Kalyan uploads know about this person fills anything the emails did not say
	const up: any = c.upload_profile || {};
	for (const [k, v] of Object.entries(up)) {
		const cur = (profile as any)[k];
		if (Array.isArray(v)) (profile as any)[k] = uniq([...(Array.isArray(cur) ? cur : []), ...v.map(String)], 12);
		else if (v && !cur) (profile as any)[k] = v;
	}
	if (!texts.length && Object.keys(up).length) source = 'upload';
	await q('update customers set profile=$2, profile_source=$3, profile_at=now() where id=$1', [customerId, JSON.stringify(profile), source]);
	return { profile, source };
}

/** Background: profile customers that are new or have written since; the AI only for recently active ones. */
export async function buildProfiles(orgId: number, deadline: number) {
	const rows = await q<any>(
		`select id, (last_contact_at > now() - interval '30 days') as recent from customers
		  where org_id=$1 and (profile_at is null or last_contact_at > profile_at)
		    and exists (select 1 from conversations cv where cv.customer_id=customers.id) order by last_contact_at desc nulls last limit 300`,
		[orgId],
	);
	let n = 0;
	let ai = 0;
	for (const r of rows) {
		if (Date.now() > deadline) break;
		const useAi = r.recent && ai < 25;
		const res = await buildProfile(r.id, useAi).catch((e) => (console.error('[profiles]', e.message), null));
		if (res?.source === 'ai') ai++;
		n++;
	}
	return { profiled: n, ai };
}

export const merged = (c: any): Profile => ({ ...(c.profile || {}), ...(c.profile_manual || {}) });

export async function listCustomerDb(orgId: number, qs: URLSearchParams) {
	const params: unknown[] = [orgId];
	// everyone who has written, ordered or takes Kalyan
	const where = ['c.org_id=$1', `(c.orders_count > 0 or c.kalyan_buyer or exists (select 1 from conversations cv where cv.customer_id=c.id))`];
	const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
	const P = `(c.profile || c.profile_manual)`;
	const text = (qs.get('q') || '').trim();
	if (text) {
		const t = p(`%${text}%`);
		const digits = text.replace(/\D/g, '');
		const exact = p(text.toUpperCase().replace(/\s+/g, ''));
		where.push(`(c.name ilike ${t} or ${P}::text ilike ${t} or exists (select 1 from contacts k where k.customer_id=c.id and k.email ilike ${t})
			or ${exact} = any(c.kalyan_custnos) or exists (select 1 from orders o where o.org_id=c.org_id and o.customer_id=c.id and o.order_key = ${exact})
			${digits.length >= 10 ? `or exists (select 1 from customer_phones ph where ph.customer_id=c.id and ph.phone10 = ${p(digits.slice(-10))})` : ''})`);
	}
	// tier, Kalyan and orders (from the uploads)
	const tiers = (qs.get('tier') || '').split(',').map((x) => x.trim()).filter(Boolean);
	if (tiers.length) where.push(`c.buyer_tier = any(${p(tiers)}::text[])`);
	if (qs.get('kalyan') === 'yes') where.push('c.kalyan_buyer');
	if (qs.get('kalyan') === 'no') where.push('not c.kalyan_buyer');
	if (qs.get('kalyanType')) where.push(`c.kalyan_type = ${p(qs.get('kalyanType'))}`);
	if (qs.get('orders') === 'yes') where.push('c.orders_count > 0');
	if (qs.get('orders') === 'no') where.push('c.orders_count = 0');
	if (Number(qs.get('minSpend')) > 0) where.push(`c.orders_spend >= ${p(Number(qs.get('minSpend')))}`);
	if (Number(qs.get('minOrders')) > 0) where.push(`c.orders_count >= ${p(Number(qs.get('minOrders')))}`);
	if (qs.get('orderedSince')) where.push(`c.orders_last >= ${p(qs.get('orderedSince'))}::date`);
	if (qs.get('orderedBefore')) where.push(`c.orders_last < ${p(qs.get('orderedBefore'))}::date`);
	// important buyers who have not ordered for a while
	if (Number(qs.get('quietDays')) > 0) where.push(`c.buyer_tier in ('platinum','gold') and c.orders_count > 0 and c.orders_last < now() - make_interval(days => ${p(Math.round(Number(qs.get('quietDays'))))})`);
	if (qs.get('gap')) where.push(`${p(qs.get('gap'))} = any(c.data_gaps)`);
	if (qs.get('source') === 'email') where.push('exists (select 1 from conversations cv where cv.customer_id=c.id)');
	if (qs.get('type')) where.push(`coalesce(${P}->>'type', c.kind) = ${p(qs.get('type'))}`);
	if (qs.get('language')) where.push(`${P}->>'language' = ${p(qs.get('language'))}`);
	if (qs.get('state')) where.push(`${P}->>'state' ilike ${p(qs.get('state'))}`);
	if (qs.get('city')) where.push(`${P}->>'city' ilike ${p(`%${qs.get('city')}%`)}`);
	// country as recorded; a reader with an Indian PIN code and no country counts as India
	const COUNTRY = `initcap(coalesce(nullif(trim(${P}->>'country'),''), case when ${P}->>'pin' ~ '^[1-9][0-9]{5}$' then 'India' end))`;
	if (qs.get('country') === '-') where.push(`${COUNTRY} is null`);
	else if (qs.get('country')) where.push(`${COUNTRY} = initcap(${p(qs.get('country'))})`);
	// why they contacted: any (default) or all of the chosen purposes, and none of the excluded ones
	const purposes = (qs.get('purposes') || '').split(',').map((x) => x.trim()).filter(Boolean);
	const not = (qs.get('not') || '').split(',').map((x) => x.trim()).filter(Boolean);
	if (purposes.length) where.push(qs.get('purposeMode') === 'all' ? `c.purposes @> ${p(purposes)}::text[]` : `c.purposes && ${p(purposes)}::text[]`);
	if (not.length) where.push(`not (c.purposes && ${p(not)}::text[])`);
	if (qs.get('has') === 'phone') where.push(`jsonb_array_length(coalesce(${P}->'phones','[]')) > 0`);
	if (qs.get('has') === 'address') where.push(`coalesce(${P}->>'address','') <> ''`);
	if (qs.get('has') === 'orders') where.push(`jsonb_array_length(coalesce(${P}->'order_refs','[]')) > 0`);
	if (qs.get('has') === 'subscriber') where.push(`jsonb_array_length(coalesce(${P}->'subscriber_numbers','[]')) > 0`);
	// sort by any column, either way; empty values last
	const dir = qs.get('dir') === 'asc' ? 'asc' : qs.get('dir') === 'desc' ? 'desc' : '';
	const SORTS: Record<string, [string, 'asc' | 'desc']> = {
		recent: ['c.last_contact_at', 'desc'], name: ['lower(c.name)', 'asc'], type: [`coalesce(${P}->>'type', c.kind)`, 'asc'], place: [`lower(nullif(${P}->>'city',''))`, 'asc'],
		country: [COUNTRY, 'asc'], language: [`nullif(${P}->>'language','')`, 'asc'], threads: ['threads', 'desc'], reasons: ['cardinality(c.purposes)', 'desc'],
		tier: [`case c.buyer_tier when 'platinum' then 1 when 'gold' then 2 when 'silver' then 3 else 4 end`, 'asc'], points: ['c.buyer_points', 'desc'], spend: ['c.orders_spend', 'desc'],
		orders: ['c.orders_count', 'desc'], lastOrder: ['c.orders_last', 'desc'], kalyan: [`case c.kalyan_type when 'LM' then 1 when 'FY' then 2 when '1Y' then 3 else 4 end`, 'asc'],
	};
	const [col, def] = SORTS[qs.get('sort') || 'recent'] || SORTS.recent;
	const sort = `${col} ${dir || def} nulls last, c.id`;
	const exporting = ['csv', 'xlsx', 'print'].includes(qs.get('format') || '');
	const limit = exporting ? (qs.get('format') === 'print' ? 5000 : 300000) : Math.min(Number(qs.get('limit')) || 50, 200);
	const offset = Math.max(0, Number(qs.get('offset')) || 0);
	const W = where.join(' and ');
	const rows = await q<any>(
		`select c.id, c.name, c.kind, c.tier, c.purposes, c.buyer_tier, c.buyer_points::float as buyer_points, c.buyer_why, c.orders_count, c.orders_spend::float as orders_spend, c.orders_first, c.orders_last,
		        c.orders_12m, c.spend_12m::float as spend_12m, c.payment_methods, c.last_order_status, c.kalyan_buyer, c.kalyan_custnos, c.kalyan_type, c.kalyan_first::text, c.kalyan_last::text, c.kalyan_mode,
		        c.kalyan_renewal::text, c.kalyan_start_known, c.data_gaps, c.matched_by, c.from_uploads, ${COUNTRY} as country, c.health_score, c.health_status, c.last_contact_at, c.profile, c.profile_manual, c.profile_source, c.profile_at, c.enrichment, c.enriched_at,
		        (select count(*) from conversations cv where cv.customer_id=c.id)::int as threads,
		        (select count(*) from conversations cv where cv.customer_id=c.id and cv.awaiting_reply and cv.status in ('open','in_progress'))::int as waiting,
		        (select min(cv.first_message_at) from conversations cv where cv.customer_id=c.id) as first_contact
		   from customers c where ${W} order by ${sort} limit ${limit} offset ${offset}`,
		params,
	);
	const totals = await one<any>(
		`select count(*)::int as total,
		        count(*) filter (where jsonb_array_length(coalesce(${P}->'phones','[]')) > 0)::int as with_phone,
		        count(*) filter (where coalesce(${P}->>'address','') <> '')::int as with_address,
		        count(*) filter (where jsonb_array_length(coalesce(${P}->'order_refs','[]')) > 0)::int as with_orders,
		        count(*) filter (where jsonb_array_length(coalesce(${P}->'subscriber_numbers','[]')) > 0)::int as with_subscriber,
		        count(*) filter (where c.profile_source='ai')::int as by_ai,
		        count(*) filter (where c.kalyan_buyer)::int as kalyan, count(*) filter (where c.orders_count > 0)::int as with_uploaded_orders, coalesce(sum(c.orders_spend), 0)::float as spend,
		        count(*) filter (where c.buyer_tier='platinum')::int as platinum, count(*) filter (where c.buyer_tier='gold')::int as gold, count(*) filter (where c.buyer_tier='silver')::int as silver,
		        count(*) filter (where c.kalyan_buyer and c.orders_count > 0)::int as kalyan_and_orders,
		        count(*) filter (where c.profile_at is null and not c.from_uploads)::int as pending
		   from customers c
		  where ${W}`,
		params,
	);
	const types = await q<any>(`select coalesce(${P}->>'type', c.kind) as k, count(*)::int as n from customers c where ${W} group by 1 order by 2 desc`, params);
	const purposeCounts = await q<any>(`select x.p as k, count(*)::int as n from customers c, unnest(c.purposes) x(p) where ${W} group by 1 order by 2 desc`, params);
	const countries = await q<any>(`select ${COUNTRY} as k, count(*)::int as n from customers c where ${W} group by 1 order by (${COUNTRY} = 'India') desc nulls last, 2 desc limit 60`, params);
	const languages = await q<any>(`select ${P}->>'language' as k, count(*)::int as n from customers c where ${W} and coalesce(${P}->>'language','') <> '' group by 1 order by 2 desc limit 30`, params);
	return { rows: rows.map((r) => ({ ...r, p: merged(r) })), totals: { ...totals, types, purposes: purposeCounts, languages, countries }, offset, limit };
}

export async function updateProfile(orgId: number, id: number, input: Record<string, unknown>) {
	const c = await one<any>('select * from customers where id=$1 and org_id=$2', [id, orgId]);
	if (!c) throw new HttpError(404, 'Customer not found');
	const manual: any = { ...(c.profile_manual || {}) };
	for (const k of PROFILE_FIELDS) {
		if (!(k in input)) continue;
		const v = input[k];
		if (v === null || v === '') delete manual[k];
		else if (['emails', 'phones', 'order_refs', 'subscriber_numbers', 'books'].includes(k)) manual[k] = uniq((Array.isArray(v) ? v : String(v).split(/[,;\n]/)).map(String), 20);
		else manual[k] = String(v).slice(0, 500);
	}
	if (manual.type && !CUSTOMER_TYPES.includes(manual.type)) throw new HttpError(400, 'Unknown type');
	await q('update customers set profile_manual=$3, name=coalesce($4, name) where id=$1 and org_id=$2', [id, orgId, JSON.stringify(manual), typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 200) : null]);
	return one<any>('select * from customers where id=$1', [id]).then((r) => ({ ...r, p: merged(r) }));
}

/** One line for the AI when it drafts a reply to this customer. */
export function profileForPrompt(c: any): string {
	const p = merged(c);
	const parts = [
		p.type && `type: ${p.type}`, p.organisation && `organisation: ${p.organisation}`, p.language && `writes in ${p.language}`,
		p.address && `address on file: ${p.address}`, p.subscriber_numbers?.length && `Kalyan subscriber no.: ${p.subscriber_numbers.join(', ')}`,
		p.order_refs?.length && `earlier orders: ${p.order_refs.slice(0, 5).join(', ')}`,
	].filter(Boolean);
	return parts.join('; ');
}
