/**
 * Kalyan customers: uploaded only, never created from emails, orders or tracking.
 *
 *  - Master file ("Kalyan complete customer", 63 columns): every Kalyan customer ever. Only the useful fields are
 *    kept (Settings → Kalyan master fields); the original file stays in the upload history.
 *  - Current-year file ("Kalyan current customer"): Duration, No, Name, Address, Location, State, Country,
 *    Post code, then two unlabelled columns: receipt number and payment date (dd/mm/yyyy). State and Location are
 *    cut to 10 characters in the export ("UTTAR PRAD"): the state comes from the PIN code, else from the prefix.
 *
 * Both are additive: an upload adds and updates by customer number and never deletes. A current-year upload also
 * adds every net new customer to the master database.
 */
import { one, q, tx } from '../db';
import { HttpError } from '../http';
import { clean, dateOnly, getMappings, headKey, pin6, stateName, subType } from '../uploads/common';
import { emailConfig, kalyanYearOf } from './year';

export const KIND_LABEL: Record<string, string> = { kalyan_master: 'Kalyan customers (all)', kalyan_current: 'Kalyan customers (current year)' };

/** The customer-number column under any of its names. */
export const CUSTNO_KEYS = ['custno', 'no', 'custono', 'customerno', 'customernumber'];
export function custnoIndex(header: string[]): number {
	const keys = header.map(headKey);
	for (const k of CUSTNO_KEYS) { const i = keys.indexOf(k); if (i >= 0) return i; }
	return -1;
}

const STATES = ['Andaman and Nicobar', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat',
	'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
	'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Nepal'];
/** "UTTAR PRAD" → Uttar Pradesh, "WEST BENGA" → West Bengal (the current-year export cuts names to 10 letters). */
export function stateByPrefix(v: string): string | null {
	const k = clean(v, 60).toUpperCase().replace(/[^A-Z]/g, '');
	if (k.length < 3) return null;
	const hits = STATES.filter((s) => s.toUpperCase().replace(/[^A-Z]/g, '').startsWith(k));
	return hits.length === 1 ? hits[0] : null;
}

/** Checks the headings before anything is stored, and names the two unlabelled columns of the current-year file. */
export function checkHeader(kind: string, header: string[]): string[] {
	const h = header.map((x) => clean(x, 80));
	if (custnoIndex(h) < 0) throw new HttpError(400, `The customer number column was not found. It should be called CustNo, No or custono. The first row of this file is: ${h.filter(Boolean).slice(0, 12).join(', ')}`);
	const keys = h.map(headKey);
	if (kind === 'kalyan_current') {
		if (keys.includes('bookid') && keys.includes('firstname')) throw new HttpError(400, 'This looks like the complete (master) customer file. Please upload it in the "All customers" slot.');
		// the two columns after "Post code" have no heading: receipt number and payment date
		const pc = keys.findIndex((k) => k === 'postcode' || k === 'pin' || k === 'pincode');
		const base = pc >= 0 ? pc : 7;
		if (!h[base + 1]) h[base + 1] = 'Receipt no';
		if (!h[base + 2]) h[base + 2] = 'Payment date';
	} else if (kind === 'kalyan_master') {
		if (keys.includes('duration') && !keys.includes('firstname')) throw new HttpError(400, 'This looks like the current-year customer file. Please upload it in the "Current year" slot.');
	}
	return h;
}

