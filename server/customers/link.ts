/**
 * One customer per person across email, orders and Kalyan.
 *
 * People are linked automatically only on an exact, valid email address or an exact mobile number (last 10 digits).
 * When an email and a mobile point to two different customers they are not merged: the pair goes to a review list.
 * The same name with the same PIN code never merges on its own; it only adds a "possible duplicate" for staff.
 * Every link records how it was made (email or phone), and staff can merge or split.
 *
 * Orders and Kalyan barely overlap (about 284 Kalyan subscribers shared a phone with a month of orders), so most
 * people are found in one source only.
 */
import type pg from 'pg';
import { one, q, tx } from '../db';
import { HttpError } from '../http';
import { getOrg, invalidateOrg } from '../settings';
import { SUB_LABEL, clean, phone10, validEmail } from '../uploads/common';

type Source = 'orders' | 'kalyan';

const PROFILE = (extra = '') => `jsonb_strip_nulls(jsonb_build_object(
	'type', 'reader', 'emails', case when w.email is not null then jsonb_build_array(w.email) end, 'phones', case when w.phone10 is not null then jsonb_build_array(w.phone10) end,
	'address', nullif(w.address, ''), 'city', nullif(w.city, ''), 'state', nullif(w.state, ''), 'pin', nullif(w.pin, ''), 'country', case when w.pin <> '' then 'India' end${extra}))`;

async function newCustomers(c: pg.PoolClient, orgId: number, source: Source, by: 'email' | 'phone10' | 'id') {
	const pick = by === 'id' ? 'select w.* from lw w where w.customer_id is null' : `select distinct on (w.${by}) w.* from lw w where w.customer_id is null and w.${by} is not null order by w.${by}, w.id`;
	const r = await c.query(
		`with e as (${pick}),
		      ids as (select e.*, nextval(pg_get_serial_sequence('customers','id')) as cid from e),
		      ins as (
		        insert into customers (id, org_id, name, kind, auto_created, from_uploads, upload_profile, profile, profile_source, profile_at, matched_by)
		        select w.cid, $1, coalesce(nullif(w.name, ''), w.email, w.phone10, 'Not named'), 'customer', true, true, ${PROFILE()}, ${PROFILE()}, 'upload', now(), array[$2::text]
		          from ids w returning id),
		      k as (
		        insert into contacts (org_id, customer_id, email, name, source)
		        select distinct on (w.email) $1::bigint, w.cid, w.email, coalesce(w.name, ''), $2 from ids w where w.email is not null order by w.email on conflict do nothing returning 1)
		 update lw set customer_id = ids.cid, how = 'new', fresh = true from ids
		  where lw.customer_id is null and ${by === 'id' ? 'lw.id = ids.id' : `lw.${by} = ids.${by}`}`,
		[orgId, source === 'orders' ? 'order' : 'kalyan'],
	);
	return r.rowCount || 0;
}

/** Register the phones (and, for phone matches, the emails) of the people just linked. A phone or email already held by someone else is left alone and reported for review. */
async function registerKeys(c: pg.PoolClient, orgId: number, source: Source) {
	await c.query(
		`insert into customer_phones (org_id, phone10, customer_id, source)
		 select distinct on (w.phone10) $1::bigint, w.phone10, w.customer_id, $2 from lw w where w.customer_id is not null and w.phone10 is not null order by w.phone10, w.id on conflict do nothing`, [orgId, source]);
	await c.query(
		`insert into contacts (org_id, customer_id, email, name, source)
		 select distinct on (w.email) $1::bigint, w.customer_id, w.email, coalesce(w.name, ''), $2 from lw w where w.customer_id is not null and w.email is not null order by w.email, w.id on conflict do nothing`, [orgId, source === 'orders' ? 'order' : 'kalyan']);
	await c.query(
		`insert into customer_reviews (org_id, kind, customer_a, customer_b, detail)
		 select distinct $1::bigint, 'email_phone', least(w.customer_id, p.customer_id), greatest(w.customer_id, p.customer_id), 'Mobile ' || w.phone10 || ' is on both records, with different email addresses'
		   from lw w join customer_phones p on p.org_id=$1 and p.phone10=w.phone10 where w.customer_id is not null and p.customer_id <> w.customer_id
		 on conflict do nothing`, [orgId]);
}

