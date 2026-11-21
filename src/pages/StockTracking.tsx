/**
 * Stock and tracking: the files that change often. One tab each for Book orders (tracking), Branch stock,
 * Main / retail / semi-finished stock (Gorakhpur) and Kalyan tracking, plus All data to browse every upload.
 * Each upload shows a check summary first; nothing is applied until it is confirmed. Every upload and its
 * original file are kept, and replies always use the latest one.
 */
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MdCheck, MdClose, MdDownload, MdSearch, MdTableView, MdUploadFile } from 'react-icons/md';
import { api, qs } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Card, Empty, Loader, Modal, PageHead, Segmented } from '../components/ui';
import { fileToBase64, num } from '../lib/purposes';
import { COLORS, ago, fmtDate, fmtDateTime } from '../lib/format';
import { download, sendBatch } from '../lib/files';

const TABS = [
	{ v: 'orders', l: 'Book orders' }, { v: 'branch', l: 'Branch stock' }, { v: 'hq', l: 'Main, retail and semi-finished' }, { v: 'kalyan', l: 'Kalyan tracking' }, { v: 'all', l: 'All data' },
];
export const KIND: Record<string, string> = { orders: 'Book orders (tracking)', kalyan: 'Kalyan tracking', books: 'Book links', prices: 'Price list', hq: 'Main, retail and semi-finished stock', branch: 'Branch stock', kalyan_master: 'Kalyan customers (all)', kalyan_current: 'Kalyan customers (current year)' };
export const STATUS: Record<string, string> = { receiving: 'Arriving', review: 'Waiting for your confirmation', queued: 'Waiting to be applied', processing: 'Being applied', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };

export default function StockTracking() {
	const [sp, setSp] = useSearchParams();
	const tab = TABS.find((t) => t.v === sp.get('tab'))?.v || 'orders';
	const { data, isLoading } = useQuery({ queryKey: ['uploads', 'all'], queryFn: () => api('/uploads'), refetchInterval: (q: any) => (q.state.data?.active?.some((a: any) => a.status !== 'review') ? 4000 : false) });
	return (
		<>
			<PageHead kw="Stock" rest="and tracking" sub="The files that change often. Each upload shows a check summary before anything is applied; every upload and its original file are kept, and replies always use the latest one." />
			<div className="mb-16" style={{ overflowX: 'auto' }}><Segmented value={tab} options={TABS} onChange={(v) => setSp({ tab: v }, { replace: true })} /></div>
			{isLoading || !data ? <Loader /> : tab === 'all' ? <AllData history={data.history} /> : (
				<>
					{(tab === 'orders' || tab === 'kalyan') && <BatchSlot kind={tab} active={data.active} />}
					{(tab === 'hq' || tab === 'branch') && <StockSlot slot={tab} />}
					<LatestFor kind={tab} history={data.history} kinds={data.kinds} />
				</>
			)}
		</>
	);
}

const HELP: Record<string, string> = {
	orders: 'The Gita Press orders export (CSV or Excel): orderId, orderMongoId, siteCategory, customerName, email, phone, totalAmount, subTotal, postage, paymentMethod, orderStatusCode, orderStatusLabel, paymentStatus, createdAt, trackingId, deliveryPartner, shipFirstName, shipLastName, shipAddress1, shipAddress2, shipCity, shipPincode, shipMobile. Orders are updated by order number; a change of status or tracking number is kept in the order\'s history.',
	kalyan: 'The Kalyan dispatch file (Excel): subperiod, custno, NAME, ADDRESS, city, pin, state, PhoneNo, DispMode, sbarcodeno, dispdate, Fromissue, Toissue, EmailID, Returnsts. Large files are read on this computer and sent in parts; keep this page open until the rows have arrived.',
	hq: 'The Tally Stock Summary for Gorakhpur: MAIN STOCK (head office), RETAIL STOCK (shop) and SEMI FINISHED (books in making, staff only). Main + Retail are offered to readers. A blank code is taken from the batch name (CB035_Rs.100 → CB035).',
	branch: 'The Tally Stock Summary with one sheet per branch. A branch missing from a file keeps its last uploaded stock. A godown of another branch listed on a sheet is ignored.',
};

