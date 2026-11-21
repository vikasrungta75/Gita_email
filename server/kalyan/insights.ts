/**
 * Customer database dashboards, for All customers (the master file) and Current year customers (the yearly
 * payment files). Headline figures with the change on the year before, the yearly flow (new, renewed, lost,
 * came back), retention, subscription mix, payments by month, tenure, and the geographic spread: states (for the
 * India map, with every year), cities, PIN areas and other countries.
 *
 * Definitions, for a year Y in the current-year files:
 *   active    paid in Y
 *   new       paid in Y and in no earlier year
 *   renewed   paid in Y and in Y-1
 *   came back paid in Y, not in Y-1, but in an earlier year
 *   lost      paid in Y-1, not in Y
 *   retention renewed in Y / active in Y-1
 */
import { q, one } from '../db';

const STATE = `coalesce(k.state_norm, nullif(k.state, ''), nullif(y.state, ''))`;
const INDIA = `(coalesce(nullif(upper(k.country), ''), 'INDIA') in ('INDIA', 'IN', 'BHARAT') or k.pin ~ '^[1-9][0-9]{5}$')`;

/** The yearly flow for every year in the current-year files. */
async function yearFlow(orgId: number) {
	// one pass with window functions: each customer-year knows the customer's first year, previous and next year
	return q<any>(
		`with w as (select year, min(year) over c as first, lag(year) over c as prev, lead(year) over c as nxt
		              from kalyan_customer_years where org_id = $1 window c as (partition by custno order by year)),
		      a as (select year, count(*)::int as active, count(*) filter (where first = year)::int as new, count(*) filter (where prev = year - 1)::int as renewed,
		                   count(*) filter (where prev < year - 1)::int as came_back from w group by year),
		      l as (select year + 1 as year, count(*) filter (where nxt is distinct from year + 1)::int as lost from w group by year)
		 select a.*, coalesce(l.lost, 0) as lost from a left join l using (year) order by a.year`, [orgId]);
}

export async function customerInsight(orgId: number, scope: 'all' | 'current', year: number) {
	const yearsP = yearFlow(orgId);
	const allP = one<any>(
		`select count(*)::int as total, count(*) filter (where k.dead)::int as inactive, count(*) filter (where not k.dead)::int as live,
		        count(*) filter (where k.sub_type = 'LM')::int as life, count(*) filter (where k.sub_type = 'FY')::int as five, count(*) filter (where k.sub_type = '1Y')::int as one,
		        count(*) filter (where extract(year from k.regdate) = $2)::int as registered, count(*) filter (where extract(year from k.regdate) = $2 - 1)::int as registered_prev,
		        count(*) filter (where k.source = 'current')::int as from_current,
		        count(*) filter (where not ${INDIA})::int as abroad,
		        count(distinct coalesce(k.state_norm, nullif(k.state, '')))::int as states,
		        coalesce(sum(k.bal_amt) filter (where k.bal_amt > 0), 0)::float as dues, count(*) filter (where k.bal_amt > 0)::int as with_dues,
		        count(*) filter (where k.regdate is not null)::int as with_regdate,
		        coalesce(avg(extract(year from age(current_date, k.regdate))) filter (where k.regdate is not null), 0)::float as avg_years
		   from kalyan_customers k where k.org_id = $1`, [orgId, year]);
	const curExtraP = one<any>(
		`select count(*) filter (where y.paid_on is not null)::int as with_date, count(*) filter (where k.custno is null)::int as not_in_master,
		        count(distinct ${STATE})::int as states, max(y.paid_on)::text as last_payment,
		        count(*) filter (where y.paid_on >= date_trunc('month', (select max(paid_on) from kalyan_customer_years where org_id = $1 and year = $2)))::int as last_month
		   from kalyan_customer_years y left join kalyan_customers k on k.org_id = y.org_id and k.custno = y.custno where y.org_id = $1 and y.year = $2`, [orgId, year]);

	// subscription mix: all customers by type; current year by type for every year
	const subAllP = q<any>(`select coalesce(nullif(sub_type, ''), '?') as k, count(*)::int as n, count(*) filter (where dead)::int as inactive from kalyan_customers where org_id = $1 group by 1 order by 2 desc`, [orgId]);
	const subYearsP = q<any>(`select year, coalesce(nullif(sub_type, ''), '?') as k, count(*)::int as n from kalyan_customer_years where org_id = $1 group by 1, 2 order by 1, 3 desc`, [orgId]);
	// payments by month: this year and the year before, month by month
	const paymentsP = q<any>(
		`select year, extract(month from paid_on)::int as m, count(*)::int as n from kalyan_customer_years where org_id = $1 and year in ($2, $2 - 1) and paid_on is not null group by 1, 2 order by 1, 2`, [orgId, year]);
	const registeredP = q<any>(`select extract(year from regdate)::int as year, count(*)::int as n, count(*) filter (where dead)::int as inactive from kalyan_customers where org_id = $1 and regdate is not null group by 1 order by 1`, [orgId]);
	const byModeP = q<any>(`select coalesce(nullif(initcap(lower(disp_mode)), ''), 'Not stated') as k, count(*)::int as n from kalyan_customers where org_id = $1 ${scope === 'current' ? `and exists (select 1 from kalyan_customer_years y where y.org_id = $1 and y.custno = kalyan_customers.custno and y.year = ${Number(year)})` : ''} group by 1 order by 2 desc`, [orgId]);
	const tenureP = q<any>(
		`select x.k, count(c.*)::int as n from (values (1, 'Under 1 year', 0, 1), (2, '1–2 years', 1, 3), (3, '3–5 years', 3, 6), (4, '6–10 years', 6, 11), (5, '11–20 years', 11, 21), (6, 'Over 20 years', 21, 999)) as x(i, k, lo, hi)
		   left join (select extract(year from age(current_date, regdate)) as t from kalyan_customers where org_id = $1 and regdate is not null and not dead) c on c.t >= x.lo and c.t < x.hi
		  group by x.i, x.k order by x.i`, [orgId]);
	const inactiveReasonsP = q<any>(`select coalesce(nullif(dead_reason, ''), 'Not stated') as k, count(*)::int as n from kalyan_customers where org_id = $1 and dead group by 1 order by 2 desc limit 8`, [orgId]);
	const [years, all, curExtra, subAll, subYears, payments, registered, byMode, tenure, inactiveReasons] = await Promise.all([yearsP, allP, curExtraP, subAllP, subYearsP, paymentsP, registeredP, byModeP, tenureP, inactiveReasonsP]);
	for (const y of years) {
		const prev = years.find((p) => p.year === y.year - 1);
		y.retention = prev?.active ? Math.round((1000 * y.renewed) / prev.active) / 10 : null;
		y.growth = prev?.active ? Math.round((1000 * (y.active - prev.active)) / prev.active) / 10 : null;
	}
	const cur = years.find((y) => y.year === year) || { year, active: 0, new: 0, renewed: 0, came_back: 0, lost: 0, retention: null, growth: null };
	const prev = years.find((y) => y.year === year - 1) || null;

	return { scope, year, years, current: cur, previous: prev, all, currentExtra: curExtra, subAll, subYears, payments, registered, byMode, tenure, inactiveReasons };
}