const num = (v: unknown) => { const s = clean(v, 30).replace(/[,₹\s]/g, ''); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const int = (v: unknown) => { const n = num(v); return n === null ? null : Math.round(n); };
const yes = (v: unknown) => /^(y|yes|true|1|dead)$/i.test(clean(v, 10));

/** One master row → the kept fields. */
export function masterRow(m: any, row: Record<string, unknown>, keep: string[]) {
	const g = (k: string) => { const hk = headKey(k); for (const [kk, v] of Object.entries(row)) if (headKey(kk) === hk) return v; return undefined; };
	const name = [g('title'), g('firstname'), g('midname'), g('lastname')].map((x) => clean(x, 60)).filter((x) => x && x !== ',').join(' ').replace(/\s+,/g, ',').replace(/,$/, '');
	const pin = pin6(g('pin'));
	const altKeys = ['LTITLE', 'LFIRSTNAME', 'LMIDNAME', 'LLASTNAME', 'LADD1', 'LADD2', 'LADD3', 'LCITY', 'LPIN', 'LSTATE', 'LCOUNTRY'];
	const alt = Object.fromEntries(altKeys.map((k) => [k, clean(g(k), 120)]).filter(([, v]) => v));
	const explicit = new Set(['custno', 'bookid', 'subperiod', 'custtype', 'title', 'firstname', 'midname', 'lastname', 'add1', 'add2', 'add3', 'city', 'pin', 'state', 'country', 'regdate', 'yearstart', 'yearend',
		'dispmode', 'forcedispmode', 'vppstatus', 'vppst', 'nextyrnovpp', 'deadcustomer', 'dead', 'deadreason', 'mailstatus', 'rejreason', 'oldcustno', 'nqty', 'hqty', 'balamt', 'curyearbal', 'lastyearbal',
		'maxissueno', 'subbranch', 'postalcenter', ...altKeys.map((k) => k.toLowerCase())]);
	const extra = Object.fromEntries(keep.filter((k) => !explicit.has(headKey(k))).map((k) => [k, clean(g(k), 200)]).filter(([, v]) => v));
	const reg = dateOnly(clean(g('regdate'), 30).slice(0, 10));
	return {
		book_id: clean(g('bookid'), 10) || null, sub_type: subType(g('subperiod')), cust_type: clean(g('custtype'), 10) || null, name,
		title: clean(g('title'), 20) || null, first_name: clean(g('firstname'), 80) || null, mid_name: clean(g('midname'), 80) || null, last_name: clean(g('lastname'), 120) || null,
		add1: clean(g('add1'), 200) || null, add2: clean(g('add2'), 200) || null, add3: clean(g('add3'), 200) || null,
		address: [g('add1'), g('add2'), g('add3')].map((x) => clean(x, 200)).filter(Boolean).join(', '),
		city: clean(g('city'), 80), pin, state: clean(g('state'), 80), state_norm: stateName(m, g('state'), pin) || stateByPrefix(clean(g('state'))), country: clean(g('country'), 60),
		regdate: reg, year_start: clean(g('yearstart'), 10) || null, year_end: clean(g('yearend'), 10) || null,
		disp_mode: clean(g('dispmode'), 30).toUpperCase() || null, force_mode: clean(g('forcedispmode'), 10) || null,
		vpp_status: clean(g('vppstatus'), 20) || null, vppst: clean(g('vppst'), 20) || null, next_yr_novpp: clean(g('nextyrnovpp'), 10) || null,
		dead: yes(g('deadcustomer')) || yes(g('dead')), dead_reason: clean(g('deadreason'), 120) || null, mail_status: clean(g('mailstatus'), 40) || null,
		rej_reason: clean(g('rejreason'), 40) || null, old_custno: clean(g('oldcustno'), 30) || null, nqty: int(g('nqty')), hqty: int(g('hqty')),
		bal_amt: num(g('balamt')), cur_year_bal: num(g('curyearbal')), last_year_bal: num(g('lastyearbal')), max_issue: clean(g('maxissueno'), 20) || null,
		subbranch: clean(g('subbranch'), 40) || null, postal_centre: clean(g('postalcenter'), 40) || null, alt_address: Object.keys(alt).length ? alt : null, extra,
	};
}

/** One current-year row → the year record. */
export function currentRow(m: any, row: Record<string, unknown>) {
	const g = (...ks: string[]) => { for (const k of ks) { const hk = headKey(k); for (const [kk, v] of Object.entries(row)) if (headKey(kk) === hk) return v; } return undefined; };
	const pin = pin6(g('Post code', 'pin', 'pincode'));
	const stateRaw = clean(g('State'), 60);
	return {
		sub_type: subType(g('Duration', 'subperiod')), name: clean(g('Name'), 200), address: clean(g('Address'), 400), city: clean(g('Location', 'city'), 80),
		state: stateName(m, stateRaw, pin) || stateByPrefix(stateRaw) || stateRaw, pin, country: clean(g('Country'), 60),
		receipt_no: clean(g('Receipt no'), 40).replace(/\.0+$/, '') || null, paid_on: dateOnly(g('Payment date')),
	};
}

/** What the upload will change, shown before anything is applied. */
export async function reviewKalyanCustomers(orgId: number, batch: any) {
	const n = (await one<any>('select count(*)::int n from kalyan_customer_stage where batch_id=$1', [batch.id]))!.n;
	const keyed = await one<any>(
		`select count(distinct s.data->>'_custno')::int as customers,
		        count(distinct s.data->>'_custno') filter (where k.custno is null)::int as new_to_master,
		        count(*) filter (where s.data->>'_custno' = '')::int as no_number
		   from kalyan_customer_stage s left join kalyan_customers k on k.org_id=$2 and k.custno = s.data->>'_custno' where s.batch_id=$1`, [batch.id, orgId]);
	const out: any = { rows: n, customers: keyed.customers, newToMaster: keyed.new_to_master, alreadyKnown: keyed.customers - keyed.new_to_master, rejected: batch.rows_rejected };
	if (batch.kind === 'kalyan_current') {
		const d = await one<any>(`select min((data->>'_paid')::date)::text as first, max((data->>'_paid')::date)::text as last, count(*) filter (where data->>'_paid' is null)::int as no_date from kalyan_customer_stage where batch_id=$1`, [batch.id]);
		const cfg = await emailConfig(orgId);
		const year = Number(batch.options?.year) || (d.last ? kalyanYearOf(cfg, new Date(`${d.last}T00:00:00Z`)) : kalyanYearOf(cfg, new Date()));
		const prevYear = await one<any>('select count(*)::int n from kalyan_customer_years where org_id=$1 and year=$2', [orgId, year]);
		const byType = await q<any>(`select coalesce(nullif(upper(data->>'_sub'),''),'?') k, count(*)::int n from kalyan_customer_stage where batch_id=$1 group by 1 order by 2 desc`, [batch.id]);
		Object.assign(out, { year, payments: { first: d.first, last: d.last, noDate: d.no_date }, alreadyInYear: prevYear?.n || 0, byType });
	}
	const prev = await one<any>(`select rows_total, uploaded_at from upload_batches where org_id=$1 and kind=$2 and status='done' and deleted_at is null and id <> $3 order by id desc limit 1`, [orgId, batch.kind, batch.id]);
	out.previous = prev ? { rows: prev.rows_total, at: prev.uploaded_at } : null;
	return out;
}

/** Applies a reviewed Kalyan customer upload (additive). */
export async function applyKalyanCustomers(orgId: number, batch: any): Promise<{ added: number; updated: number; years?: number; netNewToMaster?: number }> {
	const m = await getMappings(orgId);
	const cfg = await emailConfig(orgId);
	const rows = await q<any>('select data from kalyan_customer_stage where batch_id=$1 order by rowno', [batch.id]);
	const recs = rows.map((r) => r.data).filter((d) => d._custno);
	let added = 0, updated = 0, years = 0, netNew = 0;
	await tx(async (c) => {
		if (batch.kind === 'kalyan_master') {
			const keep: string[] = cfg.kalyanMasterFields;
			const CH = 1000;
			for (let i = 0; i < recs.length; i += CH) {
				const part = recs.slice(i, i + CH).map((d) => ({ custno: d._custno, ...masterRow(m, d, keep) }));
				const res = await c.query(
					`insert into kalyan_customers as k (org_id, custno, book_id, sub_type, cust_type, name, title, first_name, mid_name, last_name, add1, add2, add3, address, city, pin, state, state_norm, country, regdate,
					   year_start, year_end, disp_mode, force_mode, vpp_status, vppst, next_yr_novpp, dead, dead_reason, mail_status, rej_reason, old_custno, nqty, hqty, bal_amt, cur_year_bal, last_year_bal, max_issue,
					   subbranch, postal_centre, alt_address, extra, in_master, first_year, source)
					 select $1, x.custno, x.book_id, x.sub_type, x.cust_type, x.name, x.title, x.first_name, x.mid_name, x.last_name, x.add1, x.add2, x.add3, x.address, x.city, x.pin, x.state, x.state_norm, x.country, x.regdate,
					   x.year_start, x.year_end, x.disp_mode, x.force_mode, x.vpp_status, x.vppst, x.next_yr_novpp, x.dead, x.dead_reason, x.mail_status, x.rej_reason, x.old_custno, x.nqty, x.hqty, x.bal_amt, x.cur_year_bal, x.last_year_bal, x.max_issue,
					   x.subbranch, x.postal_centre, x.alt_address, coalesce(x.extra,'{}'), true, extract(year from x.regdate)::int, 'master'
					   from jsonb_to_recordset($2::jsonb) as x(custno text, book_id text, sub_type text, cust_type text, name text, title text, first_name text, mid_name text, last_name text, add1 text, add2 text, add3 text, address text,
					     city text, pin text, state text, state_norm text, country text, regdate date, year_start text, year_end text, disp_mode text, force_mode text, vpp_status text, vppst text, next_yr_novpp text, dead boolean,
					     dead_reason text, mail_status text, rej_reason text, old_custno text, nqty int, hqty int, bal_amt numeric, cur_year_bal numeric, last_year_bal numeric, max_issue text, subbranch text, postal_centre text, alt_address jsonb, extra jsonb)
					 on conflict (org_id, custno) do update set book_id=excluded.book_id, sub_type=coalesce(nullif(excluded.sub_type,''), k.sub_type), cust_type=excluded.cust_type, name=coalesce(nullif(excluded.name,''), k.name),
					   title=excluded.title, first_name=excluded.first_name, mid_name=excluded.mid_name, last_name=excluded.last_name, add1=excluded.add1, add2=excluded.add2, add3=excluded.add3,
					   address=coalesce(nullif(excluded.address,''), k.address), city=coalesce(nullif(excluded.city,''), k.city), pin=coalesce(nullif(excluded.pin,''), k.pin), state=coalesce(nullif(excluded.state,''), k.state),
					   state_norm=coalesce(excluded.state_norm, k.state_norm), country=coalesce(nullif(excluded.country,''), k.country), regdate=coalesce(excluded.regdate, k.regdate), year_start=excluded.year_start, year_end=excluded.year_end,
					   disp_mode=excluded.disp_mode, force_mode=excluded.force_mode, vpp_status=excluded.vpp_status, vppst=excluded.vppst, next_yr_novpp=excluded.next_yr_novpp, dead=excluded.dead, dead_reason=excluded.dead_reason,
					   mail_status=excluded.mail_status, rej_reason=excluded.rej_reason, old_custno=excluded.old_custno, nqty=excluded.nqty, hqty=excluded.hqty, bal_amt=excluded.bal_amt, cur_year_bal=excluded.cur_year_bal,
					   last_year_bal=excluded.last_year_bal, max_issue=excluded.max_issue, subbranch=excluded.subbranch, postal_centre=excluded.postal_centre, alt_address=excluded.alt_address, extra=k.extra || excluded.extra,
					   in_master=true, first_year=coalesce(k.first_year, excluded.first_year), updated_at=now()
					 returning (xmax = 0) as inserted`,
					[orgId, JSON.stringify(part)],
				);
				for (const r of res.rows) r.inserted ? added++ : updated++;
			}
		} else {
			const review = batch.review || {};
			const year = Number(batch.options?.year) || Number(review.year) || kalyanYearOf(cfg, new Date());
			const CH = 2000;
			for (let i = 0; i < recs.length; i += CH) {
				const part = recs.slice(i, i + CH).map((d) => ({ custno: d._custno, ...currentRow(m, d) }));
				const res = await c.query(
					`insert into kalyan_customer_years as y (org_id, custno, year, sub_type, receipt_no, paid_on, name, address, city, state, pin, country, batch_id)
					 select $1, x.custno, $3, x.sub_type, x.receipt_no, x.paid_on, x.name, x.address, x.city, x.state, x.pin, x.country, $4
					   from jsonb_to_recordset($2::jsonb) as x(custno text, sub_type text, receipt_no text, paid_on date, name text, address text, city text, state text, pin text, country text)
					 on conflict (org_id, custno, year) do update set sub_type=excluded.sub_type, receipt_no=coalesce(excluded.receipt_no, y.receipt_no), paid_on=coalesce(excluded.paid_on, y.paid_on),
					   name=excluded.name, address=excluded.address, city=excluded.city, state=excluded.state, pin=excluded.pin, country=excluded.country, batch_id=excluded.batch_id, updated_at=now()
					 returning (xmax = 0) as inserted`,
					[orgId, JSON.stringify(part), year, batch.id],
				);
				for (const r of res.rows) r.inserted ? added++ : updated++;
				years += res.rows.length;
				// net new customers go into the master database too
				const nn = await c.query(
					`insert into kalyan_customers (org_id, custno, sub_type, name, address, city, pin, state, state_norm, country, in_master, first_year, source)
					 select $1, x.custno, x.sub_type, x.name, x.address, x.city, x.pin, x.state, x.state, x.country, true, $3, 'current'
					   from jsonb_to_recordset($2::jsonb) as x(custno text, sub_type text, name text, address text, city text, pin text, state text, country text)
					 on conflict (org_id, custno) do nothing returning custno`,
					[orgId, JSON.stringify(part), year],
				);
				netNew += nn.rowCount || 0;
			}
			await c.query(`update kalyan_customers k set first_year = least(coalesce(k.first_year, 9999), y.first)
			  from (select custno, min(year) as first from kalyan_customer_years where org_id=$1 group by 1) y where k.org_id=$1 and k.custno=y.custno and (k.first_year is null or k.first_year > y.first)`, [orgId]);
			return;
		}
	});
	await q('delete from kalyan_customer_stage where batch_id=$1', [batch.id]);
	return batch.kind === 'kalyan_current' ? { added, updated, years, netNewToMaster: netNew } : { added, updated };
}

// ── lists and dashboard ─────────────────────────────────────────────────────
const SORTS: Record<string, string> = {
	custno: `case when k.custno ~ '^\\d+$' then lpad(k.custno, 12, '0') else k.custno end`, name: 'lower(k.name)', city: 'lower(k.city)', state: "coalesce(k.state_norm, k.state)", type: 'k.sub_type',
	mode: 'k.disp_mode', regdate: 'k.regdate', first_year: 'k.first_year', last_year: 'ly.year', paid_on: 'ly.paid_on', updated: 'k.updated_at',
};

export interface ListOpts { tab: 'all' | 'current'; qs: URLSearchParams; year: number }

/** Customers with filters; the same filters drive the downloads. */
export async function listKalyanCustomers(orgId: number, o: ListOpts) {
	const qs = o.qs;
	const params: unknown[] = [orgId];
	const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
	const where = ['k.org_id=$1'];
	const yr = Number(qs.get('year')) || o.year;
	if (o.tab === 'current') where.push(`exists (select 1 from kalyan_customer_years y where y.org_id=k.org_id and y.custno=k.custno and y.year=${p(yr)})`);
	const text = (qs.get('q') || '').trim();
	if (text) { const t = p(`%${text}%`); where.push(`(k.custno = ${p(text)} or k.name ilike ${t} or k.address ilike ${t} or k.city ilike ${t} or k.pin = ${p(text)})`); }
	if (qs.get('state')) where.push(`coalesce(k.state_norm, k.state) = ${p(qs.get('state'))}`);
	if (qs.get('type')) where.push(`k.sub_type = ${p(qs.get('type'))}`);
	if (qs.get('mode')) where.push(`k.disp_mode = ${p(qs.get('mode'))}`);
	if (qs.get('dead') === '1') where.push('k.dead'); else if (qs.get('dead') === '0') where.push('not k.dead');
	const seg = qs.get('segment');
	const sy = Number(qs.get('segmentYear')) || yr;
	const inYear = (y: string) => `exists (select 1 from kalyan_customer_years y2 where y2.org_id=k.org_id and y2.custno=k.custno and y2.year=${y})`;
	if (seg === 'new') where.push(`${inYear(p(sy))} and not exists (select 1 from kalyan_customer_years y3 where y3.org_id=k.org_id and y3.custno=k.custno and y3.year < ${p(sy)})`);
	if (seg === 'lost') where.push(`${inYear(p(sy - 1))} and not ${inYear(p(sy))}`);
	if (seg === 'repeat') where.push(`${inYear(p(sy - 1))} and ${inYear(p(sy))}`);
	if (seg === 'registered') where.push(`extract(year from k.regdate) = ${p(sy)}`);
	const dir = qs.get('dir') === 'desc' ? 'desc' : 'asc';
	const sort = `${SORTS[qs.get('sort') || 'custno'] || SORTS.custno} ${dir} nulls last, k.custno`;
	const all = ['xlsx', 'csv'].includes(qs.get('format') || '');
	const limit = all ? 500000 : Math.min(Number(qs.get('limit')) || 100, 500);
	const offset = all ? 0 : Math.max(0, Number(qs.get('offset')) || 0);
	const W = where.join(' and ');
	const rows = await q<any>(
		`select k.custno, k.name, k.sub_type, k.cust_type, k.address, k.city, k.pin, coalesce(k.state_norm, k.state) as state, k.country, k.regdate::text as regdate, k.disp_mode, k.dead, k.dead_reason,
		        k.mail_status, k.year_start, k.year_end, k.first_year, k.source, k.bal_amt::float as bal_amt, ly.year as last_year, ly.receipt_no, ly.paid_on::text as paid_on, k.updated_at
		   from kalyan_customers k
		   left join lateral (select year, receipt_no, paid_on from kalyan_customer_years y where y.org_id=k.org_id and y.custno=k.custno order by year desc limit 1) ly on true
		  where ${W} order by ${sort} limit ${limit} offset ${offset}`, params);
	if (all) return { rows, total: rows.length };
	const total = (await one<any>(`select count(*)::int n from kalyan_customers k where ${W}`, params))!.n;
	return { rows, total, offset, limit };
}

export async function kalyanDashboard(orgId: number, year: number) {
	const totals = await one<any>(
		`select count(*)::int as total, count(*) filter (where dead)::int as inactive, count(*) filter (where source='current')::int as from_current
		   from kalyan_customers where org_id=$1`, [orgId]);
	const years = await q<any>(
		`with y as (select custno, year from kalyan_customer_years where org_id=$1),
		      f as (select custno, min(year) as first from y group by 1)
		 select y.year,
		        count(*)::int as active,
		        count(*) filter (where f.first = y.year)::int as new,
		        count(*) filter (where exists (select 1 from y p where p.custno=y.custno and p.year=y.year-1))::int as repeat,
		        (select count(*) from y p where p.year=y.year-1 and not exists (select 1 from y c where c.custno=p.custno and c.year=y.year))::int as lost
		   from y join f on f.custno=y.custno group by y.year order by y.year`, [orgId]);
	const registered = await q<any>(`select extract(year from regdate)::int as year, count(*)::int as n from kalyan_customers where org_id=$1 and regdate is not null group by 1 order by 1`, [orgId]);
	const byType = await q<any>(`select coalesce(nullif(k.sub_type,''),'?') as k, count(*)::int as n, count(*) filter (where exists (select 1 from kalyan_customer_years y where y.org_id=k.org_id and y.custno=k.custno and y.year=$2))::int as active from kalyan_customers k where k.org_id=$1 group by 1 order by 2 desc`, [orgId, year]);
	const byMode = await q<any>(`select coalesce(nullif(disp_mode,''),'Not stated') as k, count(*)::int as n from kalyan_customers where org_id=$1 group by 1 order by 2 desc`, [orgId]);
	const byState = await q<any>(
		`select coalesce(k.state_norm, nullif(k.state,''), 'Not stated') as k, count(*)::int as n,
		        count(*) filter (where exists (select 1 from kalyan_customer_years y where y.org_id=k.org_id and y.custno=k.custno and y.year=$2))::int as active
		   from kalyan_customers k where k.org_id=$1 group by 1 order by 2 desc limit 40`, [orgId, year]);
	const byCity = await q<any>(`select initcap(lower(city)) as k, count(*)::int as n from kalyan_customer_years where org_id=$1 and year=$2 and city <> '' group by 1 order by 2 desc limit 25`, [orgId, year]);
	const payments = await q<any>(`select to_char(paid_on, 'YYYY-MM') as k, count(*)::int as n from kalyan_customer_years where org_id=$1 and year=$2 and paid_on is not null group by 1 order by 1`, [orgId, year]);
	const cur = years.find((y) => y.year === year) || { active: 0, new: 0, repeat: 0, lost: 0 };
	return { year, totals, current: cur, years, registered, byType, byMode, byState, byCity, payments };
}

export const KALYAN_EXPORT_HEADER = ['Customer no', 'Name', 'Subscription', 'Address', 'City', 'PIN', 'State', 'Country', 'Registered', 'Dispatch mode', 'Inactive', 'Inactive reason', 'Mail status',
	'Year start', 'Year end', 'First year', 'Last active year', 'Receipt no', 'Payment date', 'Source'];
export const kalyanExportRows = (rows: any[]) => rows.map((r) => [r.custno, r.name, r.sub_type, r.address, r.city, r.pin, r.state, r.country, r.regdate || '', r.disp_mode || '', r.dead ? 'Yes' : '',
	r.dead_reason || '', r.mail_status || '', r.year_start || '', r.year_end || '', r.first_year ?? '', r.last_year ?? '', r.receipt_no || '', r.paid_on || '', r.source === 'current' ? 'Current-year file' : 'Master file']);
