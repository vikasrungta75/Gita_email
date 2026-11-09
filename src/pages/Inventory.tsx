import { useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { MdDelete, MdDownload, MdSearch, MdUploadFile } from 'react-icons/md';
import { api, getToken, qs } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import Chart from '../components/Chart';
import { Card, Empty, Kpi, Loader, PageHead, Segmented, Sparkline, Story } from '../components/ui';
import { COLORS, ago, fmtDate } from '../lib/format';
import { fileToBase64, inr, num } from '../lib/purposes';

const TABS = [
	{ v: 'overview', l: 'Overview' }, { v: 'stock', l: 'Stock status' }, { v: 'top', l: 'Top sellers' }, { v: 'replenish', l: 'Replenishment' },
	{ v: 'range', l: 'Range per branch' }, { v: 'slow', l: 'Slow movers' }, { v: 'demand', l: 'Demand and cross-sell' }, { v: 'uploads', l: 'Uploads and settings' },
] as const;
type Tab = (typeof TABS)[number]['v'];

/** Long lists show the first rows on screen; Excel has them all. */
const SHOW = 200;
const More = ({ total }: { total: number }) => (total > SHOW ? <div className="xs faint" style={{ padding: '8px 20px' }}>Showing the first {SHOW} of {total.toLocaleString('en-IN')}; download Excel for the full list.</div> : null);

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
	const setTab = (t: Tab) => setSp({ tab: t }, { replace: true });
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
			<Card flush title="Branches" actions={<ExcelBtn path="/inventory/overview" name="branch-summary" />}>
				<div className="table-wrap">
					<table className="table">
						<thead><tr><th>Location</th><th>Stock as of</th><th className="num">Copies</th><th className="num">Value</th><th className="num">Titles</th><th className="num">Sales a day</th><th className="num">Days of cover</th><th className="num">Running low</th><th className="num">Selling, out of stock</th><th>Monthly sales</th></tr></thead>
						<tbody>
							{data.branches.map((b: any) => (
								<tr key={b.key}>
									<td><b>{b.label}</b>{b.key === 'gorakhpur' && <div className="xs faint">head office</div>}</td>
									<td className="small nowrap">{b.asOf ? fmtDate(b.asOf) : <span className="faint">not uploaded</span>}</td>
									<td className="num">{num(b.qty)}</td>
									<td className="num small">{inr(b.value)}</td>
									<td className="num">{num(b.titles)}</td>
									<td className="num">{num(b.salesPerDay)}<div className="xs faint">{b.salesDays} days</div></td>
									<td className="num">{b.cover === null ? '–' : num(b.cover)}</td>
									<td className="num">{b.lowTitles === null ? <span className="faint">–</span> : b.lowTitles ? <Link to={`/inventory?tab=stock&location=${b.key}&status=low`}>{b.lowTitles}</Link> : 0}</td>
									<td className="num">{b.outTitles === null ? <span className="faint">–</span> : b.outTitles ? <Link to={`/inventory?tab=stock&location=${b.key}&status=out`}>{b.outTitles}</Link> : 0}</td>
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

// ── Stock status ──────────────────────────────────────────────────────────

const STATUS: Record<string, [string, string]> = {
	out_selling: ['Out of stock, selling', 'red'], out: ['Out of stock', ''], low: ['Running low', 'amber'], over: ['Overstocked', 'amber'], no_sales: ['No sales', ''], ok: ['OK', 'green'],
};
function StockStatus() {
	const [sp] = useSearchParams();
	const [f, setF] = useState({ location: sp.get('location') || 'gorakhpur', status: sp.get('status') || '', language: '', q: '' });
	const [search, setSearch] = useState('');
	const { data, isFetching } = useQuery({ queryKey: ['inv-stock', f], queryFn: () => api(`/inventory/stock${qs(f)}`), placeholderData: keepPreviousData });
	const langs = useQuery({ queryKey: ['inv-top-langs'], queryFn: () => api('/inventory/top?limit=1') });
	return (
		<Card flush title={data ? `${data.label}: ${num(data.total)} titles` : 'Stock'} sub={data && <>Stock as of {data.asOf ? fmtDate(data.asOf) : 'not uploaded'}; sales over the latest {data.salesDays} days.{!data.enough && ` Status needs at least ${data.minDays} days of sales data.`}</>}
			actions={<ExcelBtn path="/inventory/stock" params={f} name={`stock-${f.location}`} />}>
			<div className="filter-strip wrap" style={{ padding: '12px 20px' }}>
				<LocationSelect value={f.location} onChange={(v) => setF({ ...f, location: v })} />
				<select className={`input sm drop ${f.status ? 'on' : ''}`} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
					<option value="">Any status</option>
					{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}{data?.counts?.[k] ? ` (${data.counts[k]})` : ''}</option>)}
				</select>
				<select className={`input sm drop ${f.language ? 'on' : ''}`} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} aria-label="Language">
					<option value="">Any language</option>
					{(langs.data?.languages || []).map((l: any) => <option key={l.language} value={l.language}>{l.language}</option>)}
				</select>
				<div className="search-box"><MdSearch /><input className="input sm" placeholder="Code or title" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setF({ ...f, q: search })} onBlur={() => setF({ ...f, q: search })} aria-label="Search titles" /></div>
				{isFetching && <span className="xs faint">updating</span>}
			</div>
			{!data ? <Loader /> : !data.rows.length ? <Empty text="No titles match." /> : (
				<div className="table-wrap">
					<table className="table">
						<thead><tr><th>Title</th><th>Language</th><th className="num">In stock</th>{f.location === 'gorakhpur' && <th className="num">Semi-finished</th>}<th className="num">Price</th><th className="num">Value</th><th className="num">Sold</th><th className="num">Per month</th><th className="num">Days of cover</th><th>Status</th></tr></thead>
						<tbody>
							{data.rows.map((r: any) => (
								<tr key={r.code}>
									<td style={{ maxWidth: 320 }}><b className="truncate" style={{ display: 'block' }}>{r.name}</b><div className="xs faint">Code {r.code}{r.hindi ? ` · ${r.hindi}` : ''}</div></td>
									<td className="small">{r.language}</td>
									<td className="num">{num(r.qty)}</td>
									{f.location === 'gorakhpur' && <td className="num">{r.semi ? num(r.semi) : <span className="faint">–</span>}</td>}
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
			{data && data.total > data.rows.length && <div className="xs faint" style={{ padding: '8px 20px' }}>Showing {num(data.rows.length)} of {num(data.total)}; download Excel for all.</div>}
		</Card>
	);
}

// ── Top sellers ───────────────────────────────────────────────────────────

function TopSellers() {
	const [f, setF] = useState({ location: '', language: '', months: '' });
	const { data } = useQuery({ queryKey: ['inv-top', f], queryFn: () => api(`/inventory/top${qs(f)}`), placeholderData: keepPreviousData });
	if (!data) return <Loader />;
	const langs = data.languages.slice(0, 10);
	return (
		<div className="grid g-2-1">
			<Card flush title="Top sellers" sub={`Copies sold${data.months.length ? `, ${monthLabel(data.months[0])} to ${monthLabel(data.months[data.months.length - 1])}` : ''}`} actions={<ExcelBtn path="/inventory/top" params={f} name="top-sellers" />}>
				<div className="filter-strip wrap" style={{ padding: '12px 20px' }}>
					<LocationSelect value={f.location} onChange={(v) => setF({ ...f, location: v })} all="All locations" />
					<select className={`input sm drop ${f.language ? 'on' : ''}`} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} aria-label="Language">
						<option value="">Any language</option>{data.languages.map((l: any) => <option key={l.language} value={l.language}>{l.language}</option>)}
					</select>
					<select className={`input sm drop ${f.months ? 'on' : ''}`} value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} aria-label="Period">
						<option value="">All uploaded months</option><option value="1">Latest month</option><option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option>
					</select>
				</div>
				{!data.rows.length ? <Empty text="No sales in this period." /> : (
					<div className="table-wrap">
						<table className="table">
							<thead><tr><th>#</th><th>Title</th><th className="num">Copies sold</th><th className="num">Value</th><th>Where it sells</th><th>Trend</th><th className="num">Gorakhpur stock</th></tr></thead>
							<tbody>
								{data.rows.map((r: any, i: number) => (
									<tr key={r.code}>
										<td className="faint">{i + 1}</td>
										<td style={{ maxWidth: 280 }}><b className="truncate" style={{ display: 'block' }}>{r.name}</b><div className="xs faint">Code {r.code} · {r.language} · {inr(r.price)}</div></td>
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
			</Card>
			<Card title="Sales by language" sub="Copies sold in the same period" accent={COLORS.purple}>
				{langs.length ? (
					<Chart type="bar" height={Math.max(220, langs.length * 26 + 40)} series={[{ name: 'Copies sold', data: langs.map((l: any) => l.qty) }]}
						options={{ colors: [COLORS.purple], plotOptions: { bar: { horizontal: true, borderRadius: 4, borderRadiusApplication: 'end', barHeight: '62%' } }, xaxis: { categories: langs.map((l: any) => l.language), labels: { formatter: (v: any) => num(Math.round(Number(v))) } }, tooltip: { y: { formatter: (v: number) => `${num(v)} copies` } } }} />
				) : <Empty text="No sales yet" />}
			</Card>
		</div>
	);
}

// ── Replenishment ─────────────────────────────────────────────────────────

function Replenish() {
	const [location, setLocation] = useState('');
	const { data } = useQuery({ queryKey: ['inv-repl', location], queryFn: () => api(`/inventory/replenishment${qs({ location })}`), placeholderData: keepPreviousData });
	if (!data) return <Loader />;
	return (
		<>
			<Story head={<>{num(data.total)} titles at {data.byLocation.length} branches will run out before new stock can arrive from Gorakhpur.</>}
				points={[<>A title is flagged when its stock covers fewer than {data.settings.leadDays} days of sales; the suggested quantity brings it to {data.settings.coverDays} days, adjusted for the season once 12 months are uploaded. Change these in Uploads and settings.</>,
					...data.byLocation.slice(0, 3).map((b: any) => <>{b.label}: {num(b.titles)} titles, {num(b.copies)} copies ({inr(b.value)}).</>)]} />
			<Card flush title="What to send" actions={<ExcelBtn path="/inventory/replenishment" params={{ location }} name="replenishment" />}>
				<div className="filter-strip wrap" style={{ padding: '12px 20px' }}><LocationSelect value={location} onChange={setLocation} all="All branches" branchesOnly /></div>
				<div style={{ padding: '0 20px' }}><Short list={data.short} min={data.minDays} /></div>
				{!data.rows.length ? <Empty text="Nothing needs sending yet." /> : (
					<div className="table-wrap">
						<table className="table">
							<thead><tr><th>Branch</th><th>Title</th><th className="num">In stock</th><th className="num">Sells a month</th><th className="num">Days left</th><th className="num">Send</th><th className="num">Gorakhpur has</th><th>Urgency</th></tr></thead>
							<tbody>
								{data.rows.slice(0, SHOW).map((r: any) => (
									<tr key={`${r.location}-${r.code}`}>
										<td className="nowrap"><b>{r.label}</b></td>
										<td style={{ maxWidth: 300 }}><span className="truncate" style={{ display: 'block' }}>{r.name}</span><div className="xs faint">Code {r.code} · {r.language}{r.season !== 1 ? ` · season ×${r.season}` : ''}</div></td>
										<td className="num">{num(r.qty)}</td>
										<td className="num">{num(r.perMonth)}</td>
										<td className="num">{num(r.cover)}</td>
										<td className="num"><b>{num(r.send)}</b></td>
										<td className="num">{num(r.hqQty)}{r.hqQty < r.send && <div className="xs" style={{ color: 'var(--amber)' }}>short by {num(r.send - r.hqQty)}</div>}</td>
										<td><span className={`badge ${r.urgency === 'out' ? 'red' : r.urgency === 'urgent' ? 'amber' : ''}`}>{r.urgency === 'out' ? 'Out of stock' : r.urgency === 'urgent' ? 'Urgent' : 'Soon'}</span></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<More total={data.total} />
			</Card>
		</>
	);
}

function RangeGaps() {
	const [location, setLocation] = useState('');
	const { data } = useQuery({ queryKey: ['inv-range', location], queryFn: () => api(`/inventory/range${qs({ location })}`), placeholderData: keepPreviousData });
	if (!data) return <Loader />;
	return (
		<Card flush title="Books a branch should stock" sub="Titles that sell well at branches with a similar language mix, in a language the branch sells, but which this branch neither stocks nor sells." actions={<ExcelBtn path="/inventory/range" params={{ location }} name="range-gaps" />}>
			<div className="filter-strip wrap" style={{ padding: '12px 20px' }}><LocationSelect value={location} onChange={setLocation} all="All branches" branchesOnly /></div>
			<div style={{ padding: '0 20px' }}><Short list={data.short} min={data.minDays} /></div>
			{!data.rows.length ? <Empty text="No gaps found yet. This needs at least a month of sales for several branches." /> : (
				<div className="table-wrap">
					<table className="table">
						<thead><tr><th>Branch</th><th>Title</th><th className="num">Expected a month</th><th>Sells at</th><th className="num">Gorakhpur has</th><th className="num">Price</th></tr></thead>
						<tbody>
							{data.rows.slice(0, SHOW).map((r: any) => (
								<tr key={`${r.location}-${r.code}`}>
									<td><b>{r.label}</b></td>
									<td style={{ maxWidth: 300 }}><span className="truncate" style={{ display: 'block' }}>{r.name}</span><div className="xs faint">Code {r.code} · {r.language}</div></td>
									<td className="num"><b>{num(r.expectedPerMonth)}</b></td>
									<td className="xs">{r.sellsAt.join(', ')}</td>
									<td className="num">{num(r.hqQty)}</td>
									<td className="num small">{inr(r.price)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<More total={data.total} />
		</Card>
	);
}

function SlowMovers() {
	const [location, setLocation] = useState('');
	const { data } = useQuery({ queryKey: ['inv-slow', location], queryFn: () => api(`/inventory/slow${qs({ location })}`), placeholderData: keepPreviousData });
	if (!data) return <Loader />;
	return (
		<Card flush title="Slow movers" sub="Stock that would last more than three times the target cover at the current sales rate, or has not sold at all. Where another branch sells the title and is short, a transfer is suggested." actions={<ExcelBtn path="/inventory/slow" params={{ location }} name="slow-movers" />}>
			<div className="filter-strip wrap" style={{ padding: '12px 20px' }}><LocationSelect value={location} onChange={setLocation} all="All branches" branchesOnly /></div>
			<div style={{ padding: '0 20px' }}><Short list={data.short} min={data.minDays} /></div>
			{!data.rows.length ? <Empty text="No slow movers found (needs at least a month of sales data)." /> : (
				<div className="table-wrap">
					<table className="table">
						<thead><tr><th>Branch</th><th>Title</th><th className="num">In stock</th><th className="num">Value</th><th className="num">Sells a month</th><th className="num">Days of cover</th><th>Suggested transfer</th></tr></thead>
						<tbody>
							{data.rows.slice(0, SHOW).map((r: any) => (
								<tr key={`${r.location}-${r.code}`}>
									<td><b>{r.label}</b></td>
									<td style={{ maxWidth: 300 }}><span className="truncate" style={{ display: 'block' }}>{r.name}</span><div className="xs faint">Code {r.code} · {r.language}</div></td>
									<td className="num">{num(r.qty)}</td>
									<td className="num small">{inr(r.value)}</td>
									<td className="num">{r.noSales ? <span className="faint">none</span> : num(r.perMonth)}</td>
									<td className="num">{r.cover === null ? '–' : num(r.cover)}</td>
									<td className="small">{r.moveTo ? <>{num(r.moveTo.qty)} to <b>{r.moveTo.label}</b> <span className="xs faint">(sells {num(r.moveTo.perMonth)} a month)</span></> : <span className="faint">–</span>}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<More total={data.total} />
		</Card>
	);
}

// ── Demand from emails and cross-sell ─────────────────────────────────────

function Demand() {
	const d = useQuery({ queryKey: ['inv-demand'], queryFn: () => api('/inventory/demand') });
	const x = useQuery({ queryKey: ['inv-xsell'], queryFn: () => api('/inventory/cross-sell') });
	const link = (s: any) => `/admin/customers${qs({ purposes: s.has, purposeMode: s.has.length > 1 ? 'all' : undefined, not: s.not || [] })}`;
	return (
		<>
			<Card title="Cross-sell and upsell" sub="Groups of readers and customers from their reasons for contacting. Open a group to see the people and download them to Excel." accent={COLORS.pink} className="mb-16">
				{!x.data ? <Loader /> : (
					<div className="table-wrap">
						<table className="table">
							<thead><tr><th>Group</th><th>Suggested offer</th><th className="num">People</th></tr></thead>
							<tbody>
								{x.data.segments.map((s: any) => (
									<tr key={s.id}>
										<td><b>{s.label}</b><div className="xs faint">Contacted for {s.hasLabels.join(' and ')}{s.notLabels.length ? `; never for ${s.notLabels.join(', ')}` : ''}</div></td>
										<td className="small">{s.pitch}</td>
										<td className="num">{s.n ? <Link to={link(s)}><b>{num(s.n)}</b></Link> : 0}</td>
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
			<div className="grid g-2">
				<Card flush title="Books readers ask for" sub="Books named or quoted by code in emails over the last year, matched to Tally stock.">
					{!d.data ? <Loader /> : !d.data.unmet.length ? <Empty text="No book requests recorded yet. They are collected as emails are analysed." /> : (
						<div className="table-wrap">
							<table className="table">
								<thead><tr><th>Book</th><th className="num">Requests</th><th className="num">Out at Gorakhpur then</th><th className="num">Gorakhpur now</th><th>Nearest branches now</th></tr></thead>
								<tbody>
									{d.data.unmet.map((r: any) => (
										<tr key={r.code}>
											<td style={{ maxWidth: 260 }}><span className="truncate" style={{ display: 'block' }}>{r.name}</span><div className="xs faint">Code {r.code} · {r.language} · last {ago(r.last)}</div></td>
											<td className="num"><b>{num(r.requests)}</b><div className="xs faint">{num(r.customers)} people</div></td>
											<td className="num">{r.out_at_hq ? <span style={{ color: 'var(--red)' }}>{num(r.out_at_hq)}</span> : 0}</td>
											<td className="num">{num(r.hqQty)}</td>
											<td className="xs">{r.nearest.map((n: any) => `${n.label} ${num(n.qty)}`).join(' · ') || '–'}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Card>
				<Card flush title="Back in stock: tell these readers" sub="They asked when the book was out of stock at Gorakhpur; it is in stock now." actions={<ExcelBtn path="/inventory/demand" name="back-in-stock" />}>
					{!d.data ? <Loader /> : !d.data.backInStock.length ? <Empty text="Nobody is waiting for a book that is back in stock." /> : (
						<div className="table-wrap">
							<table className="table">
								<thead><tr><th>Reader</th><th>Book</th><th>Asked</th><th className="num">In stock now</th></tr></thead>
								<tbody>
									{d.data.backInStock.map((r: any) => (
										<tr key={`${r.conversation_id}-${r.code}`}>
											<td className="small"><Link to={`/conversations/${r.conversation_id}`}>{r.name}</Link><div className="xs faint">{r.email}</div></td>
											<td className="small">{r.bookName}<div className="xs faint">Code {r.code}</div></td>
											<td className="small nowrap">{fmtDate(r.requested_at)}</td>
											<td className="num">{num(r.hqQty)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Card>
			</div>
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
	const del = useMutation({ mutationFn: (id: number) => api(`/stock/uploads/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries(); toast('Upload removed'); }, onError: (e: any) => toast(e.message, 'error') });
	const titles = useMutation({
		mutationFn: async (f: File) => api('/stock/titles', { body: { fileName: f.name, data: await fileToBase64(f) } }),
		onSuccess: (r) => { qc.invalidateQueries(); toast(`Hindi titles saved: ${r.updated + r.added} codes${r.skipped ? `, ${r.skipped} rows skipped` : ''}`); if (titlesRef.current) titlesRef.current.value = ''; },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const save = useMutation({ mutationFn: () => api('/stock/settings', { method: 'PUT', body: { ...form, nonSalesGodowns: String(form.nonSalesGodowns || '').split('\n').map((x: string) => x.trim()).filter(Boolean) } }), onSuccess: () => { qc.invalidateQueries(); toast('Settings saved'); setForm(null); }, onError: (e: any) => toast(e.message, 'error') });
	if (isLoading || !data) return <Loader />;
	const s = data.settings;
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
			<Card flush title={`Uploads (${data.uploads.length})`} sub="Every upload is kept for trends. The latest period for each location is its current stock.">
				{!data.uploads.length ? <Empty text="Nothing uploaded yet." /> : (
					<div className="table-wrap">
						<table className="table">
							<thead><tr><th>Period</th><th>Type</th><th>File</th><th>Locations</th><th className="num">Rows</th><th>Uploaded</th><th /></tr></thead>
							<tbody>
								{data.uploads.map((u: any) => (
									<tr key={u.id}>
										<td className="nowrap">{fmtDate(u.period_from)} – {fmtDate(u.period_to)}</td>
										<td>{u.scope === 'hq' ? 'Head office' : 'Branches'}</td>
										<td className="small">{u.file_name}{u.warnings?.length ? <div className="xs" style={{ color: 'var(--amber)' }} title={u.warnings.join('\n')}>{u.warnings.length} note{u.warnings.length > 1 ? 's' : ''}</div> : null}</td>
										<td className="xs">{u.locations.length > 3 ? `${u.locations.length} locations` : u.locations.join(', ')}</td>
										<td className="num">{num(u.row_count)}</td>
										<td className="small nowrap">{ago(u.uploaded_at)}{u.uploaded_by ? ` · ${u.uploaded_by}` : ''}</td>
										<td>{manager && <button className="btn ghost icon sm" aria-label="Remove upload" onClick={() => confirm('Remove this upload? Its stock and sales are taken out of the figures.') && del.mutate(u.id)}><MdDelete /></button>}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Card>
		</>
	);
}
