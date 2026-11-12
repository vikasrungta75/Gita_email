/**
 * Customer enrichment. Adds to each customer record:
 *  - activity from Gita Mail itself (threads, groups they write about, mailbox they use, sentiment, last reply)
 *  - region from public postal and GST codes (PIN code → state, GSTIN → state and type of entity)
 *  - other records that share a phone number or postal address (possible duplicates or one household)
 *  - for organisations only (a business email domain), the title and description of their own website.
 * Private individuals are never looked up on the internet: only what they wrote to Gita Press is used.
 */
import { one, q } from './db';
import { merged } from './profiles';
import { BUSINESS_LABELS, type BusinessCategory } from './ai/types';

const PIN2: Record<string, string> = {
	'11': 'Delhi', '12': 'Haryana', '13': 'Haryana', '14': 'Punjab', '15': 'Punjab', '16': 'Punjab', '17': 'Himachal Pradesh', '18': 'Jammu and Kashmir', '19': 'Jammu and Kashmir',
	'20': 'Uttar Pradesh', '21': 'Uttar Pradesh', '22': 'Uttar Pradesh', '23': 'Uttar Pradesh', '24': 'Uttar Pradesh', '25': 'Uttar Pradesh', '26': 'Uttar Pradesh', '27': 'Uttar Pradesh', '28': 'Uttar Pradesh',
	'30': 'Rajasthan', '31': 'Rajasthan', '32': 'Rajasthan', '33': 'Rajasthan', '34': 'Rajasthan', '36': 'Gujarat', '37': 'Gujarat', '38': 'Gujarat', '39': 'Gujarat',
	'40': 'Maharashtra', '41': 'Maharashtra', '42': 'Maharashtra', '43': 'Maharashtra', '44': 'Maharashtra', '45': 'Madhya Pradesh', '46': 'Madhya Pradesh', '47': 'Madhya Pradesh', '48': 'Madhya Pradesh', '49': 'Chhattisgarh',
	'50': 'Telangana', '51': 'Andhra Pradesh', '52': 'Andhra Pradesh', '53': 'Andhra Pradesh', '56': 'Karnataka', '57': 'Karnataka', '58': 'Karnataka', '59': 'Karnataka',
	'60': 'Tamil Nadu', '61': 'Tamil Nadu', '62': 'Tamil Nadu', '63': 'Tamil Nadu', '64': 'Tamil Nadu', '67': 'Kerala', '68': 'Kerala', '69': 'Kerala',
	'70': 'West Bengal', '71': 'West Bengal', '72': 'West Bengal', '73': 'West Bengal', '74': 'West Bengal', '75': 'Odisha', '76': 'Odisha', '77': 'Odisha', '78': 'Assam', '79': 'North East',
	'80': 'Bihar', '81': 'Bihar', '82': 'Bihar', '83': 'Jharkhand', '84': 'Bihar', '85': 'Bihar',
};
const PIN3: Record<string, string> = {
	'160': 'Chandigarh', '194': 'Ladakh', '246': 'Uttarakhand', '247': 'Uttarakhand', '248': 'Uttarakhand', '249': 'Uttarakhand', '262': 'Uttarakhand', '263': 'Uttarakhand',
	'403': 'Goa', '605': 'Puducherry', '737': 'Sikkim', '744': 'Andaman and Nicobar', '790': 'Arunachal Pradesh', '791': 'Arunachal Pradesh', '792': 'Arunachal Pradesh',
	'793': 'Meghalaya', '794': 'Meghalaya', '795': 'Manipur', '796': 'Mizoram', '797': 'Nagaland', '798': 'Nagaland', '799': 'Tripura',
	'814': 'Jharkhand', '815': 'Jharkhand', '816': 'Jharkhand', '822': 'Jharkhand', '825': 'Jharkhand', '826': 'Jharkhand', '827': 'Jharkhand', '828': 'Jharkhand', '829': 'Jharkhand',
};
export const stateFromPin = (pin?: string) => (pin && /^[1-9]\d{5}$/.test(pin) ? PIN3[pin.slice(0, 3)] || PIN2[pin.slice(0, 2)] || '' : '');

const GST_STATE: Record<string, string> = {
	'01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
	'10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
	'20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
	'30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};
const PAN_TYPE: Record<string, string> = { P: 'Individual', C: 'Company', H: 'Hindu undivided family', F: 'Firm or partnership', A: 'Association of persons', T: 'Trust', B: 'Body of individuals', L: 'Local authority', J: 'Artificial juridical person', G: 'Government' };
export function gstinInfo(g?: string) {
	if (!g || !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return null;
	return { state: GST_STATE[g.slice(0, 2)] || '', entity: PAN_TYPE[g[5]] || '' };
}

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|rediffmail|rediff|icloud|me|mac|aol|protonmail|proton|zohomail|yandex|mail|gmx|inbox|indiatimes|sify|vsnl|bsnl|in\.com)\./i;
const isOrgDomain = (d: string) => !!d && !FREE_MAIL.test(d) && !/gitapress\.org$/i.test(d);

/** The title and description of an organisation's own website (public business information). */
export async function websiteInfo(domain: string) {
	for (const url of [`https://${domain}`, `https://www.${domain}`]) {
		try {
			const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'GitaMail/1.0 (customer record enrichment; contact via the site owner)', accept: 'text/html' } });
			if (!res.ok || !/text\/html/i.test(res.headers.get('content-type') || '')) continue;
			const html = (await res.text()).slice(0, 200_000);
			const meta = (name: string) => html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']{2,400})["']`, 'i'))?.[1] || html.match(new RegExp(`<meta[^>]+content=["']([^"']{2,400})["'][^>]*(?:name|property)=["']${name}["']`, 'i'))?.[1];
			const decode = (s?: string) => s?.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
			const title = decode(meta('og:site_name') || html.match(/<title[^>]*>([^<]{2,200})<\/title>/i)?.[1]);
			const description = decode(meta('description') || meta('og:description'));
			if (title || description) return { url: res.url || url, title: title?.slice(0, 160), description: description?.slice(0, 300) };
		} catch {
			/* site not reachable: no website information */
		}
	}
	return null;
}