/** Orders and Kalyan tracking: read here, sent in parts, then a check summary to confirm. */
export function BatchSlot({ kind, active, options, title }: { kind: string; active: any[]; options?: Record<string, unknown>; title?: string }) {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const ref = useRef<HTMLInputElement>(null);
	const [state, setState] = useState<{ step: string; pct: number } | null>(null);
	const [error, setError] = useState('');
	const upload = async (file?: File) => {
		if (!file) return;
		setError('');
		try {
			setState({ step: `Opening ${file.name}`, pct: 0 });
			await sendBatch(kind, file, (step, pct) => setState({ step, pct }), options);
			setState(null);
			qc.invalidateQueries({ queryKey: ['uploads'] });
			toast('Rows received. Check the summary below and confirm to apply them.');
		} catch (e: any) { setState(null); setError(e.message); toast(e.message, 'error'); }
		if (ref.current) ref.current.value = '';
	};
	const waiting = (active || []).filter((a) => a.kind === kind);
	return (
		<Card className="mb-16" title={title || `Upload: ${KIND[kind]}`} sub={HELP[kind]} accent={kind === 'orders' ? COLORS.blue : COLORS.purple}>
			{can('manager') ? <>
				<input ref={ref} type="file" accept=".xlsx,.csv" hidden onChange={(e) => upload(e.target.files?.[0])} />
				<button className="btn primary" disabled={!!state} onClick={() => ref.current?.click()}><MdUploadFile /> {state ? 'Uploading…' : 'Choose file'}</button>
			</> : <div className="small faint">Managers and admins can upload.</div>}
			{state && <div className="small mt-8">{state.step}<div className="progress mt-4"><div style={{ width: `${state.pct}%` }} /></div></div>}
			{error && <div className="small mt-8" style={{ color: 'var(--red)' }}>{error}</div>}
			{waiting.map((b) => <BatchReview key={b.id} b={b} />)}
		</Card>
	);
}

