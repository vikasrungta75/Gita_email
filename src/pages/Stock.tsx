/**
 * Stock: Branch stock, and Main / retail / semi-finished stock at Gorakhpur. For each: a dashboard, all the
 * latest data (search, filters, sort, download), and the upload with its check summary and history.
 * Replies use the same latest stock.
 */
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MdInventory2, MdLocalShipping, MdStore, MdWarningAmber } from 'react-icons/md';
import { api } from '../api/client';
import { Card, Empty, Kpi, Loader, PageHead, Segmented } from '../components/ui';
import DataTable from '../components/DataTable';
import IndiaMap from '../components/IndiaMap';
import { BarList, KpiRow, ViewSwitch, short, shortInr } from '../components/dash';
import { LatestFor, StockSlot, UploadHistory, useUploads } from '../components/UploadParts';
import { inr, num } from '../lib/purposes';
import { COLORS, fmtDate } from '../lib/format';

const TABS = [{ v: 'branch', l: 'Branch stock' }, { v: 'hq', l: 'Main, retail and semi-finished (Gorakhpur)' }, { v: 'uploads', l: 'All stock uploads' }];

export default function Stock() {
	const [sp, setSp] = useSearchParams();
	const tab = TABS.find((t) => t.v === sp.get('tab'))?.v || 'branch';
	const view = sp.get('view') || 'dashboard';
	const scope = tab as 'branch' | 'hq';
	const up = useUploads();
	const toData = (f: Record<string, string>) => setSp({ tab, view: 'data', ...f });
	return (
		<>
			<PageHead kw="Stock" sub="The latest Tally stock for every branch and for Gorakhpur (main, retail and semi-finished). Replies, the tables and the dashboards all use the latest upload of each location." />
			<div className="row gap-12 wrap mb-16">
				<div style={{ overflowX: 'auto' }}><Segmented value={tab} options={TABS} onChange={(v) => setSp({ tab: v }, { replace: true })} /></div>
				{tab !== 'uploads' && <ViewSwitch value={view} onChange={(v) => setSp({ tab, view: v }, { replace: true })} />}
			</div>
			{tab === 'uploads' ? (up.data ? <UploadHistory history={up.data.history} kinds={['hq', 'branch']} title="All stock uploads" /> : <Loader />)
				: view === 'data' ? <DataTable name={`stock_${scope}`} />
					: view === 'upload' ? (up.data ? <><StockSlot slot={scope} /><LatestFor kind={scope} history={up.data.history} kinds={up.data.kinds} /></> : <Loader />)
						: <StockDashboard scope={scope} toData={toData} />}
		</>
	);
}

