/**
 * Tracking: Book orders (the Gita Press orders export) and Kalyan tracking (the dispatch file). For each: a
 * dashboard, all the data (search, filters, sort, download), and the upload with its check summary and history.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MdLocalShipping, MdMarkunread, MdPeople, MdReceiptLong, MdWarningAmber } from 'react-icons/md';
import { api } from '../api/client';
import { Card, Empty, Kpi, Loader, PageHead, Segmented } from '../components/ui';
import Chart from '../components/Chart';
import DataTable from '../components/DataTable';
import IndiaMap from '../components/IndiaMap';
import { BarList, KpiRow, ViewSwitch, pct, short, shortInr } from '../components/dash';
import { BatchSlot, LatestFor, UploadHistory, useUploads } from '../components/UploadParts';
import { inr, num } from '../lib/purposes';
import { COLORS, fmtDate } from '../lib/format';

const TABS = [{ v: 'orders', l: 'Book orders' }, { v: 'kalyan', l: 'Kalyan tracking' }, { v: 'uploads', l: 'All tracking uploads' }];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SUB: Record<string, string> = { '1Y': '1 year', FY: '5 years', LM: 'Life member' };

export default function Tracking() {
	const [sp, setSp] = useSearchParams();
	const tab = TABS.find((t) => t.v === sp.get('tab'))?.v || 'orders';
	const view = sp.get('view') || 'dashboard';
	const up = useUploads();
	const toData = (f: Record<string, string>) => setSp({ tab, view: 'data', ...f });
	return (
		<>
			<PageHead kw="Tracking" sub="Book orders and Kalyan dispatches from the uploads: status, tracking numbers and delivery partners. Replies use the same data to answer where an order or a Kalyan issue is." />
			<div className="row gap-12 wrap mb-16">
				<Segmented value={tab} options={TABS} onChange={(v) => setSp({ tab: v }, { replace: true })} />
				{tab !== 'uploads' && <ViewSwitch value={view} onChange={(v) => setSp({ tab, view: v }, { replace: true })} />}
			</div>
			{tab === 'uploads' ? (up.data ? <UploadHistory history={up.data.history} kinds={['orders', 'kalyan']} title="All tracking uploads" /> : <Loader />)
				: view === 'data' ? <DataTable name={tab === 'orders' ? 'orders' : 'kalyan_dispatch'} />
					: view === 'upload' ? (up.data ? <><BatchSlot kind={tab} active={up.data.active} /><LatestFor kind={tab} history={up.data.history} kinds={up.data.kinds} /></> : <Loader />)
						: tab === 'orders' ? <OrdersDashboard toData={toData} /> : <DispatchDashboard toData={toData} />}
		</>
	);
}

const PERIODS = [{ v: '7', l: 'Last 7 days' }, { v: '30', l: 'Last 30 days' }, { v: '90', l: 'Last 90 days' }, { v: '365', l: 'Last year' }, { v: '', l: 'All' }];

function OrdersDashboard({ toData }: { toData: (f: Record<string, string>) => void }) {
	const [days, setDays] = useState('');
	const [metric, setMetric] = useState<'n' | 'amount'>('n');
	const { data, isLoading } = useQuery({ queryKey: ['insight-orders', days], queryFn: () => api(`/insight/orders${days ? `?days=${days}` : ''}`) });
	if (isLoading || !data) return <Loader />;
	const k = data.kpis;
	if (!k.orders && !days) return <Card><Empty text='No book orders uploaded yet. Upload the orders export under "Upload and history".' /></Card>;
	const fromDate = days && k.last ? new Date(new Date(k.last).getTime() - Number(days) * 86400_000).toISOString().slice(0, 10) : '';
	const inPeriod = (f: Record<string, string>) => toData(fromDate ? { ...f, 'min.ordered_at': fromDate } : f);
	const open = data.open.reduce((a: number, r: any) => a + r.n, 0);
	const money = (v: number) => (metric === 'amount' ? shortInr(v) : num(v));
	const repeatBuyers = (data.repeat?.twice || 0) + (data.repeat?.more || 0);
	const label = (d: string) => (data.unit === 'month' ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}` : fmtDate(d).replace(/ \d{4}$/, ''));
	return (
		<div className="col gap-16">
			<div className="row-between wrap gap-8">
				<div className="small faint">{k.first ? <>Orders from <b>{fmtDate(k.first)}</b> to <b>{fmtDate(k.last)}</b>. Select a figure or a row to open the orders behind it.</> : 'No orders in this period.'}</div>
				<Segmented value={days} options={PERIODS} onChange={setDays} />
			</div>
			<KpiRow>
				<Kpi label="Orders" value={num(k.orders)} icon={<MdReceiptLong />} accent={COLORS.blue} onClick={() => inPeriod({})} />
				<Kpi label="Order value" value={shortInr(k.amount)} accent={COLORS.green} foot={inr(k.amount)} />
				<Kpi label="Average order" value={inr(Math.round(k.avg))} accent={COLORS.teal} foot={`postage ${pct(k.postage, k.amount)} of value`} />
				<Kpi label="Buyers" value={num(k.buyers)} icon={<MdPeople />} accent={COLORS.purple} foot={`${num(repeatBuyers)} ordered more than once`} />
				<Kpi label="Not marked delivered" value={num(open)} icon={<MdLocalShipping />} accent={COLORS.amber} foot="latest status is not delivered, cancelled or returned" />
				<Kpi label="Damaged tracking numbers" value={num(k.damaged_tracking)} icon={<MdWarningAmber />} accent={COLORS.red} foot="e.g. 5.0E+12 from Excel" onClick={() => inPeriod({ 'f.tracking_ok': 'false' })} />
			</KpiRow>
			<Card title={`Orders by ${data.unit}`} actions={<Segmented value={metric} options={[{ v: 'n', l: 'Orders' }, { v: 'amount', l: 'Value' }]} onChange={setMetric as any} />}>
				{!data.timeline.length ? <Empty text="No orders in this period." /> : <Chart type="bar" height={260}
					options={{ xaxis: { categories: data.timeline.map((r: any) => label(r.k)), labels: { rotate: -45, hideOverlappingLabels: true } }, colors: [metric === 'n' ? COLORS.blue : COLORS.green], plotOptions: { bar: { columnWidth: '70%', borderRadius: 3 } }, yaxis: { labels: { formatter: (v: number) => money(v) } }, tooltip: { y: { formatter: (v: number) => (metric === 'amount' ? inr(v) : num(v)) } } }}
					series={[{ name: metric === 'n' ? 'Orders' : 'Order value', data: data.timeline.map((r: any) => (metric === 'n' ? r.n : Math.round(r.amount))) }]} />}
			</Card>
			<div className="grid g-2">
				<Card title="Where orders go" sub={`${metric === 'n' ? 'Orders' : 'Order value'} by state, from the delivery PIN code; select a state for its orders`}>
					<IndiaMap values={Object.fromEntries(data.byState.map((r: any) => [r.k, metric === 'n' ? r.n : r.amount]))} label={metric === 'n' ? 'Orders' : 'Order value'} format={metric === 'n' ? short : shortInr}
						detail={(s) => { const r = data.byState.find((x: any) => x.k === s); return r ? [`${num(r.n)} orders · ${inr(r.amount)}`] : []; }}
						onSelect={(s) => s && inPeriod({ 'f.state': s })} height={430} />
				</Card>
				<Card title="Top states and cities" flush>
					<BarList head="Orders" extraHeads={['Value']} rows={data.byState.map((r: any) => ({ k: r.k, n: r.n, extra: [shortInr(r.amount)], on: () => inPeriod({ 'f.state': r.k }) }))} height={240} />
					<BarList head="Orders" extraHeads={['Value']} share={false} rows={data.byCity.map((r: any) => ({ k: r.k, n: r.n, extra: [shortInr(r.amount)], on: () => inPeriod({ q: r.k }) }))} height={240} />
				</Card>
			</div>
			<div className="grid g-3">
				<Card title="Status" flush><BarList head="Orders" rows={data.byStatus.map((r: any) => ({ k: r.k, n: r.n, on: () => inPeriod({ 'f.status': r.k }) }))} height={260} /></Card>
				<Card title="Delivery partner" flush><BarList head="Orders" extraHeads={['Value']} rows={data.byPartner.map((r: any) => ({ k: r.k, n: r.n, extra: [shortInr(r.amount)], on: () => inPeriod({ 'f.partner': r.k === 'Not stated' ? '(blank)' : r.k }) }))} height={260} /></Card>
				<Card title="Not marked delivered, by days since the order" flush><BarList head="Orders" rows={data.open.map((r: any, i: number) => ({ k: r.k, n: r.n, on: () => inPeriod({ 'min.age_days': String([0, 8, 16, 31][i]) }) }))} height={260} empty="Every order is delivered." /></Card>
			</div>
			<div className="grid g-3">
				<Card title="Payment" flush><BarList head="Orders" extraHeads={['Value']} rows={data.byPayment.map((r: any) => ({ k: r.k, n: r.n, extra: [shortInr(r.amount)], on: () => inPeriod({ 'f.payment_method': r.k }) }))} height={240} /></Card>
				<Card title="Site" flush><BarList head="Orders" extraHeads={['Value']} rows={data.bySite.map((r: any) => ({ k: r.k, n: r.n, extra: [shortInr(r.amount)], on: () => inPeriod({ 'f.site': r.k }) }))} height={240} /></Card>
				<Card title="Order value" flush><BarList head="Orders" rows={data.bands.map((r: any) => ({ k: r.k, n: r.n }))} height={240} /></Card>
			</div>
			<Card title="Orders by day of the week">
				<Chart type="bar" height={200} options={{ xaxis: { categories: WEEKDAYS }, colors: [COLORS.blue], plotOptions: { bar: { columnWidth: '50%', borderRadius: 3 } } }}
					series={[{ name: 'Orders', data: WEEKDAYS.map((_, i) => data.weekday.find((w: any) => w.d === i + 1)?.n || 0) }]} />
			</Card>
		</div>
	);
}

function DispatchDashboard({ toData }: { toData: (f: Record<string, string>) => void }) {
	const [metric, setMetric] = useState<'n' | 'registered_pct'>('n');
	const { data, isLoading } = useQuery({ queryKey: ['insight-dispatch'], queryFn: () => api('/insight/kalyan-dispatch') });
	if (isLoading || !data) return <Loader />;
	const k = data.kpis;
	if (!k.dispatches) return <Card><Empty text='No Kalyan dispatches uploaded yet. Upload the dispatch file under "Upload and history".' /></Card>;
	const issueLabel = (r: any) => `Issue ${r.issue} · ${MONTHS[Number(r.month.slice(5, 7)) - 1]} ${r.month.slice(0, 4)}`;
	const latest = data.issues[data.issues.length - 1];
	return (
		<div className="col gap-16">
			<div className="small faint">Dispatches from <b>{fmtDate(k.first)}</b> to <b>{fmtDate(k.last)}</b>. Select a figure or a row to open the dispatches behind it.</div>
			<KpiRow>
				<Kpi label="Dispatches" value={short(k.dispatches)} icon={<MdMarkunread />} accent={COLORS.blue} foot={num(k.dispatches)} onClick={() => toData({})} />
				<Kpi label="Readers sent to" value={short(k.customers)} icon={<MdPeople />} accent={COLORS.purple} foot={num(k.customers)} />
				<Kpi label="Registered post" value={pct(k.registered, k.dispatches)} accent={COLORS.teal} foot={`${short(k.registered)} with a barcode to track`} onClick={() => toData({ 'f.mode': 'Registered' })} />
				<Kpi label="Latest issue" value={latest ? `Issue ${latest.issue}` : '–'} accent={COLORS.green} foot={latest ? `${num(latest.n)} sent, ${fmtDate(latest.first)} to ${fmtDate(latest.last)}` : ''} onClick={() => latest && toData({ 'min.dispdate': latest.first, 'max.dispdate': latest.last })} />
				{data.missed && <Kpi label="Not in the latest issue" value={short(data.missed.n)} icon={<MdWarningAmber />} accent={COLORS.amber} foot={`sent issue ${data.missed.previous.slice(5)} but not ${data.missed.latest.slice(5)} (yet)`} />}
				<Kpi label="Last dispatch" value={fmtDate(k.last)} accent={COLORS.general} foot={`first in the data ${fmtDate(k.first)}`} />
			</KpiRow>
			<div className="grid g-2">
				<Card title="By issue" sub="Registered and ordinary post">
					<Chart type="bar" height={280} options={{ chart: { stacked: true }, xaxis: { categories: data.issues.map(issueLabel) }, colors: [COLORS.blue, COLORS.grey], plotOptions: { bar: { columnWidth: '55%', borderRadius: 3 } }, yaxis: { labels: { formatter: (v: number) => short(v) } } }}
						series={[{ name: 'Registered', data: data.issues.map((r: any) => r.registered) }, { name: 'Ordinary', data: data.issues.map((r: any) => r.ordinary) }]} />
				</Card>
				<Card title="Dispatches by day" sub="The last 75 days in the data">
					<Chart type="bar" height={280} options={{ chart: { stacked: true }, xaxis: { categories: data.daily.map((r: any) => fmtDate(r.k).replace(/ \d{4}$/, '')), labels: { rotate: -45, hideOverlappingLabels: true } }, colors: [COLORS.blue, COLORS.grey], plotOptions: { bar: { columnWidth: '80%' } }, yaxis: { labels: { formatter: (v: number) => short(v) } } }}
						series={[{ name: 'Registered', data: data.daily.map((r: any) => r.registered) }, { name: 'Ordinary', data: data.daily.map((r: any) => r.n - r.registered) }]} />
				</Card>
			</div>
			<div className="grid g-2">
				<Card title="Readers by state" sub="Select a state for its dispatches" actions={<Segmented value={metric} options={[{ v: 'n', l: 'Readers' }, { v: 'registered_pct', l: 'Registered %' }]} onChange={setMetric as any} />}>
					<IndiaMap values={Object.fromEntries(data.byState.filter((r: any) => r.k).map((r: any) => [r.k, r[metric]]))} label={metric === 'n' ? 'Readers' : 'Registered post %'} format={metric === 'n' ? short : (v) => `${Math.round(v)}%`}
						detail={(s) => { const r = data.byState.find((x: any) => x.k === s); return r ? [`${num(r.n)} readers · ${num(r.dispatches)} dispatches`, `${r.registered_pct}% registered post`] : []; }}
						onSelect={(s) => s && toData({ 'f.state': s })} height={430} />
				</Card>
				<Card title="States and cities" flush>
					<BarList head="Readers" extraHeads={['Registered']} rows={data.byState.map((r: any) => ({ k: r.k || 'Not known', n: r.n, extra: [`${r.registered_pct ?? 0}%`], on: () => toData({ 'f.state': r.k || 'Not known' }) }))} height={250} />
					<BarList head="Readers" share={false} rows={data.byCity.map((r: any) => ({ k: r.k, n: r.n, on: () => toData({ 'f.city': r.k.toUpperCase() }) }))} height={230} />
				</Card>
			</div>
			<Card title="By subscription" flush>
				<BarList head="Dispatches" extraHeads={['Readers', 'Registered']} rows={data.bySub.map((r: any) => ({ k: SUB[r.k] || r.k, n: r.n, extra: [num(r.customers), pct(r.registered, r.n)], on: () => toData({ 'f.sub_type': r.k }) }))} height={200} />
			</Card>
		</div>
	);
}