/** The check summary of an upload, with Confirm and Cancel; then its progress. */
export function BatchReview({ b }: { b: any }) {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const [year, setYear] = useState<number>(b.review?.year || new Date().getFullYear());
	const live = useQuery({ queryKey: ['upload', b.id], queryFn: () => api(`/uploads/${b.id}`), initialData: b, refetchInterval: (q: any) => (['review', 'done', 'failed', 'cancelled'].includes(q.state.data?.status) ? false : 3000) });
	const x = live.data || b;
	const r = x.review || {};
	const confirm = useMutation({ mutationFn: () => api(`/uploads/${b.id}/confirm`, { body: x.kind === 'kalyan_current' ? { year } : {} }), onSuccess: () => { qc.invalidateQueries(); toast('Confirmed: the upload is being applied'); }, onError: (e: any) => toast(e.message, 'error') });
	const cancel = useMutation({ mutationFn: () => api(`/uploads/${b.id}/cancel`, { body: {} }), onSuccess: () => { qc.invalidateQueries(); toast('Upload cancelled; nothing was changed'); }, onError: (e: any) => toast(e.message, 'error') });
	return (
		<div className="review-box mt-16">
			<div className="row-between"><b>{x.file_name}</b><span className="badge">{STATUS[x.status] || x.status}</span></div>
			<div className="grid g-3 small mt-8" style={{ gap: 6 }}>
				{r.rows !== undefined && <div><b>{num(r.rows)}</b> rows</div>}
				{r.orders !== undefined && <div><b>{num(r.orders)}</b> orders</div>}
				{r.customers !== undefined && <div><b>{num(r.customers)}</b> customers</div>}
				{r.new !== undefined && <div><b>{num(r.new)}</b> new</div>}
				{r.newToMaster !== undefined && <div><b>{num(r.newToMaster)}</b> new to the master database</div>}
				{r.alreadyKnown !== undefined && <div><b>{num(r.alreadyKnown)}</b> already known (updated)</div>}
				{(r.rejected || x.rows_rejected) > 0 && <div style={{ color: 'var(--amber)' }}><b>{num(r.rejected || x.rows_rejected)}</b> rows cannot be used</div>}
				{r.dates?.first && <div>Dates {fmtDate(r.dates.first)} to {fmtDate(r.dates.last)}</div>}
				{r.payments?.first && <div>Payments {fmtDate(r.payments.first)} to {fmtDate(r.payments.last)}</div>}
				{r.damagedTracking > 0 && <div style={{ color: 'var(--amber)' }}>{num(r.damagedTracking)} damaged tracking numbers (5.0E+12)</div>}
				{r.ordinary !== undefined && <div>{num(r.registered)} registered · {num(r.ordinary)} ordinary</div>}
				{r.alreadyInYear !== undefined && <div>{num(r.alreadyInYear)} already in {r.year}</div>}
			</div>
			{r.previous && <div className="xs faint mt-8">Previous upload: {num(r.previous.rows)} rows, {ago(r.previous.at)}{r.rows !== undefined ? ` (${r.rows - r.previous.rows >= 0 ? '+' : ''}${num(r.rows - r.previous.rows)})` : ''}</div>}
			{r.months?.length > 0 && <div className="xs faint mt-8">By month: {r.months.map((m: any) => `${m.k} ${num(m.n)} (${num(m.ordinary)} ordinary)`).join(' · ')}</div>}
			{r.statuses?.length > 0 && <div className="xs faint mt-8">Status: {r.statuses.map((s: any) => `${s.k} ${num(s.n)}`).join(' · ')}</div>}
			{r.byType?.length > 0 && <div className="xs faint mt-8">Subscription: {r.byType.map((s: any) => `${s.k} ${num(s.n)}`).join(' · ')}</div>}
			{(r.problems || x.warnings || []).slice(0, 6).map((w: string) => <div key={w} className="xs" style={{ color: 'var(--amber)' }}>{w}</div>)}
			{x.error && <div className="small" style={{ color: 'var(--red)' }}>{x.error}</div>}
			{x.status === 'review' && can('manager') && (
				<div className="row gap-8 mt-8">
					{x.kind === 'kalyan_current' && <label className="small row gap-4">Year <input className="input sm" type="number" style={{ width: 90 }} value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>}
					<button className="btn primary sm" disabled={confirm.isPending} onClick={() => confirm.mutate()}><MdCheck /> Confirm and apply</button>
					<button className="btn sm" disabled={cancel.isPending} onClick={() => cancel.mutate()}><MdClose /> Cancel</button>
				</div>
			)}
			{x.status === 'done' && <div className="small mt-8" style={{ color: 'var(--green)' }}>Applied: {num(x.rows_new)} new, {num(x.rows_updated)} updated{x.rows_unchanged ? `, ${num(x.rows_unchanged)} unchanged` : ''}.</div>}
		</div>
	);
}

