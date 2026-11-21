/**
 * The full-data table used by Stock, Tracking and the book list: search, sort on any column (select the heading;
 * again to reverse), a filter on any column (values with counts, or a from–to range), choose columns, page through
 * everything, totals of the number columns, and Excel or CSV download of what is filtered.
 * The table's state lives in the address (q, sort, dir, f.<col>, min.<col>, max.<col>, page), so a filtered view can
 * be bookmarked, shared, or opened from a dashboard.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MdArrowDownward, MdArrowUpward, MdClose, MdDownload, MdExpandMore, MdFilterList, MdOpenInNew, MdSearch, MdViewColumn } from 'react-icons/md';
import { api } from '../api/client';
import { useToast } from '../contexts/ToastContext';
import { Empty, Loader } from './ui';
import { inr, num } from '../lib/purposes';
import { fmtDate, fmtDateTime } from '../lib/format';
import { download } from '../lib/files';

export interface Col { key: string; label: string; type: 'text' | 'code' | 'num' | 'money' | 'date' | 'datetime' | 'link' | 'bool'; facet?: boolean; search?: boolean; hidden?: boolean }
interface Desc { name: string; label: string; note?: string; cols: Col[]; sort: string; dir: 'asc' | 'desc' }

const STATE_KEYS = (k: string) => k === 'q' || k === 'sort' || k === 'dir' || k === 'page' || k.startsWith('f.') || k.startsWith('min.') || k.startsWith('max.');
const PAGE = 50;

/** Keys this table owns in the address; anything else (tab, view) is left alone. */
export function tableParams(sp: URLSearchParams) {
	const out = new URLSearchParams();
	for (const [k, v] of sp.entries()) if (STATE_KEYS(k) && k !== 'page') out.set(k, v);
	return out;
}

export function cell(c: Col, v: any) {
	if (v === null || v === undefined || v === '') return <span className="faint">–</span>;
	switch (c.type) {
		case 'money': return inr(v);
		case 'num': return num(v);
		case 'date': return fmtDate(v);
		case 'datetime': return fmtDateTime(v);
		case 'bool': return v ? 'Yes' : <span className="faint">No</span>;
		case 'code': return <span className="mono">{v}</span>;
		case 'link': {
			let host = '';
			try { host = new URL(v).hostname.replace(/^www\./, ''); } catch { return String(v); }
			return <a href={v} target="_blank" rel="noopener noreferrer" className="row gap-4 nowrap" onClick={(e) => e.stopPropagation()} title={v}>{host.includes('amazon') ? 'Amazon' : host} <MdOpenInNew /></a>;
		}
		default: return String(v);
	}
}

