/**
 * Dashboards for the data sections: stock (branch, and Gorakhpur main/retail/semi-finished), tracking (book orders,
 * Kalyan dispatches), and the book list (Suchi) and book links. Each returns headline figures and small grouped
 * series; the pages draw them. Everything reads the latest data, the same as the tables and the replies.
 */
import { q, one } from '../db';
import { latestStock, locState } from './datasets';
import { DIRECTORY } from '../directory';

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const city = (expr: string) => `case ${expr} ${DIRECTORY.map((d) => `when ${lit(d.key)} then ${lit(d.city)}`).join(' ')} else initcap(${expr}) end`;

// ── stock ───────────────────────────────────────────────────────────────────
export async function stockInsight(orgId: number, scope: 'hq' | 'branch') {
	const base = `with lu as (${latestStock(scope)}),
	  r as (select r.*, lu.period_to from stock_rows r join lu on lu.id = r.upload_id and lu.loc = r.location where r.org_id = $1)`;
	const offered = scope === 'hq' ? `r.godown_kind in ('main', 'retail')` : 'true';
	const k = await one<any>(`${base}
	  select count(distinct r.location)::int as locations,
	         count(distinct r.code) filter (where r.closing_qty > 0 and ${offered})::int as titles,
	         coalesce(sum(greatest(r.closing_qty, 0)) filter (where ${offered}), 0)::float as copies,
	         coalesce(sum(greatest(r.closing_value, 0)) filter (where ${offered}), 0)::float as value,
	         coalesce(sum(r.out_qty) filter (where ${offered}), 0)::float as outward,
	         coalesce(sum(r.in_qty) filter (where ${offered}), 0)::float as inward,
	         coalesce(sum(greatest(r.closing_qty, 0)) filter (where r.godown_kind = 'semi'), 0)::float as semi,
	         min(r.period_to)::text as oldest, max(r.period_to)::text as newest
	    from r`, [orgId]);
	const byLocation = await q<any>(`${base}
	  select ${city('r.location')} as k, ${locState('r.location')} as state, max(r.period_to)::text as as_of,
	         count(distinct r.code) filter (where r.closing_qty > 0)::int as titles, sum(greatest(r.closing_qty, 0))::float as copies,
	         sum(greatest(r.closing_value, 0))::float as value, sum(r.out_qty)::float as outward
	    from r where ${offered} group by r.location order by copies desc`, [orgId]);
	const byKind = await q<any>(`${base}
	  select case r.godown_kind when 'main' then 'Main stock' when 'retail' then 'Retail stock' when 'semi' then 'Semi-finished' when 'godown' then 'Godown' else 'Shop' end as k,
	         count(distinct r.code) filter (where r.closing_qty > 0)::int as titles, sum(greatest(r.closing_qty, 0))::float as copies, sum(greatest(r.closing_value, 0))::float as value, sum(r.out_qty)::float as outward
	    from r group by 1 order by copies desc`, [orgId]);
	const byLanguage = await q<any>(`${base}
	  select coalesce(nullif(r.language, ''), nullif(b.language, ''), 'Not stated') as k, count(distinct r.code) filter (where r.closing_qty > 0)::int as titles, sum(greatest(r.closing_qty, 0))::float as copies
	    from r left join book_titles b on b.org_id = r.org_id and b.code = r.code where ${offered} group by 1 order by copies desc limit 12`, [orgId]);
	const bySize = await q<any>(`${base}
	  select coalesce(b.size_en, 'Not in the Suchi') as k, count(distinct r.code) filter (where r.closing_qty > 0)::int as titles, sum(greatest(r.closing_qty, 0))::float as copies
	    from r left join book_titles b on b.org_id = r.org_id and b.code = r.code where ${offered} group by 1 order by copies desc`, [orgId]);
	const perBook = `${base}, t as (
	  select r.code, max(coalesce(nullif(b.name, ''), r.name)) as name, max(coalesce(b.hindi_title, b.native_title)) as hindi,
	         sum(r.out_qty)::float as outward, sum(greatest(r.closing_qty, 0))::float as closing, bool_or(b.best_seller) as best
	    from r left join book_titles b on b.org_id = r.org_id and b.code = r.code where ${offered} group by r.code)`;
	const topOut = await q<any>(`${perBook} select * from t where outward > 0 order by outward desc limit 15`, [orgId]);
	// moving books that would last less than one more period at the same pace
	const runningOut = await q<any>(`${perBook} select *, round((closing / nullif(outward, 0))::numeric, 2)::float as cover from t where outward > 0 and closing < outward order by outward desc limit 20`, [orgId]);
	const missing = scope === 'hq'
		? await one<any>(`${base}
		  select count(*)::int as n, count(*) filter (where b.best_seller)::int as best from book_titles b
		   where b.org_id = $1 and b.in_suchi and not exists (select 1 from r where r.code = b.code and r.godown_kind in ('main', 'retail') and r.closing_qty > 0)`, [orgId])
		: null;
	const missingBest = scope === 'hq'
		? await q<any>(`${base}
		  select b.code, coalesce(b.suchi_title, b.name) as name, coalesce(b.hindi_title, b.native_title) as hindi, b.suchi_price::float as price,
		         (select sum(greatest(r.closing_qty, 0))::float from r where r.code = b.code and r.godown_kind = 'semi') as semi
		    from book_titles b where b.org_id = $1 and b.in_suchi and b.best_seller
		     and not exists (select 1 from r where r.code = b.code and r.godown_kind in ('main', 'retail') and r.closing_qty > 0)
		   order by case when b.code ~ '^\\d+$' then lpad(b.code, 12, '0') else b.code end limit 40`, [orgId])
		: [];
	const notInSuchi = await one<any>(`${base}
	  select count(distinct r.code)::int as n from r left join book_titles b on b.org_id = r.org_id and b.code = r.code where (b.code is null or not b.in_suchi) and r.closing_qty > 0`, [orgId]);
	const byState = scope === 'branch'
		? await q<any>(`${base} select ${locState('r.location')} as k, sum(greatest(r.closing_qty, 0))::float as n, count(distinct r.location)::int as locations from r group by 1`, [orgId])
		: [];
	return { scope, kpis: { ...k, notInSuchi: notInSuchi?.n || 0, missing: missing?.n ?? null, missingBest: missing?.best ?? null }, byLocation, byKind, byLanguage, bySize, topOut, runningOut, missingBest, byState };
}

