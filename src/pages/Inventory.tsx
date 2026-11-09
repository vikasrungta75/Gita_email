import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { MdDelete, MdDownload, MdRestore, MdSearch, MdUploadFile } from 'react-icons/md';
import { api, getToken, qs } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import Chart from '../components/Chart';
import { Card, Chips, Empty, Facts, Kpi, Loader, Modal, PageHead, Segmented, Sparkline, Story } from '../components/ui';
import { BookPicker, Count, useSort } from '../components/SortTable';
import { COLORS, ago, fmtDate } from '../lib/format';
import { fileToBase64, inr, num } from '../lib/purposes';

const TABS = [
	{ v: 'overview', l: 'Overview' }, { v: 'stock', l: 'Stock status' }, { v: 'top', l: 'Top sellers' }, { v: 'replenish', l: 'Replenishment' },
	{ v: 'range', l: 'Range per branch' }, { v: 'slow', l: 'Slow movers' }, { v: 'demand', l: 'Demand and cross-sell' }, { v: 'uploads', l: 'Uploads and settings' },
] as const;
type Tab = (typeof TABS)[number]['v'];

/** Long lists show the first rows on screen; Excel has them all. */
const SHOW = 200;

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });

async function downloadXlsx(path: string, params: Record<string, unknown>, name: string) {
	const res = await fetch(`/api${path}${qs({ ...params, format: 'xlsx' })}`, { headers: { authorization: `Bearer ${getToken()}` } });
	if (!res.ok) throw new Error('Download failed');
	const a = document.createElement('a');
	a.href = URL.createObjectURL(await res.blob());
	a.download = `gitamail-${name}-${new Date().toISOString().slice(0, 10)}.xlsx`;
	a.click();
}
const ExcelBtn = ({ path, params = {}, name }: { path: string; params?: Record<string, unknown>; name: string }) => (
	<button className="btn sm" onClick={() => downloadXlsx(path, params, name)}><MdDownload /> Excel</button>
);