export default function DataTable({ name, title, actions, onRow }: { name: string; title?: string; actions?: React.ReactNode; onRow?: (r: any) => void }) {
	const toast = useToast();
	const [sp, setSp] = useSearchParams();
	const desc = useQuery<Desc>({ queryKey: ['dataset', name], queryFn: () => api(`/datasets/${name}`), staleTime: Infinity });
	const params = tableParams(sp);
	const page = Math.max(0, Number(sp.get('page')) || 0);
	const set = (changes: Record<string, string | null>, keepPage = false) => {
		const n = new URLSearchParams(sp);
		for (const [k, v] of Object.entries(changes)) { if (v === null || v === '') n.delete(k); else n.set(k, v); }
		if (!keepPage) n.delete('page');
		setSp(n, { replace: true });
	};
	const [search, setSearch] = useState(sp.get('q') || '');
	useEffect(() => { setSearch(sp.get('q') || ''); }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => { const t = setTimeout(() => { if (search !== (sp.get('q') || '')) set({ q: search }); }, 350); return () => clearTimeout(t); });

	const storeKey = `cols:${name}`;
	const [shown, setShown] = useState<string[] | null>(() => { try { return JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch { return null; } });
	const cols = useMemo(() => (desc.data?.cols || []).filter((c) => (shown ? shown.includes(c.key) : !c.hidden)), [desc.data, shown]);
	const saveShown = (v: string[]) => { setShown(v); try { localStorage.setItem(storeKey, JSON.stringify(v)); } catch { /* private mode */ } };

	const query = new URLSearchParams(params);
	query.set('offset', String(page * PAGE));
	query.set('limit', String(PAGE));
	const data = useQuery({ queryKey: ['dataset-rows', name, query.toString()], queryFn: () => api(`/datasets/${name}/rows?${query}`), placeholderData: keepPreviousData, enabled: !!desc.data });

	if (desc.isLoading || !desc.data) return <Loader />;
	const d = desc.data;
	const sort = sp.get('sort') || d.sort;
	const dir = sp.get('dir') || (sp.get('sort') ? 'asc' : d.dir);
	const toggleSort = (k: string) => set(sort === k ? { sort: k, dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: k, dir: 'asc' });
	const active = d.cols.filter((c) => sp.get(`f.${c.key}`) || sp.get(`min.${c.key}`) || sp.get(`max.${c.key}`));
	const total = data.data?.total ?? 0;
	const exp = (format: 'xlsx' | 'csv') => {
		const p = new URLSearchParams(params); p.set('format', format);
		download(`/datasets/${name}/rows?${p}`, `${name.replace(/_/g, '-')}.${format}`).catch((e) => toast(e.message, 'error'));
	};
	return (
		<div className="card">
			<div className="card-head">
				<div>
					<h2>{title || d.label}</h2>
					{d.note && <div className="sub">{d.note}</div>}
				</div>
				<div className="row gap-8">
					{actions}
					<button className="btn sm" onClick={() => exp('xlsx')} title="Download what is filtered, every row"><MdDownload /> Excel</button>
					<button className="btn sm" onClick={() => exp('csv')}><MdDownload /> CSV</button>
				</div>
			</div>
			<div className="card-body">
				<div className="row gap-8 wrap mb-8">
					<div className="data-search"><MdSearch /><input className="input sm" placeholder={`Search ${d.cols.filter((c) => c.search).map((c) => c.label.toLowerCase()).slice(0, 4).join(', ')}`} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" /></div>
					{d.cols.filter((c) => c.facet && (cols.includes(c) || sp.get(`f.${c.key}`))).map((c) => <FacetFilter key={c.key} name={name} col={c} params={params} value={sp.get(`f.${c.key}`)} onChange={(v) => set({ [`f.${c.key}`]: v })} />)}
					{d.cols.filter((c) => ['num', 'money', 'date', 'datetime'].includes(c.type) && !c.hidden).length > 0 && (
						<RangeFilters cols={d.cols.filter((c) => ['num', 'money', 'date', 'datetime'].includes(c.type))} sp={sp} onChange={set} />
					)}
					<ColumnChooser cols={d.cols} shown={cols.map((c) => c.key)} onChange={saveShown} />
					{(active.length > 0 || sp.get('q')) && <button className="btn ghost sm" onClick={() => { setSearch(''); const n = new URLSearchParams(sp); for (const k of [...n.keys()]) if (STATE_KEYS(k) && k !== 'sort' && k !== 'dir') n.delete(k); setSp(n, { replace: true }); }}><MdClose /> Clear filters</button>}
				</div>
				{active.length > 0 && (
					<div className="row gap-4 wrap mb-8">{active.map((c) => {
						const v = sp.get(`f.${c.key}`);
						const lo = sp.get(`min.${c.key}`), hi = sp.get(`max.${c.key}`);
						const text = v ? v.split('|').join(', ') : `${lo || '…'} to ${hi || '…'}`;
						return <span key={c.key} className="chip on">{c.label}: {text.length > 40 ? `${text.slice(0, 40)}…` : text} <button className="btn ghost icon xs" aria-label={`Remove the ${c.label} filter`} onClick={() => set({ [`f.${c.key}`]: null, [`min.${c.key}`]: null, [`max.${c.key}`]: null })}><MdClose /></button></span>;
					})}</div>
				)}
			</div>
			<div className="card-body flush">
				{data.isLoading ? <Loader /> : !data.data?.rows?.length ? <Empty text="No rows match." /> : (
					<div className="table-wrap" style={{ maxHeight: '68vh', overflow: 'auto' }}>
						<table className="table sticky">
							<thead><tr>{cols.map((c) => (
								<th key={c.key} className={`${['num', 'money'].includes(c.type) ? 'num' : ''} sortable`} onClick={() => toggleSort(c.key)} aria-sort={sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
									<span className="row gap-4 nowrap" style={{ justifyContent: ['num', 'money'].includes(c.type) ? 'flex-end' : undefined }}>{c.label}{sort === c.key && (dir === 'asc' ? <MdArrowUpward /> : <MdArrowDownward />)}</span>
								</th>
							))}</tr></thead>
							<tbody>{data.data.rows.map((r: any, i: number) => (
								<tr key={i} className={onRow ? 'click' : ''} onClick={onRow ? () => onRow(r) : undefined}>
									{cols.map((c) => <td key={c.key} className={`${['num', 'money'].includes(c.type) ? 'num' : ''} small ${c.type === 'text' && String(r[c.key] || '').length > 50 ? 'wrap-cell' : 'nowrap'}`}>{cell(c, r[c.key])}</td>)}
								</tr>
							))}</tbody>
							{Object.values(data.data.sums || {}).some((v) => v !== null) && (
								<tfoot><tr>{cols.map((c, i) => (
									<td key={c.key} className={`${['num', 'money'].includes(c.type) ? 'num' : ''} small`}><b>{i === 0 ? 'Total' : c.type === 'num' && !/issue|age|pages|carton/.test(c.key) ? num(data.data.sums[c.key]) : c.type === 'money' && /value|total|amount|postage|subtotal/.test(c.key) ? inr(data.data.sums[c.key]) : ''}</b></td>
								))}</tr></tfoot>
							)}
						</table>
					</div>
				)}
			</div>
			<div className="card-body row-between small">
				<span className="faint">{total ? `${num(page * PAGE + 1)}–${num(Math.min(total, (page + 1) * PAGE))} of ${num(total)}` : ''}{data.isFetching ? ' · loading' : ''}</span>
				<span className="row gap-8">
					<button className="btn sm" disabled={!page} onClick={() => set({ page: page > 1 ? String(page - 1) : null }, true)}>Previous</button>
					<button className="btn sm" disabled={(page + 1) * PAGE >= total} onClick={() => set({ page: String(page + 1) }, true)}>Next</button>
				</span>
			</div>
		</div>
	);
}

/** A value-list filter that loads its values (with counts, under the other filters) when opened. */
function FacetFilter({ name, col, params, value, onChange }: { name: string; col: Col; params: URLSearchParams; value: string | null; onChange: (v: string | null) => void }) {
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState('');
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
		document.addEventListener('mousedown', h);
		return () => document.removeEventListener('mousedown', h);
	}, []);
	const p = new URLSearchParams(params); p.delete(`f.${col.key}`);
	const opts = useQuery({ queryKey: ['facet', name, col.key, p.toString()], queryFn: () => api(`/datasets/${name}/facet/${col.key}?${p}`), enabled: open, staleTime: 60_000 });
	const sel = value ? value.split('|') : [];
	const label = (v: string) => (col.type === 'bool' ? (v === 'true' ? 'Yes' : v === 'false' ? 'No' : v) : col.type === 'date' ? fmtDate(v) : v);
	const toggle = (v: string, on: boolean) => { const n = on ? [...sel, v] : sel.filter((x) => x !== v); onChange(n.length ? n.join('|') : null); };
	const shown = (opts.data || []).filter((o: any) => !q || String(o.v).toLowerCase().includes(q.toLowerCase()));
	return (
		<div className="ms" ref={ref}>
			<button className={`ms-btn ${sel.length ? 'on' : ''}`} onClick={() => setOpen(!open)} type="button">
				{sel.length === 0 ? col.label : sel.length === 1 ? `${col.label}: ${label(sel[0])}` : `${col.label}: ${sel.length}`}<MdExpandMore />
			</button>
			{open && (
				<div className="ms-pop">
					<input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
					<div className="ms-list">
						{opts.isLoading ? <Loader small /> : shown.map((o: any) => (
							<label key={o.v} className="ms-opt">
								<input type="checkbox" checked={sel.includes(String(o.v))} onChange={(e) => toggle(String(o.v), e.target.checked)} />
								<span className="grow truncate">{label(String(o.v))}</span>
								<span className="xs faint">{num(o.n)}</span>
							</label>
						))}
						{!opts.isLoading && !shown.length && <div className="faint small" style={{ padding: 8 }}>No values</div>}
					</div>
					<div className="ms-foot">
						<button className="btn ghost sm" onClick={() => onChange(null)}>Clear</button>
						<button className="btn sm" onClick={() => setOpen(false)}>Done</button>
					</div>
				</div>
			)}
		</div>
	);
}

