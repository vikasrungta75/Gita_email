import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MdAdd, MdDelete, MdDownload, MdEdit, MdPrint, MdRestore, MdSearch } from 'react-icons/md';
import { api, getToken, qs } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card, Empty, Loader, Modal, Segmented } from '../../components/ui';
import { fileToBase64, inr, num } from '../../lib/purposes';
import { COLORS, ago } from '../../lib/format';
import Addresses from './Addresses';

const SUBS = [
	{ v: 'books', l: 'Books' }, { v: 'addresses', l: 'Addresses' }, { v: 'catalogues', l: 'Catalogues' }, { v: 'mappings', l: 'Names and codes' }, { v: 'festivals', l: 'Festival calendar' }, { v: 'tiers', l: 'Customer tiers' },
];
const save = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); };
const get = (path: string) => fetch(`/api${path}`, { headers: { authorization: `Bearer ${getToken()}` } });

/** Settings → Master data: the lists everything else is linked to. The book code is the key for every book. */
export default function MasterData() {
	const [sp, setSp] = useSearchParams();
	const sub = SUBS.find((s) => s.v === sp.get('sub'))?.v || 'books';
	return (
		<>
			<div className="mb-16" style={{ overflowX: 'auto' }}>
				<Segmented value={sub} options={SUBS} onChange={(v) => { const n = new URLSearchParams(sp); n.set('sub', v); ['q', 'language', 'missing', 'status', 'sort', 'dir'].forEach((k) => n.delete(k)); setSp(n, { replace: true }); }} />
			</div>
			{sub === 'books' && <Books />}
			{sub === 'addresses' && <Addresses />}
			{sub === 'catalogues' && <Catalogues />}
			{sub === 'mappings' && <Mappings />}
			{sub === 'festivals' && <Festivals />}
			{sub === 'tiers' && <Tiers />}
		</>
	);
}

// ── Books ────────────────────────────────────────────────────────────────────

const COLS: [string, string][] = [['code', 'Code'], ['name', 'English name'], ['language', 'Language'], ['hindi', 'Hindi title'], ['family', 'Title family'], ['gitapress', 'gitapress.org'], ['amazon', 'Amazon'], ['mrp', 'Price'], ['status', 'Status']];

