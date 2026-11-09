import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { MdAutoAwesome, MdDownload, MdOpenInNew, MdSearch } from 'react-icons/md';
import { api, getToken, qs } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card, Empty, Facts, Loader, Modal, MultiSelect, PageHead, Segmented, Story } from '../../components/ui';
import { PURPOSE_KEYS, inr, purposeLabel, shortPurpose } from '../../lib/purposes';
import { ago, fmtDate } from '../../lib/format';

const TYPES: Record<string, string> = { reader: 'Reader', bookseller: 'Bookseller', distributor: 'Distributor', institution: 'Temple, school or trust', supplier: 'Supplier', other: 'Other', customer: 'Reader', prospect: 'Bulk buyer', vendor: 'Supplier', partner: 'Distributor', candidate: 'Job applicant' };
const LIST_FIELDS = ['emails', 'phones', 'order_refs', 'subscriber_numbers', 'books'];
const FIELDS: [string, string, boolean?][] = [
	['type', 'Type'], ['organisation', 'Organisation'], ['phones', 'Phone numbers', true], ['emails', 'Email addresses', true],
	['address', 'Postal address'], ['city', 'City'], ['state', 'State'], ['pin', 'PIN code'], ['country', 'Country'], ['language', 'Writes in'],
	['subscriber_numbers', 'Kalyan subscriber numbers', true], ['order_refs', 'Order numbers', true], ['books', 'Books asked about', true], ['gstin', 'GSTIN'], ['notes', 'Notes'],
];
const n = (v?: number) => (v ?? 0).toLocaleString('en-IN');
const list = (v: any) => (Array.isArray(v) ? v.join(', ') : v || '');

