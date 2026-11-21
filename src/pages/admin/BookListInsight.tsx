/** Dashboards for the book list (Suchi) and the book links, opened from Admin → Master data. */
import { useQuery } from '@tanstack/react-query';
import { MdLibraryBooks, MdLink, MdStar, MdWarningAmber } from 'react-icons/md';
import { api } from '../../api/client';
import { Card, Empty, Kpi, Loader } from '../../components/ui';
import { BarList, KpiRow, pct } from '../../components/dash';
import { inr, num } from '../../lib/purposes';
import { COLORS } from '../../lib/format';

type ToData = (f: Record<string, string>) => void;

const bookRows = (rows: any[], toData: ToData, semi = false) => (
	<div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table className="table">
		<thead><tr><th>Code</th><th>Book</th><th className="num">Price</th>{semi && <th className="num">Semi-finished</th>}</tr></thead>
		<tbody>{rows.map((r) => (
			<tr key={r.code} className="click" onClick={() => toData({ q: r.code })}>
				<td className="mono small">{r.code}</td><td className="small">{r.hindi || r.name}{r.hindi && r.name !== r.hindi && <div className="xs faint">{r.name}</div>}</td>
				<td className="num small">{inr(r.price)}</td>{semi && <td className="num small">{r.semi ? num(r.semi) : '–'}</td>}
			</tr>
		))}</tbody>
	</table></div>
);

export function SuchiDashboard({ toData }: { toData: ToData }) {
	const { data, isLoading } = useQuery({ queryKey: ['insight-suchi'], queryFn: () => api('/insight/suchi') });
	if (isLoading || !data) return <Loader />;
	const k = data.kpis;
	if (!k.titles) return <Card><Empty text='No book list yet. Upload the Suchi PDF or Excel under "Upload and history".' /></Card>;
	return (
		<div className="col gap-16">
			<KpiRow>
				<Kpi label="Titles" value={num(k.titles)} icon={<MdLibraryBooks />} accent={COLORS.blue} foot={`${num(k.sets)} sets`} onClick={() => toData({})} />
				<Kpi label="Best sellers" value={num(k.best)} icon={<MdStar />} accent={COLORS.amber} foot={pct(k.best, k.titles)} onClick={() => toData({ 'f.best_seller': 'true' })} />
				<Kpi label="Typical price" value={inr(k.median_price)} accent={COLORS.green} foot={`average ${inr(Math.round(k.avg_price))}`} />
				<Kpi label="In stock at Gorakhpur" value={num(k.in_stock)} accent={COLORS.teal} foot={`${pct(k.in_stock, k.titles)} of titles (main and retail)`} onClick={() => toData({ 'min.gkp_stock': '1' })} />
				<Kpi label="Not in stock" value={num(k.out_of_stock)} icon={<MdWarningAmber />} accent={COLORS.red} foot={`${num(k.best_out)} best sellers · ${num(k.in_making)} being made`} onClick={() => toData({ 'max.gkp_stock': '0' })} />
				<Kpi label="With an online link" value={pct(k.with_link, k.titles)} icon={<MdLink />} accent={COLORS.purple} foot={`${num(k.titles - k.with_link)} without`} />
				<Kpi label="Only in the links file" value={num(k.only_links)} accent={COLORS.general} foot={`${num(k.no_hindi)} titles without a Hindi title`} />
			</KpiRow>
			<div className="grid g-2">
				<Card title="By size" flush><BarList head="Titles" extraHeads={['In stock', 'Average price']} rows={data.bySize.map((r: any) => ({ k: r.k, n: r.n, extra: [pct(r.in_stock, r.n), inr(Math.round(r.avg_price))], on: () => toData({ 'f.size': r.k === 'Not stated' ? '(blank)' : r.k }) }))} /></Card>
				<Card title="By language" flush><BarList head="Titles" extraHeads={['In stock']} rows={data.byLanguage.map((r: any) => ({ k: r.k, n: r.n, extra: [pct(r.in_stock, r.n)], on: () => toData({ 'f.language': r.k === 'Not stated' ? '(blank)' : r.k }) }))} /></Card>
			</div>
			<div className="grid g-3">
				<Card title="Price" flush><BarList head="Titles" rows={data.priceBands.map((r: any) => ({ k: r.k, n: r.n }))} height={300} /></Card>
				<Card title="Pages" flush><BarList head="Titles" rows={data.pageBands.map((r: any) => ({ k: r.k, n: r.n }))} height={300} /></Card>
				<Card title="Largest sets" flush><BarList share={false} head="Titles" extraHeads={['Price total']} rows={data.sets.map((r: any) => ({ k: r.k, n: r.n, extra: [inr(r.value)], on: () => toData({ 'f.set_code': r.k }) }))} height={300} empty="No sets." /></Card>
			</div>
			<Card title="Best sellers not in stock at Gorakhpur" sub="Semi-finished shows copies being made" flush>
				{!data.bestOut.length ? <Empty text="Every best seller is in stock." /> : bookRows(data.bestOut, toData, true)}
			</Card>
		</div>
	);
}

export function LinksDashboard({ toData }: { toData: ToData }) {
	const { data, isLoading } = useQuery({ queryKey: ['insight-links'], queryFn: () => api('/insight/links') });
	if (isLoading || !data) return <Loader />;
	const k = data.kpis;
	if (!k.titles) return <Card><Empty text='No book links yet. Upload the links file under "Upload and history".' /></Card>;
	return (
		<div className="col gap-16">
			<KpiRow>
				<Kpi label="Books" value={num(k.titles)} icon={<MdLibraryBooks />} accent={COLORS.blue} onClick={() => toData({})} />
				<Kpi label="gitapress.org link" value={pct(k.gitapress, k.titles)} icon={<MdLink />} accent={COLORS.teal} foot={num(k.gitapress)} />
				<Kpi label="Amazon link" value={pct(k.amazon, k.titles)} icon={<MdLink />} accent={COLORS.amber} foot={num(k.amazon)} />
				<Kpi label="Both links" value={num(k.both)} accent={COLORS.green} onClick={() => toData({ 'f.coverage': 'Both' })} />
				<Kpi label="No link" value={num(k.none)} icon={<MdWarningAmber />} accent={COLORS.red} onClick={() => toData({ 'f.coverage': 'No link' })} />
				<Kpi label="Suchi titles with no link" value={num(k.suchi_no_link)} accent={COLORS.general} foot={`${num(k.suchi_only)} Suchi titles not in this file`} />
			</KpiRow>
			<div className="grid g-2">
				<Card title="Coverage" flush>
					<BarList head="Books" rows={[['Both', k.both], ['gitapress.org only', k.gitapress - k.both], ['Amazon only', k.amazon - k.both], ['No link', k.none]].map(([l, n]) => ({ k: l as string, n: n as number, on: () => toData({ 'f.coverage': l as string }) }))} height={220} />
				</Card>
				<Card title="By language" flush>
					<BarList head="Books" extraHeads={['gitapress.org', 'Amazon']} rows={data.byLanguage.map((r: any) => ({ k: r.k, n: r.n, extra: [pct(r.gitapress, r.n), pct(r.amazon, r.n)], on: () => toData({ 'f.language': r.k === 'Not stated' ? '(blank)' : r.k }) }))} height={300} />
				</Card>
			</div>
			<Card title="Best sellers with no online link" sub="Readers asking where to buy these get no link in the reply" flush>
				{!data.bestNoLink.length ? <Empty text="Every best seller has a link." /> : bookRows(data.bestNoLink, toData)}
			</Card>
		</div>
	);
}