// ── book orders ─────────────────────────────────────────────────────────────
export async function ordersInsight(orgId: number, days: number | null) {
	const W = `o.org_id = $1${days ? ` and o.ordered_at >= (select max(ordered_at) from orders where org_id = $1) - interval '${Math.round(days)} days'` : ''}`;
	const k = await one<any>(
		`select count(*)::int as orders, coalesce(sum(o.total), 0)::float as amount, coalesce(avg(o.total), 0)::float as avg, coalesce(sum(o.postage), 0)::float as postage,
		        count(distinct coalesce(o.phone10, o.email, o.order_key))::int as buyers,
		        count(*) filter (where o.tracking_id is not null and o.tracking_id <> '')::int as with_tracking,
		        count(*) filter (where o.tracking_id is not null and o.tracking_id <> '' and not o.tracking_ok)::int as damaged_tracking,
		        count(*) filter (where pin_state(o.ship_pin) is null)::int as no_state,
		        min(o.ordered_at)::text as first, max(o.ordered_at)::text as last
		   from orders o where ${W}`, [orgId]);
	const span = k?.first ? (new Date(k.last).getTime() - new Date(k.first).getTime()) / 86400_000 : 0;
	const unit = span <= 100 ? 'day' : span <= 800 ? 'week' : 'month';
	const timeline = await q<any>(`select to_char(date_trunc('${unit}', o.ordered_at), 'YYYY-MM-DD') as k, count(*)::int as n, coalesce(sum(o.total), 0)::float as amount from orders o where ${W} group by 1 order by 1`, [orgId]);
	const group = (expr: string, limit = 12) => q<any>(`select coalesce(nullif(${expr}::text, ''), 'Not stated') as k, count(*)::int as n, coalesce(sum(o.total), 0)::float as amount from orders o where ${W} group by 1 order by 2 desc limit ${limit}`, [orgId]);
	const [byStatus, byPartner, byPayment, bySite, byCity] = await Promise.all([group('o.status_label'), group('o.partner'), group('o.payment_method'), group('o.site'), group('initcap(lower(o.ship_city))', 15)]);
	const byState = await q<any>(`select pin_state(o.ship_pin) as k, count(*)::int as n, coalesce(sum(o.total), 0)::float as amount from orders o where ${W} and pin_state(o.ship_pin) is not null group by 1 order by 2 desc`, [orgId]);
	const bands = await q<any>(
		`select b.k, count(o.*)::int as n from (values (1, 'Up to ₹500', 0, 500), (2, '₹501–1,000', 500, 1000), (3, '₹1,001–2,000', 1000, 2000), (4, '₹2,001–5,000', 2000, 5000), (5, 'Above ₹5,000', 5000, 1e12)) as b(i, k, lo, hi)
		   left join orders o on ${W} and o.total > b.lo and o.total <= b.hi group by b.i, b.k order by b.i`, [orgId]);
	const weekday = await q<any>(`select extract(isodow from o.ordered_at)::int as d, count(*)::int as n from orders o where ${W} group by 1 order by 1`, [orgId]);
	const repeat = await one<any>(
		`select count(*) filter (where n = 1)::int as once, count(*) filter (where n = 2)::int as twice, count(*) filter (where n > 2)::int as more
		   from (select count(*) as n from orders o where ${W} group by coalesce(o.phone10, o.email, o.order_key)) x`, [orgId]);
	// orders that are not delivered yet, by how long ago they were placed
	const open = await q<any>(
		`select b.k, count(o.*)::int as n from (values (1, 'Up to 7 days', -1, 7), (2, '8–15 days', 7, 15), (3, '16–30 days', 15, 30), (4, 'Over 30 days', 30, 100000)) as b(i, k, lo, hi)
		   left join orders o on ${W} and coalesce(o.status_label, '') !~* 'deliver|cancel|return' and (current_date - o.ordered_at::date) > b.lo and (current_date - o.ordered_at::date) <= b.hi
		  group by b.i, b.k order by b.i`, [orgId]);
	return { kpis: k, unit, timeline, byStatus, byPartner, byPayment, bySite, byCity, byState, bands, weekday, repeat, open };
}