/** Links every order (or Kalyan subscriber) that has no customer yet. Safe to run again: only unlinked rows are looked at. */
export async function linkPeople(orgId: number, source: Source) {
	// phones already known from customers' emails (first come, first kept)
	await q(
		`insert into customer_phones (org_id, phone10, customer_id, source)
		 select distinct on (ph) $1::bigint, ph, id, 'email' from (
		   select c.id, right(regexp_replace(x.p, '\\D', '', 'g'), 10) as ph from customers c, jsonb_array_elements_text(coalesce((c.profile || c.profile_manual)->'phones', '[]'::jsonb)) x(p) where c.org_id=$1 and not c.from_uploads) t
		  where ph ~ '^[6-9][0-9]{9}$' order by ph, id on conflict do nothing`, [orgId]);
	const res = await tx(async (c) => {
		await c.query(`create temp table lw (id bigserial primary key, ident text, name text, email text, phone10 text, pin text, city text, state text, address text, custno text, customer_id bigint, how text, fresh boolean not null default false) on commit drop`);
		if (source === 'orders') await c.query(
			`insert into lw (ident, name, email, phone10, pin, city, state, address)
			 select distinct on (ident) ident, coalesce(nullif(customer_name, ''), ship_name, ''), e, phone10, coalesce(ship_pin, ''), coalesce(ship_city, ''), '', coalesce(ship_address, '')
			   from (select o.*, case when email_ok then email end as e,
			                coalesce(case when email_ok then email end, '') || '|' || coalesce(phone10, '') || '|' || case when not email_ok and phone10 is null then order_key else '' end as ident
			           from orders o where org_id=$1 and customer_id is null) o
			  order by ident, ordered_at desc nulls last`, [orgId]);
		else await c.query(
			`insert into lw (ident, name, email, phone10, pin, city, state, address, custno)
			 select custno, name, case when email_ok then email end, phone10, pin, city, coalesce(state_norm, state), address, custno from kalyan_subscribers where org_id=$1 and customer_id is null`, [orgId]);
		await c.query('create index on lw (email)');
		await c.query('create index on lw (phone10)');
		await c.query('analyze lw');
		const total = (await c.query('select count(*)::int n from lw')).rows[0].n as number;
		if (!total) return { total: 0, byEmail: 0, byPhone: 0, created: 0 };
		// 1. exact email
		const byEmail = (await c.query(`update lw set customer_id = k.customer_id, how = 'email' from contacts k where k.org_id=$1 and k.customer_id is not null and lower(k.email) = lw.email and lw.email is not null`, [orgId])).rowCount || 0;
		await registerKeys(c, orgId, source);
		// 2. exact mobile
		const phoneMatch = async () => (await c.query(`update lw set customer_id = p.customer_id, how = 'phone' from customer_phones p where lw.customer_id is null and p.org_id=$1 and p.phone10 = lw.phone10`, [orgId])).rowCount || 0;
		let byPhone = await phoneMatch();
		await registerKeys(c, orgId, source);
		// 3. new people: one per email, then one per mobile, then the rest one by one
		let created = await newCustomers(c, orgId, source, 'email');
		await registerKeys(c, orgId, source);
		byPhone += await phoneMatch();
		created += await newCustomers(c, orgId, source, 'phone10');
		await registerKeys(c, orgId, source);
		created += await newCustomers(c, orgId, source, 'id');
		// write the links back, and note on existing customers what the upload knows about them
		if (source === 'orders') await c.query(
			`update orders o set customer_id = w.customer_id from lw w
			  where o.org_id=$1 and o.customer_id is null and w.ident = coalesce(case when o.email_ok then o.email end, '') || '|' || coalesce(o.phone10, '') || '|' || case when not o.email_ok and o.phone10 is null then o.order_key else '' end`, [orgId]);
		else await c.query(`update kalyan_subscribers s set customer_id = w.customer_id from lw w where s.org_id=$1 and s.custno = w.custno and s.customer_id is null`, [orgId]);
		await c.query(
			`update customers cu set matched_by = array(select distinct x from unnest(cu.matched_by || array[w.how]) x),
			        upload_profile = case when cu.upload_profile = '{}'::jsonb then ${PROFILE()} else cu.upload_profile end,
			        profile_at = case when cu.upload_profile = '{}'::jsonb and not cu.from_uploads then null else cu.profile_at end
			   from (select distinct on (customer_id) * from lw where not fresh and customer_id is not null order by customer_id, id) w where cu.id = w.customer_id`);
		const fresh = (await c.query('select customer_id from lw where fresh')).rows.map((r) => r.customer_id as number);
		return { total, byEmail, byPhone, created, fresh };
	});
	// the same name with the same PIN code: a suggestion for staff, never a merge
	let suggestions = 0;
	const fresh: number[] = (res as any).fresh || [];
	for (let i = 0; i < fresh.length && suggestions < 5000; i += 20000) {
		suggestions += (await q<any>(
			`insert into customer_reviews (org_id, kind, customer_a, customer_b, detail)
			 select distinct $1::bigint, 'name_pin', least(a.id, b.id), greatest(a.id, b.id), 'Same name and PIN code: ' || a.name || ', ' || (a.upload_profile->>'pin')
			   from customers a join customers b on b.org_id=a.org_id and b.from_uploads and lower(b.name) = lower(a.name) and (b.upload_profile->>'pin') = (a.upload_profile->>'pin') and b.id <> a.id
			  where a.org_id=$1 and a.id = any($2::bigint[]) and a.from_uploads and length(a.name) >= 6 and coalesce(a.upload_profile->>'pin', '') <> ''
			  limit 5000 on conflict do nothing returning 1`, [orgId, fresh.slice(i, i + 20000)])).length;
	}
	delete (res as any).fresh;
	return { ...res, suggestions };
}