function StockDashboard({ scope, toData }: { scope: 'branch' | 'hq'; toData: (f: Record<string, string>) => void }) {
	const { data, isLoading } = useQuery({ queryKey: ['insight-stock', scope], queryFn: () => api(`/insight/stock?scope=${scope}`) });
	if (isLoading || !data) return <Loader />;
	const k = data.kpis;
	if (!k.locations) return <Card><Empty text={`No ${scope === 'hq' ? 'Gorakhpur' : 'branch'} stock uploaded yet. Upload the Tally Stock Summary under "Upload and history".`} /></Card>;
	const dates = k.oldest === k.newest ? fmtDate(k.newest) : `${fmtDate(k.oldest)} to ${fmtDate(k.newest)}`;
	const book = (r: any) => ({ k: `${r.code} · ${r.hindi || r.name}`, sub: r.hindi ? r.name : undefined });
	return (
		<div className="col gap-16">
			<KpiRow>
				{scope === 'branch' && <Kpi label="Branches" value={num(k.locations)} icon={<MdStore />} accent={COLORS.teal} foot={`stock as of ${dates}`} />}
				<Kpi label="Titles in stock" value={num(k.titles)} icon={<MdInventory2 />} accent={COLORS.blue} foot={scope === 'hq' ? 'main and retail' : 'at one branch or more'} onClick={() => toData({ 'min.closing': '1' })} />
				<Kpi label="Copies in stock" value={short(k.copies)} accent={COLORS.purple} foot={num(k.copies)} />
				<Kpi label="Stock value" value={shortInr(k.value)} accent={COLORS.green} foot={inr(k.value)} />
				<Kpi label="Copies out in the period" value={short(k.outward)} icon={<MdLocalShipping />} accent={COLORS.amber} foot={`${short(k.inward)} came in`} onClick={() => toData({ sort: 'outward', dir: 'desc' })} />
				{scope === 'hq' && <Kpi label="Semi-finished" value={short(k.semi)} accent={COLORS.general} foot="copies in making (not offered)" onClick={() => toData({ 'f.kind': 'Semi-finished' })} />}
				{scope === 'hq' && <Kpi label="Suchi titles not in stock" value={num(k.missing)} icon={<MdWarningAmber />} accent={COLORS.red} foot={`${num(k.missingBest)} of them best sellers`} />}
				<Kpi label="Codes not in the Suchi" value={num(k.notInSuchi)} accent={COLORS.general} foot="in stock but not in the book list" />
			</KpiRow>

			{scope === 'branch' ? (
				<div className="grid g-2">
					<Card title="Stock by branch" sub="Copies in stock; select a branch for its rows" flush>
						<BarList head="Copies" extraHeads={['Titles', 'Value', 'Out', 'As of']} rows={data.byLocation.map((r: any) => ({ k: r.k, sub: r.state, n: r.copies, extra: [num(r.titles), shortInr(r.value), num(r.outward), fmtDate(r.as_of)], on: () => toData({ 'f.location': r.k }) }))} height={440} />
					</Card>
					<Card title="Branch stock by state" sub="Copies at the branches in each state; select a state for its rows">
						<IndiaMap values={Object.fromEntries(data.byState.map((r: any) => [r.k, r.n]))} label="Copies" format={short} height={400}
							detail={(s) => { const r = data.byState.find((x: any) => x.k === s); return r ? [`${r.locations} branch${r.locations > 1 ? 'es' : ''}`] : []; }}
							onSelect={(s) => s && toData({ 'f.state': s })} />
					</Card>
				</div>
			) : (
				<Card title="Main, retail and semi-finished" sub="Main and retail are offered to readers; semi-finished books are still being made" flush>
					<BarList head="Copies" extraHeads={['Titles', 'Value', 'Out']} rows={data.byKind.map((r: any) => ({ k: r.k, n: r.copies, extra: [num(r.titles), shortInr(r.value), num(r.outward)], on: () => toData({ 'f.kind': r.k }) }))} height={220} />
				</Card>
			)}

			<div className="grid g-2">
				<Card title="Moving most" sub="Copies out in the period, all locations together; select a book for its rows" flush>
					<BarList head="Out" share={false} extraHeads={['In stock']} rows={data.topOut.map((r: any) => ({ ...book(r), n: r.outward, extra: [num(r.closing)], on: () => toData({ q: r.code }) }))} height={420} />
				</Card>
				<Card title="May run out" sub="Moving books with less stock left than went out in the period" flush>
					{!data.runningOut.length ? <Empty text="No moving book is below one period of stock." /> : (
						<BarList head="Out" share={false} extraHeads={['In stock', 'Periods left']} rows={data.runningOut.map((r: any) => ({ ...book(r), n: r.outward, extra: [num(r.closing), r.cover.toFixed(1)], on: () => toData({ q: r.code }) }))} height={420} />
					)}
				</Card>
			</div>

			{scope === 'hq' && (
				<Card title="Best sellers with no stock at Gorakhpur" sub="In the Suchi as best sellers, with nothing in main or retail stock. Semi-finished shows copies being made." flush>
					{!data.missingBest.length ? <Empty text="Every best seller has stock." /> : (
						<div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table className="table">
							<thead><tr><th>Code</th><th>Book</th><th className="num">Price</th><th className="num">Semi-finished</th></tr></thead>
							<tbody>{data.missingBest.map((r: any) => <tr key={r.code}><td className="mono small">{r.code}</td><td className="small">{r.hindi || r.name}{r.hindi && <div className="xs faint">{r.name}</div>}</td><td className="num small">{inr(r.price)}</td><td className="num small">{r.semi ? num(r.semi) : <span className="faint">–</span>}</td></tr>)}</tbody>
						</table></div>
					)}
				</Card>
			)}

			<div className="grid g-2">
				<Card title="By language" flush><BarList head="Copies" extraHeads={['Titles']} rows={data.byLanguage.map((r: any) => ({ k: r.k, n: r.copies, extra: [num(r.titles)], on: () => toData({ 'f.language': r.k }) }))} /></Card>
				<Card title="By size (from the Suchi)" flush><BarList head="Copies" extraHeads={['Titles']} rows={data.bySize.map((r: any) => ({ k: r.k, n: r.copies, extra: [num(r.titles)], on: () => toData(r.k === 'Not in the Suchi' ? { 'f.size': '(blank)' } : { 'f.size': r.k }) }))} /></Card>
			</div>
		</div>
	);
}