function Books() {
	const { can } = useAuth();
	const manager = can('manager');
	const toast = useToast();
	const qc = useQueryClient();
	const [sp, setSp] = useSearchParams();
	const f = { q: sp.get('q') || '', language: sp.get('language') || '', missing: sp.get('missing') || '', status: sp.get('status') || '', sort: sp.get('sort') || 'code', dir: sp.get('dir') || 'asc' };
	const setF = (patch: Partial<typeof f>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); } setSp(n, { replace: true }); };
	const [search, setSearch] = useState(f.q);
	useEffect(() => { const t = setTimeout(() => search !== f.q && setF({ q: search }), 300); return () => clearTimeout(t); });
	const [limit, setLimit] = useState(100);
	const { data, isLoading, isFetching } = useQuery({ queryKey: ['books', f, limit], queryFn: () => api(`/master/books${qs({ ...f, limit })}`), placeholderData: keepPreviousData });
	const [edit, setEdit] = useState<any>(null);
	const done = (msg: string) => ({ onSuccess: () => { qc.invalidateQueries({ queryKey: ['books'] }); toast(msg); }, onError: (e: any) => toast(e.message, 'error') });
	const remove = useMutation({ mutationFn: (code: string) => api(`/master/books/${encodeURIComponent(code)}`, { method: 'DELETE' }), ...done('Book removed. It can be restored from the Removed filter.') });
	const restore = useMutation({ mutationFn: (code: string) => api(`/master/books/${encodeURIComponent(code)}/restore`, { body: {} }), ...done('Book restored') });
	const t = data?.totals || {};
	const flagN = (k: string) => t.flags?.[k] || 0;
	const sortBy = (k: string) => setF({ sort: k, dir: f.sort === k && f.dir === 'asc' ? 'desc' : 'asc' });
	const Th = ({ k, l }: { k: string; l: string }) => (
		<th className={`sortable${f.sort === k ? ' on' : ''}`} aria-sort={f.sort === k ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
			<button type="button" className="th-sort" onClick={() => sortBy(k)}>{l}<span className="arrow">{f.sort === k ? (f.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button>
		</th>
	);
	const link = (u?: string) => (u ? <a href={u} target="_blank" rel="noreferrer" className="xs">open</a> : <span className="faint xs">missing</span>);
	return (
		<>
			<Card className="mb-16" title="Book list" accent={COLORS.teal}
				sub={<>One row per book code. Stock, links, prices, replies and recommendations all use the code. Upload the whole list on the <Link to="/uploads">Uploads</Link> page; a code that first appears in a Tally stock file is added here automatically and marked "Needs details".</>}
				actions={<div className="row gap-8">
					{manager && <button className="btn sm primary" onClick={() => setEdit({ code: '', name: '', language: 'Hindi', _new: true })}><MdAdd /> Add a book</button>}
					<button className="btn sm" onClick={async () => save(await (await get(`/master/books${qs({ ...f, format: 'xlsx' })}`)).blob(), 'gitamail-book-list.xlsx')}><MdDownload /> Excel</button>
					<button className="btn sm" onClick={async () => { const w = window.open('', '_blank'); const r = await get(`/master/books${qs({ ...f, format: 'print' })}`); if (w) { w.document.write(await r.text()); w.document.close(); } }}><MdPrint /> PDF</button>
				</div>}>
				<div className="row wrap gap-16 small">
					<span><b>{num(t.books)}</b> books</span><span><b>{num(t.families)}</b> title families</span>
					<button className="btn ghost sm" onClick={() => setF({ status: 'needs_details' })}><span className="badge amber">{num(t.needs_details)}</span> need details</button>
					<button className="btn ghost sm" onClick={() => setF({ missing: 'no_amazon_link' })}>{num(flagN('no_amazon_link'))} without an Amazon link</button>
					<button className="btn ghost sm" onClick={() => setF({ missing: 'no_gitapress_link' })}>{num(flagN('no_gitapress_link'))} without a gitapress.org link</button>
					<button className="btn ghost sm" onClick={() => setF({ missing: 'no_hindi_title' })}>{num(flagN('no_hindi_title'))} without a Hindi title</button>
				</div>
			</Card>
			<div className="filter-strip wrap mb-16">
				<div className="search-box"><MdSearch /><input className="input sm" placeholder="Search code, English name, Hindi title or other names" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search books" /></div>
				<select className={`input sm drop ${f.language ? 'on' : ''}`} value={f.language} onChange={(e) => setF({ language: e.target.value })} aria-label="Language">
					<option value="">Every language</option>{(t.languages || []).map((l: any) => <option key={l.k} value={l.k}>{l.k} ({num(l.n)})</option>)}
				</select>
				<select className={`input sm drop ${f.missing ? 'on' : ''}`} value={f.missing} onChange={(e) => setF({ missing: e.target.value })} aria-label="Missing">
					<option value="">Any details</option>{Object.entries(data?.flagLabels || {}).map(([k, l]) => <option key={k} value={k}>{l as string} ({num(flagN(k))})</option>)}
				</select>
				<select className={`input sm drop ${f.status ? 'on' : ''}`} value={f.status} onChange={(e) => setF({ status: e.target.value })} aria-label="Status">
					<option value="">Active and needs details</option><option value="active">Active</option><option value="needs_details">Needs details</option><option value="removed">Removed ({num(t.removed)})</option>
				</select>
				{(f.q || f.language || f.missing || f.status) && <button className="btn ghost sm" onClick={() => { setSearch(''); setF({ q: '', language: '', missing: '', status: '' }); }}>Clear filters</button>}
			</div>
			<Card flush>
				{isLoading ? <Loader /> : !data?.rows?.length ? <Empty text="No books match." /> : (
					<>
						<div className="table-wrap"><table className="table">
							<thead><tr>{COLS.map(([k, l]) => <Th key={k} k={k} l={l} />)}<th /></tr></thead>
							<tbody>{data.rows.map((b: any) => (
								<tr key={b.code} className={manager ? 'click' : ''} onClick={() => manager && setEdit(b)}>
									<td className="mono small">{b.code}</td>
									<td className="small" style={{ maxWidth: 280 }}><b>{b.name}</b>{b.aliases?.length ? <div className="xs faint truncate">Also: {b.aliases.join('; ')}</div> : null}</td>
									<td className="small">{b.language}</td>
									<td className="small" style={{ maxWidth: 220 }}>{b.hindi_title || <span className="faint">–</span>}</td>
									<td className="xs" style={{ maxWidth: 180 }}>{b.family ? <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setSearch(b.family); setF({ q: b.family }); }} title="Show every edition">{b.family}</button> : '–'}{b.family_manual ? <span className="faint"> (set by hand)</span> : null}</td>
									<td>{link(b.gitapress_url)}</td><td>{link(b.amazon_url)}</td>
									<td className="num small">{b.mrp != null ? inr(b.mrp) : <span className="faint">–</span>}</td>
									<td className="small">{b.status === 'needs_details' ? <span className="badge amber">Needs details</span> : b.status === 'removed' ? <span className="badge">Removed</span> : 'Active'}
										{(b.flags || []).includes('shared_link') && <div className="xs faint">link shared with another code</div>}</td>
									<td className="nowrap" onClick={(e) => e.stopPropagation()}>{manager && (b.status === 'removed'
										? <button className="btn ghost icon sm" title="Restore" aria-label="Restore" onClick={() => restore.mutate(b.code)}><MdRestore /></button>
										: <><button className="btn ghost icon sm" title="Edit" aria-label="Edit" onClick={() => setEdit(b)}><MdEdit /></button>
											<button className="btn ghost icon sm" title="Remove (can be restored)" aria-label="Remove" onClick={() => confirm(`Remove ${b.code} ${b.name} from the book list? Its stock and history stay, and it can be restored.`) && remove.mutate(b.code)}><MdDelete /></button></>)}</td>
								</tr>))}</tbody>
						</table></div>
						<div className="row-between" style={{ padding: '10px 20px' }}>
							<span className="small faint">{num(data.rows.length)} of {num(data.total)} shown{isFetching ? ' · updating' : ''}</span>
							{data.rows.length < data.total && <button className="btn sm" onClick={() => setLimit(limit + 200)}>Show 200 more</button>}
						</div>
					</>
				)}
			</Card>
			{edit && <BookEditor b={edit} onClose={() => setEdit(null)} languages={(t.languages || []).map((l: any) => l.k)} />}
		</>
	);
}