/** Order and Kalyan figures on each customer record, from the rows linked to it. */
export async function refreshStats(orgId: number) {
	await q(
		`with o as (
		   select customer_id, count(*)::int as n, coalesce(sum(total), 0) as spend, min(ordered_at) as f, max(ordered_at) as l,
		          (count(*) filter (where ordered_at > now() - interval '12 months'))::int as n12, coalesce(sum(total) filter (where ordered_at > now() - interval '12 months'), 0) as s12,
		          coalesce(array_agg(distinct payment_method) filter (where payment_method is not null), '{}') as pm,
		          (array_agg(status_label order by ordered_at desc nulls last))[1] as last_status
		     from orders where org_id=$1 and customer_id is not null group by 1)
		 update customers c set orders_count=o.n, orders_spend=o.spend, orders_first=o.f, orders_last=o.l, orders_12m=o.n12, spend_12m=o.s12, payment_methods=o.pm, last_order_status=o.last_status
		   from o where c.id=o.customer_id and (c.orders_count, c.orders_spend, c.orders_last, c.orders_12m, c.spend_12m, c.last_order_status) is distinct from (o.n, o.spend, o.l, o.n12, o.s12, o.last_status)`, [orgId]);
	await q(`update customers c set orders_count=0, orders_spend=0, orders_first=null, orders_last=null, orders_12m=0, spend_12m=0, payment_methods='{}', last_order_status=null
	          where c.org_id=$1 and c.orders_count > 0 and not exists (select 1 from orders o where o.customer_id=c.id)`, [orgId]);
	await q(
		`with k as (
		   select customer_id, array_agg(custno order by custno) as nos, min(first_dispatch) as f, max(last_dispatch) as l,
		          (array_agg(sub_type order by case sub_type when 'LM' then 3 when 'FY' then 2 else 1 end desc, last_dispatch desc nulls last))[1] as typ,
		          (array_agg(mode order by last_dispatch desc nulls last))[1] as mode, min(renewal_est) as ren, bool_or(start_known) as known
		     from kalyan_subscribers where org_id=$1 and customer_id is not null and dispatches > 0 group by 1)
		 update customers c set kalyan_buyer=true, kalyan_custnos=k.nos, kalyan_type=k.typ, kalyan_first=k.f, kalyan_last=k.l, kalyan_mode=k.mode, kalyan_renewal=k.ren, kalyan_start_known=k.known
		   from k where c.id=k.customer_id and (c.kalyan_buyer, c.kalyan_custnos, c.kalyan_type, c.kalyan_first, c.kalyan_last, c.kalyan_mode, c.kalyan_renewal, c.kalyan_start_known) is distinct from (true, k.nos, k.typ, k.f, k.l, k.mode, k.ren, k.known)`, [orgId]);
	await q(`update customers c set kalyan_buyer=false, kalyan_custnos='{}', kalyan_type=null, kalyan_first=null, kalyan_last=null, kalyan_mode=null, kalyan_renewal=null, kalyan_start_known=false
	          where c.org_id=$1 and c.kalyan_buyer and not exists (select 1 from kalyan_subscribers s where s.customer_id=c.id and s.dispatches > 0)`, [orgId]);
	// what the uploads know, kept on the record: subscriber numbers and recent order numbers
	await q(
		`update customers c set upload_profile = x.p, profile = case when c.profile_source = 'upload' then x.p else c.profile end,
		        profile_at = case when c.profile_source = 'upload' or c.profile_at is null then c.profile_at else null end
		   from (select c.id, jsonb_strip_nulls(c.upload_profile || jsonb_build_object(
		                  'subscriber_numbers', case when cardinality(c.kalyan_custnos) > 0 then to_jsonb(c.kalyan_custnos) end,
		                  'order_refs', (select to_jsonb(array_agg(order_id)) from (select order_id from orders o where o.customer_id=c.id order by ordered_at desc nulls last limit 10) t))) as p
		           from customers c where c.org_id=$1 and (c.orders_count > 0 or c.kalyan_buyer)) x
		  where c.id=x.id and c.upload_profile is distinct from x.p`, [orgId]);
	// gaps in the record that stop a reply or a follow-up
	await q(
		`update customers c set data_gaps = x.gaps
		   from (select c.id, array_remove(array[
		                  case when not exists (select 1 from contacts k where k.customer_id=c.id) then 'No email address' end,
		                  case when exists (select 1 from orders o where o.customer_id=c.id and o.email is not null and not o.email_ok) or exists (select 1 from kalyan_subscribers s where s.customer_id=c.id and s.email is not null and not s.email_ok) then 'Email address on file is not valid' end,
		                  case when not exists (select 1 from customer_phones p where p.customer_id=c.id) then 'No mobile number' end,
		                  case when exists (select 1 from orders o where o.customer_id=c.id and o.tracking_id is not null and not o.tracking_ok) then 'An order has a damaged tracking number' end], null) as gaps
		           from customers c where c.org_id=$1 and (c.orders_count > 0 or c.kalyan_buyer or c.from_uploads)) x
		  where c.id=x.id and c.data_gaps is distinct from x.gaps`, [orgId]);
}