/**
 * Where customers are, for the map and the tables. For each state: all customers, inactive, registered per year,
 * and (from the current-year files) active, new and lost per year.
 */
export async function customerGeo(orgId: number, scope: 'all' | 'current', year: number, state?: string | null) {
	const base = await q<any>(
		`select coalesce(k.state_norm, nullif(k.state, ''), 'Not known') as k, count(*)::int as total, count(*) filter (where k.dead)::int as inactive, count(*) filter (where k.sub_type = 'LM')::int as life
		   from kalyan_customers k where k.org_id = $1 group by 1`, [orgId]);
	const reg = await q<any>(
		`select coalesce(k.state_norm, nullif(k.state, ''), 'Not known') as k, extract(year from k.regdate)::int as y, count(*)::int as n
		   from kalyan_customers k where k.org_id = $1 and k.regdate is not null group by 1, 2`, [orgId]);
	const flowRows = await q<any>(
		`with y as (select y.custno, y.year, ${STATE} as st from kalyan_customer_years y left join kalyan_customers k on k.org_id = y.org_id and k.custno = y.custno where y.org_id = $1),
		      w as (select st, year, min(year) over c as first, lag(year) over c as prev, lead(year) over c as nxt from y window c as (partition by custno order by year)),
		      top as (select max(year) as m from y)
		 select coalesce(st, 'Not known') as k, year as y, count(*)::int as active, count(*) filter (where first = year)::int as new, count(*) filter (where prev = year - 1)::int as renewed,
		        count(*) filter (where year < (select m from top) and nxt is distinct from year + 1)::int as lost_next
		   from w group by 1, 2`, [orgId]);
	const flow = flowRows;
	const lost = flowRows.filter((r) => r.lost_next).map((r) => ({ k: r.k, y: r.y + 1, n: r.lost_next }));
	const map = new Map<string, any>();
	const get = (k: string) => { if (!map.has(k)) map.set(k, { k, total: 0, inactive: 0, life: 0, registered: {}, active: {}, new: {}, renewed: {}, lost: {} }); return map.get(k); };
	for (const s of base) Object.assign(get(s.k), { total: s.total, inactive: s.inactive, life: s.life });
	for (const r of reg) get(r.k).registered[r.y] = r.n;
	for (const r of flow) { const s = get(r.k); s.active[r.y] = r.active; s.new[r.y] = r.new; s.renewed[r.y] = r.renewed; }
	for (const r of lost) get(r.k).lost[r.y] = r.n;

	// cities, PIN areas and countries, for the chosen scope (and state when one is picked on the map)
	const inScope = scope === 'current'
		? `exists (select 1 from kalyan_customer_years y where y.org_id = k.org_id and y.custno = k.custno and y.year = ${Number(year)})`
		: 'true';
	const params: unknown[] = [orgId];
	const st = state ? (params.push(state), `and coalesce(k.state_norm, nullif(k.state, ''), 'Not known') = $${params.length}`) : '';
	const cities = await q<any>(
		`select initcap(lower(trim(k.city))) as k, mode() within group (order by coalesce(k.state_norm, nullif(k.state, ''))) as state, count(*)::int as n from kalyan_customers k
		  where k.org_id = $1 and ${inScope} and trim(k.city) <> '' ${st} group by 1 order by 3 desc limit 25`, params);
	const pins = await q<any>(
		`select substr(k.pin, 1, 3) as k, mode() within group (order by initcap(lower(trim(k.city)))) as city, mode() within group (order by coalesce(k.state_norm, nullif(k.state, ''))) as state, count(*)::int as n
		   from kalyan_customers k where k.org_id = $1 and ${inScope} and k.pin ~ '^[1-9][0-9]{5}$' ${st} group by 1 order by 4 desc limit 25`, params);
	const countries = await q<any>(
		`select initcap(lower(coalesce(nullif(trim(k.country), ''), 'Not stated'))) as k, count(*)::int as n from kalyan_customers k
		  where k.org_id = $1 and ${inScope} and not ${INDIA} group by 1 order by 2 desc limit 20`, [orgId]);
	const years = [...new Set([...flow.map((r) => r.y), ...reg.map((r) => r.y)])].filter((y) => y).sort();
	return { scope, year, years, states: [...map.values()], cities, pins, countries, state: state || null };
}
