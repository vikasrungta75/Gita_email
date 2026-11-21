/**
 * Admin → Master data: what changes rarely. Locations · Others (delivery partners, Kalyan subscription types and
 * dispatch modes, order statuses, states) · Bank details · Discount details · Freight charges · Book list (Suchi)
 * · Book links · Books (combined). Every change is kept with who made it; bank changes are admin-only.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MdDownload, MdSave, MdUploadFile } from 'react-icons/md';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card, Loader, Modal, PageHead, Segmented } from '../../components/ui';
import { fileToBase64, inr, num } from '../../lib/purposes';
import { COLORS, ago, fmtDate, fmtDateTime } from '../../lib/format';
import { download, authFetch } from '../../lib/files';
import Addresses from './Addresses';
import { Books, Mappings } from './MasterData';
import { BookPreview } from '../Uploads';
import DataTable from '../../components/DataTable';
import { ViewSwitch } from '../../components/dash';
import { LinksDashboard, SuchiDashboard } from './BookListInsight';

const SUBS = [
	{ v: 'locations', l: 'Locations' }, { v: 'others', l: 'Others' }, { v: 'bank', l: 'Bank details' }, { v: 'discount', l: 'Discount details' }, { v: 'freight', l: 'Freight charges' },
	{ v: 'suchi', l: 'Book list (Suchi)' }, { v: 'links', l: 'Book links' }, { v: 'books', l: 'Books (combined)' },
];

export default function MasterHub() {
	const [sp, setSp] = useSearchParams();
	const sub = SUBS.find((s) => s.v === sp.get('sub'))?.v || 'books';
	const { data } = useQuery({ queryKey: ['master-values'], queryFn: () => api('/master/values') });
	return (
		<>
			<PageHead kw="Master" rest="data" sub="What changes rarely and every reply depends on. Changes are kept with who made them and when." />
			<div className="mb-16" style={{ overflowX: 'auto' }}>
				<Segmented value={sub} options={SUBS} onChange={(v) => { const n = new URLSearchParams(); n.set('sub', v); setSp(n, { replace: true }); }} />
			</div>
			{sub === 'locations' && <Addresses />}
			{sub === 'others' && <><KalyanPrices data={data} /><div className="mt-16"><Mappings /></div></>}
			{sub === 'bank' && <Bank data={data} />}
			{sub === 'discount' && <Discount data={data} />}
			{sub === 'freight' && <Freight data={data} />}
			{sub === 'suchi' && <BookSection kind="suchi" />}
			{sub === 'links' && <BookSection kind="links" />}
			{sub === 'books' && <Books />}
			{data?.history?.length > 0 && ['bank', 'discount', 'freight', 'others'].includes(sub) && (
				<details className="mt-16"><summary className="xs faint">Change history</summary>
					<div className="xs">{data.history.map((h: any, i: number) => <div key={i}>{fmtDateTime(h.changed_at)} · {data.labels[h.key] || h.key} · {h.changed_by || 'system'}</div>)}</div>
				</details>
			)}
		</>
	);
}

/** The book list (Suchi) and the book links: a dashboard, all the data, and the upload with its history. */
function BookSection({ kind }: { kind: 'suchi' | 'links' }) {
	const [sp, setSp] = useSearchParams();
	const view = sp.get('view') || 'dashboard';
	const go = (v: string, f: Record<string, string> = {}) => setSp({ sub: kind, view: v, ...f }, { replace: v === view });
	return (
		<>
			<div className="mb-16"><ViewSwitch value={view} onChange={(v) => go(v)} /></div>
			{view === 'data' ? <DataTable name={kind} />
				: view === 'upload' ? (kind === 'suchi' ? <Suchi /> : <Links />)
					: kind === 'suchi' ? <SuchiDashboard toData={(f) => go('data', f)} /> : <LinksDashboard toData={(f) => go('data', f)} />}
		</>
	);
}

function useSave(key: string, msg: string) {
	const toast = useToast();
	const qc = useQueryClient();
	return useMutation({ mutationFn: (body: any) => api(`/master/values/${key}`, { method: 'PUT', body }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['master-values'] }); toast(msg); }, onError: (e: any) => toast(e.message, 'error') });
}