// ── Kalyan dispatches ───────────────────────────────────────────────────────
export async function dispatchInsight(orgId: number) {
	const kP = one<any>(
		`select count(*)::int as dispatches, count(distinct d.custno)::int as customers, count(*) filter (where d.mode = 'REGISTERED')::int as registered,
		        count(*) filter (where d.mode = 'REGISTERED' and (d.barcode is null or d.barcode = ''))::int as registered_no_barcode,
		        min(d.dispdate)::text as first, max(d.dispdate)::text as last
		   from kalyan_dispatches d where d.org_id = $1`, [orgId]);
	// issues: the issue number with the year it was sent in
	const issuesP = q<any>(
		`select to_char(d.dispdate, 'YYYY') || '-' || lpad(d.to_issue::text, 2, '0') as k, d.to_issue as issue, min(d.dispdate)::text as first, max(d.dispdate)::text as last, mode() within group (order by to_char(d.dispdate, 'YYYY-MM')) as month,
		        count(*)::int as n, count(*) filter (where d.mode = 'REGISTERED')::int as registered, count(*) filter (where d.mode <> 'REGISTERED')::int as ordinary, count(distinct d.custno)::int as customers
		   from kalyan_dispatches d where d.org_id = $1 group by 1, 2 order by 1`, [orgId]);
	const dailyP = q<any>(
		`select d.dispdate::text as k, count(*)::int as n, count(*) filter (where d.mode = 'REGISTERED')::int as registered
		   from kalyan_dispatches d where d.org_id = $1 and d.dispdate >= (select max(dispdate) from kalyan_dispatches where org_id = $1) - 75 group by 1 order by 1`, [orgId]);
	const bySubP = q<any>(
		`select coalesce(nullif(d.subperiod, ''), '?') as k, count(*)::int as n, count(*) filter (where d.mode = 'REGISTERED')::int as registered, count(distinct d.custno)::int as customers
		   from kalyan_dispatches d where d.org_id = $1 group by 1 order by 2 desc`, [orgId]);
	const byStateP = q<any>(
		`select coalesce(s.state_norm, nullif(s.state, '')) as k, count(distinct d.custno)::int as n, count(*)::int as dispatches,
		        round(100.0 * count(*) filter (where d.mode = 'REGISTERED') / nullif(count(*), 0), 1)::float as registered_pct
		   from kalyan_dispatches d left join kalyan_subscribers s on s.org_id = d.org_id and s.custno = d.custno where d.org_id = $1 group by 1 order by 2 desc`, [orgId]);
	const byCityP = q<any>(
		`select initcap(lower(s.city)) as k, count(distinct d.custno)::int as n from kalyan_dispatches d join kalyan_subscribers s on s.org_id = d.org_id and s.custno = d.custno
		  where d.org_id = $1 and s.city <> '' group by 1 order by 2 desc limit 15`, [orgId]);
	const [k, issues, daily, bySub, byState, byCity] = await Promise.all([kP, issuesP, dailyP, bySubP, byStateP, byCityP]);
	// readers in the previous issue who have no dispatch in the latest one
	const last2 = issues.slice(-2);
	let missed = null as null | { latest: string; previous: string; n: number };
	if (last2.length === 2) {
		const key = `to_char(d.dispdate, 'YYYY') || '-' || lpad(d.to_issue::text, 2, '0')`;
		const m = await one<any>(
			`select count(distinct d.custno)::int as n from kalyan_dispatches d where d.org_id = $1 and ${key} = $2
			    and not exists (select 1 from kalyan_dispatches e where e.org_id = d.org_id and e.custno = d.custno and to_char(e.dispdate, 'YYYY') || '-' || lpad(e.to_issue::text, 2, '0') = $3)`,
			[orgId, last2[0].k, last2[1].k]);
		missed = { previous: last2[0].k, latest: last2[1].k, n: m?.n || 0 };
	}
	return { kpis: k, issues, daily, bySub, byState, byCity, missed };
}

