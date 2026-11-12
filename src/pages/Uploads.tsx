import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MdDelete, MdDownload, MdPlayArrow, MdPrint, MdUploadFile, MdWarningAmber } from 'react-icons/md';
import { api, getToken, qs } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Card, Empty, Loader, Modal, PageHead } from '../components/ui';
import { useSort } from '../components/SortTable';
import { StockUploads } from './Inventory';
import { fileToBase64, num } from '../lib/purposes';
import { streamTableRows } from '../lib/xlsxStream';
import { COLORS, ago, fmtDate, fmtDateTime } from '../lib/format';

const KIND: Record<string, string> = { orders: 'Orders', kalyan: 'Kalyan dispatch', books: 'Book list', prices: 'Price list', hq: 'Head office stock', branch: 'Branch stock' };
const STATUS: Record<string, string> = { receiving: 'Arriving', queued: 'Waiting to be worked on', processing: 'Being worked on', done: 'Done', failed: 'Failed' };

const save = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); };
const fetchFile = async (path: string) => fetch(`/api${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
const openPrint = async (path: string) => { const w = window.open('', '_blank'); const res = await fetchFile(path); if (w) { w.document.write(await res.text()); w.document.close(); } };
/** bytes → base64, in pieces small enough for the browser */
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

/** Every file Gita Press uploads, in one place: stock (weekly), orders (twice a week), Kalyan dispatch (monthly), the book list and the price list. */
export default function Uploads() {
	const { can } = useAuth();
	const [sp, setSp] = useSearchParams();
	const filter = { kind: sp.get('kind') || '', from: sp.get('from') || '', to: sp.get('to') || '' };
	const setFilter = (f: typeof filter) => setSp(qs(f).replace(/^\?/, ''), { replace: true });
	const { data, isLoading } = useQuery({ queryKey: ['uploads', filter], queryFn: () => api(`/uploads${qs(filter)}`), refetchInterval: (q: any) => (q.state.data?.active?.length ? 4000 : false) });
	if (isLoading || !data) return <Loader />;
	const manager = can('manager');
	return (
		<>
			<PageHead kw="Uploads" sub="Every file Gita Mail works from: stock every week, orders twice a week, Kalyan dispatch every month, and the book and price lists when they change. Every upload and its original file are kept for at least five years. After each upload the figures, customer links and tiers are worked out again automatically." />
			<Due data={data} />
			<StockUploads part="stock" />
			<div className="grid g-2 mb-16">
				<RowsSlot kind="orders" can={manager} title="Orders · twice a week" columns={data.columns.orders}
					help="The Gita Press orders export (CSV or Excel). Each file holds all orders to date: orders are updated by order number, nothing is deleted, and a change of status or tracking number is added to the order's history." />
				<RowsSlot kind="kalyan" can={manager} title="Kalyan dispatch · every month" columns={data.columns.kalyan}
					help="The Kalyan dispatch file (Excel). Large files (750,000 rows) are read on this computer and sent in small parts; keep this page open until it says the rows have arrived. Every dispatch row is kept." />
			</div>
			<div className="grid g-2 mb-16">
				<BookSlot can={manager} />
				<PriceSlot can={manager} />
			</div>
			<Kalyan months={data.kalyanMonths} />
			<History rows={data.history} filter={filter} setFilter={setFilter} />
			{manager && <Expect expect={data.expect} />}
		</>
	);
}

/** When each kind was last uploaded and whether one is overdue. */
function Due({ data }: { data: any }) {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const a = useQuery({ queryKey: ['analytics'], queryFn: () => api('/analytics'), refetchInterval: (q: any) => (q.state.data?.runs?.some((r: any) => r.status === 'running' || r.status === 'queued') ? 4000 : false) });
	const run = useMutation({ mutationFn: () => api('/analytics/run', { body: {} }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['analytics'] }); toast('The figures are being worked out again'); }, onError: (e: any) => toast(e.message, 'error') });
	const last = a.data?.runs?.[0];
	return (
		<Card className="mb-16">
			<div className="grid g-3" style={{ gap: 12 }}>
				{Object.entries(data.kinds).map(([k, v]: [string, any]) => (
					<div key={k} className="small">
						<b>{v.label}</b>
						<div className={v.overdue ? '' : 'faint'} style={v.overdue ? { color: COLORS.amber } : undefined}>
							{v.last ? `Last ${fmtDate(v.last)}` : 'Not uploaded yet'}{v.due ? ` · next due ${fmtDate(v.due)}` : ''}{v.overdue && <> <MdWarningAmber style={{ verticalAlign: 'middle' }} /> overdue</>}
						</div>
					</div>
				))}
			</div>
			{data.active?.length > 0 && <div className="small mt-16">{data.active.map((b: any) => <div key={b.id}>{KIND[b.kind]}: {b.file_name} · {STATUS[b.status]}{b.step && b.step !== b.status ? ` (${b.step})` : ''} · {num(b.rows_received)} rows</div>)}</div>}
			<div className="row-between mt-16 small">
				<span className="faint">{last ? <>Figures last worked out {ago(last.finished_at || last.requested_at)} ({last.status === 'done' ? 'done' : last.status === 'failed' ? `failed: ${last.error}` : STATUS[last.status] || last.status}). Next scheduled run {a.data?.next ? fmtDateTime(a.data.next) : ''}.</> : 'The figures have not been worked out yet.'} <Link to="/admin/settings?tab=status">Schedule</Link></span>
				{can('manager') && <button className="btn sm" disabled={run.isPending} onClick={() => run.mutate()}><MdPlayArrow /> Work out the figures now</button>}
			</div>
		</Card>
	);
}

/** Orders and Kalyan: the file is read here, in the browser, and sent to Gita Mail a few thousand rows at a time. */
function RowsSlot({ kind, title, help, columns, can }: { kind: 'orders' | 'kalyan'; title: string; help: string; columns: string[]; can: boolean }) {
	const toast = useToast();
	const qc = useQueryClient();
	const ref = useRef<HTMLInputElement>(null);
	const [state, setState] = useState<{ step: string; pct: number } | null>(null);
	const [batch, setBatch] = useState<number | null>(null);
	const [error, setError] = useState('');
	const res = useQuery({ queryKey: ['upload', batch], enabled: !!batch, queryFn: () => api(`/uploads/${batch}`), refetchInterval: (q: any) => (q.state.data && ['done', 'failed'].includes(q.state.data.status) && (q.state.data.status === 'failed' || ['done', 'failed'].includes(q.state.data.analytics?.status)) ? false : 3000) });
	useEffect(() => { if (res.data?.status === 'done') qc.invalidateQueries({ queryKey: ['uploads'] }); }, [res.data?.status, qc]);
	const upload = async (file: File | undefined) => {
		if (!file) return;
		setError(''); setBatch(null);
		let id = 0;
		try {
			setState({ step: `Opening ${file.name}`, pct: 0 });
			const data = new Uint8Array(await file.arrayBuffer());
			let sent = 0;
			let fraction = 0;
			// 1. the rows, a few thousand at a time
			const r = await streamTableRows(data, file.name, async (rows) => {
				if (!id) {
					const head = rows.shift() || [];
					id = (await api('/uploads/start', { body: { kind, fileName: file.name, fileSize: file.size, header: head } })).id;
				}
				for (let i = 0; i < rows.length; i += 3000) {
					const part = rows.slice(i, i + 3000);
					await api(`/uploads/${id}/rows`, { body: { start: sent, rows: part } });
					sent += part.length;
				}
				setState({ step: `Sending rows: ${num(sent)} so far`, pct: Math.round(fraction * 80) });
			}, { batch: 6000, onProgress: (f) => { fraction = f; } });
			if (!id) throw new Error('The file is empty.');
			// 2. the original file, kept so it can be downloaded again
			const PART = 3_000_000;
			for (let i = 0, seq = 0; i < data.length; i += PART, seq++) {
				setState({ step: 'Keeping a copy of the original file', pct: 80 + Math.round((i / data.length) * 15) });
				await api(`/uploads/${id}/part`, { body: { seq, data: b64(data.subarray(i, i + PART)) } });
			}
			await api(`/uploads/${id}/finish`, { body: { rows: r.rows - 1 } });
			setState(null);
			setBatch(id);
			toast(`${num(r.rows - 1)} rows received. Gita Mail is working through them; you can leave this page.`);
		} catch (e: any) {
			setState(null);
			setError(e.message);
			toast(e.message, 'error');
		}
		if (ref.current) ref.current.value = '';
	};
	const b = res.data;
	return (
		<Card title={title} sub={help} accent={kind === 'orders' ? COLORS.blue : COLORS.purple}>
			{can ? (
				<>
					<input ref={ref} type="file" accept=".xlsx,.csv" hidden onChange={(e) => upload(e.target.files?.[0])} />
					<button className="btn primary" disabled={!!state} onClick={() => ref.current?.click()}><MdUploadFile /> {state ? 'Uploading…' : 'Choose file'}</button>
				</>
			) : <div className="small faint">Managers and admins can upload.</div>}
			{state && <div className="small mt-8">{state.step}<div className="meter mt-4" style={{ height: 6, background: '#eee', borderRadius: 3 }}><div style={{ width: `${state.pct}%`, height: 6, background: COLORS.blue, borderRadius: 3 }} /></div></div>}
			{error && <div className="small mt-8" style={{ color: 'var(--red)' }}>{error}</div>}
			{b && <BatchResult b={b} />}
			<details className="mt-8"><summary className="xs faint">Columns the file needs</summary><div className="xs faint">{columns.join(', ')}</div></details>
		</Card>
	);
}

function BatchResult({ b }: { b: any }) {
	const p = b.profile || {};
	return (
		<div className="small mt-8" style={{ borderTop: '1px solid var(--line, #eee)', paddingTop: 8 }}>
			<b>{b.file_name}</b>: {STATUS[b.status]}{b.step && !['done', 'queued'].includes(b.step) ? ` (${b.step})` : ''}
			{b.status === 'done' && <div>{num(b.rows_total)} {b.kind === 'orders' ? 'orders' : 'dispatches'}: {num(b.rows_new)} new, {num(b.rows_updated)} updated, {num(b.rows_unchanged)} unchanged{b.rows_rejected ? `, ${num(b.rows_rejected)} not used` : ''}.
				{p.from && <> Dates {fmtDate(p.from)} to {fmtDate(p.to)}.</>}{p.subscribers ? ` ${num(p.subscribers)} subscribers.` : ''}</div>}
			{b.status === 'done' && b.kind === 'orders' && <div className="xs faint">Delivery partners: {Object.entries(p.couriers || {}).map(([k, n]) => `${k} ${num(n as number)}`).join(', ')} · Sites: {Object.entries(p.sites || {}).map(([k, n]) => `${k} ${num(n as number)}`).join(', ')} · Status: {Object.entries(p.statuses || {}).map(([k, n]) => `${k} ${num(n as number)}`).join(', ')} · Payment: {Object.entries(p.paymentMethods || {}).map(([k, n]) => `${k} ${num(n as number)}`).join(', ')}{p.noEmail ? ` · ${num(p.noEmail)} without an email address` : ''}</div>}
			{b.status === 'done' && b.kind === 'kalyan' && <div className="xs faint">Sent by: {(p.modes || []).map((m: any) => `${m.k} ${num(m.n)}`).join(', ')} · Subscriptions: {(p.types || []).map((m: any) => `${m.k} ${num(m.n)}`).join(', ')}</div>}
			{b.error && <div style={{ color: 'var(--red)' }}>{b.error}</div>}
			{(b.warnings || []).map((w: string) => <div key={w} className="xs" style={{ color: 'var(--amber)' }}>{w}</div>)}
			{b.analytics && <div className="xs faint">Figures and customer links: {b.analytics.status === 'done' ? 'updated' : STATUS[b.analytics.status] || b.analytics.status}</div>}
		</div>
	);
}

/** The book list: what will change is shown before anything is saved. */
function BookSlot({ can }: { can: boolean }) {
	const toast = useToast();
	const qc = useQueryClient();
	const ref = useRef<HTMLInputElement>(null);
	const [file, setFile] = useState<{ fileName: string; data: string } | null>(null);
	const [preview, setPreview] = useState<any>(null);
	const check = useMutation({
		mutationFn: async (f: File) => { const body = { fileName: f.name, data: await fileToBase64(f) }; setFile(body); return api('/master/books/preview', { body }); },
		onSuccess: setPreview, onError: (e: any) => toast(e.message, 'error'),
	});
	const apply = useMutation({
		mutationFn: () => api('/master/books/upload', { body: file }),
		onSuccess: (r: any) => { setPreview(null); setFile(null); qc.invalidateQueries(); toast(`Book list saved: ${num(r.new)} new, ${num(r.changed)} changed`); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	return (
		<Card title="Book list · when it changes" accent={COLORS.teal}
			sub={<>Code, English name, Language, Hindi title, Other names (separate with ;), gitapress.org Website Link, Amazon Website Link. Rows are updated by code; nothing is deleted. <Link to="/admin/settings?tab=master&sub=books">Open the book list</Link></>}>
			{can ? <>
				<input ref={ref} type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) check.mutate(f); e.target.value = ''; }} />
				<button className="btn primary" disabled={check.isPending} onClick={() => ref.current?.click()}><MdUploadFile /> {check.isPending ? 'Checking…' : 'Choose file'}</button>
			</> : <div className="small faint">Managers and admins can upload.</div>}
			{preview && (
				<Modal wide title="Check the book list before saving" onClose={() => setPreview(null)}
					footer={<><button className="btn" onClick={() => setPreview(null)}>Cancel</button><button className="btn primary" disabled={apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? 'Saving…' : `Save ${num(preview.total)} books`}</button></>}>
					<BookPreview p={preview} />
				</Modal>
			)}
		</Card>
	);
}

export function BookPreview({ p }: { p: any }) {
	const FLAG: Record<string, string> = { no_hindi_title: 'No Hindi title', no_gitapress_link: 'No gitapress.org link', no_amazon_link: 'No Amazon link', bad_gitapress_link: 'gitapress.org link looks wrong', bad_amazon_link: 'Amazon link looks wrong', odd_other_names: 'Other names look wrong' };
	return (
		<div className="small">
			<div className="grid g-3 mb-16" style={{ gap: 8 }}>
				<div><b>{num(p.new)}</b> new</div><div><b>{num(p.changed)}</b> changed</div><div><b>{num(p.unchanged)}</b> unchanged</div>
				{p.hasStock && <><div><b>{num(p.notInTally)}</b> in the file but not in Tally stock</div><div><b>{num(p.notInFile)}</b> in Tally stock but not in the file</div></>}
				{p.shared > 0 && <div><b>{num(p.shared)}</b> links used by two codes (allowed)</div>}
			</div>
			{Object.keys(p.flags || {}).length > 0 && <div className="mb-8">Will be listed as gaps: {Object.entries(p.flags).map(([k, n]) => `${FLAG[k] || k} ${num(n as number)}`).join(' · ')}</div>}
			{(p.problems || []).map((x: string) => <div key={x} className="xs" style={{ color: 'var(--amber)' }}>{x}</div>)}
			{p.samples?.changed?.length > 0 && <details className="mt-8"><summary>Changes ({num(p.changed)})</summary><ul className="xs">{p.samples.changed.map((c: any) => <li key={c.code}>{c.code} {c.name}: {c.fields.join(', ')}</li>)}</ul></details>}
			{p.samples?.notInFile?.length > 0 && <details className="mt-8"><summary>In Tally stock but not in the file</summary><div className="xs">{p.samples.notInFile.join(', ')}{p.notInFile > p.samples.notInFile.length ? '…' : ''}</div></details>}
			{p.samples?.notInTally?.length > 0 && <details className="mt-8"><summary>In the file but not in Tally stock</summary><div className="xs">{p.samples.notInTally.join(', ')}{p.notInTally > p.samples.notInTally.length ? '…' : ''}</div></details>}
		</div>
	);
}

function PriceSlot({ can }: { can: boolean }) {
	const toast = useToast();
	const qc = useQueryClient();
	const ref = useRef<HTMLInputElement>(null);
	const up = useMutation({
		mutationFn: async (f: File) => api('/master/prices/upload', { body: { fileName: f.name, data: await fileToBase64(f) } }),
		onSuccess: (r: any) => { qc.invalidateQueries(); toast(`Price list saved: ${num(r.changed)} prices changed${r.unknown ? `, ${num(r.unknown)} codes not in the book list` : ''}`); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	return (
		<Card title="Price list · when it changes" accent={COLORS.amber}
			sub="Two columns: Code and Price (MRP). A reply quotes the highest batch price at Gorakhpur; this price is used only when a book has no batch at Gorakhpur. A full catalogue with prices can be loaded the same way.">
			{can ? <>
				<input ref={ref} type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ''; }} />
				<button className="btn primary" disabled={up.isPending} onClick={() => ref.current?.click()}><MdUploadFile /> {up.isPending ? 'Saving…' : 'Choose file'}</button>
			</> : <div className="small faint">Managers and admins can upload.</div>}
		</Card>
	);
}

/** Is each month of Kalyan dispatch complete? Warns when a month looks short, rather than counting it silently. */
function Kalyan({ months }: { months: any[] }) {
	if (!months?.length) return null;
	return (
		<Card title="Kalyan dispatch by month" className="mb-16" sub="Months well below the usual size, or with no ordinary-post dispatches, may be missing part of the file.">
			<div className="table-wrap"><table className="table">
				<thead><tr><th>Month</th><th className="num">Dispatches</th><th className="num">Subscribers</th><th className="num">Registered</th><th className="num">Ordinary</th><th>Check</th></tr></thead>
				<tbody>{months.map((m) => (
					<tr key={m.month}><td>{m.label}</td><td className="num">{num(m.n)}</td><td className="num">{num(m.subscribers)}</td><td className="num">{num(m.registered)}</td><td className="num">{num(m.ordinary)} ({m.ordinaryShare}%)</td>
						<td className="xs" style={{ color: m.warning ? 'var(--amber)' : undefined }}>{m.warning || 'Looks complete'}</td></tr>))}</tbody>
			</table></div>
		</Card>
	);
}

function History({ rows, filter, setFilter }: { rows: any[]; filter: any; setFilter: (f: any) => void }) {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const { sorted, Th } = useSort<any>(rows, { key: 'uploaded_at', dir: 'desc' });
	const del = useMutation({
		mutationFn: ({ h, permanent }: { h: any; permanent?: boolean }) => api(`${h.key[0] === 's' ? '/stock/uploads' : '/uploads'}/${h.id}${permanent ? '?permanent=1' : ''}`, { method: 'DELETE' }),
		onSuccess: (_r, v) => { qc.invalidateQueries(); toast(v.permanent ? 'Upload erased' : 'Upload removed. Its rows are taken out of use; the file is kept.'); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const original = async (h: any) => {
		const res = await fetchFile(`${h.key[0] === 's' ? '/stock/uploads' : '/uploads'}/${h.id}/file`);
		if (!res.ok) return toast('The original file is not stored for this upload', 'error');
		save(await res.blob(), h.file_name || 'upload');
	};
	return (
		<Card flush title="Upload history" sub="Every upload of every kind, kept for at least five years with its original file. Removing an upload takes its rows out of use; only an admin can erase it for good."
			actions={<div className="row gap-8">
				<button className="btn sm" onClick={async () => save(await (await fetchFile(`/uploads${qs({ ...filter, format: 'xlsx' })}`)).blob(), 'gitamail-uploads.xlsx')}><MdDownload /> Excel</button>
				<button className="btn sm" onClick={() => openPrint(`/uploads${qs({ ...filter, format: 'print' })}`)}><MdPrint /> PDF</button></div>}>
			<div className="filter-strip wrap" style={{ padding: '10px 20px' }}>
				<select className={`input sm drop ${filter.kind ? 'on' : ''}`} value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })} aria-label="Kind">
					<option value="">Every kind</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
				</select>
				<label className="row small gap-4">From <input className="input sm" type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} /></label>
				<label className="row small gap-4">to <input className="input sm" type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} /></label>
			</div>
			{!rows.length ? <Empty text="Nothing uploaded yet." /> : (
				<div className="table-wrap"><table className="table">
					<thead><tr><Th k="uploaded_at" num>Uploaded</Th><Th k="kind">Kind</Th><Th k="file_name">File</Th><Th k="rows_total" num>Rows</Th><Th k="rows_new" num>New</Th><Th k="rows_updated" num>Updated</Th><Th k="status">Status</Th><th /></tr></thead>
					<tbody>{sorted.map((h) => (
						<tr key={h.key} style={h.deleted_at ? { opacity: 0.55 } : undefined}>
							<td className="small nowrap">{fmtDateTime(h.uploaded_at)}{h.uploaded_by ? <div className="xs faint">{h.uploaded_by}</div> : null}</td>
							<td className="small">{KIND[h.kind] || h.kind}{h.period_to ? <div className="xs faint">{fmtDate(h.period_from)} to {fmtDate(h.period_to)}</div> : null}</td>
							<td className="small" style={{ maxWidth: 280 }}><span className="truncate" style={{ display: 'block' }}>{h.file_name}</span>{h.warnings?.length ? <div className="xs" style={{ color: 'var(--amber)' }} title={h.warnings.join('\n')}>{h.warnings.length} note{h.warnings.length > 1 ? 's' : ''}</div> : null}</td>
							<td className="num small">{num(h.rows_total)}</td><td className="num small">{num(h.rows_new)}</td><td className="num small">{num(h.rows_updated)}</td>
							<td className="small">{h.deleted_at ? `Removed ${ago(h.deleted_at)}` : h.error ? <span style={{ color: 'var(--red)' }} title={h.error}>Failed</span> : STATUS[h.status] || h.status}</td>
							<td className="nowrap"><div className="row gap-4" style={{ justifyContent: 'flex-end' }}>
								{h.has_file && can('manager') && <button className="btn ghost icon sm" title="Download the original file" aria-label="Download the original file" onClick={() => original(h)}><MdDownload /></button>}
								{!h.deleted_at && can('manager') && ['orders', 'kalyan', 'hq', 'branch'].includes(h.kind) && <button className="btn ghost icon sm" title="Remove (the file is kept)" aria-label="Remove upload" onClick={() => confirm('Remove this upload? Rows that only this upload brought in are taken out of use. The file is kept.') && del.mutate({ h })}><MdDelete /></button>}
								{h.deleted_at && can('admin') && <button className="btn ghost icon sm" title="Erase permanently" aria-label="Erase permanently" onClick={() => confirm('Erase this upload and its file permanently? This cannot be undone.') && del.mutate({ h, permanent: true })}><MdDelete /></button>}
							</div></td>
						</tr>))}</tbody>
				</table></div>
			)}
		</Card>
	);
}

/** How often each file is expected; an upload later than this shows as overdue. */
function Expect({ expect }: { expect: Record<string, number> }) {
	const toast = useToast();
	const qc = useQueryClient();
	const [f, setF] = useState<Record<string, number> | null>(null);
	const v = f || expect;
	const save = useMutation({ mutationFn: () => api('/uploads/settings', { method: 'PUT', body: v }), onSuccess: () => { setF(null); qc.invalidateQueries(); toast('Saved'); }, onError: (e: any) => toast(e.message, 'error') });
	return (
		<Card title="When uploads are expected" className="mt-16" sub="An upload not received within this many days of the last one shows as overdue.">
			<div className="row wrap gap-16">
				{Object.keys(expect).map((k) => (
					<label key={k} className="field" style={{ width: 170 }}><span className="small">{KIND[k]} (days)</span>
						<input className="input sm" type="number" min={1} max={365} value={v[k]} onChange={(e) => setF({ ...v, [k]: Number(e.target.value) })} /></label>
				))}
			</div>
			{f && <button className="btn primary mt-8" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>}
		</Card>
	);
}