function Bank({ data }: { data: any }) {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const [f, setF] = useState<any>(null);
	useEffect(() => { if (data && !f) setF({ ...data.values.bank, afterPaying: data.values.bank.afterPaying.join('\n') }); }, [data]);
	const save = useSave('bank', 'Bank details saved. Replies and quotes use them from now on.');
	const qrRef = useRef<HTMLInputElement>(null);
	const [qrUrl, setQrUrl] = useState('');
	const loadQr = async () => { const r = await authFetch('/master/bank-qr'); if (r.ok) setQrUrl(URL.createObjectURL(await r.blob())); };
	useEffect(() => { loadQr(); }, []);
	const upQr = useMutation({ mutationFn: async (file: File) => api('/master/bank-qr', { body: { fileName: file.name, type: file.type, data: await fileToBase64(file) } }), onSuccess: () => { loadQr(); qc.invalidateQueries({ queryKey: ['master-values'] }); toast('Payment QR saved'); }, onError: (e: any) => toast(e.message, 'error') });
	if (!f) return <Loader />;
	const admin = can('admin');
	const field = (k: string, l: string, hint?: string) => <div className="field"><label>{l}</label><input className="input" disabled={!admin} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />{hint && <span className="hint">{hint}</span>}</div>;
	return (
		<div className="grid g-2">
			<Card title="Bank details for payment" sub="Included in every reply about payment (new orders, Kalyan new requests, quotes, payment questions) and whenever a reader asks. International replies add SWIFT. Only an admin can change them; every change is audited." accent={COLORS.green}>
				<div className="grid g-2">
					{field('beneficiary', 'Beneficiary name')}{field('beneficiaryNote', 'Shown after the name', 'e.g. Gita Press, Gorakhpur')}
					{field('account', 'Account number')}{field('bank', 'Bank')}
					{field('branch', 'Branch')}{field('ifsc', 'IFSC (India routing)')}
					{field('swift', 'SWIFT / BIC')}{field('upi', 'UPI ID')}
				</div>
				<div className="field"><label>After paying, please send (one per line)</label><textarea className="input" rows={3} disabled={!admin} value={f.afterPaying} onChange={(e) => setF({ ...f, afterPaying: e.target.value })} /></div>
				{admin && <button className="btn primary" disabled={save.isPending} onClick={() => save.mutate({ ...f, afterPaying: String(f.afterPaying).split('\n') })}><MdSave /> Save bank details</button>}
			</Card>
			<Card title="Payment QR code" sub="Shown with the bank details in quotes. Scanning it pays Gobind Bhawan Karyalaya by UPI.">
				{qrUrl ? <img src={qrUrl} alt="Payment QR code" style={{ width: 200, height: 200, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8 }} /> : <Loader small />}
				<div className="xs faint mt-8">{data.qr?.file_name}{data.qr?.updated_at ? ` · ${ago(data.qr.updated_at)}` : ''}</div>
				{admin && <><input ref={qrRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) upQr.mutate(x); e.target.value = ''; }} />
					<button className="btn sm mt-8" onClick={() => qrRef.current?.click()}><MdUploadFile /> Replace the QR image</button></>}
			</Card>
		</div>
	);
}