// ── book list (Suchi) and links ─────────────────────────────────────────────
export async function suchiInsight(orgId: number) {
	const hq = `with lu as (${latestStock('hq')}),
	  s as (select r.code, sum(greatest(r.closing_qty, 0)) filter (where r.godown_kind in ('main', 'retail')) as qty, sum(greatest(r.closing_qty, 0)) filter (where r.godown_kind = 'semi') as semi
	          from stock_rows r join lu on lu.id = r.upload_id and lu.loc = r.location where r.org_id = $1 group by 1),
	  b as (select b.*, coalesce(s.qty, 0) as qty, coalesce(s.semi, 0) as semi, s.code is not null as stocked from book_titles b left join s on s.code = b.code where b.org_id = $1 and b.in_suchi)`;
	const k = await one<any>(`${hq}
	  select count(*)::int as titles, count(distinct set_code) filter (where set_code is not null)::int as sets, count(*) filter (where best_seller)::int as best,
	         count(*) filter (where suchi_price is null)::int as no_price, coalesce(avg(suchi_price), 0)::float as avg_price,
	         coalesce(percentile_cont(0.5) within group (order by suchi_price), 0)::float as median_price,
	         count(*) filter (where gitapress_url is not null or amazon_url is not null)::int as with_link,
	         count(*) filter (where qty > 0)::int as in_stock, count(*) filter (where qty <= 0)::int as out_of_stock,
	         count(*) filter (where qty <= 0 and best_seller)::int as best_out, count(*) filter (where qty <= 0 and semi > 0)::int as in_making,
	         count(*) filter (where coalesce(hindi_title, native_title) is null)::int as no_hindi, count(*) filter (where edited_fields <> '{}')::int as edited,
	         (select count(*)::int from book_titles x where x.org_id = $1 and x.in_links and not x.in_suchi) as only_links
	    from b`, [orgId]);
	const bySize = await q<any>(`${hq} select coalesce(size_en, 'Not stated') as k, count(*)::int as n, count(*) filter (where qty > 0)::int as in_stock, coalesce(avg(suchi_price), 0)::float as avg_price from b group by 1 order by 2 desc`, [orgId]);
	const byLanguage = await q<any>(`${hq} select coalesce(nullif(language, ''), 'Not stated') as k, count(*)::int as n, count(*) filter (where qty > 0)::int as in_stock from b group by 1 order by 2 desc limit 12`, [orgId]);
	const priceBands = await q<any>(`${hq}
	  select x.k, count(b.*)::int as n from (values (1, 'Up to ₹10', -1, 10), (2, '₹11–30', 10, 30), (3, '₹31–60', 30, 60), (4, '₹61–100', 60, 100), (5, '₹101–200', 100, 200), (6, '₹201–500', 200, 500), (7, 'Above ₹500', 500, 1e9)) as x(i, k, lo, hi)
	    left join b on b.suchi_price > x.lo and b.suchi_price <= x.hi group by x.i, x.k order by x.i`, [orgId]);
	const pageBands = await q<any>(`${hq}
	  select x.k, count(b.*)::int as n from (values (1, 'Up to 32', -1, 32), (2, '33–96', 32, 96), (3, '97–200', 96, 200), (4, '201–500', 200, 500), (5, 'Over 500', 500, 1e9)) as x(i, k, lo, hi)
	    left join b on b.pages > x.lo and b.pages <= x.hi group by x.i, x.k order by x.i`, [orgId]);
	const sets = await q<any>(`${hq} select set_code as k, count(*)::int as n, coalesce(sum(suchi_price), 0)::float as value from b where set_code is not null group by 1 order by 2 desc limit 15`, [orgId]);
	const bestOut = await q<any>(`${hq} select code, coalesce(suchi_title, name) as name, coalesce(hindi_title, native_title) as hindi, suchi_price::float as price, semi::float as semi from b where best_seller and qty <= 0
	  order by case when code ~ '^\\d+$' then lpad(code, 12, '0') else code end limit 30`, [orgId]);
	return { kpis: k, bySize, byLanguage, priceBands, pageBands, sets, bestOut };
}