// ── tiers (customer criticality) ────────────────────────────────────────────

export interface TierSettings {
	/** points per ₹1,000 spent in the last 12 months */
	spendPer1000: number;
	/** points per order in the last 12 months */
	perOrder: number;
	/** points per year as a Kalyan subscriber (a life member counts at least 4 years, a 5-year subscriber 2, a 1-year subscriber 1) */
	perKalyanYear: number;
	/** points for a bulk or dealer buyer */
	bulkDealer: number;
	/** share of ranked customers in each tier, in percent */
	platinumPct: number;
	goldPct: number;
	silverPct: number;
	/** days without an order before an important buyer counts as "gone quiet" */
	quietDays: number;
}
export const TIER_DEFAULTS: TierSettings = { spendPer1000: 1, perOrder: 2, perKalyanYear: 0.5, bulkDealer: 10, platinumPct: 2, goldPct: 8, silverPct: 20, quietDays: 90 };
export const TIER_LABEL: Record<string, string> = { platinum: 'Platinum', gold: 'Gold', silver: 'Silver', regular: 'Regular' };

export async function tierSettings(orgId: number): Promise<TierSettings> {
	return { ...TIER_DEFAULTS, ...(((await getOrg(orgId)).settings as any).tiers || {}) };
}
export async function saveTierSettings(orgId: number, input: any): Promise<TierSettings> {
	const cur = await tierSettings(orgId);
	const n = (k: keyof TierSettings, lo: number, hi: number) => { const v = Number(input?.[k]); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : cur[k]; };
	const next: TierSettings = {
		spendPer1000: n('spendPer1000', 0, 100), perOrder: n('perOrder', 0, 100), perKalyanYear: n('perKalyanYear', 0, 100), bulkDealer: n('bulkDealer', 0, 1000),
		platinumPct: n('platinumPct', 0, 50), goldPct: n('goldPct', 0, 50), silverPct: n('silverPct', 0, 80), quietDays: Math.round(n('quietDays', 14, 730)),
	};
	if (next.platinumPct + next.goldPct + next.silverPct > 100) throw new HttpError(400, 'Platinum, Gold and Silver together cannot be more than 100%');
	await q(`update organisations set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('tiers', $2::jsonb) where id=$1`, [orgId, JSON.stringify(next)]);
	invalidateOrg(orgId);
	return next;
}