export async function enrichCustomer(customerId: number, opts: { web?: boolean } = {}) {
	const c = await one<any>('select * from customers where id=$1', [customerId]);
	if (!c) return null;
	const p = merged(c);
	const act = await one<any>(
		`select count(*)::int as threads,
		        coalesce(sum(inbound_count),0)::int as emails_from_them,
		        count(*) filter (where awaiting_reply and status in ('open','in_progress'))::int as waiting,
		        count(*) filter (where rag='red')::int as red,
		        round(avg(sentiment_score)::numeric, 2)::float as avg_sentiment,
		        round(avg(first_response_minutes)::numeric / 60, 1)::float as avg_first_reply_hours,
		        min(first_message_at) as first_contact, max(last_message_at) as last_contact,
		        (select jsonb_agg(x order by x.n desc) from (select business_category as g, count(*)::int as n from conversations where customer_id=$1 group by 1 order by 2 desc limit 4) x) as groups,
		        (select m.address from conversations c2 join mailboxes m on m.id = c2.mailbox_ids[1] where c2.customer_id=$1 group by m.address order by count(*) desc limit 1) as usual_mailbox,
		        (select max(d.sent_at) from reply_drafts d join conversations c3 on c3.id=d.conversation_id where c3.customer_id=$1 and d.status='sent') as last_reply_sent
		   from conversations where customer_id=$1`,
		[customerId],
	);
	// other records sharing a phone number or the same address and PIN
	const phones: string[] = p.phones || [];
	const twins = phones.length || (p.address && p.pin)
		? await q<any>(
			`select id, name from customers where org_id=$1 and id<>$2 and (
			   (coalesce(profile->'phones','[]') || coalesce(profile_manual->'phones','[]')) ?| $3::text[]
			   or ($4::text is not null and (profile||profile_manual)->>'pin' = $4 and lower(regexp_replace((profile||profile_manual)->>'address', '\\W', '', 'g')) = lower(regexp_replace($5, '\\W', '', 'g'))))
			 limit 5`,
			[c.org_id, customerId, phones, p.address && p.pin ? p.pin : null, p.address || ''],
		)
		: [];
	const gst = gstinInfo(p.gstin);
	const domains: string[] = [...new Set([...(c.domains || []), ...((p.emails || []) as string[]).map((e) => e.split('@')[1]?.toLowerCase())].filter(Boolean))];
	const orgDomain = domains.find(isOrgDomain);
	const prev = c.enrichment || {};
	let website = prev.website || null;
	if (opts.web && orgDomain && (!prev.website_checked_at || Date.now() - new Date(prev.website_checked_at).getTime() > 30 * 86400_000)) {
		website = await websiteInfo(orgDomain);
	}
	const enrichment = {
		activity: {
			...act,
			groups: (act?.groups || []).map((g: any) => ({ label: BUSINESS_LABELS[g.g as BusinessCategory] || g.g, n: g.n })),
		},
		region: {
			pin_state: stateFromPin(p.pin) || null,
			gst_state: gst?.state || null,
			gst_entity: gst?.entity || null,
			mismatch: !!(p.state && stateFromPin(p.pin) && !stateFromPin(p.pin).toLowerCase().includes(String(p.state).toLowerCase().split(' ')[0])),
		},
		possible_duplicates: twins,
		org_domain: orgDomain || null,
		website,
		website_checked_at: opts.web && orgDomain ? new Date().toISOString() : prev.website_checked_at || null,
	};
	await q('update customers set enrichment=$2, enriched_at=now() where id=$1', [customerId, JSON.stringify(enrichment)]);
	// fill the state from the PIN or GSTIN when the emails did not say it
	if (!p.state && (enrichment.region.pin_state || enrichment.region.gst_state)) {
		await q(`update customers set profile = jsonb_set(profile, '{state}', to_jsonb($2::text)) where id=$1`, [customerId, enrichment.region.pin_state || enrichment.region.gst_state]);
	}
	return enrichment;
}

/** Background: enrich records built or changed since their last enrichment; a few website checks per run. */
export async function enrichCustomers(orgId: number, deadline: number) {
	const rows = await q<any>(
		`select id from customers where org_id=$1 and profile_at is not null and (enriched_at is null or enriched_at < profile_at or enriched_at < last_contact_at)
		    and exists (select 1 from conversations cv where cv.customer_id=customers.id)
		  order by last_contact_at desc nulls last limit 200`,
		[orgId],
	);
	let n = 0;
	let web = 0;
	for (const r of rows) {
		if (Date.now() > deadline) break;
		const allowWeb = web < 10;
		const e = await enrichCustomer(r.id, { web: allowWeb }).catch((err) => (console.error('[enrich]', err.message), null));
		if (allowWeb && e?.org_domain) web++;
		n++;
	}
	return { enriched: n, websites: web };
}