export async function linksInsight(orgId: number) {
	const k = await one<any>(
		`select count(*)::int as titles, count(*) filter (where gitapress_url is not null)::int as gitapress, count(*) filter (where amazon_url is not null)::int as amazon,
		        count(*) filter (where gitapress_url is not null and amazon_url is not null)::int as both, count(*) filter (where gitapress_url is null and amazon_url is null)::int as none,
		        count(*) filter (where in_suchi)::int as in_suchi, count(*) filter (where hindi_title is not null)::int as hindi,
		        (select count(*)::int from book_titles x where x.org_id = $1 and x.in_suchi and not x.in_links) as suchi_only,
		        (select count(*)::int from book_titles x where x.org_id = $1 and x.in_suchi and x.gitapress_url is null and x.amazon_url is null) as suchi_no_link
		   from book_titles where org_id = $1 and in_links`, [orgId]);
	const byLanguage = await q<any>(
		`select coalesce(nullif(language, ''), 'Not stated') as k, count(*)::int as n, count(*) filter (where gitapress_url is not null)::int as gitapress, count(*) filter (where amazon_url is not null)::int as amazon
		   from book_titles where org_id = $1 and in_links group by 1 order by 2 desc limit 12`, [orgId]);
	const bestNoLink = await q<any>(
		`select code, coalesce(suchi_title, name) as name, coalesce(hindi_title, native_title) as hindi, suchi_price::float as price from book_titles
		  where org_id = $1 and in_suchi and best_seller and gitapress_url is null and amazon_url is null order by case when code ~ '^\\d+$' then lpad(code, 12, '0') else code end limit 30`, [orgId]);
	return { kpis: k, byLanguage, bestNoLink };
}