/**
 * Platinum / Gold / Silver / Regular from points. Customers are ranked (points, then spend, then orders, then longest
 * with Kalyan); the top shares set in Settings become Platinum, Gold and Silver. A plain 1-year Kalyan subscription on
 * its own is not ranked (about 100,000 such records would otherwise make every book buyer Platinum). Each record says why.
 */
export async function computeTiers(orgId: number) {
	const s = await tierSettings(orgId);
	// years with Kalyan: the time seen in the uploads, but at least what the subscription stands for (life member 4, five-year 2, one-year 1)
	const YEARS = `greatest(case c.kalyan_type when 'LM' then 4 when 'FY' then 2 when '1Y' then 1 else 0 end, coalesce((c.kalyan_last - c.kalyan_first) / 365.0, 0))`;
	const BULK = `(c.purposes && array['bulk_order','dealer'])`;
	const r = await one<any>(
		`with p as (
		   select c.id, round((c.spend_12m / 1000.0 * $2::numeric + c.orders_12m * $3::numeric + case when c.kalyan_buyer then ${YEARS} * $4::numeric else 0 end + case when ${BULK} then $5::numeric else 0 end)::numeric, 1) as pts,
		          c.spend_12m, c.orders_12m, c.kalyan_first, c.kalyan_buyer, c.kalyan_type, ${BULK} as bulk
		     from customers c where c.org_id=$1 and (c.orders_count > 0 or c.kalyan_buyer or ${BULK} or c.buyer_tier <> 'regular' or c.buyer_points <> 0)),
		 -- a plain 1-year Kalyan subscription on its own (the most common record) is not ranked: it stays Regular
		 r as (select p.*, row_number() over (order by pts desc, spend_12m desc, orders_12m desc, kalyan_first asc nulls last, id) as pos, count(*) filter (where pts > $9::numeric) over () as ranked from p),
		 t as (
		   select r.*, case when pts <= $9::numeric then 'regular' when pos <= ceil(ranked * $6::numeric / 100.0) then 'platinum' when pos <= ceil(ranked * ($6::numeric + $7::numeric) / 100.0) then 'gold'
		                    when pos <= ceil(ranked * ($6::numeric + $7::numeric + $8::numeric) / 100.0) then 'silver' else 'regular' end as tier,
		          array_remove(array[
		            case when spend_12m > 0 then '₹' || to_char(round(spend_12m), 'FM99,99,99,990') || ' spent in the last 12 months' end,
		            case when orders_12m > 0 then orders_12m || case when orders_12m = 1 then ' order' else ' orders' end || ' in the last 12 months' end,
		            case when kalyan_buyer then 'Kalyan: ' || case kalyan_type when 'LM' then 'life member' when 'FY' then '5-year subscriber' when '1Y' then '1-year subscriber' else 'subscriber' end end,
		            case when bulk then 'Bulk or dealer buyer' end], null) as why
		     from r),
		 u as (update customers c set buyer_tier=t.tier, buyer_points=t.pts, buyer_why=t.why from t where c.id=t.id and (c.buyer_tier, c.buyer_points, c.buyer_why) is distinct from (t.tier, t.pts, t.why) returning 1)
		 select (select count(*)::int from u) as changed, (select count(*)::int from t where tier='platinum') as platinum, (select count(*)::int from t where tier='gold') as gold,
		        (select count(*)::int from t where tier='silver') as silver, (select count(*)::int from t where pts > $9::numeric) as ranked`,
		[orgId, s.spendPer1000, s.perOrder, s.perKalyanYear, s.bulkDealer, s.platinumPct, s.goldPct, s.silverPct, s.perKalyanYear],
	);
	return r;
}

