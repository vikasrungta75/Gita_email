/** Small pieces shared by the dashboards: a row of headline figures, a ranked list with bars, and a view switch. */
import type { ReactNode } from 'react';
import { Empty, Segmented } from './ui';
import { num } from '../lib/purposes';

export const KpiRow = ({ children, min = 170 }: { children: ReactNode; min?: number }) => (
	<div className="grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}>{children}</div>
);

export interface BarRow { k: string; n: number; sub?: ReactNode; extra?: ReactNode[]; on?: () => void }

/**
 * A ranked table with a bar per row: readable as a table, scannable as a chart. Select a row to open what it
 * stands for (usually the full data with that filter).
 */
export function BarList({ rows, head = 'Count', extraHeads = [], format = num, max: maxRows = 40, height = 360, empty = 'No data yet.', share = true }: {
	rows: BarRow[]; head?: string; extraHeads?: string[]; format?: (v: number) => string; max?: number; height?: number; empty?: string;
	/** show each row's share of the total (off for top-N lists, where the total is not the whole) */
	share?: boolean;
}) {
	if (!rows.length) return <Empty text={empty} />;
	const shown = rows.slice(0, maxRows);
	const top = Math.max(1, ...shown.map((r) => r.n));
	const total = rows.reduce((a, r) => a + (r.n || 0), 0);
	return (
		<div className="table-wrap" style={{ maxHeight: height, overflow: 'auto' }}>
			<table className="table">
				<thead><tr><th /><th className="num">{head}</th>{share && <th className="num">Share</th>}{extraHeads.map((h) => <th key={h} className="num">{h}</th>)}<th style={{ width: '30%' }} /></tr></thead>
				<tbody>{shown.map((r) => (
					<tr key={r.k} className={r.on ? 'click' : ''} onClick={r.on} title={r.on ? 'Open the rows' : undefined}>
						<td className="small">{r.k}{r.sub && <div className="xs faint">{r.sub}</div>}</td>
						<td className="num small nowrap">{format(r.n)}</td>
						{share && <td className="num xs faint">{total ? `${((100 * r.n) / total).toFixed(r.n / total < 0.1 ? 1 : 0)}%` : ''}</td>}
						{(r.extra || []).map((x, i) => <td key={i} className="num small nowrap">{x}</td>)}
						<td><div className="bar-cell"><div style={{ width: `${(100 * r.n) / top}%` }} /></div></td>
					</tr>
				))}</tbody>
			</table>
		</div>
	);
}

export const VIEWS = [{ v: 'dashboard', l: 'Dashboard' }, { v: 'data', l: 'All data' }, { v: 'upload', l: 'Upload and history' }] as const;
export type View = (typeof VIEWS)[number]['v'];

export function ViewSwitch({ value, onChange, options = VIEWS as any }: { value: string; onChange: (v: any) => void; options?: { v: string; l: string }[] }) {
	return <Segmented value={value} options={options} onChange={onChange} />;
}

export const pct = (a?: number | null, b?: number | null) => (a === null || a === undefined || !b ? '–' : `${((100 * a) / b).toFixed(1)}%`);
/** Compact Indian numbering: 1.2 lakh, 3.4 crore. */
export const short = (v?: number | null) => {
	if (v === null || v === undefined) return '–';
	const a = Math.abs(v);
	if (a >= 1e7) return `${(v / 1e7).toFixed(a >= 1e8 ? 0 : 1)} cr`;
	if (a >= 1e5) return `${(v / 1e5).toFixed(a >= 1e6 ? 0 : 1)} lakh`;
	return num(Math.round(v));
};
export const shortInr = (v?: number | null) => (v === null || v === undefined ? '–' : `₹${short(v)}`);
