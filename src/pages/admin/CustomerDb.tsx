import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { MdAutoAwesome, MdCallSplit, MdDownload, MdOpenInNew, MdPrint, MdSearch } from 'react-icons/md';
import { api, getToken, qs } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card, Empty, Facts, Loader, Modal, MultiSelect, PageHead, Segmented, Story } from '../../components/ui';
import { inr, purposeLabel, shortPurpose, usePurposes } from '../../lib/purposes';
import { ago, fmtDate } from '../../lib/format';

const TYPES: Record<string, string> = { reader: 'Reader', bookseller: 'Bookseller', distributor: 'Distributor', institution: 'Temple, school or trust', supplier: 'Supplier', other: 'Other', customer: 'Reader', prospect: 'Bulk buyer', vendor: 'Supplier', partner: 'Distributor', candidate: 'Job applicant' };
const LIST_FIELDS = ['emails', 'phones', 'order_refs', 'subscriber_numbers', 'books'];
const FIELDS: [string, string, boolean?][] = [
	['type', 'Type'], ['organisation', 'Organisation'], ['phones', 'Phone numbers', true], ['emails', 'Email addresses', true],
	['address', 'Postal address'], ['city', 'City'], ['state', 'State'], ['pin', 'PIN code'], ['country', 'Country'], ['language', 'Writes in'],
	['subscriber_numbers', 'Kalyan subscriber numbers', true], ['order_refs', 'Order numbers', true], ['books', 'Books asked about', true], ['gstin', 'GSTIN'], ['notes', 'Notes'],
];
const n = (v?: number) => (v ?? 0).toLocaleString('en-IN');
export const TIER_LABEL: Record<string, string> = { platinum: 'Platinum', gold: 'Gold', silver: 'Silver', regular: 'Regular' };
const TIER_COLOR: Record<string, string> = { platinum: '#475569', gold: '#B7791F', silver: '#94A3B8' };
export const SUB_LABEL: Record<string, string> = { '1Y': '1 year', FY: '5 years', LM: 'Life member' };
export const BuyerTier = ({ t }: { t?: string }) => (t && t !== 'regular' ? <span className="badge" style={{ background: TIER_COLOR[t], color: '#fff' }}>{TIER_LABEL[t]}</span> : null);
const renewal = (r: any) => (!r.kalyan_buyer ? '' : r.kalyan_type === 'LM' ? 'never (life member)' : r.kalyan_renewal ? `${fmtDate(r.kalyan_renewal, 'MMM yyyy')} (estimated)` : 'not known');
const list = (v: any) => (Array.isArray(v) ? v.join(', ') : v || '');