function BookEditor({ b, onClose, languages }: { b: any; onClose: () => void; languages: string[] }) {
	const toast = useToast();
	const qc = useQueryClient();
	const isNew = !!b._new;
	const [f, setF] = useState<any>({ code: b.code, name: b.name, language: b.language, hindi_title: b.hindi_title || '', aliases: (b.aliases || []).join('; '), gitapress_url: b.gitapress_url || '', amazon_url: b.amazon_url || '', family: b.family_manual ? b.family : '', category: b.category || '', mrp: b.mrp ?? '', lead_days: b.lead_days ?? '', cover_days: b.cover_days ?? '', min_print: b.min_print ?? '' });
	const go = useMutation({
		mutationFn: () => (isNew ? api('/master/books', { body: f }) : api(`/master/books/${encodeURIComponent(b.code)}`, { method: 'PATCH', body: { ...f, code: undefined } })),
		onSuccess: () => { qc.invalidateQueries({ queryKey: ['books'] }); toast(isNew ? 'Book added' : 'Book saved'); onClose(); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const field = (k: string, l: string, hint?: string, type = 'text') => (
		<div className="field"><label>{l}</label><input className="input" type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />{hint && <span className="hint">{hint}</span>}</div>
	);
	return (
		<Modal wide title={isNew ? 'Add a book' : `${b.code} · ${b.name}`} onClose={onClose}
			footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={go.isPending} onClick={() => go.mutate()}>Save</button></>}>
			<div className="grid g-2">
				{isNew ? field('code', 'Code') : <div className="field"><label>Code</label><input className="input" value={b.code} disabled /></div>}
				{field('name', 'English name')}
				<div className="field"><label>Language</label><input className="input" list="book-languages" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} /><datalist id="book-languages">{languages.map((l) => <option key={l} value={l} />)}</datalist></div>
				{field('hindi_title', 'Hindi title', 'A code at the end, such as "- ( 1 )", is removed.')}
				<div className="field" style={{ gridColumn: '1 / -1' }}><label>Other names (separate with ;)</label><input className="input" value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} /><span className="hint">Other ways readers write the title, in English or Hindi. Used to recognise the book in emails.</span></div>
				{field('gitapress_url', 'gitapress.org link', 'A page on gitapress.org')}
				{field('amazon_url', 'Amazon link', 'A page on amazon.in or amazon.com')}
				{field('family', 'Title family', b.family && !b.family_manual ? `Filled in automatically: "${b.family}". Type a name to set it by hand; leave empty to keep it automatic.` : 'Groups the language editions of one work. Leave empty to fill it in automatically.')}
				{field('category', 'Category', 'For example Children, Gita, Ramayana. Used for catalogues.')}
				{field('mrp', 'Price (MRP)', 'Used only when the book has no batch at Gorakhpur.', 'number')}
				{field('lead_days', 'Print lead time (days)', 'Leave empty for the general value.', 'number')}
				{field('cover_days', 'Days of stock to print for', 'Leave empty for the general value.', 'number')}
				{field('min_print', 'Minimum print run', 'Leave empty for none.', 'number')}
			</div>
		</Modal>
	);
}