function useLocations() {
	return useQuery({ queryKey: ['stock-uploads'], queryFn: () => api('/stock/uploads') });
}
function LocationSelect({ value, onChange, all, branchesOnly }: { value: string; onChange: (v: string) => void; all?: string; branchesOnly?: boolean }) {
	const { data } = useLocations();
	return (
		<select className={`input sm drop ${value ? 'on' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Location">
			{all !== undefined && <option value="">{all}</option>}
			{(data?.locations || []).filter((l: any) => !l.noStock && !(branchesOnly && l.hq)).map((l: any) => <option key={l.key} value={l.key}>{l.hq ? `${l.label} (head office)` : l.label}</option>)}
		</select>
	);
}
const Short = ({ list, min }: { list?: string[]; min?: number }) => (list?.length ? <div className="xs faint mb-8">Not enough sales data yet (under {min} days) for: {list.join(', ')}. Upload a full month or more for these.</div> : null);

/** Stock, estimated sales and recommendations from the Tally stock summaries. */
export default function Inventory() {
	const [sp, setSp] = useSearchParams();
	const tab = (sp.get('tab') as Tab) || 'overview';
	const setTab = (t: Tab) => setSp({ tab: t });
	const { data: up } = useLocations();
	const noData = up && !up.uploads?.length;
	return (
		<>
			<PageHead kw="Inventory" rest="and sales"
				sub="Stock at Gorakhpur and every branch, estimated sales and what to send where, from the Tally stock summaries you upload. Estimated sales are outwards from branch shops and Gorakhpur retail dispatch; Main Stock and branch godown outwards are transfers." />
			<div className="mb-16" style={{ overflowX: 'auto' }}><Segmented value={tab} onChange={setTab} options={[...TABS]} /></div>
			{noData && tab !== 'uploads' ? (
				<Card><Empty text={<>No stock uploaded yet. <Link to="/inventory?tab=uploads">Upload the HQ and branch stock summaries</Link> to begin.</>} /></Card>
			) : (
				<>
					{tab === 'overview' && <Overview />}
					{tab === 'stock' && <StockStatus />}
					{tab === 'top' && <TopSellers />}
					{tab === 'replenish' && <Replenish />}
					{tab === 'range' && <RangeGaps />}
					{tab === 'slow' && <SlowMovers />}
					{tab === 'demand' && <Demand />}
					{tab === 'uploads' && <Uploads />}
				</>
			)}
		</>
	);
}

// ── Overview ──────────────────────────────────────────────────────────────

function Overview() {
	const { data, isLoading } = useQuery({ queryKey: ['inv-overview'], queryFn: () => api('/inventory/overview') });
	const bt = useSort<any>(data?.branches, { key: 'salesPerDay', dir: 'desc' });
	if (isLoading || !data) return <Loader />;
	const hq = data.branches.find((b: any) => b.key === 'gorakhpur');
	const months = data.months;
	const partial = (m: any) => m.days && m.days < 28;
	const busiest = [...data.branches].filter((b: any) => b.key !== 'gorakhpur').sort((a: any, b: any) => b.salesPerDay - a.salesPerDay);
	const lowest = [...data.branches].filter((b: any) => b.key !== 'gorakhpur' && b.cover !== null && b.salesDays >= data.minDays).sort((a: any, b: any) => a.cover - b.cover)[0];
	return (
		<>
			<Story
				head={<>{num(data.totals.qty)} copies in stock across Gorakhpur and {data.branches.length - 1} branches, worth {inr(data.totals.value)} at batch prices.</>}
				points={[
					<>Data covers {data.uploads.first ? `${fmtDate(data.uploads.first)} to ${fmtDate(data.uploads.last)}` : 'no period yet'} from {data.uploads.n} uploads. {months.length < 3 ? 'Upload the last 12 months (one HQ and one branch file per month) to see trends and seasonality.' : ''}</>,
					busiest[0] ? <>{busiest[0].label} sells the most of the branches: about {num(busiest[0].salesPerDay)} copies a day (based on {busiest[0].salesDays} days).</> : null,
					lowest ? <>{lowest.label} has the least cover: about {num(lowest.cover)} days of stock at its current sales rate.</> : null,
					<>{num(data.hqOutOfStock)} titles are out of stock at Gorakhpur; {num(data.semi)} copies are printed and waiting to be bound.</>,
				].filter(Boolean) as ReactNode[]}
				next={<>See <Link to="/inventory?tab=replenish">Replenishment</Link> for what to send to each branch.</>}
			/>
			<div className="grid g-4 mb-16">
				<Kpi label="Copies in stock" value={num(data.totals.qty)} accent={COLORS.pink} foot={`Gorakhpur ${num(hq?.qty)}`} />
				<Kpi label="Stock value" value={inr(data.totals.value)} accent={COLORS.teal} foot="at the highest batch price" />
				<Kpi label="Titles in catalogue" value={num(data.titles)} accent={COLORS.blue} foot={`${num(hq?.titles)} in stock at Gorakhpur`} />
				<Kpi label="Semi-finished at Gorakhpur" value={num(data.semi)} accent={COLORS.general} foot="printed, not yet bound" />
			</div>
			<div className="grid g-2 mb-16">
				<Card title="Estimated sales per month" sub="Copies sold from branch shops and Gorakhpur retail dispatch. Months marked * are only partly covered by uploads." accent={COLORS.pink}>
					{months.length ? (
						<Chart type="bar" height={260}
							series={[{ name: 'Copies sold', data: months.map((m: any) => m.qty) }]}
							options={{
								colors: [COLORS.pink],
								plotOptions: { bar: { borderRadius: 4, borderRadiusApplication: 'end', columnWidth: '55%' } },
								xaxis: { categories: months.map((m: any) => `${monthLabel(m.month)}${partial(m) ? '*' : ''}`) },
								yaxis: { labels: { formatter: (v: number) => num(Math.round(v)) } },
								tooltip: { y: { formatter: (v: number, o: any) => `${num(v)} copies${partial(months[o.dataPointIndex]) ? ` (only ${months[o.dataPointIndex].days} days uploaded)` : ''}` } },
							}} />
					) : <Empty text="No sales yet" />}
				</Card>
				<Card title="Estimated sales per day by branch" sub="Average over the latest uploads (up to 90 days). Gorakhpur is retail dispatch only." accent={COLORS.teal}>
					<Chart type="bar" height={Math.max(260, busiest.length * 22 + 40)}
						series={[{ name: 'Copies a day', data: [hq, ...busiest].filter(Boolean).map((b: any) => b.salesPerDay) }]}
						options={{
							colors: [COLORS.teal],
							plotOptions: { bar: { horizontal: true, borderRadius: 4, borderRadiusApplication: 'end', barHeight: '62%' } },
							xaxis: { categories: [hq, ...busiest].filter(Boolean).map((b: any) => b.label), labels: { formatter: (v: any) => num(Math.round(Number(v))) } },
							tooltip: { y: { formatter: (v: number, o: any) => `${num(v)} copies a day (${[hq, ...busiest].filter(Boolean)[o.dataPointIndex].salesDays} days of data)` } },
						}} />
				</Card>
			</div>
			<Card flush title="Branches" sub="Click a heading to sort, or a number to open that list." actions={<ExcelBtn path="/inventory/overview" name="branch-summary" />}>
				<div className="table-wrap">
					<table className="table">
						<thead><tr><bt.Th k="label">Location</bt.Th><bt.Th k="asOf" num>Stock as of</bt.Th><bt.Th k="qty" num>Copies</bt.Th><bt.Th k="value" num>Value</bt.Th><bt.Th k="titles" num>Titles</bt.Th><bt.Th k="salesPerDay" num>Sales a day</bt.Th><bt.Th k="cover" num first="asc">Days of cover</bt.Th><bt.Th k="lowTitles" num>Running low</bt.Th><bt.Th k="outTitles" num>Selling, out of stock</bt.Th><th>Monthly sales</th></tr></thead>
						<tbody>
							{bt.sorted.map((b: any) => (
								<tr key={b.key}>
									<td><Link to={`/inventory?tab=stock&location=${b.key}`}><b>{b.label}</b></Link>{b.key === 'gorakhpur' && <div className="xs faint">head office</div>}</td>
									<td className="small nowrap num">{b.asOf ? fmtDate(b.asOf) : <span className="faint">not uploaded</span>}</td>
									<td className="num">{num(b.qty)}</td>
									<td className="num small">{inr(b.value)}</td>
									<td className="num">{num(b.titles)}</td>
									<td className="num">{num(b.salesPerDay)}<div className="xs faint">{b.salesDays} days</div></td>
									<td className="num">{b.cover === null ? '–' : num(b.cover)}</td>
									<td className="num">{b.lowTitles === null ? <span className="faint">–</span> : b.lowTitles ? <Link to={`/inventory?tab=stock&location=${b.key}&status=low`}>{b.lowTitles}</Link> : 0}</td>
									<td className="num">{b.outTitles === null ? <span className="faint">–</span> : b.outTitles ? <Link to={`/inventory?tab=stock&location=${b.key}&status=out_selling`}>{b.outTitles}</Link> : 0}</td>
									<td>{b.monthly.length > 1 ? <Sparkline v={b.monthly.map((m: any) => m.days ? m.qty / m.days : 0)} /> : <span className="faint xs">needs 2+ months</span>}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className="xs faint" style={{ padding: '8px 20px' }}>"Running low" means fewer days of stock than the {data.settings.leadDays}-day lead time from Gorakhpur; counts need at least {data.minDays} days of sales data. Sparklines show copies sold per day in each month.</div>
			</Card>
		</>
	);
}

// ── Shared: filters kept in the address, book detail ─────────────────────

/** A filter value kept in the page address, so a filtered view can be bookmarked, shared or reopened. */
function useParam(key: string, def = ''): [string, (v: string) => void] {
	const [sp, setSp] = useSearchParams();
	const v = sp.get(key) ?? def;
	return [v, (next: string) => setSp((p) => { if (next && next !== def) p.set(key, next); else p.delete(key); return p; }, { replace: true })];
}
function useCodes(): [string[], (v: string[]) => void] {
	const [v, set] = useParam('books');
	return [v ? v.split(',') : [], (c) => set(c.join(','))];
}
function useClear(keys: string[]) {
	const [sp, setSp] = useSearchParams();
	const any = keys.some((k) => sp.get(k));
	return { any, clear: () => setSp((p) => { keys.forEach((k) => p.delete(k)); return p; }, { replace: true }) };
}

/** Click a title anywhere to see that book at every location. */
const BookLink = ({ code, name, sub, onOpen }: { code: string; name: string; sub?: ReactNode; onOpen: (c: string) => void }) => (
	<td style={{ maxWidth: 320 }}>
		<button type="button" className="link-btn title-btn truncate" onClick={() => onOpen(code)} title="See this book at every location">{name}</button>
		<div className="xs faint">{sub ?? <>Code {code}</>}</div>
	</td>
);

function BookModal({ code, onClose }: { code: string; onClose: () => void }) {
	const { data } = useQuery({ queryKey: ['inv-book', code], queryFn: () => api(`/inventory/book/${encodeURIComponent(code)}`) });
	const { sorted, Th } = useSort<any>(data?.rows, { key: 'qty', dir: 'desc' });
	return (
		<Modal wide title={data ? <>{data.name} <span className="faint" style={{ fontWeight: 500 }}>· code {code}</span></> : 'Book'} onClose={onClose}
			footer={<><Link className="btn ghost" to={`/inventory?tab=top&books=${code}`} onClick={onClose}>Sales of this book</Link><span style={{ flex: 1 }} /><button className="btn" onClick={onClose}>Close</button></>}>
			{!data ? <Loader /> : (
				<>
					<Facts items={[
						['Language', data.language],
						['Hindi title', data.hindi || ''],
						['Copies in stock', num(data.rows.reduce((a: number, r: any) => a + r.qty, 0))],
						['Sold per month', num(Math.round(data.rows.reduce((a: number, r: any) => a + r.perMonth, 0)))],
						['Asked for by email', data.requests?.n ? `${num(data.requests.n)} times, ${num(data.requests.people)} people` : 'not yet'],
					]} />
					{data.months.length > 1 && (
						<div className="mt-16">
							<Chart type="bar" height={180} series={[{ name: 'Copies sold', data: data.months.map((m: any) => m.qty) }]}
								options={{ colors: [COLORS.pink], plotOptions: { bar: { borderRadius: 4, borderRadiusApplication: 'end', columnWidth: '55%' } }, xaxis: { categories: data.months.map((m: any) => `${monthLabel(m.month)}${m.days && m.days < 28 ? '*' : ''}`) }, yaxis: { labels: { formatter: (v: number) => num(Math.round(v)) } }, tooltip: { y: { formatter: (v: number) => `${num(v)} copies` } } }} />
						</div>
					)}
					<div className="table-wrap mt-16">
						<table className="table">
							<thead><tr><Th k="label">Location</Th><Th k="qty" num>In stock</Th><Th k="semi" num>Semi-finished</Th><Th k="price" num>Price</Th><Th k="perMonth" num>Sells a month</Th><Th k="cover" num first="asc">Days of cover</Th></tr></thead>
							<tbody>{sorted.map((r: any) => (
								<tr key={r.key}>
									<td><b>{r.label}</b><div className="xs faint">as of {fmtDate(r.asOf)}</div></td>
									<td className="num">{r.qty ? num(r.qty) : <span className="faint">0</span>}</td>
									<td className="num">{r.semi ? num(r.semi) : <span className="faint">–</span>}</td>
									<td className="num small">{inr(r.price)}</td>
									<td className="num">{r.perMonth ? num(r.perMonth) : <span className="faint">–</span>}</td>
									<td className="num">{r.cover === null ? '–' : <span style={{ color: r.cover < r.leadDays ? COLORS.red : undefined }}>{num(r.cover)}</span>}</td>
								</tr>
							))}</tbody>
						</table>
					</div>
				</>
			)}
		</Modal>
	);
}

/** Rows chosen in the book filter (client side, for tables already loaded). */
const byBooks = <T extends { code: string }>(rows: T[] | undefined, codes: string[]) => (rows || []).filter((r) => !codes.length || codes.includes(r.code));

// ── Stock status ──────────────────────────────────────────────────────────

const STATUS: Record<string, [string, string, number]> = {
	out_selling: ['Out of stock, selling', 'red', 0], low: ['Running low', 'amber', 1], out: ['Out of stock', '', 2], over: ['Overstocked', 'amber', 3], no_sales: ['No sales', '', 4], ok: ['OK', 'green', 5],
};
function StockStatus() {
	const [location, setLocation] = useParam('location', 'gorakhpur');
	const [status, setStatus] = useParam('status');
	const [language, setLanguage] = useParam('language');
	const [q, setQ] = useParam('q');
	const [codes, setCodes] = useCodes();
	const [search, setSearch] = useState(q);
	useEffect(() => { const t = setTimeout(() => search !== q && setQ(search), 350); return () => clearTimeout(t); }, [search]);
	const [open, setOpen] = useState<string | null>(null);
	const f = { location, status, language, q, codes };
	const { data, isFetching } = useQuery({ queryKey: ['inv-stock', f], queryFn: () => api(`/inventory/stock${qs(f)}`), placeholderData: keepPreviousData });
	const langs = useQuery({ queryKey: ['inv-top-langs'], queryFn: () => api('/inventory/top?limit=1') });
	const { sorted, Th } = useSort<any>(data?.rows, { key: 'sold', dir: 'desc' }, { status: (r) => STATUS[r.status]?.[2] });
	const { any, clear } = useClear(['status', 'language', 'q', 'books']);
	return (
		<Card flush title={data ? <h2>{data.label} <span className="faint" style={{ fontWeight: 500 }}>· stock status</span></h2> : 'Stock status'}
			sub={data && <>Stock as of {data.asOf ? fmtDate(data.asOf) : 'not uploaded'}; sales over the latest {data.salesDays} days.{!data.enough && ` Status needs at least ${data.minDays} days of sales data.`} Click a title to see it at every location.</>}
			actions={<ExcelBtn path="/inventory/stock" params={f} name={`stock-${location}`} />}>
			<div className="filter-strip wrap" style={{ padding: '12px 20px' }}>
				<LocationSelect value={location} onChange={setLocation} />
				<select className={`input sm drop ${status ? 'on' : ''}`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
					<option value="">Any status</option>
					{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}{data?.counts?.[k] ? ` (${num(data.counts[k])})` : ''}</option>)}
				</select>
				<select className={`input sm drop ${language ? 'on' : ''}`} value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
					<option value="">Any language</option>
					{(langs.data?.languages || []).map((l: any) => <option key={l.language} value={l.language}>{l.language}</option>)}
				</select>
				<div className="search-box"><MdSearch /><input className="input sm" placeholder="Words in the title or a code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search titles" /></div>
				<BookPicker value={codes} onChange={setCodes} />
			</div>
			{data && <StatusChips counts={data.counts} value={status} onChange={setStatus} />}
			{!data ? <Loader /> : !data.rows.length ? <Empty text="No titles match these filters." /> : (
				<div className="table-wrap sticky">
					<table className="table">
						<thead><tr>
							<Th k="name">Title</Th><Th k="language">Language</Th><Th k="qty" num>In stock</Th>{location === 'gorakhpur' && <Th k="semi" num>Semi-finished</Th>}
							<Th k="price" num>Price</Th><Th k="value" num>Value</Th><Th k="sold" num>Sold</Th><Th k="perMonth" num>Per month</Th><Th k="cover" num first="asc">Days of cover</Th><Th k="status" first="asc">Status</Th>
						</tr></thead>
						<tbody>
							{sorted.map((r: any) => (
								<tr key={r.code}>
									<BookLink code={r.code} name={r.name} onOpen={setOpen} sub={<>Code {r.code}{r.hindi ? ` · ${r.hindi}` : ''}</>} />
									<td className="small">{r.language}</td>
									<td className="num">{num(r.qty)}</td>
									{location === 'gorakhpur' && <td className="num">{r.semi ? num(r.semi) : <span className="faint">–</span>}</td>}
									<td className="num small">{inr(r.price)}</td>
									<td className="num small">{inr(r.value)}</td>
									<td className="num">{num(r.sold)}</td>
									<td className="num">{num(r.perMonth)}</td>
									<td className="num">{r.cover === null ? '–' : num(r.cover)}</td>
									<td><span className={`badge ${STATUS[r.status]?.[1] || ''}`}>{STATUS[r.status]?.[0] || r.status}</span></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<div className="row-between" style={{ padding: '8px 20px' }}>
				{data ? <Count shown={data.rows.length} total={data.total} onClear={any ? () => { setSearch(''); clear(); } : undefined} /> : <span />}
				{data && data.total > data.rows.length && <span className="xs faint">Narrow the filters or download Excel for all {num(data.total)}.</span>}
				{isFetching && <span className="xs faint">updating</span>}
			</div>
			{open && <BookModal code={open} onClose={() => setOpen(null)} />}
		</Card>
	);
}

/** One-click status filter with counts. */
function StatusChips({ counts, value, onChange }: { counts: Record<string, number>; value: string; onChange: (v: string) => void }) {
	const opts = Object.entries(STATUS).filter(([k]) => counts?.[k]).map(([k, [l, tone]]) => ({ v: k, l, n: counts[k], tone }));
	if (!opts.length) return null;
	return <div style={{ padding: '0 20px 10px' }}><Chips single options={opts} value={value ? [value] : []} onChange={(v) => onChange(v[0] || '')} /></div>;
}

// ── Top sellers ───────────────────────────────────────────────────────────

function TopSellers() {
	const [location, setLocation] = useParam('location');
	const [language, setLanguage] = useParam('language');
	const [months, setMonths] = useParam('months');
	const [codes, setCodes] = useCodes();
	const [limit, setLimit] = useState(50);
	const [open, setOpen] = useState<string | null>(null);
	const f = { location, language, months, codes, limit };
	const { data } = useQuery({ queryKey: ['inv-top', f], queryFn: () => api(`/inventory/top${qs(f)}`), placeholderData: keepPreviousData });
	const ranked = useMemo(() => (data?.rows || []).map((r: any, i: number) => ({ ...r, rank: i + 1 })), [data]);
	const { sorted, Th } = useSort<any>(ranked, { key: 'rank', dir: 'asc' });
	const { any, clear } = useClear(['location', 'language', 'months', 'books']);
	if (!data) return <Loader />;
	const langs = data.languages.slice(0, 10);
	return (
		<div className="col gap-16">
			<Card flush title="Top sellers" sub={`Copies sold${data.months.length ? `, ${monthLabel(data.months[0])} to ${monthLabel(data.months[data.months.length - 1])}` : ''}. Click a title to see it at every location.`} actions={<ExcelBtn path="/inventory/top" params={f} name="top-sellers" />}>
				<div className="filter-strip wrap" style={{ padding: '12px 20px' }}>
					<LocationSelect value={location} onChange={setLocation} all="All locations" />
					<select className={`input sm drop ${language ? 'on' : ''}`} value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
						<option value="">Any language</option>{data.languages.map((l: any) => <option key={l.language} value={l.language}>{l.language}</option>)}
					</select>
					<Segmented value={months || 'all'} onChange={(v) => setMonths(v === 'all' ? '' : v)} options={[{ v: 'all', l: 'All months' }, { v: '1', l: 'Latest' }, { v: '3', l: '3 months' }, { v: '6', l: '6 months' }, { v: '12', l: '12 months' }]} />
					<BookPicker value={codes} onChange={setCodes} placeholder="Compare books" />
				</div>
				{!sorted.length ? <Empty text={codes.length ? 'The chosen books have no sales in this period.' : 'No sales in this period.'} /> : (
					<div className="table-wrap sticky">
						<table className="table">
							<thead><tr><Th k="rank" num first="asc">#</Th><Th k="name">Title</Th><Th k="language">Language</Th><Th k="qty" num>Copies sold</Th><Th k="value" num>Value</Th><th>Where it sells</th><th>Trend</th><Th k="hqQty" num>Gorakhpur stock</Th></tr></thead>
							<tbody>
								{sorted.map((r: any) => (
									<tr key={r.code}>
										<td className="num faint">{r.rank}</td>
										<BookLink code={r.code} name={r.name} onOpen={setOpen} sub={<>Code {r.code} · {inr(r.price)}</>} />
										<td className="small">{r.language}</td>
										<td className="num"><b>{num(r.qty)}</b></td>
										<td className="num small">{inr(r.value)}</td>
										<td className="xs" style={{ maxWidth: 220 }}>{r.branches.map((b: any) => `${b.label} ${num(b.qty)}`).join(' · ')}</td>
										<td>{r.trend.length > 1 ? <Sparkline v={r.trend} /> : <span className="faint xs">–</span>}</td>
										<td className="num">{num(r.hqQty)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<div className="row-between" style={{ padding: '8px 20px' }}>
					<Count shown={sorted.length} total={sorted.length} onClear={any ? clear : undefined} />
					{!codes.length && data.rows.length >= limit && <button className="btn sm" onClick={() => setLimit(limit + 100)}>Show 100 more</button>}
				</div>
			</Card>
			<Card title="Sales by language" sub="Copies sold in the same period. Click a bar to show only that language." accent={COLORS.purple}>
				{langs.length ? (
					<Chart type="bar" height={Math.max(200, langs.length * 24 + 40)} series={[{ name: 'Copies sold', data: langs.map((l: any) => l.qty) }]}
						options={{
							colors: [COLORS.purple], plotOptions: { bar: { horizontal: true, borderRadius: 4, borderRadiusApplication: 'end', barHeight: '62%' } },
							chart: { events: { dataPointSelection: (_e: any, _c: any, o: any) => setLanguage(langs[o.dataPointIndex].language === language ? '' : langs[o.dataPointIndex].language) } } as any,
							xaxis: { categories: langs.map((l: any) => l.language), tickAmount: 4, labels: { formatter: (v: any) => num(Math.round(Number(v))) } }, tooltip: { y: { formatter: (v: number) => `${num(v)} copies` } },
						}} />
				) : <Empty text="No sales yet" />}
			</Card>
			{open && <BookModal code={open} onClose={() => setOpen(null)} />}
		</div>
	);
}

// ── Replenishment, range, slow movers ─────────────────────────────────────

const URGENCY: Record<string, [string, string, number]> = { out: ['Out of stock', 'red', 0], urgent: ['Urgent', 'amber', 1], soon: ['Soon', '', 2] };

function Replenish() {
	const [location, setLocation] = useParam('location');
	const [urgency, setUrgency] = useParam('urgency');
	const [codes, setCodes] = useCodes();
	const [open, setOpen] = useState<string | null>(null);
	const { data } = useQuery({ queryKey: ['inv-repl', location], queryFn: () => api(`/inventory/replenishment${qs({ location })}`), placeholderData: keepPreviousData });
	const rows = useMemo(() => byBooks<any>(data?.rows, codes).filter((r) => !urgency || r.urgency === urgency), [data, codes, urgency]);
	const { sorted, Th } = useSort<any>(rows, { key: 'cover', dir: 'asc' }, { urgency: (r) => URGENCY[r.urgency]?.[2], short: (r) => Math.max(0, r.send - r.hqQty) });
	const { any, clear } = useClear(['urgency', 'books']);
	if (!data) return <Loader />;
	const counts = (data.rows as any[]).reduce((a: any, r: any) => ((a[r.urgency] = (a[r.urgency] || 0) + 1), a), {});
	return (
		<>
			<Story head={<>{num(data.total)} titles at {data.byLocation.length} branches will run out before new stock can arrive from Gorakhpur.</>}
				points={[<>A title is flagged when its stock covers fewer than {data.settings.leadDays} days of sales; the suggested quantity brings it to {data.settings.coverDays} days, adjusted for the season once 6 months or more are uploaded. Change these in Uploads and settings.</>,
					...data.byLocation.slice(0, 3).map((b: any) => <>{b.label}: {num(b.titles)} titles, {num(b.copies)} copies ({inr(b.value)}). <button type="button" className="link-btn" onClick={() => setLocation(b.key)}>Show</button></>)]} />
			<Card flush title="What to send" sub="Click a title to see its stock and sales at every location." actions={<ExcelBtn path="/inventory/replenishment" params={{ location }} name="replenishment" />}>
				<div className="filter-strip wrap" style={{ padding: '12px 20px' }}>
					<LocationSelect value={location} onChange={setLocation} all="All branches" branchesOnly />
					<Chips single options={Object.entries(URGENCY).filter(([k]) => counts[k]).map(([k, [l, tone]]) => ({ v: k, l, n: counts[k], tone }))} value={urgency ? [urgency] : []} onChange={(v) => setUrgency(v[0] || '')} />
					<BookPicker value={codes} onChange={setCodes} />
				</div>
				<div style={{ padding: '0 20px' }}><Short list={data.short} min={data.minDays} /></div>
				{!sorted.length ? <Empty text={data.rows.length ? 'Nothing matches these filters.' : 'Nothing needs sending yet.'} /> : (
					<div className="table-wrap sticky">
						<table className="table">
							<thead><tr><Th k="label">Branch</Th><Th k="name">Title</Th><Th k="qty" num>In stock</Th><Th k="perMonth" num>Sells a month</Th><Th k="cover" num first="asc">Days left</Th><Th k="send" num>Send</Th><Th k="hqQty" num>Gorakhpur has</Th><Th k="urgency" first="asc">Urgency</Th></tr></thead>
							<tbody>
								{sorted.slice(0, SHOW).map((r: any) => (
									<tr key={`${r.location}-${r.code}`}>
										<td className="nowrap"><b>{r.label}</b></td>
										<BookLink code={r.code} name={r.name} onOpen={setOpen} sub={<>Code {r.code} · {r.language}{r.season !== 1 ? ` · season ×${r.season}` : ''}</>} />
										<td className="num">{num(r.qty)}</td>
										<td className="num">{num(r.perMonth)}</td>
										<td className="num">{num(r.cover)}</td>
										<td className="num"><b>{num(r.send)}</b></td>
										<td className="num">{num(r.hqQty)}{r.hqQty < r.send && <div className="xs" style={{ color: 'var(--amber)' }}>short by {num(r.send - r.hqQty)}</div>}</td>
										<td><span className={`badge ${URGENCY[r.urgency]?.[1] || ''}`}>{URGENCY[r.urgency]?.[0]}</span></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<div className="row-between" style={{ padding: '8px 20px' }}><Count shown={Math.min(SHOW, sorted.length)} total={sorted.length} onClear={any ? clear : undefined} />{sorted.length > SHOW && <span className="xs faint">Download Excel for the full list.</span>}</div>
			</Card>
			{open && <BookModal code={open} onClose={() => setOpen(null)} />}
		</>
	);
}

function RangeGaps() {
	const [location, setLocation] = useParam('location');
	const [codes, setCodes] = useCodes();
	const [language, setLanguage] = useParam('language');
	const [open, setOpen] = useState<string | null>(null);
	const { data } = useQuery({ queryKey: ['inv-range', location], queryFn: () => api(`/inventory/range${qs({ location })}`), placeholderData: keepPreviousData });
	const rows = useMemo(() => byBooks<any>(data?.rows, codes).filter((r) => !language || r.language === language), [data, codes, language]);
	const { sorted, Th } = useSort<any>(rows, { key: 'expectedPerMonth', dir: 'desc' }, { sellsAt: (r) => r.sellsAt.length });
	const langs = useMemo(() => [...new Set((data?.rows || []).map((r: any) => r.language))].filter(Boolean).sort() as string[], [data]);
	const { any, clear } = useClear(['books', 'language']);
	if (!data) return <Loader />;
	return (
		<Card flush title="Books a branch should stock" sub="Titles that sell well at branches with a similar language mix, in a language the branch sells, but which this branch neither stocks nor sells." actions={<ExcelBtn path="/inventory/range" params={{ location }} name="range-gaps" />}>
			<div className="filter-strip wrap" style={{ padding: '12px 20px' }}>
				<LocationSelect value={location} onChange={setLocation} all="All branches" branchesOnly />
				<select className={`input sm drop ${language ? 'on' : ''}`} value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language"><option value="">Any language</option>{langs.map((l) => <option key={l}>{l}</option>)}</select>
				<BookPicker value={codes} onChange={setCodes} />
			</div>
			<div style={{ padding: '0 20px' }}><Short list={data.short} min={data.minDays} /></div>
			{!sorted.length ? <Empty text={data.rows.length ? 'Nothing matches these filters.' : 'No gaps found yet. This needs at least a month of sales for several branches.'} /> : (
				<div className="table-wrap sticky">
					<table className="table">
						<thead><tr><Th k="label">Branch</Th><Th k="name">Title</Th><Th k="expectedPerMonth" num>Expected a month</Th><Th k="sellsAt" num>Sells at</Th><Th k="hqQty" num>Gorakhpur has</Th><Th k="price" num>Price</Th></tr></thead>
						<tbody>
							{sorted.slice(0, SHOW).map((r: any) => (
								<tr key={`${r.location}-${r.code}`}>
									<td><b>{r.label}</b></td>
									<BookLink code={r.code} name={r.name} onOpen={setOpen} sub={<>Code {r.code} · {r.language}</>} />
									<td className="num"><b>{num(r.expectedPerMonth)}</b></td>
									<td className="xs num">{r.sellsAt.join(', ')}</td>
									<td className="num">{num(r.hqQty)}</td>
									<td className="num small">{inr(r.price)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<div className="row-between" style={{ padding: '8px 20px' }}><Count shown={Math.min(SHOW, sorted.length)} total={sorted.length} onClear={any ? clear : undefined} />{sorted.length > SHOW && <span className="xs faint">Download Excel for the full list.</span>}</div>
			{open && <BookModal code={open} onClose={() => setOpen(null)} />}
		</Card>
	);
}

function SlowMovers() {
	const [location, setLocation] = useParam('location');
	const [codes, setCodes] = useCodes();
	const [only, setOnly] = useParam('only');
	const [open, setOpen] = useState<string | null>(null);
	const { data } = useQuery({ queryKey: ['inv-slow', location], queryFn: () => api(`/inventory/slow${qs({ location })}`), placeholderData: keepPreviousData });
	const rows = useMemo(() => byBooks<any>(data?.rows, codes).filter((r) => (only === 'move' ? r.moveTo : only === 'nosales' ? r.noSales : true)), [data, codes, only]);
	const { sorted, Th } = useSort<any>(rows, { key: 'value', dir: 'desc' }, { moveTo: (r) => r.moveTo?.qty, cover: (r) => (r.noSales ? Infinity : r.cover) });
	const { any, clear } = useClear(['books', 'only']);
	if (!data) return <Loader />;
	const n = { move: data.rows.filter((r: any) => r.moveTo).length, nosales: data.rows.filter((r: any) => r.noSales).length };
	return (
		<Card flush title="Slow movers" sub="Stock that would last more than three times the target cover at the current sales rate, or has not sold at all. Where another branch sells the title and is short, a transfer is suggested." actions={<ExcelBtn path="/inventory/slow" params={{ location }} name="slow-movers" />}>
			<div className="filter-strip wrap" style={{ padding: '12px 20px' }}>
				<LocationSelect value={location} onChange={setLocation} all="All branches" branchesOnly />
				<Chips single options={[{ v: 'move', l: 'Transfer suggested', n: n.move }, { v: 'nosales', l: 'No sales at all', n: n.nosales }]} value={only ? [only] : []} onChange={(v) => setOnly(v[0] || '')} />
				<BookPicker value={codes} onChange={setCodes} />
			</div>
			<div style={{ padding: '0 20px' }}><Short list={data.short} min={data.minDays} /></div>
			{!sorted.length ? <Empty text={data.rows.length ? 'Nothing matches these filters.' : 'No slow movers found (needs at least a month of sales data).'} /> : (
				<div className="table-wrap sticky">
					<table className="table">
						<thead><tr><Th k="label">Branch</Th><Th k="name">Title</Th><Th k="qty" num>In stock</Th><Th k="value" num>Value</Th><Th k="perMonth" num>Sells a month</Th><Th k="cover" num>Days of cover</Th><Th k="moveTo" num>Suggested transfer</Th></tr></thead>
						<tbody>
							{sorted.slice(0, SHOW).map((r: any) => (
								<tr key={`${r.location}-${r.code}`}>
									<td><b>{r.label}</b></td>
									<BookLink code={r.code} name={r.name} onOpen={setOpen} sub={<>Code {r.code} · {r.language}</>} />
									<td className="num">{num(r.qty)}</td>
									<td className="num small">{inr(r.value)}</td>
									<td className="num">{r.noSales ? <span className="faint">none</span> : num(r.perMonth)}</td>
									<td className="num">{r.cover === null ? '–' : num(r.cover)}</td>
									<td className="small num">{r.moveTo ? <>{num(r.moveTo.qty)} to <b>{r.moveTo.label}</b> <div className="xs faint">sells {num(r.moveTo.perMonth)} a month</div></> : <span className="faint">–</span>}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<div className="row-between" style={{ padding: '8px 20px' }}><Count shown={Math.min(SHOW, sorted.length)} total={sorted.length} onClear={any ? clear : undefined} />{sorted.length > SHOW && <span className="xs faint">Download Excel for the full list.</span>}</div>
			{open && <BookModal code={open} onClose={() => setOpen(null)} />}
		</Card>
	);
}

// ── Demand from emails and cross-sell ─────────────────────────────────────

function Demand() {
	const d = useQuery({ queryKey: ['inv-demand'], queryFn: () => api('/inventory/demand') });
	const x = useQuery({ queryKey: ['inv-xsell'], queryFn: () => api('/inventory/cross-sell') });
	const [codes, setCodes] = useCodes();
	const [open, setOpen] = useState<string | null>(null);
	const link = (s: any) => `/admin/customers${qs({ purposes: s.has, purposeMode: s.has.length > 1 ? 'all' : undefined, not: s.not || [] })}`;
	const seg = useSort<any>(x.data?.segments, { key: 'n', dir: 'desc' });
	const unmet = useSort<any>(useMemo(() => byBooks<any>(d.data?.unmet, codes), [d.data, codes]), { key: 'requests', dir: 'desc' }, { nearest: (r) => r.nearest.reduce((a: number, n: any) => a + n.qty, 0) });
	const back = useSort<any>(useMemo(() => byBooks<any>(d.data?.backInStock, codes), [d.data, codes]), { key: 'requested_at', dir: 'desc' });
	return (
		<>
			<Card flush title="Cross-sell and upsell" sub="Groups of readers and customers from their reasons for contacting. Open a group to see the people and download them to Excel." accent={COLORS.pink} className="mb-16">
				{!x.data ? <Loader /> : (
					<div className="table-wrap">
						<table className="table">
							<thead><tr><seg.Th k="label">Group</seg.Th><th>Suggested offer</th><seg.Th k="n" num>People</seg.Th></tr></thead>
							<tbody>
								{seg.sorted.map((s: any) => (
									<tr key={s.id}>
										<td><b>{s.label}</b><div className="xs faint">Contacted for {s.hasLabels.join(' and ')}{s.notLabels.length ? `; never for ${s.notLabels.join(', ')}` : ''}</div></td>
										<td className="small">{s.pitch}</td>
										<td className="num">{s.n ? <Link className="btn sm" to={link(s)}>{num(s.n)} people</Link> : <span className="faint">0</span>}</td>
									</tr>
								))}
								<tr>
									<td><b>Asked for a book when it was out of stock</b><div className="xs faint">From email requests matched to Tally stock</div></td>
									<td className="small">Once the book is back in stock at Gorakhpur, they appear under Back in stock below.</td>
									<td className="num">{num(x.data.askedWhenOut)}</td>
								</tr>
							</tbody>
						</table>
					</div>
				)}
			</Card>
			<div className="filter-strip wrap mb-16"><BookPicker value={codes} onChange={setCodes} placeholder="Filter both lists by book" /></div>
			<div className="grid g-2">
				<Card flush title="Books readers ask for" sub="Books named or quoted by code in emails over the last year, matched to Tally stock.">
					{!d.data ? <Loader /> : !unmet.sorted.length ? <Empty text={d.data.unmet.length ? 'No requests for the chosen books.' : 'No book requests recorded yet. They are collected as emails are analysed.'} /> : (
						<div className="table-wrap sticky">
							<table className="table">
								<thead><tr><unmet.Th k="name">Book</unmet.Th><unmet.Th k="requests" num>Requests</unmet.Th><unmet.Th k="out_at_hq" num>Out at Gorakhpur then</unmet.Th><unmet.Th k="hqQty" num>Gorakhpur now</unmet.Th><unmet.Th k="nearest" num>Nearest branches now</unmet.Th></tr></thead>
								<tbody>
									{unmet.sorted.map((r: any) => (
										<tr key={r.code}>
											<BookLink code={r.code} name={r.name} onOpen={setOpen} sub={<>Code {r.code} · {r.language} · last {ago(r.last)}</>} />
											<td className="num"><b>{num(r.requests)}</b><div className="xs faint">{num(r.customers)} people</div></td>
											<td className="num">{r.out_at_hq ? <span style={{ color: 'var(--red)' }}>{num(r.out_at_hq)}</span> : 0}</td>
											<td className="num">{num(r.hqQty)}</td>
											<td className="xs num">{r.nearest.map((n: any) => `${n.label} ${num(n.qty)}`).join(' · ') || '–'}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Card>
				<Card flush title="Back in stock: tell these readers" sub="They asked when the book was out of stock at Gorakhpur; it is in stock now." actions={<ExcelBtn path="/inventory/demand" name="back-in-stock" />}>
					{!d.data ? <Loader /> : !back.sorted.length ? <Empty text="Nobody is waiting for a book that is back in stock." /> : (
						<div className="table-wrap sticky">
							<table className="table">
								<thead><tr><back.Th k="name">Reader</back.Th><back.Th k="bookName">Book</back.Th><back.Th k="requested_at" num>Asked</back.Th><back.Th k="hqQty" num>In stock now</back.Th></tr></thead>
								<tbody>
									{back.sorted.map((r: any) => (
										<tr key={`${r.conversation_id}-${r.code}`}>
											<td className="small"><Link to={`/conversations/${r.conversation_id}`}>{r.name}</Link><div className="xs faint">{r.email}</div></td>
											<BookLink code={r.code} name={r.bookName} onOpen={setOpen} />
											<td className="small nowrap num">{fmtDate(r.requested_at)}</td>
											<td className="num">{num(r.hqQty)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Card>
			</div>
			{open && <BookModal code={open} onClose={() => setOpen(null)} />}
		</>
	);
}

// ── Uploads and settings ──────────────────────────────────────────────────

function UploadSlot({ slot, title, help, can }: { slot: 'hq' | 'branch'; title: string; help: string; can: boolean }) {
	const toast = useToast();
	const qc = useQueryClient();
	const ref = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState('');
	const [results, setResults] = useState<any[]>([]);
	const upload = async (files: FileList | null) => {
		if (!files?.length) return;
		const out: any[] = [];
		for (const [i, f] of [...files].entries()) {
			setBusy(`Reading ${f.name} (${i + 1} of ${files.length})…`);
			try {
				const res = await api('/stock/upload', { body: { slot, fileName: f.name, data: await fileToBase64(f) } });
				out.push({ file: f.name, ok: true, ...res });
			} catch (e: any) {
				out.push({ file: f.name, ok: false, error: e.message });
			}
		}
		setBusy('');
		setResults(out);
		if (ref.current) ref.current.value = '';
		qc.invalidateQueries();
		const ok = out.filter((x) => x.ok).length;
		toast(ok === out.length ? `${ok} file${ok > 1 ? 's' : ''} uploaded` : `${ok} of ${out.length} uploaded; see the messages`, ok === out.length ? 'ok' : 'error');
	};
	return (
		<Card title={title} sub={help} accent={slot === 'hq' ? COLORS.pink : COLORS.teal}>
			{can ? (
				<>
					<input ref={ref} type="file" accept=".xlsx" multiple hidden onChange={(e) => upload(e.target.files)} />
					<button className="btn primary" disabled={!!busy} onClick={() => ref.current?.click()}><MdUploadFile /> {busy ? 'Uploading…' : 'Choose Excel file(s)'}</button>
					{busy && <div className="small muted mt-8">{busy}</div>}
					<div className="xs faint mt-8">You can pick several monthly files at once to load history. A period uploaded again replaces the earlier figures for the same locations.</div>
				</>
			) : <div className="small faint">Managers and admins can upload stock.</div>}
			{results.map((r) => (
				<div key={r.file} className="small mt-8" style={{ borderTop: '1px solid var(--line, #eee)', paddingTop: 8 }}>
					<b>{r.file}</b>: {r.ok ? <>{fmtDate(r.period.from)} to {fmtDate(r.period.to)}, {num(r.rows)} rows for {r.locations.length} location{r.locations.length > 1 ? 's' : ''}{r.replaced ? ' (replaced earlier figures for this period)' : ''}.</> : <span style={{ color: 'var(--red)' }}>{r.error}</span>}
					{r.warnings?.map((w: string) => <div key={w} className="xs" style={{ color: 'var(--amber)' }}>{w}</div>)}
				</div>
			))}
		</Card>
	);
}

function Uploads() {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const { data, isLoading } = useLocations();
	const titlesRef = useRef<HTMLInputElement>(null);
	const [form, setForm] = useState<any>(null);
	const del = useMutation({ mutationFn: ({ id, permanent }: { id: number; permanent?: boolean }) => api(`/stock/uploads/${id}${permanent ? '?permanent=1' : ''}`, { method: 'DELETE' }), onSuccess: (_r, v) => { qc.invalidateQueries(); toast(v.permanent ? 'Upload erased' : 'Upload removed. It can be restored below.'); }, onError: (e: any) => toast(e.message, 'error') });
	const restore = useMutation({ mutationFn: (id: number) => api(`/stock/uploads/${id}/restore`, { body: {} }), onSuccess: () => { qc.invalidateQueries(); toast('Upload restored'); }, onError: (e: any) => toast(e.message, 'error') });
	const fileOf = async (u: any) => {
		const res = await fetch(`/api/stock/uploads/${u.id}/file`, { headers: { authorization: `Bearer ${getToken()}` } });
		if (!res.ok) return toast('The original file is not stored for this upload', 'error');
		const a = document.createElement('a');
		a.href = URL.createObjectURL(await res.blob());
		a.download = u.file_name || 'stock.xlsx';
		a.click();
	};
	const titles = useMutation({
		mutationFn: async (f: File) => api('/stock/titles', { body: { fileName: f.name, data: await fileToBase64(f) } }),
		onSuccess: (r) => { qc.invalidateQueries(); toast(`Hindi titles saved: ${r.updated + r.added} codes${r.skipped ? `, ${r.skipped} rows skipped` : ''}`); if (titlesRef.current) titlesRef.current.value = ''; },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const save = useMutation({ mutationFn: () => api('/stock/settings', { method: 'PUT', body: { ...form, nonSalesGodowns: String(form.nonSalesGodowns || '').split('\n').map((x: string) => x.trim()).filter(Boolean) } }), onSuccess: () => { qc.invalidateQueries(); toast('Settings saved'); setForm(null); }, onError: (e: any) => toast(e.message, 'error') });
	if (isLoading || !data) return <Loader />;
	const s = data.settings;
	const active = data.uploads.filter((u: any) => !u.deleted_at);
	const removed = data.uploads.filter((u: any) => u.deleted_at);
	const f = form || { coverDays: s.coverDays, leadDays: s.leadDays, branches: s.branches, nonSalesGodowns: (s.nonSalesGodowns || []).join('\n') };
	const manager = can('manager');
	const template = async () => {
		const res = await fetch('/api/stock/titles/template', { headers: { authorization: `Bearer ${getToken()}` } });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(await res.blob());
		a.download = 'gitamail-hindi-titles.xlsx';
		a.click();
	};
	return (
		<>
			<div className="grid g-2 mb-16">
				<UploadSlot slot="hq" can={manager} title="Head office (Gorakhpur) stock" help="The Tally Stock Summary with the MAIN STOCK, RETAIL STOCK and SEMI FINISHED sheets. Main + Retail are offered to readers; semi-finished is shown to staff only." />
				<UploadSlot slot="branch" can={manager} title="Branch stock" help="The Tally Stock Summary with one sheet per branch. A branch missing from a file keeps its last uploaded stock." />
			</div>
			<div className="grid g-2 mb-16">
				<Card title="Hindi book titles" sub="Optional. Tally names are in English letters; with the Hindi titles, emails written in Devanagari match books more reliably. Hindi names are already matched by sound without this list.">
					<div className="small mb-8">{num(data.titles?.with_hindi)} of {num(data.titles?.codes)} codes have a Hindi title{data.titles?.hindi_updated ? `, last updated ${ago(data.titles.hindi_updated)}` : ''}.</div>
					<div className="row wrap gap-8">
						<button className="btn" onClick={template}><MdDownload /> Download list to fill in</button>
						{manager && <><input ref={titlesRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files?.[0] && titles.mutate(e.target.files[0])} />
							<button className="btn primary" disabled={titles.isPending} onClick={() => titlesRef.current?.click()}><MdUploadFile /> {titles.isPending ? 'Uploading…' : 'Upload Hindi titles'}</button></>}
					</div>
					<div className="xs faint mt-8">Columns: Code, English name, Hindi title, Other names (separate with ;). The download already lists every code and English name.</div>
				</Card>
				<Card title="Replenishment settings" sub="Used for Running low, Replenishment, Range and Slow movers.">
					<div className="grid g-2">
						<div className="field"><label>Days of sales a branch should hold</label><input className="input" type="number" disabled={!manager} value={f.coverDays} onChange={(e) => setForm({ ...f, coverDays: e.target.value })} /></div>
						<div className="field"><label>Days to get books from Gorakhpur</label><input className="input" type="number" disabled={!manager} value={f.leadDays} onChange={(e) => setForm({ ...f, leadDays: e.target.value })} /></div>
					</div>
					<details className="mt-8">
						<summary className="small">Different values for a branch</summary>
						<div className="table-wrap mt-8"><table className="table"><thead><tr><th>Branch</th><th>Days to hold</th><th>Lead time</th></tr></thead><tbody>
							{data.locations.filter((l: any) => !l.hq && !l.noStock).map((l: any) => (
								<tr key={l.key}><td>{l.label}</td>
									{(['coverDays', 'leadDays'] as const).map((k) => (
										<td key={k}><input className="input sm" type="number" style={{ width: 90 }} disabled={!manager} placeholder={String(k === 'coverDays' ? f.coverDays : f.leadDays)} value={f.branches?.[l.key]?.[k] ?? ''}
											onChange={(e) => setForm({ ...f, branches: { ...f.branches, [l.key]: { ...(f.branches?.[l.key] || {}), [k]: e.target.value } } })} /></td>
									))}
								</tr>
							))}
						</tbody></table></div>
					</details>
					<div className="field mt-8"><label>Branch godowns that only pass stock to the shop (one per line)</label>
						<textarea className="input" rows={3} disabled={!manager} value={f.nonSalesGodowns} placeholder="e.g. Delhi Whole Sale Location" onChange={(e) => setForm({ ...f, nonSalesGodowns: e.target.value })} />
						<span className="hint">Their outwards are not counted as sales. Godowns with "Godown" in the name are always treated this way.</span></div>
					{manager && form && <button className="btn primary mt-8" disabled={save.isPending} onClick={() => save.mutate()}>Save settings</button>}
				</Card>
			</div>
			<UploadTable title={`Uploads in use (${active.length})`} sub="Every upload is kept for trends. The latest period for each location is its current stock. The original Excel files are stored and can be downloaded."
				rows={active} actions={(u) => <>
					{u.has_file && <button className="btn ghost icon sm" title="Download the original file" aria-label="Download the original file" onClick={() => fileOf(u)}><MdDownload /></button>}
					{manager && <button className="btn ghost icon sm" title="Remove (can be restored)" aria-label="Remove upload" onClick={() => confirm('Remove this upload? Its stock and sales are taken out of the figures. You can restore it later.') && del.mutate({ id: u.id })}><MdDelete /></button>}
				</>} />
			{removed.length > 0 && (
				<details className="mt-16">
					<summary className="small">Removed and replaced uploads ({removed.length}): kept, not used in the figures</summary>
					<UploadTable rows={removed} removed actions={(u) => <>
						{u.has_file && <button className="btn ghost icon sm" title="Download the original file" aria-label="Download the original file" onClick={() => fileOf(u)}><MdDownload /></button>}
						{manager && u.deleted_reason !== 'replaced' && <button className="btn sm" onClick={() => restore.mutate(u.id)}><MdRestore /> Restore</button>}
						{can('admin') && <button className="btn ghost icon sm" title="Erase permanently" aria-label="Erase permanently" onClick={() => confirm('Erase this upload and its file permanently? This cannot be undone.') && del.mutate({ id: u.id, permanent: true })}><MdDelete /></button>}
					</>} />
				</details>
			)}
		</>
	);
}

function UploadTable({ title, sub, rows, actions, removed }: { title?: string; sub?: string; rows: any[]; actions: (u: any) => ReactNode; removed?: boolean }) {
	const { sorted, Th } = useSort<any>(rows, { key: 'period_to', dir: 'desc' }, { locations: (u) => u.locations.length });
	return (
		<Card flush title={title} sub={sub} className={removed ? 'mt-8' : ''}>
			{!rows.length ? <Empty text="Nothing uploaded yet." /> : (
				<div className="table-wrap">
					<table className="table">
						<thead><tr><Th k="period_to" num>Period</Th><Th k="scope">Type</Th><Th k="file_name">File</Th><Th k="locations" num>Locations</Th><Th k="row_count" num>Rows</Th><Th k={removed ? 'deleted_at' : 'uploaded_at'} num>{removed ? 'Removed' : 'Uploaded'}</Th><th /></tr></thead>
						<tbody>
							{sorted.map((u: any) => (
								<tr key={u.id}>
									<td className="nowrap">{fmtDate(u.period_from)} – {fmtDate(u.period_to)}</td>
									<td>{u.scope === 'hq' ? 'Head office' : 'Branches'}</td>
									<td className="small">{u.file_name}{u.warnings?.length ? <div className="xs" style={{ color: 'var(--amber)' }} title={u.warnings.join('\n')}>{u.warnings.length} note{u.warnings.length > 1 ? 's' : ''}</div> : null}</td>
									<td className="xs">{u.locations.length > 3 ? `${u.locations.length} locations` : u.locations.join(', ') || '–'}{u.replaced_locations?.length ? <div className="faint">{u.replaced_locations.length} replaced by a newer upload</div> : null}</td>
									<td className="num">{num(u.row_count)}</td>
									<td className="small nowrap">{removed ? <>{ago(u.deleted_at)}{u.deleted_by ? ` · ${u.deleted_by}` : ''}<div className="xs faint">{u.deleted_reason === 'replaced' ? 'replaced by a newer upload' : 'removed'}</div></> : <>{ago(u.uploaded_at)}{u.uploaded_by ? ` · ${u.uploaded_by}` : ''}</>}</td>
									<td className="nowrap"><div className="row gap-4" style={{ justifyContent: 'flex-end' }}>{actions(u)}</div></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</Card>
	);
}