/** Every reader, bookseller, institution and supplier, with what their emails say about them. */
export default function CustomerDb() {
	const [sp] = useSearchParams();
	const list0 = (k: string) => (sp.get(k) || '').split(',').filter(Boolean);
	const [f, setF] = useState({ q: '', type: '', language: '', has: '', sort: sp.get('sort') || 'recent', dir: '', city: '', country: sp.get('country') || '', purposes: list0('purposes'), purposeMode: sp.get('purposeMode') || 'any', not: list0('not') });
	const [city, setCity] = useState('');
	useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, city })), 350); return () => clearTimeout(t); }, [city]);
	const [search, setSearch] = useState('');
	const [limit, setLimit] = useState(50);
	const [open, setOpen] = useState<any>(null);
	useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q: search })), 350); return () => clearTimeout(t); }, [search]);
	const { data, isLoading, isFetching } = useQuery({ queryKey: ['customer-db', f, limit], queryFn: () => api(`/customer-db${qs({ ...f, limit })}`), placeholderData: keepPreviousData });
	const t = data?.totals || {};
	const download = async (format: 'csv' | 'xlsx') => {
		const res = await fetch(`/api/customer-db${qs({ ...f, format })}`, { headers: { authorization: `Bearer ${getToken()}` } });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(await res.blob());
		a.download = `gitamail-customers-${new Date().toISOString().slice(0, 10)}.${format}`;
		a.click();
	};
	const purposeCount = (k: string) => (t.purposes || []).find((x: any) => x.k === k)?.n;
	const filtered = f.q || f.type || f.language || f.has || f.city || f.country || f.purposes.length || f.not.length;
	const pct = (x: number) => (t.total ? Math.round((x / t.total) * 100) : 0);

	return (
		<>
			<PageHead kw="Customer" rest="database"
				sub="Every reader, bookseller, institution and supplier who has written, with the details their emails contain. Built automatically; Claude refines active customers, and anything you edit is kept."
				actions={<><button className="btn" onClick={() => download('xlsx')}><MdDownload /> Excel</button><button className="btn" onClick={() => download('csv')}><MdDownload /> CSV</button></>} />
			{data && (
				<Story
					head={<>{n(t.total)} customers on file{filtered ? ' with these filters' : ''}: {pct(t.with_phone)}% have a phone number and {pct(t.with_address)}% a postal address.</>}
					points={[
						<>{n(t.with_orders)} have quoted an order number and {n(t.with_subscriber)} a Kalyan subscriber number.</>,
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
				<MultiSelect label="Contacted for" keepLabel searchable value={f.purposes} onChange={(v) => setF({ ...f, purposes: v })}
					options={PURPOSE_KEYS.map((k) => ({ v: k, l: purposeLabel(k), extra: purposeCount(k) ? <span className="xs faint">{n(purposeCount(k))}</span> : undefined }))} />
				{f.purposes.length > 1 && <Segmented value={f.purposeMode} onChange={(v) => setF({ ...f, purposeMode: v })} options={[{ v: 'any', l: 'Any of these' }, { v: 'all', l: 'All of these' }]} />}
				<MultiSelect label="Never contacted for" keepLabel searchable value={f.not} onChange={(v) => setF({ ...f, not: v })} options={PURPOSE_KEYS.map((k) => ({ v: k, l: purposeLabel(k) }))} />
				{filtered ? <button className="btn ghost sm" onClick={() => { setSearch(''); setCity(''); setF({ q: '', type: '', language: '', has: '', sort: f.sort, dir: f.dir, city: '', country: '', purposes: [], purposeMode: 'any', not: [] }); }}>Clear filters</button> : null}
			</div>
			<Card flush>
				{isLoading ? <Loader text="Loading customers" /> : !data?.rows?.length ? <Empty text="No customers match." /> : (
					<>
						<div className="table-wrap">
							<table className="table">
								<thead><tr>
									<Th k="name" f={f} setF={setF}>Name</Th><Th k="type" f={f} setF={setF}>Type</Th><th>Phone</th><Th k="place" f={f} setF={setF}>Place</Th>
									<Th k="country" f={f} setF={setF}>Country</Th><Th k="language" f={f} setF={setF}>Language</Th><Th k="reasons" f={f} setF={setF}>Reasons for contacting</Th>
									<th>Orders and subscriptions</th><Th k="threads" f={f} setF={setF} num>Threads</Th><Th k="recent" f={f} setF={setF}>Last contact</Th>
								</tr></thead>
								<tbody>
									{data.rows.map((r: any) => (
										<tr key={r.id} className="click" onClick={() => setOpen(r)}>
											<td style={{ maxWidth: 260 }}><b className="truncate" style={{ display: 'block' }}>{r.name}</b><div className="xs faint truncate">{r.p.organisation || r.p.emails?.[0]}</div></td>
											<td className="small nowrap">{TYPES[r.p.type || r.kind] || r.p.type || r.kind}</td>
											<td className="small mono nowrap">{r.p.phones?.[0] || <span className="faint">–</span>}</td>
											<td className="small" style={{ maxWidth: 200 }}>{[r.p.city, r.p.state || r.enrichment?.region?.pin_state, r.p.pin].filter(Boolean).join(', ') || <span className="faint">–</span>}{r.enrichment?.possible_duplicates?.length ? <div className="xs" style={{ color: 'var(--amber)' }}>Possible duplicate</div> : null}</td>
											<td className="small nowrap">{r.country || <span className="faint">–</span>}</td>
											<td className="small">{r.p.language || <span className="faint">–</span>}</td>
											<td className="xs" style={{ maxWidth: 230 }}>{(r.purposes || []).length ? <div className="row wrap gap-4">{r.purposes.slice(0, 3).map((x: string) => <span key={x} className="chip" title={purposeLabel(x)}>{shortPurpose(x)}</span>)}{r.purposes.length > 3 && <span className="faint">+{r.purposes.length - 3}</span>}</div> : <span className="faint">–</span>}</td>
											<td className="xs" style={{ maxWidth: 220 }}>
												{r.p.subscriber_numbers?.length > 0 && <div className="truncate">Kalyan {r.p.subscriber_numbers.join(', ')}</div>}
												{r.p.order_refs?.length > 0 && <div className="truncate faint">{r.p.order_refs.slice(0, 3).join(', ')}</div>}
											</td>
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
						['Record built by', cur.profile_source === 'ai' ? `Claude, ${ago(cur.profile_at)}` : cur.profile_source ? `Rules, ${ago(cur.profile_at)}` : 'Not yet'],
					]} />
					<div className="kv mt-16">
						{FIELDS.filter(([k]) => k !== 'type' && k !== 'language').map(([k, l]) => (
							<FragmentRow key={k} k={l} v={LIST_FIELDS.includes(k) ? (p[k] || []).join(', ') : p[k]} edited={k in manual} />
						))}
					</div>
					<div className="kv mt-16">
						<span className="k">Reasons for contacting</span>
						<span className="row wrap gap-4">{(cur.purposes || []).length ? cur.purposes.map((x: string) => <span key={x} className="chip">{purposeLabel(x)}</span>) : <span className="faint">Not known yet</span>}</span>
					</div>
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

const DEFAULT_DIR: Record<string, string> = { recent: 'desc', threads: 'desc', reasons: 'desc' };
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