function Discount({ data }: { data: any }) {
	const { can } = useAuth();
	const [f, setF] = useState<any>(null);
	useEffect(() => { if (data && !f) setF(structuredClone(data.values.discount)); }, [data]);
	const save = useSave('discount', 'Discount saved. Open quotes are worked out again.');
	if (!f) return <Loader />;
	const m = can('manager');
	const set = (i: number, k: string, v: string) => setF({ ...f, slabs: f.slabs.map((s: any, j: number) => (j === i ? { ...s, [k]: v === '' ? null : Number(v) } : s)) });
	const ex = [2000, 2500, 5001, 20000];
	const disc = (v: number) => { const s = [...f.slabs].sort((a, b) => a.from - b.from).filter((x: any) => v >= x.from).pop(); if (!s) return v; const a = v * (1 - (s.pct || 0) / 100); return s.extraPct ? a * (1 - s.extraPct / 100) : a; };
	return (
		<Card title="Discount on book purchases" sub="Applied only in email quotes and bulk-order replies, never on retail price lines. The slab is chosen by the book value; an extra % is taken off the net (₹20,000 → 20% → ₹16,000 → 5% → ₹15,200)." accent={COLORS.purple}>
			<div className="field" style={{ maxWidth: 220 }}><label>Effective from</label><input className="input" type="date" disabled={!m} value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></div>
			<div className="table-wrap"><table className="table">
				<thead><tr><th>From (₹)</th><th>To (₹, empty = no limit)</th><th>Discount %</th><th>Extra % on the net</th><th /></tr></thead>
				<tbody>{f.slabs.map((s: any, i: number) => (
					<tr key={i}>
						<td><input className="input sm" type="number" disabled={!m} value={s.from ?? ''} onChange={(e) => set(i, 'from', e.target.value)} /></td>
						<td><input className="input sm" type="number" disabled={!m} value={s.to ?? ''} onChange={(e) => set(i, 'to', e.target.value)} /></td>
						<td><input className="input sm" type="number" disabled={!m} value={s.pct ?? ''} onChange={(e) => set(i, 'pct', e.target.value)} /></td>
						<td><input className="input sm" type="number" disabled={!m} value={s.extraPct ?? ''} onChange={(e) => set(i, 'extraPct', e.target.value)} /></td>
						<td>{m && <button className="btn ghost sm" onClick={() => setF({ ...f, slabs: f.slabs.filter((_x: any, j: number) => j !== i) })}>×</button>}</td>
					</tr>
				))}</tbody>
			</table></div>
			<div className="xs faint mt-8">Check: {ex.map((v) => `${inr(v)} → ${inr(Math.round(disc(v) * 100) / 100)}`).join(' · ')}</div>
			{m && <div className="row gap-8 mt-8"><button className="btn sm" onClick={() => setF({ ...f, slabs: [...f.slabs, { from: 0, to: null, pct: 0 }] })}>+ Slab</button><button className="btn primary sm" disabled={save.isPending} onClick={() => save.mutate(f)}><MdSave /> Save</button></div>}
		</Card>
	);
}

function Freight({ data }: { data: any }) {
	const { can } = useAuth();
	const [f, setF] = useState<any>(null);
	useEffect(() => { if (data && !f) setF(structuredClone(data.values.freight)); }, [data]);
	const save = useSave('freight', 'Freight charges saved.');
	if (!f) return <Loader />;
	const m = can('manager');
	const set = (i: number, k: string, v: string) => setF({ ...f, slabs: f.slabs.map((s: any, j: number) => (j === i ? { ...s, [k]: Number(v) } : s)) });
	const post = (v: number) => (f.freeAbove !== null && f.freeAbove !== '' && v > Number(f.freeAbove) ? 0 : ([...f.slabs].sort((a, b) => a.to - b.to).find((s: any) => v <= s.to)?.postage ?? f.slabs.at(-1)?.postage));
	return (
		<Card title="Freight charges (postage within India)" sub="Postage by book value, before any discount. Checked against 3,015 real orders: every order up to ₹1,000 matches these slabs and every order above ₹1,000 shipped free." accent={COLORS.amber}>
			<div className="table-wrap"><table className="table">
				<thead><tr><th>Book value up to (₹)</th><th>Postage (₹)</th><th /></tr></thead>
				<tbody>{f.slabs.map((s: any, i: number) => (
					<tr key={i}><td><input className="input sm" type="number" disabled={!m} value={s.to} onChange={(e) => set(i, 'to', e.target.value)} /></td><td><input className="input sm" type="number" disabled={!m} value={s.postage} onChange={(e) => set(i, 'postage', e.target.value)} /></td>
						<td>{m && <button className="btn ghost sm" onClick={() => setF({ ...f, slabs: f.slabs.filter((_x: any, j: number) => j !== i) })}>×</button>}</td></tr>
				))}</tbody>
			</table></div>
			<div className="grid g-2 mt-8">
				<div className="field"><label>Free postage above (₹)</label><input className="input" type="number" disabled={!m} value={f.freeAbove ?? ''} onChange={(e) => setF({ ...f, freeAbove: e.target.value === '' ? null : Number(e.target.value) })} /></div>
				<div className="field"><label>International shipping (used in replies abroad)</label><input className="input" disabled={!m} value={f.international || ''} placeholder="Not set: replies abroad ask for it" onChange={(e) => setF({ ...f, international: e.target.value })} /><span className="hint">Until this is set, international replies ask a question you can answer once for all emails.</span></div>
			</div>
			<div className="xs faint">Check: {[100, 101, 700, 1000, 1001].map((v) => `${inr(v)} → ${post(v) === 0 ? 'free' : inr(post(v))}`).join(' · ')}</div>
			{m && <div className="row gap-8 mt-8"><button className="btn sm" onClick={() => setF({ ...f, slabs: [...f.slabs, { to: 0, postage: 0 }] })}>+ Slab</button><button className="btn primary sm" disabled={save.isPending} onClick={() => save.mutate(f)}><MdSave /> Save</button></div>}
		</Card>
	);
}

