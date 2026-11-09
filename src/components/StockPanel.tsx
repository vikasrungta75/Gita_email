import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Card } from './ui';
import { COLORS, fmtDate } from '../lib/format';
import { inr, num } from '../lib/purposes';

/** Staff view beside a draft: live stock for the books the reader mentions, at every location, and any addresses asked for. */
export default function StockPanel({ conversationId }: { conversationId: string | number }) {
	const { data } = useQuery({ queryKey: ['conv-stock', conversationId], queryFn: () => api(`/conversations/${conversationId}/stock`) });
	if (!data || (!data.books?.length && !data.addresses?.length)) return null;
	return (
		<Card title={<h2><span className="kw">Stock</span> for books mentioned</h2>} accent={COLORS.teal}
			sub={<>Tally stock{data.asOf?.gorakhpur ? `, Gorakhpur as of ${fmtDate(data.asOf.gorakhpur)}` : ''}. Readers are told the Gorakhpur and nearest-branch figures{data.nearest ? `; nearest branch: ${data.nearest.label} (${data.nearest.why})` : ''}{data.abroad ? '; reader is abroad, so Gorakhpur only' : ''}.</>}>
			{data.books?.length > 0 && (
				<div className="table-wrap">
					<table className="table">
						<thead><tr><th>Book</th><th className="num">Gorakhpur</th><th className="num">Semi-finished</th><th>Nearest branch</th><th>Other branches with stock</th></tr></thead>
						<tbody>
							{data.books.map((b: any) => (
								<tr key={b.code}>
									<td style={{ maxWidth: 240 }}><b>{b.name}</b><div className="xs faint">Code {b.code} · {b.language}{b.hindi ? ` · ${b.hindi}` : ''}{b.certain ? '' : ' · possible match'}</div></td>
									<td className="num nowrap">{b.hq ? <>{num(Math.round(b.hq.qty))}<div className="xs faint">{inr(b.hq.price)}</div></> : <span className="faint">not uploaded</span>}</td>
									<td className="num">{b.semi ? num(Math.round(b.semi)) : <span className="faint">–</span>}</td>
									<td className="small nowrap">{b.nearest ? <>{b.nearest.label}: <b>{num(Math.round(b.nearest.qty))}</b> <span className="faint">{inr(b.nearest.price)}</span></> : <span className="faint">–</span>}</td>
									<td className="xs" style={{ maxWidth: 260 }}>{b.all.filter((l: any) => l.key !== 'gorakhpur' && l.key !== b.nearest?.key).slice(0, 6).map((l: any) => `${l.label} ${num(Math.round(l.qty))}`).join(' · ') || <span className="faint">none</span>}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{data.addresses?.length > 0 && (
				<div className="small mt-8"><span className="faint">Address asked for: </span>{data.addresses.map((d: any) => d.city).join(', ')} (given in the draft)</div>
			)}
			<div className="xs faint mt-8">Upload newer stock in <Link to="/inventory?tab=uploads">Inventory → Uploads</Link>.</div>
		</Card>
	);
}