// ── merge, split, review list ───────────────────────────────────────────────

/** Called when two customer records are merged: orders, Kalyan numbers and phones follow. */
export async function moveCustomerData(target: number, source: number) {
	await q('update orders set customer_id=$1 where customer_id=$2', [target, source]);
	await q('update kalyan_subscribers set customer_id=$1 where customer_id=$2', [target, source]);
	await q('update customer_phones set customer_id=$1 where customer_id=$2', [target, source]);
	await q(`update customer_reviews set status='merged', decided_at=now() where status='open' and ((customer_a=$1 and customer_b=$2) or (customer_a=$2 and customer_b=$1))`, [target, source]);
	await q(`update customers t set upload_profile = s.upload_profile || t.upload_profile, matched_by = array(select distinct x from unnest(t.matched_by || s.matched_by || array['merged by staff']) x), from_uploads = t.from_uploads and s.from_uploads
	           from customers s where t.id=$1 and s.id=$2`, [target, source]);
}

/**
 * Split: move some of a customer's orders, Kalyan numbers, email addresses or phones to a new customer record
 * (for two people who were linked because they share a phone or an email address).
 */
export async function splitCustomer(orgId: number, id: number, input: { name?: string; orderKeys?: string[]; custnos?: string[]; emails?: string[]; phones?: string[] }) {
	const c = await one<any>('select * from customers where id=$1 and org_id=$2', [id, orgId]);
	if (!c) throw new HttpError(404, 'Customer not found');
	const orderKeys = (input.orderKeys || []).map(String);
	const custnos = (input.custnos || []).map(String);
	const emails = (input.emails || []).map(validEmail).filter(Boolean) as string[];
	const phones = (input.phones || []).map(phone10).filter(Boolean) as string[];
	if (!orderKeys.length && !custnos.length && !emails.length && !phones.length) throw new HttpError(400, 'Choose what to move to the new customer');
	const name = clean(input.name, 200) || (custnos.length ? (await one<any>('select name from kalyan_subscribers where org_id=$1 and custno=$2', [orgId, custnos[0]]))?.name : '')
		|| (orderKeys.length ? (await one<any>('select customer_name from orders where org_id=$1 and order_key=$2', [orgId, orderKeys[0]]))?.customer_name : '') || `${c.name} (2)`;
	const fresh = await one<any>(
		`insert into customers (org_id, name, kind, auto_created, from_uploads, profile_source, profile_at, matched_by) values ($1,$2,'customer',false,true,'upload',now(),array['split by staff']) returning id`, [orgId, name]);
	await q('update orders set customer_id=$1 where org_id=$2 and customer_id=$3 and order_key = any($4::text[])', [fresh.id, orgId, id, orderKeys]);
	await q('update kalyan_subscribers set customer_id=$1 where org_id=$2 and customer_id=$3 and custno = any($4::text[])', [fresh.id, orgId, id, custnos]);
	await q('update contacts set customer_id=$1 where org_id=$2 and customer_id=$3 and lower(email) = any($4::text[])', [fresh.id, orgId, id, emails]);
	await q('update customer_phones set customer_id=$1 where org_id=$2 and customer_id=$3 and phone10 = any($4::text[])', [fresh.id, orgId, id, phones]);
	if (emails.length) await q(
		`update conversations cv set customer_id=$1 where cv.customer_id=$2 and exists (select 1 from emails e where e.conversation_id=cv.id and e.direction='inbound' and lower(e.from_address) = any($3::text[]))`, [fresh.id, id, emails]);
	// the new record starts from what its own orders and Kalyan rows say
	await q(
		`update customers c set upload_profile = coalesce((
		   select jsonb_strip_nulls(jsonb_build_object('type','reader','phones', case when x.phone10 is not null then jsonb_build_array(x.phone10) end, 'address', nullif(x.address,''), 'city', nullif(x.city,''), 'state', nullif(x.state,''), 'pin', nullif(x.pin,''), 'country', case when x.pin <> '' then 'India' end))
		     from (select phone10, address, city, coalesce(state_norm, state) as state, pin from kalyan_subscribers where customer_id=c.id
		           union all select phone10, coalesce(ship_address,''), coalesce(ship_city,''), '', coalesce(ship_pin,'') from orders where customer_id=c.id limit 1) x), '{}'::jsonb) where c.id=$1`, [fresh.id]);
	await q(`update customers set profile = upload_profile || jsonb_build_object('emails', coalesce((select jsonb_agg(email) from contacts where customer_id=$1), '[]'::jsonb)) where id=$1`, [fresh.id]);
	await refreshStats(orgId);
	await computeTiers(orgId);
	return { id: fresh.id as number, name };
}

