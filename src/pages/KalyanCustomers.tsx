/**
 * Customer database (Kalyan only, upload only): All customers (the master file), Current year customers, and one
 * dashboard for both. Uploads are additive; a current-year upload also adds net new customers to the master.
 * No customer is ever created from an email.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MdDownload, MdSearch } from 'react-icons/md';
import { api, qs } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Card, Empty, Kpi, Loader, Modal, PageHead, Segmented } from '../components/ui';
import Chart from '../components/Chart';
import { BatchSlot } from './StockTracking';
import { num } from '../lib/purposes';
import { COLORS, fmtDate } from '../lib/format';
import { download } from '../lib/files';

const TABS = [{ v: 'all', l: 'All customers' }, { v: 'current', l: 'Current year customers' }, { v: 'dashboard', l: 'Dashboard' }];
const TYPE: Record<string, string> = { '1Y': '1 year', FY: '5 years', LM: 'Life member' };

export default function KalyanCustomers() {
	const [sp, setSp] = useSearchParams();
	const tab = TABS.find((t) => t.v === sp.get('tab'))?.v || 'all';
	return (
		<>
			<PageHead kw="Customer" rest="database" sub="Kalyan customers, uploaded only: the complete customer file and the current-year file. Uploads add and update by customer number and never delete; net new customers in a current-year upload are added to the master too. No customer is created from an email." />
			<div className="mb-16"><Segmented value={tab} options={TABS} onChange={(v) => setSp({ tab: v }, { replace: true })} /></div>
			{tab === 'dashboard' ? <Dashboard onList={(p) => setSp({ tab: 'all', ...p })} /> : <CustomerList tab={tab as 'all' | 'current'} />}
		</>
	);
}

function Uploader({ tab }: { tab: 'all' | 'current' }) {
	const up = useQuery({ queryKey: ['uploads', 'all'], queryFn: () => api('/uploads'), refetchInterval: (q: any) => (q.state.data?.active?.some((a: any) => a.status !== 'review') ? 4000 : false) });
	const kind = tab === 'all' ? 'kalyan_master' : 'kalyan_current';
	return (
		<details className="mb-16" open={!!up.data?.active?.some((a: any) => a.kind === kind)}>
			<summary className="small"><b>Upload the {tab === 'all' ? 'complete customer file (all customers)' : 'current-year customer file'}</b></summary>
			<div className="mt-8">
				<BatchSlot kind={kind} active={up.data?.active || []} title={tab === 'all' ? 'All customers (Kalyan complete customer file)' : 'Current year customers'} />
				<div className="xs faint">{tab === 'all'
					? 'The complete customer export (63 columns: BookID, CustNo, SubPeriod, …). Only the useful fields are kept (Settings → Emails → Kalyan master fields); the original file stays in the upload history.'
					: 'Duration, No, Name, Address, Location, State, Country, Post code, then two columns without a heading: receipt number and payment date (dd/mm/yyyy). The year is taken from the latest payment date; you can change it before confirming.'}</div>
			</div>
		</details>
	);
}

function CustomerList({ tab }: { tab: 'all' | 'current' }) {
	const { can } = useAuth();
	const toast = useToast();
	const [sp, setSp] = useSearchParams();
	const keys = ['q', 'state', 'type', 'mode', 'dead', 'segment', 'segmentYear', 'year', 'sort', 'dir'];
	const f: Record<string, string> = Object.fromEntries(keys.map((k) => [k, sp.get(k) || '']));
	const set = (p: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(p)) { if (v) n.set(k, v); else n.delete(k); } setSp(n, { replace: true }); };
	const [search, setSearch] = useState(f.q);
	useEffect(() => { const t = setTimeout(() => search !== f.q && set({ q: search }), 350); return () => clearTimeout(t); });
	const [offset, setOffset] = useState(0);
	useEffect(() => setOffset(0), [JSON.stringify(f), tab]);
	const query = { tab, ...f, offset, limit: 100 };
	const { data, isLoading, isFetching } = useQuery({ queryKey: ['kalyan-customers', query], queryFn: () => api(`/kalyan/customers${qs(query)}`), placeholderData: keepPreviousData });
	const [open, setOpen] = useState<string | null>(null);
	const sortBy = (k: string) => set({ sort: k, dir: f.sort === k && f.dir === 'asc' ? 'desc' : 'asc' });
	const Th = ({ k, l, n }: { k: string; l: string; n?: boolean }) => (
		<th className={`${n ? 'num ' : ''}sortable${f.sort === k ? ' on' : ''}`}><button type="button" className="th-sort" onClick={() => sortBy(k)}>{l}<span className="arrow">{f.sort === k ? (f.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>
	);
	const segLabel: Record<string, string> = { new: 'New', lost: 'Lost', repeat: 'Renewed', registered: 'Registered' };
	const dl = (format: string) => download(`/kalyan/customers${qs({ tab, ...f, format })}`, `kalyan-customers-${tab}.${format}`).catch((e) => toast(e.message, 'error'));
	return (
		<>
			{can('manager') && <Uploader tab={tab} />}
			<div className="filter-strip wrap mb-8">
				<div className="search-box"><MdSearch /><input className="input sm" placeholder="Search customer number, name, address, city or PIN" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" /></div>
				{tab === 'current' && <select className="input sm drop on" value={f.year || String(data?.year || '')} onChange={(e) => set({ year: e.target.value })} aria-label="Year">
					{(data?.years || []).map((y: any) => <option key={y.year} value={y.year}>{y.year} ({num(y.n)})</option>)}
				</select>}
				<select className={`input sm drop ${f.state ? 'on' : ''}`} value={f.state} onChange={(e) => set({ state: e.target.value })} aria-label="State"><option value="">Every state</option>{(data?.states || []).filter((s: any) => s.k).map((s: any) => <option key={s.k} value={s.k}>{s.k} ({num(s.n)})</option>)}</select>
				<select className={`input sm drop ${f.type ? 'on' : ''}`} value={f.type} onChange={(e) => set({ type: e.target.value })} aria-label="Subscription"><option value="">Every subscription</option>{Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
				<select className={`input sm drop ${f.mode ? 'on' : ''}`} value={f.mode} onChange={(e) => set({ mode: e.target.value })} aria-label="Dispatch mode"><option value="">Every dispatch mode</option><option value="ORDINARY">Ordinary</option><option value="REGISTERED">Registered</option><option value="BY SHOP">By shop</option></select>
				<select className={`input sm drop ${f.dead ? 'on' : ''}`} value={f.dead} onChange={(e) => set({ dead: e.target.value })} aria-label="Active"><option value="">Active and inactive</option><option value="0">Active only</option><option value="1">Inactive only</option></select>
				{f.segment && <span className="chip on">{segLabel[f.segment]} in {f.segmentYear} <button className="link-btn" onClick={() => set({ segment: '', segmentYear: '' })}>×</button></span>}
				<span className="grow" />
				{can('analyst') && <><button className="btn sm" onClick={() => dl('xlsx')}><MdDownload /> Excel</button><button className="btn sm" onClick={() => dl('csv')}><MdDownload /> CSV</button></>}
			</div>
			<Card flush>
				{isLoading ? <Loader /> : !data?.rows?.length ? <Empty text={tab === 'all' ? 'No customers yet. Upload the complete customer file above.' : 'No current-year customers yet. Upload the current-year file above.'} /> : (
					<>
						<div className="table-wrap sticky"><table className="table">
							<thead><tr><Th k="custno" l="Customer no." /><Th k="name" l="Name" /><Th k="type" l="Subscription" /><Th k="city" l="City" /><Th k="state" l="State" /><Th k="mode" l="Dispatch" /><Th k="regdate" l="Registered" /><Th k="last_year" l="Last active" n /><Th k="paid_on" l="Last payment" /></tr></thead>
							<tbody>{data.rows.map((r: any) => (
								<tr key={r.custno} className="click" onClick={() => setOpen(r.custno)}>
									<td className="mono small">{r.custno}</td>
									<td className="small">{r.name}{r.dead ? <span className="badge" style={{ marginLeft: 6 }}>inactive</span> : null}</td>
									<td className="small">{TYPE[r.sub_type] || r.sub_type}</td>
									<td className="small">{r.city}</td><td className="small">{r.state}</td><td className="xs">{r.disp_mode}</td>
									<td className="xs nowrap">{r.regdate ? fmtDate(r.regdate) : ''}</td>
									<td className="num small">{r.last_year ?? ''}</td>
									<td className="xs nowrap">{r.paid_on ? `${fmtDate(r.paid_on)}${r.receipt_no ? ` · ${r.receipt_no}` : ''}` : ''}</td>
								</tr>
							))}</tbody>
						</table></div>
						<div className="row-between list-foot">
							<span className="xs faint">{num(offset + 1)}–{num(offset + data.rows.length)} of {num(data.total)}{isFetching ? ' · updating' : ''}</span>
							<span className="row gap-8"><button className="btn sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</button><button className="btn sm" disabled={offset + 100 >= data.total} onClick={() => setOffset(offset + 100)}>Next</button></span>
						</div>
					</>
				)}
			</Card>
			{open && <CustomerRecord custno={open} onClose={() => setOpen(null)} />}
		</>
	);
}

function CustomerRecord({ custno, onClose }: { custno: string; onClose: () => void }) {
	const { data, isLoading } = useQuery({ queryKey: ['kalyan-customer', custno], queryFn: () => api(`/kalyan/customers/${encodeURIComponent(custno)}`) });
	const c = data?.customer;
	return (
		<Modal wide title={`Kalyan customer ${custno}`} onClose={onClose}>
			{isLoading || !c ? <Loader /> : (
				<div className="col gap-16">
					<div className="grid g-2 small" style={{ gap: 8 }}>
						<div><b>{c.name}</b><div className="faint">{c.address}{c.city ? `, ${c.city}` : ''} {c.pin}</div><div className="faint">{c.state_norm || c.state} {c.country}</div></div>
						<div>Subscription: <b>{TYPE[c.sub_type] || c.sub_type}</b> · Dispatch: {c.disp_mode || '–'}<br />Registered: {c.regdate ? fmtDate(c.regdate) : '–'} · Year {c.year_start || '–'} to {c.year_end || '–'}{c.dead ? <><br /><span style={{ color: 'var(--red)' }}>Inactive{c.dead_reason ? `: ${c.dead_reason}` : ''}</span></> : null}{c.mail_status ? <><br />Mail status: {c.mail_status}</> : null}</div>
					</div>
					<div><b className="small">Years active</b>{!data.years.length ? <div className="xs faint">Not in any current-year file yet.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Year</th><th>Subscription</th><th>Receipt</th><th>Payment date</th></tr></thead><tbody>{data.years.map((y: any) => <tr key={y.year}><td>{y.year}</td><td>{TYPE[y.sub_type] || y.sub_type}</td><td>{y.receipt_no}</td><td>{y.paid_on ? fmtDate(y.paid_on) : ''}</td></tr>)}</tbody></table></div>}</div>
					<div><b className="small">Kalyan dispatches</b>{!data.dispatches.length ? <div className="xs faint">None in the Kalyan tracking uploads.</div> : <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto' }}><table className="table"><thead><tr><th>Date</th><th>Issues</th><th>Mode</th><th>Registered post no.</th></tr></thead><tbody>{data.dispatches.map((d: any, i: number) => <tr key={i}><td className="xs">{fmtDate(d.dispdate)}</td><td className="xs">{d.from_issue === d.to_issue ? d.to_issue : `${d.from_issue}–${d.to_issue}`}</td><td className="xs">{d.mode}</td><td className="xs mono">{d.barcode || ''}</td></tr>)}</tbody></table></div>}</div>
					{data.emails.length > 0 && <div><b className="small">Emails</b>{data.emails.map((e: any) => <div key={e.id} className="small"><a href={`/emails?tab=all&open=${e.id}`}>{e.subject}</a> <span className="xs faint">{fmtDate(e.last_inbound_at)}</span></div>)}</div>}
				</div>
			)}
		</Modal>
	);
}

function Dashboard({ onList }: { onList: (p: Record<string, string>) => void }) {
	const [year, setYear] = useState<number | null>(null);
	const { data, isLoading } = useQuery({ queryKey: ['kalyan-dashboard', year], queryFn: () => api(`/kalyan/dashboard${qs({ year })}`) });
	if (isLoading || !data) return <Loader />;
	const y = data.year;
	const yrs = data.years.map((r: any) => String(r.year));
	return (
		<div className="col gap-16">
			<div className="row-between">
				<div className="small faint">Year {y} ({data.yearStartMonth === 1 ? 'January–December' : `starting month ${data.yearStartMonth}`}; change it in Settings → Emails). Select a figure to open the list behind it.</div>
				<select className="input sm" style={{ width: 110 }} value={y} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">{[...new Set([y, ...data.years.map((r: any) => r.year)])].sort().reverse().map((v: any) => <option key={v} value={v}>{v}</option>)}</select>
			</div>
			<div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
				<Kpi label="Total customers" value={num(data.totals.total)} accent={COLORS.blue} foot={`${num(data.totals.inactive)} marked inactive`} onClick={() => onList({})} />
				<Kpi label={`Active in ${y}`} value={num(data.current.active)} accent={COLORS.green} onClick={() => onList({ segment: '', year: String(y) })} />
				<Kpi label={`New in ${y}`} value={num(data.current.new)} accent={COLORS.teal} foot="first year active" onClick={() => onList({ segment: 'new', segmentYear: String(y) })} />
				<Kpi label={`Renewed in ${y}`} value={num(data.current.repeat)} accent={COLORS.purple} foot={`active in ${y - 1} and ${y}`} onClick={() => onList({ segment: 'repeat', segmentYear: String(y) })} />
				<Kpi label={`Lost in ${y}`} value={num(data.current.lost)} accent={COLORS.red} foot={`active in ${y - 1}, not in ${y}`} onClick={() => onList({ segment: 'lost', segmentYear: String(y) })} />
			</div>
			<div className="grid g-2">
				<Card title="Year on year">
					{!yrs.length ? <Empty text="Upload a current-year file to see the years." /> : <Chart type="bar" height={280} options={{ xaxis: { categories: yrs }, colors: [COLORS.green, COLORS.teal, COLORS.purple, COLORS.red], plotOptions: { bar: { columnWidth: '60%' } } }}
						series={[{ name: 'Active', data: data.years.map((r: any) => r.active) }, { name: 'New', data: data.years.map((r: any) => r.new) }, { name: 'Renewed', data: data.years.map((r: any) => r.repeat) }, { name: 'Lost', data: data.years.map((r: any) => r.lost) }]} />}
				</Card>
				<Card title={`Payments in ${y} by month`}>
					{!data.payments.length ? <Empty text="No payment dates for this year." /> : <Chart type="bar" height={280} options={{ xaxis: { categories: data.payments.map((p: any) => p.k) }, colors: [COLORS.blue] }} series={[{ name: 'Payments', data: data.payments.map((p: any) => p.n) }]} />}
				</Card>
			</div>
			<div className="grid g-3">
				<Card title="By subscription" flush><Breakdown rows={data.byType.map((r: any) => ({ k: TYPE[r.k] || r.k, n: r.n, a: r.active, on: () => onList({ type: r.k }) }))} active={y} /></Card>
				<Card title="By dispatch mode" flush><Breakdown rows={data.byMode.map((r: any) => ({ k: r.k, n: r.n, on: () => onList({ mode: r.k }) }))} /></Card>
				<Card title={`Top cities (${y})`} flush><Breakdown rows={data.byCity.map((r: any) => ({ k: r.k, n: r.n }))} /></Card>
			</div>
			<Card title="By state" flush><Breakdown rows={data.byState.map((r: any) => ({ k: r.k, n: r.n, a: r.active, on: () => onList({ state: r.k }) }))} active={y} /></Card>
			<Card title="Registered by year (from the complete customer file)">
				{!data.registered.length ? <Empty text="No registration dates." /> : <Chart type="bar" height={240} options={{ xaxis: { categories: data.registered.map((r: any) => String(r.year)) }, colors: [COLORS.teal] }} series={[{ name: 'Registered', data: data.registered.map((r: any) => r.n) }]} />}
			</Card>
		</div>
	);
}

function Breakdown({ rows, active }: { rows: { k: string; n: number; a?: number; on?: () => void }[]; active?: number }) {
	if (!rows.length) return <Empty text="No data yet." />;
	const max = Math.max(...rows.map((r) => r.n));
	return (
		<div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table className="table">
			<thead><tr><th /><th className="num">Customers</th>{active && <th className="num">Active {active}</th>}<th /></tr></thead>
			<tbody>{rows.map((r) => (
				<tr key={r.k} className={r.on ? 'click' : ''} onClick={r.on}>
					<td className="small">{r.k}</td><td className="num small">{num(r.n)}</td>{active && <td className="num small">{num(r.a)}</td>}
					<td style={{ width: '35%' }}><div className="bar-cell"><div style={{ width: `${(r.n / max) * 100}%` }} /></div></td>
				</tr>
			))}</tbody>
		</table></div>
	);
}