function KalyanPrices({ data }: { data: any }) {
	const { can } = useAuth();
	const [f, setF] = useState<any>(null);
	useEffect(() => { if (data && !f) setF(structuredClone(data.values.kalyan_prices)); }, [data]);
	const save = useSave('kalyan_prices', 'Kalyan prices saved.');
	if (!f) return <Loader />;
	const L: Record<string, string> = { '1Y': '1 year', FY: '5 years', LM: 'Life member' };
	return (
		<Card title="Kalyan subscription prices" sub="Used in replies to new subscription requests. Leave empty until confirmed: replies then ask for them.">
			<div className="row wrap gap-16">
				{Object.keys(f.prices).map((k) => <div key={k} className="field" style={{ width: 160 }}><label>{L[k] || k} (₹)</label><input className="input" type="number" disabled={!can('manager')} value={f.prices[k] ?? ''} onChange={(e) => setF({ ...f, prices: { ...f.prices, [k]: e.target.value === '' ? null : Number(e.target.value) } })} /></div>)}
			</div>
			{can('manager') && <button className="btn primary sm" disabled={save.isPending} onClick={() => save.mutate(f)}><MdSave /> Save</button>}
		</Card>
	);
}

function Suchi() {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const ref = useRef<HTMLInputElement>(null);
	const [replaceEdits, setReplaceEdits] = useState(false);
	const check = useMutation({ mutationFn: async (f: File) => api('/master/suchi/preview', { body: { fileName: f.name, data: await fileToBase64(f) } }), onError: (e: any) => toast(e.message, 'error') });
	const apply = useMutation({ mutationFn: () => api('/master/suchi/apply', { body: { replaceEdits } }), onSuccess: (r: any) => { check.reset(); qc.invalidateQueries(); toast(`Book list saved: ${num(r.rows)} titles (${num(r.new)} new, ${num(r.changed)} changed)`); }, onError: (e: any) => toast(e.message, 'error') });
	const ups = useQuery({ queryKey: ['master-uploads'], queryFn: () => api('/master/uploads') });
	const p = check.data;
	return (
		<>
			<Card className="mb-16" title="Book list (सूची-पत्र, Suchi)" accent={COLORS.teal}
				sub="The code-wise catalogue: code, title, size, pages, books per carton, price, other-language editions and sets. Upload the PDF (e.g. Final_Gita_Press_Suchi_Codewise_Oct_2026_V8.pdf) or the Excel version; the check summary is shown before anything is saved. On the cloud server the PDF's Hindi titles are read cleanly; on Windows the numbers are read correctly but Hindi letters may be garbled, so the Hindi title from the book links file is shown, or upload the Excel version."
				actions={<button className="btn sm" onClick={() => download('/master/suchi/export', 'gita-press-suchi.xlsx').catch((e) => toast(e.message, 'error'))}><MdDownload /> Excel (current list)</button>}>
				{can('manager') ? <>
					<input ref={ref} type="file" accept=".pdf,.xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) check.mutate(f); e.target.value = ''; }} />
					<button className="btn primary" disabled={check.isPending} onClick={() => ref.current?.click()}><MdUploadFile /> {check.isPending ? 'Reading the catalogue…' : 'Choose PDF or Excel'}</button>
				</> : <div className="small faint">Managers and admins can upload.</div>}
			</Card>
			{p && (
				<Modal wide title="Check the book list before saving" onClose={() => check.reset()}
					footer={<><label className="small row gap-4 grow"><input type="checkbox" checked={replaceEdits} onChange={(e) => setReplaceEdits(e.target.checked)} /> Replace prices and sizes edited by hand in Gita Mail</label><button className="btn" onClick={() => check.reset()}>Cancel</button><button className="btn primary" disabled={apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? 'Saving…' : `Save ${num(p.rows)} titles`}</button></>}>
					<div className="grid g-3 small" style={{ gap: 8 }}>
						<div><b>{num(p.rows)}</b> titles read ({p.reader === 'pdftotext' ? 'PDF, full text' : p.reader === 'excel' ? 'Excel' : 'PDF, built-in reader'})</div>
						<div><b>{num(p.new)}</b> new · <b>{num(p.changed)}</b> changed · <b>{num(p.unchanged)}</b> unchanged</div>
						<div><b>{num(p.priceChanges)}</b> price changes</div>
						<div><b>{num(p.sets)}</b> sets · <b>{num(p.bestSellers)}</b> best sellers</div>
						{p.withoutPrice > 0 && <div style={{ color: 'var(--amber)' }}><b>{num(p.withoutPrice)}</b> without a price</div>}
						{p.onlyInLinks > 0 && <div><b>{num(p.onlyInLinks)}</b> codes in the links file but not in this list</div>}
					</div>
					{p.previous && <div className="xs faint mt-8">Previous upload: {num(p.previous.rows)} titles, {fmtDate(p.previous.at)}</div>}
					{p.examples?.length > 0 && <div className="xs mt-8">Price changes: {p.examples.join(' · ')}</div>}
					{(p.problems || []).map((x: string) => <div key={x} className="xs" style={{ color: 'var(--amber)' }}>{x}</div>)}
					<div className="table-wrap mt-16"><table className="table">
						<thead><tr><th>Code</th><th>Title</th><th>Size</th><th className="num">Pages</th><th className="num">Per carton</th><th className="num">Price</th></tr></thead>
						<tbody>{p.sample.map((e: any) => <tr key={e.code}><td className="mono xs">{e.code}</td><td className="xs">{e.title}{e.set ? ` · set ${e.set.setCode}` : ''}</td><td className="xs">{e.sizeEn}</td><td className="num xs">{e.pages}</td><td className="num xs">{e.carton ?? '—'}</td><td className="num xs">{inr(e.price)}</td></tr>)}</tbody>
					</table></div>
				</Modal>
			)}
			<Card title="Uploads of the book list" flush>
				<div className="table-wrap"><table className="table"><thead><tr><th>Uploaded</th><th>File</th><th className="num">Titles</th><th className="num">New</th><th className="num">Changed</th><th>By</th><th /></tr></thead>
					<tbody>{(ups.data || []).filter((u: any) => u.kind === 'suchi').map((u: any) => (
						<tr key={u.id}><td className="xs">{fmtDateTime(u.uploaded_at)}</td><td className="small">{u.file_name}</td><td className="num small">{num(u.summary?.rows)}</td><td className="num small">{num(u.summary?.new)}</td><td className="num small">{num(u.summary?.changed)}</td><td className="xs">{u.uploaded_by}</td>
							<td><button className="btn ghost icon sm" aria-label="Download" onClick={() => download(`/master/uploads/${u.id}/file`, u.file_name).catch((e) => toast(e.message, 'error'))}><MdDownload /></button></td></tr>
					))}</tbody></table></div>
			</Card>
		</>
	);
}