export async function listReviews(orgId: number, status = 'open', limit = 200) {
	const cols = (a: string) => `${a}.id as ${a}_id, ${a}.name as ${a}_name, ${a}.upload_profile || ${a}.profile || ${a}.profile_manual as ${a}_p, ${a}.orders_count as ${a}_orders, ${a}.kalyan_custnos as ${a}_kalyan, ${a}.matched_by as ${a}_how,
		(select count(*)::int from conversations v where v.customer_id=${a}.id) as ${a}_threads, (select array_agg(k.email) from contacts k where k.customer_id=${a}.id) as ${a}_emails`;
	const rows = await q<any>(
		`select r.id, r.kind, r.detail, r.status, r.created_at, ${cols('a')}, ${cols('b')}
		   from customer_reviews r join customers a on a.id=r.customer_a join customers b on b.id=r.customer_b where r.org_id=$1 and r.status=$2 order by r.kind, r.id desc limit ${Math.min(limit, 1000)}`, [orgId, status]);
	const counts = await q<any>(`select kind, count(*)::int as n from customer_reviews where org_id=$1 and status='open' group by 1`, [orgId]);
	return { rows, counts: Object.fromEntries(counts.map((c) => [c.kind, c.n])) };
}
export async function dismissReview(orgId: number, id: number, userId: number | null) {
	const r = await q(`update customer_reviews set status='dismissed', decided_by=$3, decided_at=now() where id=$1 and org_id=$2 and status='open' returning id`, [id, orgId, userId]);
	if (!r.length) throw new HttpError(404, 'Not found');
	return { success: true };
}