/** Tally stock: checked first (summary and comparison with the last upload), then saved. */
function StockSlot({ slot }: { slot: 'hq' | 'branch' }) {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const ref = useRef<HTMLInputElement>(null);
	const [file, setFile] = useState<{ fileName: string; data: string } | null>(null);
	const check = useMutation({ mutationFn: async (f: File) => { const body = { slot, fileName: f.name, data: await fileToBase64(f) }; setFile(body); return api('/stock/preview', { body }); }, onError: (e: any) => toast(e.message, 'error') });
	const apply = useMutation({ mutationFn: () => api('/stock/upload', { body: { slot, ...file } }), onSuccess: (r: any) => { check.reset(); setFile(null); qc.invalidateQueries(); toast(`Stock saved: ${num(r.rows)} rows for ${r.locations.length} location(s)`); }, onError: (e: any) => toast(e.message, 'error') });
	const p = check.data;
	return (
		<Card className="mb-16" title={`Upload: ${KIND[slot]}`} sub={HELP[slot]} accent={slot === 'hq' ? COLORS.pink : COLORS.teal}>
			{can('manager') ? <>
				<input ref={ref} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) check.mutate(f); e.target.value = ''; }} />
				<button className="btn primary" disabled={check.isPending} onClick={() => ref.current?.click()}><MdUploadFile /> {check.isPending ? 'Checking…' : 'Choose Excel file'}</button>
			</> : <div className="small faint">Managers and admins can upload.</div>}
			{p && (
				<div className="review-box mt-16">
					<div className="row-between"><b>{file?.fileName}</b><span className="badge">Waiting for your confirmation</span></div>
					<div className="grid g-3 small mt-8" style={{ gap: 6 }}>
						<div>Period <b>{fmtDate(p.period.from)}</b> to <b>{fmtDate(p.period.to)}</b></div>
						<div><b>{num(p.rows)}</b> rows · <b>{num(p.books)}</b> books</div>
						<div><b>{p.locations.length}</b> location(s)</div>
						{p.newBooks > 0 && <div style={{ color: 'var(--amber)' }}><b>{num(p.newBooks)}</b> codes not in the book list (added as "Needs details")</div>}
						{p.replacesSamePeriod > 0 && <div style={{ color: 'var(--amber)' }}>Replaces the earlier upload for the same period and locations</div>}
					</div>
					{p.previous && <div className="xs faint mt-8">Previous: {p.previous.file}, {fmtDate(p.previous.period.from)}–{fmtDate(p.previous.period.to)}, {num(p.previous.rows)} rows ({p.rows - p.previous.rows >= 0 ? '+' : ''}{num(p.rows - p.previous.rows)}); {num(p.previous.booksAdded)} books new since then, {num(p.previous.booksGone)} no longer listed.</div>}
					<div className="xs faint mt-8">Sheets: {p.sheets.map((s: any) => `${s.sheet} → ${s.location || 'skipped'} (${num(s.rows)})`).join(' · ')}</div>
					{(p.warnings || []).map((w: string) => <div key={w} className="xs" style={{ color: 'var(--amber)' }}>{w}</div>)}
					<div className="row gap-8 mt-8">
						<button className="btn primary sm" disabled={apply.isPending} onClick={() => apply.mutate()}><MdCheck /> {apply.isPending ? 'Saving…' : 'Confirm and save'}</button>
						<button className="btn sm" onClick={() => { check.reset(); setFile(null); }}><MdClose /> Cancel</button>
					</div>
				</div>
			)}
		</Card>
	);
}

function LatestFor({ kind, history, kinds }: { kind: string; history: any[]; kinds: any }) {
	const rows = history.filter((h) => h.kind === kind);
	const latest = rows.find((h) => h.status === 'done' && !h.deleted_at);
	const [view, setView] = useState<any>(null);
	return (
		<Card title={`${KIND[kind]}: uploads`} sub={latest ? <>Replies use the latest: <b>{latest.file_name}</b>, uploaded {fmtDateTime(latest.uploaded_at)}{latest.period_to ? ` (stock as of ${fmtDate(latest.period_to)})` : ''}.</> : kinds?.[kind]?.last ? '' : 'Nothing uploaded yet.'} flush>
			{!rows.length ? <Empty text="No uploads yet." /> : <UploadsTable rows={rows} onView={setView} />}
			{view && <RowsViewer u={view} onClose={() => setView(null)} />}
		</Card>
	);
}

