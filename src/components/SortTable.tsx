import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MdClose, MdMenuBook, MdSearch } from 'react-icons/md';
import { api } from '../api/client';

export type Dir = 'asc' | 'desc';
type Getter<T> = (row: T) => unknown;

/**
 * Sorting for a table whose rows are already loaded. Click a heading to sort; click again to reverse.
 * Text sorts A→Z first, numbers and dates largest first; empty values always go last.
 */
export function useSort<T>(rows: T[] | undefined, initial: { key: string; dir?: Dir }, getters: Record<string, Getter<T>> = {}) {
	const [sort, setSort] = useState<{ key: string; dir: Dir }>({ key: initial.key, dir: initial.dir || 'desc' });
	const sorted = useMemo(() => {
		const list = [...(rows || [])];
		const get = getters[sort.key] || ((r: any) => r?.[sort.key]);
		const val = (r: T) => {
			const v = get(r);
			if (v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) return null;
			if (v instanceof Date) return v.getTime();
			if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(v).getTime();
			return v;
		};
		const m = sort.dir === 'asc' ? 1 : -1;
		return list.sort((a, b) => {
			const x = val(a);
			const y = val(b);
			if (x === null && y === null) return 0;
			if (x === null) return 1;
			if (y === null) return -1;
			if (typeof x === 'number' && typeof y === 'number') return (x - y) * m;
			return String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' }) * m;
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rows, sort.key, sort.dir]);
	/** A sortable column heading. `first` is the direction of the first click (text: asc, numbers: desc). */
	const Th = ({ k, children, num, first, title }: { k: string; children: ReactNode; num?: boolean; first?: Dir; title?: string }) => {
		const on = sort.key === k;
		const next = () => setSort(on ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: first || (num ? 'desc' : 'asc') });
		return (
			<th className={`${num ? 'num ' : ''}sortable${on ? ' on' : ''}`} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} title={title}>
				<button type="button" className="th-sort" onClick={next}>{children}<span className="arrow">{on ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button>
			</th>
		);
	};
	return { sorted, sort, setSort, Th };
}

export interface BookOption { code: string; name: string; language: string; hindi?: string | null }

/** Every book code in the catalogue (from the Tally uploads), for the book picker. */
export function useBooks() {
	return useQuery<{ books: BookOption[] }>({ queryKey: ['inventory-books'], queryFn: () => api('/inventory/books'), staleTime: 300_000 });
}

/**
 * Choose one or more books by name, Hindi title or code. Shows the best matches as you type;
 * chosen books stay as chips that can be removed one by one.
 */
export function BookPicker({ value, onChange, placeholder = 'Filter by book' }: { value: string[]; onChange: (codes: string[]) => void; placeholder?: string }) {
	const { data } = useBooks();
	const [q, setQ] = useState('');
	const [open, setOpen] = useState(false);
	const [hi, setHi] = useState(0);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
		document.addEventListener('mousedown', h);
		return () => document.removeEventListener('mousedown', h);
	}, []);
	const books = data?.books || [];
	const byCode = useMemo(() => new Map(books.map((b) => [b.code, b])), [books]);
	const matches = useMemo(() => {
		const t = q.trim().toLowerCase();
		if (!t) return [];
		const words = t.split(/\s+/);
		return books
			.filter((b) => !value.includes(b.code))
			.map((b) => {
				const hay = `${b.name} ${b.hindi || ''} ${b.language}`.toLowerCase();
				const all = words.every((w) => hay.includes(w) || b.code.toLowerCase() === w);
				const score = b.code.toLowerCase() === t ? 100 : !all ? 0 : hay.startsWith(t) ? 12 : hay.includes(` ${t}`) ? 10 : hay.startsWith(words[0]) ? 8 : 5;
				return { b, score };
			})
			.filter((x) => x.score)
			.sort((a, z) => z.score - a.score || a.b.name.localeCompare(z.b.name))
			.slice(0, 40)
			.map((x) => x.b);
	}, [q, books, value]);
	const add = (b: BookOption) => { onChange([...value, b.code]); setQ(''); setHi(0); };
	return (
		<div className="book-picker" ref={ref}>
			<div className={`book-picker-box ${value.length ? 'on' : ''}`} onClick={() => setOpen(true)}>
				<MdMenuBook className="faint" />
				{value.map((c) => (
					<span key={c} className="chip book-chip" title={byCode.get(c)?.hindi || ''}>
						{byCode.get(c)?.name || c} <span className="faint">· {c}</span>
						<button type="button" aria-label={`Remove ${byCode.get(c)?.name || c}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== c)); }}><MdClose /></button>
					</span>
				))}
				<input value={q} placeholder={value.length ? 'Add another book' : placeholder} aria-label="Filter by book"
					onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
					onKeyDown={(e) => {
						if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(hi + 1, matches.length - 1)); }
						else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hi - 1, 0)); }
						else if (e.key === 'Enter' && matches[hi]) { e.preventDefault(); add(matches[hi]); }
						else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
						else if (e.key === 'Escape') setOpen(false);
					}} />
				{value.length > 0 && <button type="button" className="btn ghost sm" onClick={(e) => { e.stopPropagation(); onChange([]); }}>Clear</button>}
			</div>
			{open && q.trim() && (
				<div className="book-picker-pop" role="listbox">
					{matches.length ? matches.map((b, i) => (
						<button type="button" key={b.code} role="option" aria-selected={i === hi} className={i === hi ? 'hi' : ''} onMouseEnter={() => setHi(i)} onClick={() => add(b)}>
							<span className="grow truncate"><b>{b.name}</b>{b.hindi ? <span className="faint"> · {b.hindi}</span> : null}</span>
							<span className="xs faint nowrap">{b.language} · {b.code}</span>
						</button>
					)) : <div className="small faint" style={{ padding: 10 }}><MdSearch /> No book matches "{q}"</div>}
				</div>
			)}
		</div>
	);
}

/** "Showing 40 of 1,200" with an optional reset. */
export const Count = ({ shown, total, onClear }: { shown: number; total: number; onClear?: () => void }) => (
	<span className="xs faint">{shown === total ? `${total.toLocaleString('en-IN')} rows` : `Showing ${shown.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`}{onClear && <> · <button type="button" className="link-btn" onClick={onClear}>clear filters</button></>}</span>
);