/** The order list and the Kalyan dispatch history shown on a customer record. */
export async function customerHistory(orgId: number, id: number) {
	const [orders, subs, dispatches, phones] = await Promise.all([
		q<any>(`select order_key, order_id, ordered_at, total::float as total, postage::float as postage, status_label, payment_status, payment_method, partner, tracking_id, tracking_ok, site, ship_city, ship_pin
		          from orders where org_id=$1 and customer_id=$2 order by ordered_at desc nulls last limit 300`, [orgId, id]),
		q<any>(`select custno, name, address, city, pin, coalesce(state_norm, state) as state, phone, email, email_ok, sub_type, mode, first_dispatch::text, last_dispatch::text, first_issue_ym, last_issue_ym, dispatches, start_known, renewal_est::text
		          from kalyan_subscribers where org_id=$1 and customer_id=$2 order by custno`, [orgId, id]),
		q<any>(`select d.custno, d.from_issue, d.to_issue, d.dispdate::text, d.mode, d.barcode, d.subperiod from kalyan_dispatches d
		         where d.org_id=$1 and d.custno in (select custno from kalyan_subscribers where org_id=$1 and customer_id=$2) order by d.dispdate desc, d.to_issue desc limit 400`, [orgId, id]),
		q<any>(`select phone10, source from customer_phones where org_id=$1 and customer_id=$2 order by phone10`, [orgId, id]),
	]);
	return { orders, subscribers: subs.map((s) => ({ ...s, sub_label: SUB_LABEL[s.sub_type] || s.sub_type })), dispatches, phones };
}

/**
 * Alerts for important buyers: a Platinum or Gold buyer with no order for the set number of days (90 by default),
 * and a Kalyan subscriber of two years or more whose estimated renewal has passed with no dispatch since. Each is
 * raised once; it is raised again only after a new order or dispatch.
 */
export async function raiseBuyerAlerts(orgId: number) {
	const s = await tierSettings(orgId);
	const quiet = await q<any>(
		`insert into alerts (org_id, customer_id, severity, title, body, dedup_key)
		 select $1, c.id, case when c.buyer_tier = 'platinum' then 'high' else 'medium' end,
		        left(initcap(c.buyer_tier) || ' buyer has not ordered for ' || (current_date - c.orders_last::date) || ' days: ' || c.name, 300),
		        'Last order ' || to_char(c.orders_last, 'DD Mon YYYY') || '; ' || c.orders_count || ' orders, ₹' || to_char(round(c.orders_spend), 'FM99,99,99,990') || ' in all. ' || array_to_string(c.buyer_why, '; ') || '.',
		        'buyer_quiet:' || c.id || ':' || c.orders_last::date
		   from customers c where c.org_id=$1 and c.buyer_tier in ('platinum','gold') and c.orders_count > 0 and c.orders_last < now() - make_interval(days => $2)
		  order by c.buyer_points desc limit 200
		 on conflict (org_id, dedup_key) do nothing returning id`, [orgId, s.quietDays]);
	const lapsed = await q<any>(
		`insert into alerts (org_id, customer_id, severity, title, body, dedup_key)
		 select $1, c.id, 'medium', left('Kalyan subscriber of ' || floor((c.kalyan_last - c.kalyan_first) / 365.0) || '+ years has not renewed: ' || c.name, 300),
		        'Subscriber ' || array_to_string(c.kalyan_custnos, ', ') || '; renewal was due (estimated) ' || to_char(c.kalyan_renewal, 'Mon YYYY') || '; last dispatch ' || to_char(c.kalyan_last, 'DD Mon YYYY') || '.',
		        'kalyan_lapsed:' || c.id || ':' || c.kalyan_renewal
		   from customers c where c.org_id=$1 and c.kalyan_buyer and c.kalyan_type <> 'LM' and c.kalyan_renewal < current_date and c.kalyan_last < c.kalyan_renewal
		    and c.kalyan_last - c.kalyan_first >= 730
		  limit 500
		 on conflict (org_id, dedup_key) do nothing returning id`, [orgId]);
	return { buyersQuiet: quiet.length, kalyanNotRenewed: lapsed.length };
}