// ── Catalogues ───────────────────────────────────────────────────────────────

function Catalogues() {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const { data } = useQuery({ queryKey: ['catalogues'], queryFn: () => api('/master/catalogues') });
	const [edit, setEdit] = useState<any>(null);
	const ref = useRef<HTMLInputElement>(null);
	const [file, setFile] = useState<File | null>(null);
	const saveC = useMutation({
		mutationFn: async () => api('/master/catalogues', { body: { ...edit, ...(file ? { fileName: file.name, contentType: file.type, data: await fileToBase64(file) } : {}) } }),
		onSuccess: () => { qc.invalidateQueries({ queryKey: ['catalogues'] }); setEdit(null); setFile(null); toast('Catalogue saved'); }, onError: (e: any) => toast(e.message, 'error'),
	});
	const del = useMutation({ mutationFn: (id: number) => api(`/master/catalogues/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['catalogues'] }) });
	return (
		<Card flush title="Catalogues" accent={COLORS.purple} sub="When a reader asks for a kind of book (for example children's books) rather than a title, the reply sends the matching catalogue. Add a file or a link per category, with words readers use for it."
			actions={can('manager') ? <button className="btn sm primary" onClick={() => setEdit({ category: '', title: '', url: '', keywords: '' })}><MdAdd /> Add a catalogue</button> : undefined}>
			{!data ? <Loader /> : !data.catalogues.length ? <Empty text="No catalogues yet." /> : (
				<div className="table-wrap"><table className="table">
					<thead><tr><th>Category</th><th>Title</th><th>Words readers use</th><th>File or link</th><th>Updated</th><th /></tr></thead>
					<tbody>{data.catalogues.map((c: any) => (
						<tr key={c.id}><td><b>{c.category}</b></td><td className="small">{c.title}</td><td className="xs">{(c.keywords || []).join(', ')}</td>
							<td className="small">{c.file_name && <button className="btn ghost sm" onClick={async () => save(await (await get(`/master/catalogues/${c.id}/file`)).blob(), c.file_name)}><MdDownload /> {c.file_name}</button>}{c.url && <a href={c.url} target="_blank" rel="noreferrer">link</a>}</td>
							<td className="small">{ago(c.updated_at)}{c.updated_by ? ` · ${c.updated_by}` : ''}</td>
							<td className="nowrap">{can('manager') && <><button className="btn ghost icon sm" aria-label="Edit" onClick={() => setEdit({ id: c.id, category: c.category, title: c.title, url: c.url || '', keywords: (c.keywords || []).join(', ') })}><MdEdit /></button><button className="btn ghost icon sm" aria-label="Remove" onClick={() => confirm('Remove this catalogue?') && del.mutate(c.id)}><MdDelete /></button></>}</td></tr>))}</tbody>
				</table></div>
			)}
			{edit && (
				<Modal title={edit.id ? 'Edit catalogue' : 'Add a catalogue'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={saveC.isPending} onClick={() => saveC.mutate()}>Save</button></>}>
					<div className="col gap-16">
						<div className="field"><label>Category</label><input className="input" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} placeholder="Children's books" /></div>
						<div className="field"><label>Title</label><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
						<div className="field"><label>Words readers use (separate with commas)</label><input className="input" value={edit.keywords} onChange={(e) => setEdit({ ...edit, keywords: e.target.value })} placeholder="children, kids, बच्चों" /></div>
						<div className="field"><label>Link</label><input className="input" value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="https://" /></div>
						<div className="field"><label>Or a file (PDF, up to 15 MB)</label><input ref={ref} type="file" accept=".pdf,.xlsx,.jpg,.png" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
					</div>
				</Modal>
			)}
		</Card>
	);
}

// ── Names and codes (courier names, tracking websites, states, languages, Kalyan codes) ──

const MAP_SECTIONS: { k: string; l: string; sub: string; keyLabel: string; valLabel: string }[] = [
	{ k: 'couriers', l: 'Delivery partners', sub: 'How each delivery partner is written in the orders file, and the name Gita Mail shows.', keyLabel: 'As written in the file', valLabel: 'Delivery partner' },
	{ k: 'courierSites', l: 'Tracking websites', sub: 'The website shared with a tracking number in replies.', keyLabel: 'Delivery partner', valLabel: 'Tracking website' },
	{ k: 'states', l: 'States', sub: 'Other spellings of a state in the Kalyan file (letters only).', keyLabel: 'As written', valLabel: 'State' },
	{ k: 'languages', l: 'Languages', sub: 'Other names for a language, matched to the spelling in the book list.', keyLabel: 'Other name', valLabel: 'Language in the book list' },
	{ k: 'orderStatus', l: 'Order status codes', sub: 'Used when the orders file has a status code but no label.', keyLabel: 'Code', valLabel: 'Status' },
	{ k: 'subperiod', l: 'Kalyan subscription types', sub: '1Y, FY and LM as confirmed by Gita Press.', keyLabel: 'Code', valLabel: 'Meaning' },
	{ k: 'dispMode', l: 'Kalyan dispatch modes', sub: 'How each dispatch mode is described.', keyLabel: 'Code', valLabel: 'Meaning' },
];

function Mappings() {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const { data } = useQuery({ queryKey: ['mappings'], queryFn: () => api('/master/mappings') });
	const [add, setAdd] = useState<Record<string, { a: string; b: string }>>({});
	const saveM = useMutation({ mutationFn: (body: any) => api('/master/mappings', { method: 'PUT', body }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['mappings'] }); setAdd({}); toast('Saved'); }, onError: (e: any) => toast(e.message, 'error') });
	if (!data) return <Loader />;
	return (
		<div className="col gap-16">
			{data.statesNotRecognised?.length > 0 && <Card title="States not recognised" accent={COLORS.amber} sub="Kalyan subscribers whose state could not be read and who have no usable PIN code. Add the spelling below.">
				<div className="xs">{data.statesNotRecognised.map((s: any) => `${s.k} (${num(s.n)})`).join(' · ')}</div></Card>}
			<div className="grid g-2">
				{MAP_SECTIONS.map((sec) => {
					const m = data.mappings[sec.k] || {};
					const own = data.saved?.[sec.k] || {};
					const a = add[sec.k] || { a: '', b: '' };
					return (
						<Card key={sec.k} title={sec.l} sub={sec.sub}>
							<div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}><table className="table">
								<thead><tr><th>{sec.keyLabel}</th><th>{sec.valLabel}</th></tr></thead>
								<tbody>{Object.entries(m).map(([k, v]) => <tr key={k}><td className="small">{k}</td><td className="small">{String(v)}{k in own ? <span className="badge" style={{ marginLeft: 6 }}>added</span> : null}</td></tr>)}</tbody>
							</table></div>
							{sec.k === 'couriers' && data.couriersSeen?.length > 0 && <div className="xs faint mt-8">In the orders on file: {data.couriersSeen.map((c: any) => `${c.k} (${num(c.n)})`).join(', ')}</div>}
							{can('manager') && <div className="row gap-8 mt-8">
								<input className="input sm" placeholder={sec.keyLabel} value={a.a} onChange={(e) => setAdd({ ...add, [sec.k]: { ...a, a: e.target.value } })} />
								<input className="input sm" placeholder={sec.valLabel} value={a.b} onChange={(e) => setAdd({ ...add, [sec.k]: { ...a, b: e.target.value } })} />
								<button className="btn sm" disabled={!a.a || !a.b || saveM.isPending} onClick={() => saveM.mutate({ [sec.k]: { ...own, [a.a]: a.b } })}>Add</button>
							</div>}
						</Card>
					);
				})}
			</div>
		</div>
	);
}

// ── Festival calendar ────────────────────────────────────────────────────────

function Festivals() {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const { data } = useQuery({ queryKey: ['mappings'], queryFn: () => api('/master/mappings') });
	const [list, setList] = useState<any[] | null>(null);
	const rows = list || data?.festivals || [];
	const saveF = useMutation({ mutationFn: () => api('/master/festivals', { method: 'PUT', body: { festivals: rows } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['mappings'] }); setList(null); toast('Festival calendar saved'); }, onError: (e: any) => toast(e.message, 'error') });
	if (!data) return <Loader />;
	const set = (i: number, k: string, v: any) => setList(rows.map((r: any, j: number) => (j === i ? { ...r, [k]: v } : r)));
	return (
		<Card title="Festival calendar" accent={COLORS.pink} sub="Extra stock ahead of festivals, used in the ship and print lists until a year of history shows the real seasonal pattern. Enter this year's date for each festival.">
			<div className="table-wrap"><table className="table">
				<thead><tr><th>Festival</th><th>Date</th><th className="num">Extra sales (%)</th><th className="num">Days before to have stock in place</th><th /></tr></thead>
				<tbody>{rows.map((r: any, i: number) => (
					<tr key={i}><td><input className="input sm" disabled={!can('manager')} value={r.name} onChange={(e) => set(i, 'name', e.target.value)} /></td>
						<td><input className="input sm" type="date" disabled={!can('manager')} value={r.date} onChange={(e) => set(i, 'date', e.target.value)} /></td>
						<td className="num"><input className="input sm" type="number" style={{ width: 90 }} disabled={!can('manager')} value={r.upliftPct} onChange={(e) => set(i, 'upliftPct', Number(e.target.value))} /></td>
						<td className="num"><input className="input sm" type="number" style={{ width: 90 }} disabled={!can('manager')} value={r.leadDays} onChange={(e) => set(i, 'leadDays', Number(e.target.value))} /></td>
						<td>{can('manager') && <button className="btn ghost icon sm" aria-label="Remove" onClick={() => setList(rows.filter((_: any, j: number) => j !== i))}><MdDelete /></button>}</td></tr>))}</tbody>
			</table></div>
			{can('manager') && <div className="row gap-8 mt-8"><button className="btn sm" onClick={() => setList([...rows, { name: '', date: '', upliftPct: 20, leadDays: 30 }])}><MdAdd /> Add a festival</button>{list && <button className="btn sm primary" disabled={saveF.isPending} onClick={() => saveF.mutate()}>Save</button>}</div>}
		</Card>
	);
}

// ── Customer tiers ───────────────────────────────────────────────────────────

function Tiers() {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const { data } = useQuery({ queryKey: ['tiers'], queryFn: () => api('/settings/tiers') });
	const [f, setF] = useState<any>(null);
	const v = f || data?.settings;
	const saveT = useMutation({ mutationFn: () => api('/settings/tiers', { method: 'PUT', body: v }), onSuccess: () => { qc.invalidateQueries(); setF(null); toast('Tiers worked out again'); }, onError: (e: any) => toast(e.message, 'error') });
	if (!data || !v) return <Loader />;
	const n = (k: string, l: string, hint: string) => (
		<div className="field"><label>{l}</label><input className="input" type="number" step="any" disabled={!can('manager')} value={v[k]} onChange={(e) => setF({ ...v, [k]: Number(e.target.value) })} /><span className="hint">{hint}</span></div>
	);
	return (
		<div className="grid g-2">
			<Card title="Points" accent={COLORS.navy} sub="Each customer earns points; customers are then ranked by points.">
				<div className="grid g-2">
					{n('spendPer1000', 'Points per ₹1,000 spent in the last 12 months', '')}
					{n('perOrder', 'Points per order in the last 12 months', '')}
					{n('perKalyanYear', 'Points per year with Kalyan', 'A life member counts at least 4 years, a 5-year subscriber 2, a 1-year subscriber 1.')}
					{n('bulkDealer', 'Points for a bulk or dealer buyer', 'From the reasons for contacting.')}
				</div>
			</Card>
<Card title="Tiers" accent={COLORS.amber} sub={<>A plain 1-year Kalyan subscription on its own stays Regular; the shares apply to everyone else. Now: {['platinum', 'gold', 'silver', 'regular'].map((k) => `${data.labels[k]} ${num(data.counts[k] || 0)}`).join(' · ')}</>}>
				<div className="grid g-2">
					{n('platinumPct', 'Platinum: top % of ranked customers', '')}
					{n('goldPct', 'Gold: next %', '')}
					{n('silverPct', 'Silver: next %', '')}
					{n('quietDays', 'An important buyer has gone quiet after (days)', 'Platinum or Gold buyers with no order for this long are listed and alerted.')}
				</div>
				{f && can('manager') && <button className="btn primary mt-8" disabled={saveT.isPending} onClick={() => saveT.mutate()}>Save and work out the tiers again</button>}
			</Card>
		</div>
	);
}