/** Every reader, bookseller, institution and supplier, with what their emails say about them. */
export default function CustomerDb() {
	const [sp] = useSearchParams();
	const list0 = (k: string) => (sp.get(k) || '').split(',').filter(Boolean);
	const EMPTY = { q: '', type: '', language: '', has: '', sort: 'recent', dir: '', city: '', country: '', purposes: [] as string[], purposeMode: 'any', not: [] as string[], tier: [] as string[], kalyan: '', kalyanType: '', orders: '', minSpend: '', orderedSince: '', orderedBefore: '', quietDays: '', gap: '' };
	// filters live in the page address, so a filtered list can be bookmarked or shared
	const [f, setF0] = useState(() => ({ ...EMPTY, ...Object.fromEntries([...sp.entries()].filter(([k]) => k in EMPTY).map(([k, v]) => [k, Array.isArray((EMPTY as any)[k]) ? v.split(',').filter(Boolean) : v])) }));
	const [, setSp] = useSearchParams();
	const setF = (v: typeof f) => { setF0(v); setSp(qs({ ...v, q: undefined }).replace(/^\?/, ''), { replace: true }); };
	void list0;
	const P = usePurposes();
	const [city, setCity] = useState('');
	useEffect(() => { const t = setTimeout(() => setF0((x) => ({ ...x, city })), 350); return () => clearTimeout(t); }, [city]);
	const [search, setSearch] = useState('');
	const [limit, setLimit] = useState(50);
	const [open, setOpen] = useState<any>(null);
	useEffect(() => { const t = setTimeout(() => setF0((x) => ({ ...x, q: search })), 350); return () => clearTimeout(t); }, [search]);
	const { data, isLoading, isFetching } = useQuery({ queryKey: ['customer-db', f, limit], queryFn: () => api(`/customer-db${qs({ ...f, limit })}`), placeholderData: keepPreviousData });
	const t = data?.totals || {};
	const download = async (format: 'csv' | 'xlsx' | 'print') => {
		const res = await fetch(`/api/customer-db${qs({ ...f, format })}`, { headers: { authorization: `Bearer ${getToken()}` } });
		if (format === 'print') { const w = window.open('', '_blank'); if (w) { w.document.write(await res.text()); w.document.close(); } return; }
		const a = document.createElement('a');
		a.href = URL.createObjectURL(await res.blob());
		a.download = `gitamail-customers-${new Date().toISOString().slice(0, 10)}.${format}`;
		a.click();
	};
	const purposeCount = (k: string) => (t.purposes || []).find((x: any) => x.k === k)?.n;
	const filtered = f.q || f.type || f.language || f.has || f.city || f.country || f.purposes.length || f.not.length || f.tier.length || f.kalyan || f.kalyanType || f.orders || f.minSpend || f.orderedSince || f.orderedBefore || f.quietDays || f.gap;
	const [reviews, setReviews] = useState(false);
	const rv = useQuery({ queryKey: ['customer-reviews'], queryFn: () => api('/customer-reviews') });
	const openReviews = Object.values(rv.data?.counts || {}).reduce((a: number, b: any) => a + b, 0) as number;
	const pct = (x: number) => (t.total ? Math.round((x / t.total) * 100) : 0);

	return (
		<>
			<PageHead kw="Customer" rest="database"
				sub="Every reader, bookseller, institution and supplier who has written, ordered or takes Kalyan, with what their emails, orders and Kalyan dispatches say. Built automatically; anything you edit is kept."
				actions={<>{openReviews > 0 && <button className="btn" onClick={() => setReviews(true)}>Possible duplicates ({n(openReviews)})</button>}<button className="btn" onClick={() => download('xlsx')}><MdDownload /> Excel</button><button className="btn" onClick={() => download('csv')}><MdDownload /> CSV</button><button className="btn" onClick={() => download('print')}><MdPrint /> PDF</button></>} />
			{data && (
				<Story
					head={<>{n(t.total)} customers on file{filtered ? ' with these filters' : ''}: {pct(t.with_phone)}% have a phone number and {pct(t.with_address)}% a postal address.</>}
					points={[
						<>{n(t.with_uploaded_orders)} have orders on file (₹{n(Math.round(t.spend || 0))} in all) and {n(t.kalyan)} take Kalyan; {n(t.kalyan_and_orders)} do both.</>,
						<>Important buyers: {n(t.platinum)} Platinum, {n(t.gold)} Gold and {n(t.silver)} Silver.</>,
						<>{n(t.by_ai)} records were read by Claude; the rest by the rules engine.{t.pending ? ` ${n(t.pending)} are still being built in the background.` : ''}</>,
						...((t.purposes || []).length ? [<>Most common reasons for contacting: {(t.purposes || []).slice(0, 4).map((x: any) => `${purposeLabel(x.k)} (${n(x.n)})`).join(', ')}.</>] : []),
					]}
					next={<>Claude uses these details when drafting replies, so readers are not asked again for an address or subscriber number already on file.</>}
				/>
			)}
			<div className="filter-strip wrap mb-16">
				<div className="search-box">
					<MdSearch />
					<input className="input sm" placeholder="Search name, email, phone, PIN, order or subscriber number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
				</div>
				<select className={`input sm drop ${f.type ? 'on' : ''}`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Type">
					<option value="">All types</option>
					{(t.types || []).map((x: any) => <option key={x.k} value={x.k}>{TYPES[x.k] || x.k} ({n(x.n)})</option>)}
				</select>
				<select className={`input sm drop ${f.language ? 'on' : ''}`} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} aria-label="Language">
					<option value="">Any language</option>
					{[...new Set(['Hindi', 'English', ...(t.languages || []).map((x: any) => x.k)])].map((l) => <option key={l} value={l}>{l}</option>)}
				</select>
				<input className={`input sm ${f.city ? 'on' : ''}`} style={{ width: 130 }} placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City" />
				<select className={`input sm drop ${f.country ? 'on' : ''}`} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} aria-label="Country">
					<option value="">Any country</option>
					{(t.countries || []).map((x: any) => <option key={x.k || '-'} value={x.k || '-'}>{x.k || 'Not known'} ({n(x.n)})</option>)}
				</select>
				<select className={`input sm drop ${f.has ? 'on' : ''}`} value={f.has} onChange={(e) => setF({ ...f, has: e.target.value })} aria-label="Has">
					<option value="">Any details</option>
					<option value="phone">Has phone ({n(t.with_phone)})</option>
					<option value="address">Has address ({n(t.with_address)})</option>
					<option value="orders">Has order numbers ({n(t.with_orders)})</option>
					<option value="subscriber">Kalyan subscriber ({n(t.with_subscriber)})</option>
				</select>
				<MultiSelect label="Tier" keepLabel value={f.tier} onChange={(v) => setF({ ...f, tier: v })} options={['platinum', 'gold', 'silver', 'regular'].map((k) => ({ v: k, l: TIER_LABEL[k] }))} />
				<select className={`input sm drop ${f.kalyan || f.kalyanType ? 'on' : ''}`} value={f.kalyanType ? `t:${f.kalyanType}` : f.kalyan} onChange={(e) => { const v = e.target.value; setF({ ...f, kalyan: v.startsWith('t:') ? 'yes' : v, kalyanType: v.startsWith('t:') ? v.slice(2) : '' }); }} aria-label="Kalyan">
					<option value="">Kalyan: any</option>
					<option value="yes">Takes Kalyan ({n(t.kalyan)})</option>
					<option value="t:1Y">Kalyan 1 year</option><option value="t:FY">Kalyan 5 years</option><option value="t:LM">Kalyan life member</option>
					<option value="no">Does not take Kalyan</option>
				</select>
				<select className={`input sm drop ${f.orders ? 'on' : ''}`} value={f.orders} onChange={(e) => setF({ ...f, orders: e.target.value })} aria-label="Orders">
					<option value="">Orders: any</option><option value="yes">Has ordered</option><option value="no">Never ordered</option>
				</select>
				<input className={`input sm ${f.minSpend ? 'on' : ''}`} style={{ width: 130 }} type="number" min={0} placeholder="Spend at least ₹" value={f.minSpend} onChange={(e) => setF({ ...f, minSpend: e.target.value })} aria-label="Spend at least" />
				<label className="row small gap-4">Last order from <input className={`input sm ${f.orderedSince ? 'on' : ''}`} type="date" value={f.orderedSince} onChange={(e) => setF({ ...f, orderedSince: e.target.value })} /></label>
				<label className="row small gap-4">before <input className={`input sm ${f.orderedBefore ? 'on' : ''}`} type="date" value={f.orderedBefore} onChange={(e) => setF({ ...f, orderedBefore: e.target.value })} /></label>
				{f.quietDays && <button className="btn sm" onClick={() => setF({ ...f, quietDays: '' })}>Important buyers quiet for {f.quietDays}+ days ✕</button>}
				{f.gap && <button className="btn sm" onClick={() => setF({ ...f, gap: '' })}>{f.gap} ✕</button>}
				<MultiSelect label="Contacted for" keepLabel searchable value={f.purposes} onChange={(v) => setF({ ...f, purposes: v })}
					options={P.options((k) => (purposeCount(k) ? <span className="xs faint">{n(purposeCount(k))}</span> : undefined))} />
				{f.purposes.length > 1 && <Segmented value={f.purposeMode} onChange={(v) => setF({ ...f, purposeMode: v })} options={[{ v: 'any', l: 'Any of these' }, { v: 'all', l: 'All of these' }]} />}
				<MultiSelect label="Never contacted for" keepLabel searchable value={f.not} onChange={(v) => setF({ ...f, not: v })}options={P.options()} />
				{filtered ? <button className="btn ghost sm" onClick={() => { setSearch(''); setCity('');setF({ ...EMPTY, sort: f.sort, dir: f.dir }); }}>Clear filters</button> : null}
			</div>
			<Card flush>
				{isLoading ? <Loader text="Loading customers" /> : !data?.rows?.length ? <Empty text="No customers match." /> : (
					<>
						<div className="table-wrap">
							<table className="table">
								<thead><tr>
									<Th k="name" f={f} setF={setF}>Name</Th><Th k="tier" f={f} setF={setF}>Tier</Th><Th k="type" f={f} setF={setF}>Type</Th><th>Phone</th><Th k="place" f={f} setF={setF}>Place</Th>
									<Th k="country" f={f} setF={setF}>Country</Th><Th k="language" f={f} setF={setF}>Language</Th><Th k="reasons" f={f} setF={setF}>Reasons for contacting</Th>
									<Th k="orders" f={f} setF={setF} num>Orders</Th><Th k="spend" f={f} setF={setF} num>Spend</Th><Th k="lastOrder" f={f} setF={setF}>Last order</Th><Th k="kalyan" f={f} setF={setF}>Kalyan</Th>
									<Th k="threads" f={f} setF={setF} num>Threads</Th><Th k="recent" f={f} setF={setF}>Last contact</Th>
								</tr></thead>
								<tbody>
									{data.rows.map((r: any) => (
										<tr key={r.id} className="click" onClick={() => setOpen(r)}>
											<td style={{ maxWidth: 260 }}><b className="truncate" style={{ display: 'block' }}>{r.name}</b><div className="xs faint truncate">{r.p.organisation || r.p.emails?.[0]}</div></td>
											<td className="small nowrap" title={(r.buyer_why || []).join('; ')}><BuyerTier t={r.buyer_tier} /></td>
											<td className="small nowrap">{TYPES[r.p.type || r.kind] || r.p.type || r.kind}</td>
											<td className="small mono nowrap">{r.p.phones?.[0] || <span className="faint">–</span>}</td>
											<td className="small" style={{ maxWidth: 200 }}>{[r.p.city, r.p.state || r.enrichment?.region?.pin_state, r.p.pin].filter(Boolean).join(', ') || <span className="faint">–</span>}{r.enrichment?.possible_duplicates?.length ? <div className="xs" style={{ color: 'var(--amber)' }}>Possible duplicate</div> : null}</td>
											<td className="small nowrap">{r.country || <span className="faint">–</span>}</td>
											<td className="small">{r.p.language || <span className="faint">–</span>}</td>
											<td className="xs" style={{ maxWidth: 230 }}>{(r.purposes || []).length ? <div className="row wrap gap-4">{r.purposes.slice(0, 3).map((x: string) => <span key={x} className="chip" title={purposeLabel(x)}>{shortPurpose(x)}</span>)}{r.purposes.length > 3 && <span className="faint">+{r.purposes.length - 3}</span>}</div> : <span className="faint">–</span>}</td>
											<td className="num small">{r.orders_count ? n(r.orders_count) : <span className="faint">–</span>}</td>
											<td className="num small nowrap">{r.orders_spend ? inr(r.orders_spend) : <span className="faint">–</span>}</td>
											<td className="small nowrap">{r.orders_last ? fmtDate(r.orders_last) : <span className="faint">–</span>}</td>
											<td className="xs" style={{ maxWidth: 180 }}>{r.kalyan_buyer ? <><div>{SUB_LABEL[r.kalyan_type] || r.kalyan_type}</div><div className="faint truncate">No. {(r.kalyan_custnos || []).join(', ')}</div></> : <span className="faint">–</span>}</td>
											<td className="num small">{r.threads}{r.waiting ? <span className="badge amber" style={{ marginLeft: 6 }}>{r.waiting} waiting</span> : null}</td>
											<td className="small nowrap">{ago(r.last_contact_at)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<div className="row-between" style={{ padding: '10px 20px' }}>
							<span className="small faint">{n(data.rows.length)} of {n(t.total)} shown{isFetching ? ' · updating' : ''}</span>
							{data.rows.length < t.total && <button className="btn sm" onClick={() => setLimit(limit + 100)}>Show 100 more</button>}
						</div>
					</>
				)}
			</Card>
			{open && <CustomerModal c={open} onClose={() => setOpen(null)} />}
			{reviews && <Reviews onClose={() => setReviews(false)} />}
		</>
	);
}

function CustomerModal({ c, onClose }: { c: any; onClose: () => void }) {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const [cur, setCur] = useState(c);
	const [edit, setEdit] = useState<Record<string, string> | null>(null);
	const save = useMutation({
		mutationFn: () => api(`/customer-db/${c.id}`, { method: 'PATCH', body: edit }),
		onSuccess: (r) => { setCur({ ...cur, ...r }); setEdit(null); qc.invalidateQueries({ queryKey: ['customer-db'] }); toast('Customer saved'); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const refresh = useMutation({
		mutationFn: () => api(`/customer-db/${c.id}/refresh`, { body: { ai: true } }),
		onSuccess: (r) => { setCur({ ...cur, ...r.customer }); qc.invalidateQueries({ queryKey: ['customer-db'] }); toast(r.source === 'ai' ? 'Read again by Claude' : 'Read again by the rules engine (Claude unavailable)'); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const p = cur.p || {};
	const manual = cur.profile_manual || {};
	return (
		<Modal wide title={cur.name} onClose={onClose}
			footer={edit ? <><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending}>Save</button></> : <>
				<Link className="btn ghost" to={`/customers/${c.id}`}><MdOpenInNew /> Threads and health</Link>
				<span style={{ flex: 1 }} />
				{can('analyst') && <button className="btn" onClick={() => refresh.mutate()} disabled={refresh.isPending}><MdAutoAwesome /> {refresh.isPending ? 'Reading…' : 'Read emails again'}</button>}
				{can('analyst') && <button className="btn primary" onClick={() => setEdit(Object.fromEntries(FIELDS.map(([k]) => [k, list(p[k])])))}>Edit</button>}
			</>}>
			{edit ? (
				<div className="grid g-2">
					{FIELDS.map(([k, l, multi]) => (
						<div key={k} className="field" style={k === 'address' || k === 'notes' ? { gridColumn: '1 / -1' } : undefined}>
							<label>{l}{multi ? ' (separate with commas)' : ''}</label>
							{k === 'type' ? (
								<select className="input" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
									{['reader', 'bookseller', 'distributor', 'institution', 'supplier', 'other'].map((x) => <option key={x} value={x}>{TYPES[x]}</option>)}
								</select>
							) : <input className="input" value={edit[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />}
						</div>
					))}
				</div>
			) : (
				<>
					<Facts items={[
						['Type', TYPES[p.type || cur.kind] || p.type],
						['Threads', `${cur.threads ?? ''}${cur.waiting ? ` (${cur.waiting} waiting)` : ''}`],
						['First contact', cur.first_contact ? fmtDate(cur.first_contact) : ''],
						['Last contact', cur.last_contact_at ? fmtDate(cur.last_contact_at) : ''],
						['Writes in', p.language],
						['Record built by', cur.profile_source === 'ai' ? `Claude, ${ago(cur.profile_at)}` : cur.profile_source === 'upload' ? 'Order and Kalyan uploads' : cur.profile_source ? `Rules, ${ago(cur.profile_at)}` : 'Not yet'],
						['Tier', TIER_LABEL[cur.buyer_tier] || 'Regular'],
						['Orders', cur.orders_count ? `${n(cur.orders_count)} (${inr(cur.orders_spend)}), ${n(cur.orders_12m)} in the last 12 months` : 'None on file'],
						['Kalyan', cur.kalyan_buyer ? `${SUB_LABEL[cur.kalyan_type] || cur.kalyan_type}, renewal ${renewal(cur)}` : 'No'],
					]} />
					{(cur.buyer_why || []).length > 0 && <div className="xs faint mt-8">Tier because: {cur.buyer_why.join('; ')}.</div>}
					{(cur.matched_by || []).length > 0 && <div className="xs faint">Linked across email, orders and Kalyan by: {cur.matched_by.filter((x: string) => x !== 'new').map((x: string) => ({ email: 'email address', phone: 'mobile number', order: 'created from an order', kalyan: 'created from Kalyan', 'merged by staff': 'joined by staff', 'split by staff': 'split by staff' } as Record<string, string>)[x] || x).join(', ') || 'one source only'}.</div>}
					{(cur.data_gaps || []).length > 0 && <div className="xs mt-8" style={{ color: 'var(--amber)' }}>Gaps: {cur.data_gaps.join('; ')}</div>}
					<div className="kv mt-16">
						{FIELDS.filter(([k]) => k !== 'type' && k !== 'language').map(([k, l]) => (
							<FragmentRow key={k} k={l} v={LIST_FIELDS.includes(k) ? (p[k] || []).join(', ') : p[k]} edited={k in manual} />
						))}
					</div>
					<div className="kv mt-16">
						<span className="k">Reasons for contacting</span>
						<span className="row wrap gap-4">{(cur.purposes || []).length ? cur.purposes.map((x: string) => <span key={x} className="chip">{purposeLabel(x)}</span>) : <span className="faint">Not known yet</span>}</span>
					</div>
					<History id={c.id} name={cur.name} />
					<Suggestions id={c.id} />
					<Enrichment e={cur.enrichment} />
				</>
			)}
		</Modal>
	);
}

const FragmentRow = ({ k, v, edited }: { k: string; v: any; edited: boolean }) => (
	<>
		<span className="k">{k}</span>
		<span className={v ? '' : 'faint'}>{v || 'Not known'}{edited && <span className="badge" style={{ marginLeft: 6 }}>edited</span>}</span>
	</>
);

/** What Gita Mail adds: activity, region from PIN or GSTIN, possible duplicates, an organisation's website. */
function Enrichment({ e }: { e: any }) {
	if (!e || !e.activity) return <div className="small faint mt-16">Enrichment is added in the background within a few minutes.</div>;
	const a = e.activity;
	const r = e.region || {};
	return (
		<div className="mt-16">
			<h3 className="report-sub mb-8">What Gita Mail adds</h3>
			<Facts items={[
				['Emails from them', a.emails_from_them],
				['Waiting for a reply', a.waiting],
				['Red threads', a.red],
				['Average first reply', a.avg_first_reply_hours != null ? `${a.avg_first_reply_hours} h` : ''],
				['Usually writes to', a.usual_mailbox],
				['Last reply sent from Gita Mail', a.last_reply_sent ? fmtDate(a.last_reply_sent) : ''],
			]} />
			<div className="kv mt-16">
				{a.groups?.length > 0 && <><span className="k">Writes about</span><span>{a.groups.map((g: any) => `${g.label} (${g.n})`).join(', ')}</span></>}
				{(r.pin_state || r.gst_state) && <><span className="k">Region</span><span>{[r.pin_state && `${r.pin_state} (from PIN code)`, r.gst_state && `${r.gst_state} (from GSTIN)`].filter(Boolean).join(' · ')}{r.mismatch && <span className="badge amber" style={{ marginLeft: 6 }}>PIN and state differ</span>}</span></>}
				{r.gst_entity && <><span className="k">GSTIN holder</span><span>{r.gst_entity}</span></>}
				{e.website && <><span className="k">Website</span><span><a href={e.website.url} target="_blank" rel="noreferrer">{e.website.title || e.org_domain}</a>{e.website.description && <div className="small muted">{e.website.description}</div>}</span></>}
				{!e.website && e.org_domain && <><span className="k">Organisation domain</span><span>{e.org_domain} <span className="faint small">(no website information found)</span></span></>}
				{e.possible_duplicates?.length > 0 && <><span className="k">Same phone or address</span><span>{e.possible_duplicates.map((d: any) => <Link key={d.id} to={`/customers/${d.id}`} style={{ marginRight: 10 }}>{d.name}</Link>)}</span></>}
			</div>
			<div className="xs faint mt-8">Readers are not looked up on the internet; only what they wrote to Gita Press is used. Organisations with their own email domain get their public website details.</div>
		</div>
	);
}

/** Upsell and cross-sell ideas for this customer, from their reasons for contacting, language, place and books asked about. */
function Suggestions({ id }: { id: number }) {
	const { data } = useQuery({ queryKey: ['customer-suggestions', id], queryFn: () => api(`/customers/${id}/suggestions`) });
	if (!data || (!data.offers?.length && !data.books?.length)) return null;
	return (
		<div className="mt-16">
			<h3 className="report-sub mb-8">Upsell and cross-sell</h3>
			{data.offers?.length > 0 && <ul className="small" style={{ margin: '0 0 8px 18px' }}>{data.offers.map((o: string) => <li key={o}>{o}</li>)}</ul>}
			{data.books?.length > 0 && (
				<div className="table-wrap">
					<table className="table">
						<thead><tr><th>Book to suggest</th><th>Why</th><th className="num">Price</th></tr></thead>
						<tbody>{data.books.map((b: any) => (
							<tr key={b.code}><td className="small"><b>{b.name}</b><div className="xs faint">Code {b.code} · {b.language}</div></td><td className="xs">{b.reason}</td><td className="num small">{inr(b.price)}</td></tr>
						))}</tbody>
					</table>
				</div>
			)}
			{!data.hasStock && <div className="xs faint">Upload stock in Inventory to get book suggestions.</div>}
		</div>
	);
}

const DEFAULT_DIR: Record<string, string> = { recent: 'desc', threads: 'desc', reasons: 'desc', points: 'desc', spend: 'desc', orders: 'desc', lastOrder: 'desc' };
/** A column heading that sorts the list; a second click reverses the order. */
function Th({ k, f, setF, num, children }: { k: string; f: any; setF: (v: any) => void; num?: boolean; children: ReactNode }) {
	const on = f.sort === k;
	const dir = on ? f.dir || DEFAULT_DIR[k] || 'asc' : '';
	const next = () => setF({ ...f, sort: k, dir: on ? (dir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[k] || 'asc' });
	return (
		<th className={`${num ? 'num ' : ''}sortable${on ? ' on' : ''}`} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
			<button type="button" className="th-sort" onClick={next}>{children}<span className="arrow">{on ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span></button>
		</th>
	);
}

/** The customer's orders and Kalyan dispatches from the uploads, and splitting a record that joins two people. */
function History({ id, name }: { id: number; name: string }) {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const { data } = useQuery({ queryKey: ['customer-history', id], queryFn: () => api(`/customer-db/${id}/history`) });
	const [split, setSplit] = useState<{ orderKeys: string[]; custnos: string[]; name: string } | null>(null);
	const doSplit = useMutation({
		mutationFn: () => api(`/customer-db/${id}/split`, { body: split }),
		onSuccess: (r: any) => { setSplit(null); qc.invalidateQueries(); toast(`Moved to a new customer: ${r.name}`); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	if (!data || (!data.orders?.length && !data.subscribers?.length)) return null;
	const toggle = (k: 'orderKeys' | 'custnos', v: string) => split && setSplit({ ...split, [k]: split[k].includes(v) ? split[k].filter((x) => x !== v) : [...split[k], v] });
	const tracked = (o: any) => (o.tracking_id ? (o.tracking_ok ? o.tracking_id : <span style={{ color: 'var(--amber)' }} title="Damaged by Excel; cannot be tracked">{o.tracking_id} (damaged)</span>) : <span className="faint">–</span>);
	return (
		<div className="mt-16">
			<div className="row-between mb-8">
				<h3 className="report-sub">Orders and Kalyan</h3>
				{can('manager') && data.orders.length + data.subscribers.length > 1 && (split
					? <span className="row gap-8"><input className="input sm" placeholder="Name of the other person" value={split.name} onChange={(e) => setSplit({ ...split, name: e.target.value })} /><button className="btn sm" onClick={() => setSplit(null)}>Cancel</button><button className="btn sm primary" disabled={doSplit.isPending || (!split.orderKeys.length && !split.custnos.length)} onClick={() => doSplit.mutate()}>Move ticked to a new customer</button></span>
					: <button className="btn sm" onClick={() => setSplit({ orderKeys: [], custnos: [], name: '' })} title={`Use when ${name} is really two people`}><MdCallSplit /> Split</button>)}
			</div>
			{data.orders.length > 0 && (
				<div className="table-wrap mb-16">
					<table className="table">
						<thead><tr>{split && <th />}<th>Order</th><th>Date</th><th className="num">Amount</th><th>Status</th><th>Delivery partner</th><th>Tracking number</th><th>Ship to</th></tr></thead>
						<tbody>{data.orders.map((o: any) => (
							<tr key={o.order_key}>
								{split && <td><input type="checkbox" checked={split.orderKeys.includes(o.order_key)} onChange={() => toggle('orderKeys', o.order_key)} aria-label={`Move order ${o.order_id}`} /></td>}
								<td className="small mono">{o.order_id}</td><td className="small nowrap">{fmtDate(o.ordered_at)}</td><td className="num small">{inr(o.total)}</td>
								<td className="small">{o.status_label}</td><td className="small">{o.partner || '–'}</td><td className="small mono">{tracked(o)}</td><td className="xs">{[o.ship_city, o.ship_pin].filter(Boolean).join(' ')}</td>
							</tr>))}</tbody>
					</table>
				</div>
			)}
			{data.subscribers.map((s: any) => (
				<div key={s.custno} className="mb-16">
					<div className="small mb-8">
						{split && <input type="checkbox" checked={split.custnos.includes(s.custno)} onChange={() => toggle('custnos', s.custno)} style={{ marginRight: 6 }} aria-label={`Move subscriber ${s.custno}`} />}
						<b>Kalyan subscriber {s.custno}</b> · {s.sub_label} · {s.city}{s.state ? `, ${s.state}` : ''} {s.pin} · renewal {s.sub_type === 'LM' ? 'never (life member)' : s.renewal_est ? `${fmtDate(s.renewal_est, 'MMM yyyy')} (estimated)` : 'not known'}
						{s.email && !s.email_ok && <span className="xs" style={{ color: 'var(--amber)', marginLeft: 6 }}>email on file is not valid: {s.email}</span>}
					</div>
					<div className="table-wrap">
						<table className="table">
							<thead><tr><th>Dispatched</th><th>Issues</th><th>Sent by</th><th>Dispatch and tracking number</th></tr></thead>
							<tbody>{data.dispatches.filter((d: any) => d.custno === s.custno).map((d: any, i: number) => (
								<tr key={i}><td className="small nowrap">{fmtDate(d.dispdate)}</td><td className="small">{d.from_issue === d.to_issue ? d.from_issue : `${d.from_issue} to ${d.to_issue}`}</td>
									<td className="small">{d.mode === 'REGISTERED' ? 'Registered post' : d.mode === 'ORDINARY' ? 'Ordinary post' : d.mode === 'BY SHOP' ? 'Collected at a shop' : d.mode}</td>
									<td className="small mono">{d.barcode || <span className="faint">{d.mode === 'ORDINARY' ? 'None (ordinary post has no tracking)' : '–'}</span>}</td></tr>))}</tbody>
						</table>
					</div>
				</div>
			))}
		</div>
	);
}

/** Pairs Gita Mail did not join on its own: a phone and an email that point to two records, or the same name and PIN code. */
function Reviews({ onClose }: { onClose: () => void }) {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const { data } = useQuery({ queryKey: ['customer-reviews'], queryFn: () => api('/customer-reviews') });
	const done = { onSuccess: () => qc.invalidateQueries(), onError: (e: any) => toast(e.message, 'error') };
	const merge = useMutation({ mutationFn: (r: any) => api('/customers/merge', { body: { targetId: r.a_id, sourceIds: [r.b_id] } }), ...done });
	const dismiss = useMutation({ mutationFn: (id: number) => api(`/customer-reviews/${id}/dismiss`, { body: {} }), ...done });
	const side = (r: any, x: 'a' | 'b') => (
		<td className="xs" style={{ maxWidth: 260 }}><b>{r[`${x}_name`]}</b>
			<div className="faint">{[(r[`${x}_emails`] || []).join(', '), (r[`${x}_p`]?.phones || []).join(', '), [r[`${x}_p`]?.city, r[`${x}_p`]?.pin].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</div>
			<div className="faint">{r[`${x}_orders`] ? `${r[`${x}_orders`]} orders ` : ''}{(r[`${x}_kalyan`] || []).length ? `Kalyan ${r[`${x}_kalyan`].join(', ')} ` : ''}{r[`${x}_threads`] ? `${r[`${x}_threads`]} threads` : ''}</div></td>
	);
	return (
		<Modal wide title="Possible duplicates" onClose={onClose}>
			<p className="small muted">These pairs were not joined automatically. Join them when they are the same person; otherwise mark them as different people. Joining moves everything onto the first record.</p>
			{!data ? <Loader /> : !data.rows.length ? <Empty text="Nothing to check." /> : (
				<div className="table-wrap"><table className="table">
					<thead><tr><th>Why</th><th>Record 1</th><th>Record 2</th><th /></tr></thead>
					<tbody>{data.rows.map((r: any) => (
						<tr key={r.id}><td className="xs" style={{ maxWidth: 200 }}>{r.detail}</td>{side(r, 'a')}{side(r, 'b')}
							<td className="nowrap">{can('manager') && <><button className="btn sm primary" disabled={merge.isPending} onClick={() => merge.mutate(r)}>Same person</button> <button className="btn sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate(r.id)}>Different people</button></>}</td></tr>))}</tbody>
				</table></div>
			)}
		</Modal>
	);
}
