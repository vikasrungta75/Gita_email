/**
 * Full-data tables: one definition per dataset (the latest stock, book orders, Kalyan dispatches, the Suchi and the
 * book links). Every dataset gets the same features from one place: search, sort by any column either way,
 * filters on any column (a value list for text, a range for numbers and dates), paging, column facets with counts,
 * and Excel or CSV download of exactly what is filtered.
 *
 * Each base query returns columns named by the column keys and uses $1 for the organisation. Filters and sorting
 * only ever use keys from the definition, never text from the request.
 */
import { q, one } from '../db';
import { HttpError } from '../http';
import { DIRECTORY } from '../directory';

export type ColType = 'text' | 'code' | 'num' | 'money' | 'date' | 'datetime' | 'link' | 'bool';
export interface Col {
	key: string;
	label: string;
	type: ColType;
	/** offer a value list filter (text and code columns) */
	facet?: boolean;
	/** included in the search box */
	search?: boolean;
	/** hidden in the table until chosen, still downloadable */
	hidden?: boolean;
	/** sort text that looks like numbers (book codes) numerically */
	natural?: boolean;
}
export interface Dataset {
	name: string;
	label: string;
	base: string;
	cols: Col[];
	sort: string;
	dir: 'asc' | 'desc';
	/** shown above the table */
	note?: string;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const LOCATION_LABEL = `case %s ${DIRECTORY.map((d) => `when ${lit(d.key)} then ${lit(d.city)}`).join(' ')} else initcap(%s) end`;
const locLabel = (expr: string) => LOCATION_LABEL.replace(/%s/g, expr);
const LOCATION_STATE = `case %s ${DIRECTORY.map((d) => `when ${lit(d.key)} then ${lit(d.state)}`).join(' ')} end`;
export const locState = (expr: string) => LOCATION_STATE.replace(/%s/g, expr);

/** The latest upload for each location of one scope ('hq' or 'branch'). */
export const latestStock = (scope: 'hq' | 'branch') => `select distinct on (l) u.id, l as loc, u.period_to
	from stock_uploads u cross join unnest(u.locations) l where u.org_id=$1 and u.deleted_at is null and u.scope=${lit(scope)}
	order by l, u.period_to desc, u.uploaded_at desc`;

const KIND_LABEL = `case r.godown_kind when 'main' then 'Main stock' when 'retail' then 'Retail stock' when 'semi' then 'Semi-finished' when 'godown' then 'Godown' when 'store' then 'Shop' else r.godown_kind end`;

const stock = (scope: 'hq' | 'branch'): Dataset => ({
	name: scope === 'hq' ? 'stock_hq' : 'stock_branch',
	label: scope === 'hq' ? 'Main, retail and semi-finished stock (Gorakhpur)' : 'Branch stock',
	note: 'The latest upload for each location. Closing is the stock at the end of the period; outwards are the copies that left in the period.',
	base: `with lu as (${latestStock(scope)})
	  select ${locLabel('r.location')} as location, ${locState('r.location')} as state, r.godown, ${KIND_LABEL} as kind, r.code,
	         coalesce(nullif(b.name, ''), r.name) as name, coalesce(b.hindi_title, b.native_title) as hindi, coalesce(nullif(r.language, ''), b.language) as language,
	         b.size_en as size, r.batch, r.price::float as price, r.opening_qty::float as opening, r.in_qty::float as inward, r.out_qty::float as outward,
	         r.closing_qty::float as closing, r.closing_value::float as value, lu.period_to as as_of
	    from stock_rows r join lu on lu.id = r.upload_id and lu.loc = r.location
	    left join book_titles b on b.org_id = r.org_id and b.code = r.code
	   where r.org_id = $1`,
	cols: [
		{ key: 'location', label: 'Location', type: 'text', facet: true, search: true },
		{ key: 'state', label: 'State', type: 'text', facet: true, hidden: scope === 'hq' },
		{ key: 'kind', label: scope === 'hq' ? 'Stock' : 'Godown type', type: 'text', facet: true, hidden: scope === 'branch' },
		{ key: 'godown', label: 'Godown', type: 'text', facet: true, hidden: scope === 'hq' },
		{ key: 'code', label: 'Code', type: 'code', search: true, natural: true },
		{ key: 'name', label: 'Book', type: 'text', search: true },
		{ key: 'hindi', label: 'Hindi title', type: 'text', search: true },
		{ key: 'language', label: 'Language', type: 'text', facet: true },
		{ key: 'size', label: 'Size', type: 'text', facet: true, hidden: true },
		{ key: 'batch', label: 'Batch', type: 'text', hidden: true, search: true },
		{ key: 'price', label: 'Rate', type: 'money' },
		{ key: 'opening', label: 'Opening', type: 'num' },
		{ key: 'inward', label: 'Inwards', type: 'num' },
		{ key: 'outward', label: 'Outwards', type: 'num' },
		{ key: 'closing', label: 'Closing', type: 'num' },
		{ key: 'value', label: 'Closing value', type: 'money' },
		{ key: 'as_of', label: 'As of', type: 'date', facet: true },
	],
	sort: 'code', dir: 'asc',
});

const orders: Dataset = {
	name: 'orders',
	label: 'Book orders',
	note: 'Every order from the uploads, with its latest status and tracking number. State is worked out from the delivery PIN code.',
	base: `select o.order_id, o.ordered_at, o.site, o.customer_name, o.email, o.phone, o.total::float as total, o.subtotal::float as subtotal, o.postage::float as postage,
	         o.payment_method, o.payment_status, o.status_label as status, o.partner, o.tracking_id, o.tracking_ok, o.ship_city as city, o.ship_pin as pin,
	         coalesce(pin_state(o.ship_pin), 'Not known') as state, (current_date - o.ordered_at::date) as age_days, o.updated_at
	    from orders o where o.org_id = $1`,
	cols: [
		{ key: 'order_id', label: 'Order', type: 'code', search: true },
		{ key: 'ordered_at', label: 'Date', type: 'datetime' },
		{ key: 'site', label: 'Site', type: 'text', facet: true },
		{ key: 'customer_name', label: 'Customer', type: 'text', search: true },
		{ key: 'email', label: 'Email', type: 'text', search: true, hidden: true },
		{ key: 'phone', label: 'Phone', type: 'text', search: true, hidden: true },
		{ key: 'total', label: 'Amount', type: 'money' },
		{ key: 'subtotal', label: 'Books', type: 'money', hidden: true },
		{ key: 'postage', label: 'Postage', type: 'money', hidden: true },
		{ key: 'payment_method', label: 'Payment', type: 'text', facet: true },
		{ key: 'payment_status', label: 'Payment status', type: 'text', facet: true, hidden: true },
		{ key: 'status', label: 'Status', type: 'text', facet: true },
		{ key: 'partner', label: 'Delivery partner', type: 'text', facet: true },
		{ key: 'tracking_id', label: 'Tracking', type: 'code', search: true },
		{ key: 'tracking_ok', label: 'Tracking usable', type: 'bool', facet: true, hidden: true },
		{ key: 'city', label: 'City', type: 'text', facet: true, search: true },
		{ key: 'pin', label: 'PIN', type: 'code', search: true },
		{ key: 'state', label: 'State', type: 'text', facet: true },
		{ key: 'age_days', label: 'Days since order', type: 'num' },
	],
	sort: 'ordered_at', dir: 'desc',
};

const kalyanDispatch: Dataset = {
	name: 'kalyan_dispatch',
	label: 'Kalyan tracking',
	note: 'Every Kalyan dispatch from the uploads. Registered post has a barcode that can be tracked on India Post; ordinary post has none.',
	base: `select d.custno, s.name, s.city, coalesce(s.state_norm, nullif(s.state, ''), 'Not known') as state, s.pin, d.subperiod as sub_type,
	         d.dispdate, to_char(d.dispdate, 'YYYY-MM') as month, d.from_issue, d.to_issue, initcap(lower(d.mode)) as mode, d.barcode, s.phone, s.email
	    from kalyan_dispatches d left join kalyan_subscribers s on s.org_id = d.org_id and s.custno = d.custno
	   where d.org_id = $1`,
	cols: [
		{ key: 'custno', label: 'Customer no', type: 'code', search: true, natural: true },
		{ key: 'name', label: 'Name', type: 'text', search: true },
		{ key: 'city', label: 'City', type: 'text', facet: true, search: true },
		{ key: 'state', label: 'State', type: 'text', facet: true },
		{ key: 'pin', label: 'PIN', type: 'code', search: true, hidden: true },
		{ key: 'sub_type', label: 'Subscription', type: 'text', facet: true },
		{ key: 'dispdate', label: 'Dispatched', type: 'date' },
		{ key: 'month', label: 'Month', type: 'text', facet: true, hidden: true },
		{ key: 'from_issue', label: 'From issue', type: 'num' },
		{ key: 'to_issue', label: 'To issue', type: 'num' },
		{ key: 'mode', label: 'Post', type: 'text', facet: true },
		{ key: 'barcode', label: 'Barcode', type: 'code', search: true },
		{ key: 'phone', label: 'Phone', type: 'text', search: true, hidden: true },
		{ key: 'email', label: 'Email', type: 'text', search: true, hidden: true },
	],
	sort: 'dispdate', dir: 'desc',
};

/** Gorakhpur stock offered to readers (main + retail), per code, from the latest upload. */
const HQ_STOCK = `hq as (select r.code, sum(greatest(r.closing_qty, 0))::float as qty from stock_rows r join (${latestStock('hq')}) lu on lu.id = r.upload_id and lu.loc = r.location
	where r.org_id = $1 and r.godown_kind in ('main', 'retail') group by 1)`;

const suchi: Dataset = {
	name: 'suchi',
	label: 'Book list (Suchi)',
	note: 'The titles in the latest Suchi upload, with the Gorakhpur stock (main and retail) and the online links.',
	base: `with ${HQ_STOCK}
	  select b.code, coalesce(b.suchi_title, b.name) as title, coalesce(b.hindi_title, b.native_title) as hindi, b.language, b.set_code, b.size_en as size,
	         b.pages, b.carton, b.binding, b.best_seller,
	         (select string_agg((e->>'language') || ' ' || (select string_agg(x, ', ') from jsonb_array_elements_text(e->'codes') x), '; ') from jsonb_array_elements(b.editions) e) as editions, b.suchi_price::float as price, hq.qty as gkp_stock,
	         b.gitapress_url, b.amazon_url, b.in_links, b.edited_fields <> '{}' as edited
	    from book_titles b left join hq on hq.code = b.code where b.org_id = $1 and b.in_suchi`,
	cols: [
		{ key: 'code', label: 'Code', type: 'code', search: true, natural: true },
		{ key: 'title', label: 'Title', type: 'text', search: true },
		{ key: 'hindi', label: 'Hindi title', type: 'text', search: true },
		{ key: 'language', label: 'Language', type: 'text', facet: true },
		{ key: 'set_code', label: 'Set', type: 'code', facet: true },
		{ key: 'size', label: 'Size', type: 'text', facet: true },
		{ key: 'pages', label: 'Pages', type: 'num' },
		{ key: 'carton', label: 'Per carton', type: 'num' },
		{ key: 'binding', label: 'Binding', type: 'text', facet: true, hidden: true },
		{ key: 'best_seller', label: 'Best seller', type: 'bool', facet: true },
		{ key: 'editions', label: 'Other editions', type: 'text', search: true, hidden: true },
		{ key: 'price', label: 'Price', type: 'money' },
		{ key: 'gkp_stock', label: 'Gorakhpur stock', type: 'num' },
		{ key: 'gitapress_url', label: 'gitapress.org', type: 'link' },
		{ key: 'amazon_url', label: 'Amazon', type: 'link' },
		{ key: 'in_links', label: 'In links file', type: 'bool', facet: true, hidden: true },
		{ key: 'edited', label: 'Edited here', type: 'bool', facet: true, hidden: true },
	],
	sort: 'code', dir: 'asc',
};

const links: Dataset = {
	name: 'links',
	label: 'Book links',
	note: 'Where readers can buy each book online. Replies share these links when a reader asks where or how to buy.',
	base: `select b.code, b.name, b.hindi_title as hindi, b.language, array_to_string(b.aliases, '; ') as aliases, b.gitapress_url, b.amazon_url,
	         case when b.gitapress_url is not null and b.amazon_url is not null then 'Both' when b.gitapress_url is not null then 'gitapress.org only'
	              when b.amazon_url is not null then 'Amazon only' else 'No link' end as coverage,
	         b.in_suchi, b.suchi_price::float as price
	    from book_titles b where b.org_id = $1 and b.in_links`,
	cols: [
		{ key: 'code', label: 'Code', type: 'code', search: true, natural: true },
		{ key: 'name', label: 'English name', type: 'text', search: true },
		{ key: 'hindi', label: 'Hindi title', type: 'text', search: true },
		{ key: 'language', label: 'Language', type: 'text', facet: true },
		{ key: 'aliases', label: 'Other names', type: 'text', search: true, hidden: true },
		{ key: 'gitapress_url', label: 'gitapress.org', type: 'link' },
		{ key: 'amazon_url', label: 'Amazon', type: 'link' },
		{ key: 'coverage', label: 'Links', type: 'text', facet: true },
		{ key: 'in_suchi', label: 'In the Suchi', type: 'bool', facet: true },
		{ key: 'price', label: 'Suchi price', type: 'money' },
	],
	sort: 'code', dir: 'asc',
};

export const DATASETS: Record<string, Dataset> = Object.fromEntries([stock('branch'), stock('hq'), orders, kalyanDispatch, suchi, links].map((d) => [d.name, d]));

export function dataset(name: string): Dataset {
	const d = DATASETS[name];
	if (!d) throw new HttpError(404, 'Unknown data');
	return d;
}

/** What the table needs to draw itself. */
export const describe = (d: Dataset) => ({ name: d.name, label: d.label, note: d.note, cols: d.cols, sort: d.sort, dir: d.dir });

/**
 * WHERE for the request: q (search), f.<key>=v1|v2 (any of the values; '(blank)' for empty), min.<key>/max.<key>.
 * `skip` leaves one column's own filter out (for its facet counts).
 */
function where(d: Dataset, qs: URLSearchParams, params: unknown[], skip?: string): string {
	const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
	const parts: string[] = [];
	const text = (qs.get('q') || '').trim();
	if (text) {
		const t = p(`%${text}%`);
		const cols = d.cols.filter((c) => c.search);
		if (cols.length) parts.push(`(${cols.map((c) => `t.${c.key}::text ilike ${t}`).join(' or ')})`);
	}
	for (const c of d.cols) {
		if (c.key === skip) continue;
		const f = qs.get(`f.${c.key}`);
		if (f) {
			const vals = f.split('|');
			const blank = vals.includes('(blank)');
			const rest = vals.filter((v) => v !== '(blank)');
			const ors: string[] = [];
			if (rest.length) ors.push(c.type === 'bool' ? `t.${c.key} = any(${p(rest.map((v) => v === 'true' || v === 'Yes'))}::boolean[])` : `t.${c.key}::text = any(${p(rest)}::text[])`);
			if (blank) ors.push(`t.${c.key} is null or t.${c.key}::text = ''`);
			parts.push(`(${ors.join(' or ')})`);
		}
		const cast = c.type === 'date' || c.type === 'datetime' ? '::date' : c.type === 'num' || c.type === 'money' ? '::numeric' : null;
		if (!cast) continue;
		const lo = qs.get(`min.${c.key}`);
		const hi = qs.get(`max.${c.key}`);
		if (lo) parts.push(`t.${c.key}${cast === '::date' ? '::date' : ''} >= ${p(lo)}${cast}`);
		if (hi) parts.push(`t.${c.key}${cast === '::date' ? '::date' : ''} <= ${p(hi)}${cast}`);
	}
	return parts.length ? `where ${parts.join(' and ')}` : '';
}

function orderBy(d: Dataset, qs: URLSearchParams): string {
	const key = d.cols.find((c) => c.key === qs.get('sort'))?.key || d.sort;
	const col = d.cols.find((c) => c.key === key)!;
	const dir = qs.get('dir') === 'asc' || qs.get('dir') === 'desc' ? qs.get('dir') : qs.get('sort') ? 'asc' : d.dir;
	const expr = col.natural ? `case when t.${key} ~ '^\\d+$' then lpad(t.${key}, 12, '0') else t.${key} end` : `t.${key}`;
	const tie = d.cols[0].key === key ? '' : `, t.${d.cols[0].key}`;
	return `order by ${expr} ${dir} nulls last${tie}`;
}

export async function rows(orgId: number, d: Dataset, qs: URLSearchParams, all = false) {
	const params: unknown[] = [orgId];
	const w = where(d, qs, params);
	const limit = all ? 1_000_000 : Math.min(Math.max(Number(qs.get('limit')) || 50, 10), 500);
	const offset = all ? 0 : Math.max(0, Number(qs.get('offset')) || 0);
	const list = await q<any>(`select t.* from (${d.base}) t ${w} ${orderBy(d, qs)} limit ${limit} offset ${offset}`, params);
	if (all) return { rows: list, total: list.length, offset: 0, limit };
	const totals = await one<any>(
		`select count(*)::int as n${d.cols.filter((c) => c.type === 'num' || c.type === 'money').map((c) => `, sum(t.${c.key})::float as "${c.key}"`).join('')} from (${d.base}) t ${w}`, params);
	const { n, ...sums } = totals || { n: 0 };
	return { rows: list, total: n, sums, offset, limit };
}

/** The values of one column with counts, under the other filters. */
export async function facet(orgId: number, d: Dataset, key: string, qs: URLSearchParams) {
	const c = d.cols.find((x) => x.key === key);
	if (!c) throw new HttpError(400, 'Unknown column');
	const params: unknown[] = [orgId];
	const w = where(d, qs, params, key);
	return q<any>(`select coalesce(nullif(t.${key}::text, ''), '(blank)') as v, count(*)::int as n from (${d.base}) t ${w} group by 1 order by 2 desc, 1 limit 300`, params);
}

/** Rows ready for Excel/CSV: the visible values in column order. */
export function exportRows(d: Dataset, list: any[]): { header: string[]; rows: unknown[][] } {
	const fmt = (c: Col, v: any) => {
		if (v === null || v === undefined) return '';
		if (c.type === 'bool') return v ? 'Yes' : '';
		if (c.type === 'date') return String(v instanceof Date ? v.toISOString() : v).slice(0, 10);
		if (c.type === 'datetime') return v instanceof Date ? v.toISOString().replace('T', ' ').slice(0, 16) : String(v);
		return v;
	};
	return { header: d.cols.map((c) => c.label), rows: list.map((r) => d.cols.map((c) => fmt(c, r[c.key]))) };
}