function UploadsTable({ rows, onView, showKind }: { rows: any[]; onView: (u: any) => void; showKind?: boolean }) {
	const toast = useToast();
	const fileOf = (u: any) => download(u.key.startsWith('s') ? `/stock/uploads/${u.id}/file` : `/uploads/${u.id}/file`, u.file_name).catch((e) => toast(e.message, 'error'));
	return (
		<div className="table-wrap"><table className="table">
			<thead><tr><th>Uploaded</th>{showKind && <th>Kind</th>}<th>File</th><th>Period</th><th className="num">Rows</th><th className="num">New</th><th className="num">Updated</th><th>Status</th><th>By</th><th /></tr></thead>
			<tbody>{rows.map((u) => (
				<tr key={u.key} style={u.deleted_at ? { opacity: 0.55 } : undefined}>
					<td className="xs nowrap">{fmtDateTime(u.uploaded_at)}</td>
					{showKind && <td className="xs">{KIND[u.kind] || u.kind}</td>}
					<td className="small" style={{ maxWidth: 240 }}><div className="truncate">{u.file_name}</div></td>
					<td className="xs nowrap">{u.period_from ? `${fmtDate(u.period_from)}–${fmtDate(u.period_to)}` : u.profile?.review?.dates?.first ? `${fmtDate(u.profile.review.dates.first)}–${fmtDate(u.profile.review.dates.last)}` : ''}</td>
					<td className="num small">{num(u.rows_total)}</td><td className="num small">{num(u.rows_new)}</td><td className="num small">{num(u.rows_updated)}</td>
					<td className="xs">{u.deleted_at ? `Removed (${u.deleted_reason || ''})` : STATUS[u.status] || u.status}{u.error ? <div style={{ color: 'var(--red)' }}>{u.error}</div> : null}</td>
					<td className="xs">{u.uploaded_by}</td>
					<td className="nowrap">
						{['hq', 'branch', 'orders', 'kalyan', 'kalyan_current'].includes(u.kind) && u.status === 'done' && <button className="btn ghost icon sm" title="Browse the rows" aria-label="Browse the rows" onClick={() => onView(u)}><MdTableView /></button>}
						{u.has_file && <button className="btn ghost icon sm" title="Download the original file" aria-label="Download the original file" onClick={() => fileOf(u)}><MdDownload /></button>}
					</td>
				</tr>
			))}</tbody>
		</table></div>
	);
}

function RowsViewer({ u, onClose }: { u: any; onClose: () => void }) {
	const [q, setQ] = useState('');
	const [offset, setOffset] = useState(0);
	const { data, isLoading, isFetching } = useQuery({ queryKey: ['data-rows', u.kind, u.id, q, offset], queryFn: () => api(`/data/${u.kind}/${u.id}/rows${qs({ q, offset, limit: 100 })}`), placeholderData: keepPreviousData });
	return (
		<Modal wide title={`${KIND[u.kind]}: ${u.file_name}`} onClose={onClose}>
			<div className="search-box mb-8"><MdSearch /><input className="input sm" placeholder="Search" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} aria-label="Search rows" /></div>
			{isLoading ? <Loader /> : !data?.rows?.length ? <Empty text="No rows." /> : (
				<div className="table-wrap" style={{ maxHeight: '60vh', overflow: 'auto' }}><table className="table">
					<thead><tr>{data.columns.map((c: string) => <th key={c}>{c}</th>)}</tr></thead>
					<tbody>{data.rows.map((r: any, i: number) => <tr key={i}>{data.columns.map((c: string) => <td key={c} className="xs">{r[c] === null || r[c] === undefined ? '' : /date|Date/.test(c) && typeof r[c] === 'string' && r[c].length > 9 ? fmtDate(r[c]) : String(r[c])}</td>)}</tr>)}</tbody>
				</table></div>
			)}
			<div className="row-between mt-8 small">
				<span className="faint">Rows {offset + 1}–{offset + (data?.rows?.length || 0)}{isFetching ? ' · loading' : ''}</span>
				<span className="row gap-8"><button className="btn sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</button><button className="btn sm" disabled={(data?.rows?.length || 0) < 100} onClick={() => setOffset(offset + 100)}>Next</button></span>
			</div>
		</Modal>
	);
}

function AllData({ history }: { history: any[] }) {
	const [kind, setKind] = useState('');
	const [view, setView] = useState<any>(null);
	const rows = history.filter((h) => !kind || h.kind === kind);
	return (
		<Card title="All data" sub="Every upload of every kind: stock, tracking, Kalyan customers, the book links and price lists. Select the table icon to browse an upload's rows." flush
			actions={<select className="input sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind"><option value="">Every kind</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}>
			{!rows.length ? <Empty text="No uploads yet." /> : <UploadsTable rows={rows} onView={setView} showKind />}
			{view && <RowsViewer u={view} onClose={() => setView(null)} />}
		</Card>
	);
}