function Links() {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const ref = useRef<HTMLInputElement>(null);
	const [file, setFile] = useState<{ fileName: string; data: string } | null>(null);
	const check = useMutation({ mutationFn: async (f: File) => { const body = { fileName: f.name, data: await fileToBase64(f) }; setFile(body); return api('/master/books/preview', { body }); }, onError: (e: any) => toast(e.message, 'error') });
	const apply = useMutation({ mutationFn: () => api('/master/books/upload', { body: file }), onSuccess: (r: any) => { check.reset(); setFile(null); qc.invalidateQueries(); toast(`Book links saved: ${num(r.new)} new, ${num(r.changed)} changed`); }, onError: (e: any) => toast(e.message, 'error') });
	return (
		<Card title="Book links" accent={COLORS.blue}
			sub="gitamail-hindi-titles_with_AWS_link.xlsx: Code, English name, Language, Hindi title, Other names (separate with ;), gitapress.org Website Link, Amazon Website Link. These are where readers can buy online, and are shared in replies when a reader asks where or how to buy. #N/A means empty. Rows update by code; the check summary is shown first.">
			{can('manager') ? <>
				<input ref={ref} type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) check.mutate(f); e.target.value = ''; }} />
				<button className="btn primary" disabled={check.isPending} onClick={() => ref.current?.click()}><MdUploadFile /> {check.isPending ? 'Checking…' : 'Choose file'}</button>
			</> : <div className="small faint">Managers and admins can upload.</div>}
			{check.data && (
				<Modal wide title="Check the book links before saving" onClose={() => check.reset()}
					footer={<><button className="btn" onClick={() => check.reset()}>Cancel</button><button className="btn primary" disabled={apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? 'Saving…' : `Save ${num(check.data.total)} books`}</button></>}>
					<BookPreview p={check.data} />
				</Modal>
			)}
		</Card>
	);
}