/** From–to filters for the number and date columns. */
function RangeFilters({ cols, sp, onChange }: { cols: Col[]; sp: URLSearchParams; onChange: (c: Record<string, string | null>) => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
		document.addEventListener('mousedown', h);
		return () => document.removeEventListener('mousedown', h);
	}, []);
	const on = cols.filter((c) => sp.get(`min.${c.key}`) || sp.get(`max.${c.key}`)).length;
	return (
		<div className="ms" ref={ref}>
			<button className={`ms-btn ${on ? 'on' : ''}`} onClick={() => setOpen(!open)} type="button"><MdFilterList /> {on ? `Ranges: ${on}` : 'Ranges'}<MdExpandMore /></button>
			{open && (
				<div className="ms-pop" style={{ minWidth: 320 }}>
					<div className="ms-list" style={{ maxHeight: 360 }}>
						{cols.map((c) => {
							const t = c.type === 'date' || c.type === 'datetime' ? 'date' : 'number';
							return (
								<div key={c.key} className="row gap-4 small" style={{ padding: '4px 8px' }}>
									<span className="grow">{c.label}</span>
									<input className="input sm" type={t} style={{ width: t === 'date' ? 130 : 80 }} aria-label={`${c.label} from`} key={`min${sp.get(`min.${c.key}`) || ''}`} defaultValue={sp.get(`min.${c.key}`) || ''} onBlur={(e) => onChange({ [`min.${c.key}`]: e.target.value || null })} />
									<span className="faint">to</span>
									<input className="input sm" type={t} style={{ width: t === 'date' ? 130 : 80 }} aria-label={`${c.label} to`} key={`max${sp.get(`max.${c.key}`) || ''}`} defaultValue={sp.get(`max.${c.key}`) || ''} onBlur={(e) => onChange({ [`max.${c.key}`]: e.target.value || null })} />
								</div>
							);
						})}
					</div>
					<div className="ms-foot">
						<button className="btn ghost sm" onClick={() => { onChange(Object.fromEntries(cols.flatMap((c) => [[`min.${c.key}`, null], [`max.${c.key}`, null]]))); setOpen(false); }}>Clear</button>
						<button className="btn sm" onClick={() => setOpen(false)}>Done</button>
					</div>
				</div>
			)}
		</div>
	);
}

function ColumnChooser({ cols, shown, onChange }: { cols: Col[]; shown: string[]; onChange: (v: string[]) => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
		document.addEventListener('mousedown', h);
		return () => document.removeEventListener('mousedown', h);
	}, []);
	return (
		<div className="ms" ref={ref}>
			<button className="ms-btn" onClick={() => setOpen(!open)} type="button"><MdViewColumn /> Columns<MdExpandMore /></button>
			{open && (
				<div className="ms-pop">
					<div className="ms-list">{cols.map((c) => (
						<label key={c.key} className="ms-opt"><input type="checkbox" checked={shown.includes(c.key)} onChange={(e) => onChange(e.target.checked ? cols.filter((x) => shown.includes(x.key) || x.key === c.key).map((x) => x.key) : shown.filter((k) => k !== c.key))} /><span className="grow">{c.label}</span></label>
					))}</div>
					<div className="ms-foot"><button className="btn ghost sm" onClick={() => onChange(cols.filter((c) => !c.hidden).map((c) => c.key))}>Default</button><button className="btn sm" onClick={() => setOpen(false)}>Done</button></div>
				</div>
			)}
		</div>
	);
}
