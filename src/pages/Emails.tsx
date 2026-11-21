/**
 * Emails, laid out like Outlook: the list on the left, the reading pane on the right (or below, or off).
 * Tabs: All · the six groups · Bulk orders and quotes · Open questions · Not for reply. An email appears here only once
 * the AI has analysed it; until then it is not shown at all (progress: Settings → AI).
 * Search, filters on every column, sorting on every column, saved views and keyboard shortcuts
 * (j / k next and previous, / search, Enter open, Esc close).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MdAttachFile, MdBookmarkAdd, MdDelete, MdSearch, MdSync, MdViewAgenda, MdViewSidebar, MdViewList } from 'react-icons/md';
import { api, qs } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Empty, Loader, Modal, PageHead } from '../components/ui';
import EmailPane, { Completeness, LevelTag, StatusTag, inr } from '../components/EmailPane';
import { ago, fmtDate, fmtDateTime } from '../lib/format';

type Pane = 'right' | 'bottom' | 'off';
const PANE_KEY = 'gitamail_reading_pane';
const loadPane = (): Pane => { try { return (localStorage.getItem(PANE_KEY) as Pane) || 'right'; } catch { return 'right'; } };
const FILTER_KEYS = ['q', 'status', 'criticality', 'subtag', 'reason', 'mailbox', 'minComp', 'maxComp', 'attachments', 'question', 'showSent', 'from', 'to'];

export default function Emails() {
	const [sp, setSp] = useSearchParams();
	const tab = sp.get('tab') || 'all';
	const meta = useQuery({ queryKey: ['emails-meta'], queryFn: () => api('/emails/meta'), refetchInterval: 60_000 });
	const setTab = (t: string) => { const n = new URLSearchParams(); n.set('tab', t); if (sp.get('view')) n.set('view', sp.get('view')!); setSp(n); };
	const m = meta.data;
	const count = (g: string, statuses = ['pending', 'ready', 'queued']) => (m?.counts || []).filter((c: any) => (g === 'all' ? !c.nfr : g === 'not_for_reply' ? c.nfr : !c.nfr && c.g === g) && (g === 'not_for_reply' || statuses.includes(c.s))).reduce((a: number, c: any) => a + c.n, 0);
	const tabs = [
		{ k: 'all', l: 'All', n: count('all') },
		...(m?.groups || []).map((g: any) => ({ k: g.key, l: g.label, n: count(g.key) })),
		{ k: 'bulk', l: 'Bulk orders and quotes', n: m?.bulkOpen },
		{ k: 'questions', l: 'Open questions', n: m?.openQuestions },
		{ k: 'not_for_reply', l: 'Not for reply', n: count('not_for_reply') },
	];
	return (
		<>
			<PageHead kw="Emails" sub="Every email that needs a reply, sorted into six groups. Gita Mail fills in what it can find (green) and asks a specific question for what is missing (yellow). Nothing is sent until you press Send." />
			<div className="tabs email-tabs" role="tablist">
				{tabs.map((t) => (
					<button key={t.k} role="tab" aria-selected={tab === t.k} className={tab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>
						{t.l}{t.n ? <span className="tab-n">{t.n.toLocaleString('en-IN')}</span> : null}
					</button>
				))}
			</div>
			{!m ? <Loader /> : tab === 'bulk' ? <BulkTab meta={m} /> : tab === 'questions' ? <QuestionsTab onShow={(key) => { const n = new URLSearchParams(); n.set('tab', 'all'); n.set('question', key); setSp(n); }} /> : <EmailList meta={m} tab={tab} />}
		</>
	);
}

function useFilterParams() {
	const [sp, setSp] = useSearchParams();
	const f: Record<string, string> = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) || '']));
	const sort = sp.get('sort') || 'received';
	const dir = sp.get('dir') || 'desc';
	const set = (patch: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); } n.delete('open'); setSp(n, { replace: true }); };
	return { sp, setSp, f, sort, dir, set };
}

function EmailList({ meta, tab }: { meta: any; tab: string }) {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const { sp, setSp, f, sort, dir, set } = useFilterParams();
	const [pane, setPaneState] = useState<Pane>(loadPane);
	const setPane = (p: Pane) => { setPaneState(p); try { localStorage.setItem(PANE_KEY, p); } catch { /* per-viewer convenience */ } };
	const [search, setSearch] = useState(f.q);
	useEffect(() => { const t = setTimeout(() => search !== f.q && set({ q: search }), 350); return () => clearTimeout(t); });
	const [limit, setLimit] = useState(100);
	const query = { tab, ...f, sort, dir, limit };
	const { data, isLoading, isFetching } = useQuery({ queryKey: ['emails', query], queryFn: () => api(`/emails${qs(query)}`), placeholderData: keepPreviousData, refetchInterval: 60_000 });
	const rows: any[] = data?.rows || [];
	const open = Number(sp.get('open')) || null;
	const setOpen = (id: number | null) => { const n = new URLSearchParams(sp); if (id) n.set('open', String(id)); else n.delete('open'); setSp(n, { replace: true }); };
	const searchRef = useRef<HTMLInputElement>(null);
	const [syncDays, setSyncDays] = useState<number>(meta.syncDays || 90);
	const sync = useMutation({ mutationFn: (days?: number) => api('/emails/sync', { body: { days } }), onSuccess: () => toast('Reading mail now. New emails appear in a few minutes.'), onError: (e: any) => toast(e.message, 'error') });
	const [saving, setSaving] = useState(false);
	const [viewName, setViewName] = useState('');
	const saveView = useMutation({ mutationFn: () => api('/saved-views', { body: { name: viewName, query: sp.toString().replace(/(^|&)open=\d+/, '') } }), onSuccess: () => { setSaving(false); setViewName(''); qc.invalidateQueries({ queryKey: ['emails-meta'] }); toast('View saved'); }, onError: (e: any) => toast(e.message, 'error') });
	const delView = useMutation({ mutationFn: (id: number) => api(`/saved-views/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['emails-meta'] }) });

	// keyboard: j / k move, Enter opens, / searches, Esc closes the pane
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement;
			if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test(t.tagName) || t.isContentEditable) return;
			if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
			if (e.key === 'Escape') { setOpen(null); return; }
			if (!['j', 'k', 'ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
			const i = rows.findIndex((r) => r.id === open);
			if (e.key === 'Enter') { if (i < 0 && rows[0]) setOpen(rows[0].id); return; }
			e.preventDefault();
			const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1)))];
			if (next) { setOpen(next.id); document.querySelector(`[data-email="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }); }
		};
		window.addEventListener('keydown', h);
		return () => window.removeEventListener('keydown', h);
	});

	const sortBy = (k: string) => set({ sort: k, dir: sort === k && dir === 'desc' ? 'asc' : 'desc' });
	const Th = ({ k, l, num }: { k: string; l: string; num?: boolean }) => (
		<th className={`${num ? 'num ' : ''}sortable${sort === k ? ' on' : ''}`} aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
			<button type="button" className="th-sort" onClick={() => sortBy(k)}>{l}<span className="arrow">{sort === k ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span></button>
		</th>
	);
	const group = (meta.groups || []).find((g: any) => g.key === tab);
	const subTags: string[] = group ? group.subTags : (meta.groups || []).flatMap((g: any) => g.subTags);
	const active = FILTER_KEYS.filter((k) => k !== 'q' && f[k]).length;
	const compact = pane === 'right' && !!open;
	const waiting = (d?: string) => (d ? ago(d).replace(' ago', '') : '');

	return (
		<>
			<div className="filter-strip wrap mb-8">
				<div className="search-box"><MdSearch /><input ref={searchRef} className="input sm" placeholder="Search sender, subject, text, order no., Kalyan no., book code  ( / )" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search emails" /></div>
				<select className={`input sm drop ${f.status ? 'on' : ''}`} value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Reply status">
					<option value="">To answer</option><option value="ready">Ready to send</option><option value="pending">Pending information</option><option value="queued">Sending</option><option value="sent">Sent</option>
				</select>
				<select className={`input sm drop ${f.criticality ? 'on' : ''}`} value={f.criticality} onChange={(e) => set({ criticality: e.target.value })} aria-label="Criticality">
					<option value="">Any criticality</option>{(meta.levels || []).map((l: any) => <option key={l.key} value={l.key}>{l.label}</option>)}
				</select>
				{subTags.length > 0 && <select className={`input sm drop ${f.subtag ? 'on' : ''}`} value={f.subtag} onChange={(e) => set({ subtag: e.target.value })} aria-label="Sub-tag">
					<option value="">Any sub-tag</option>{[...new Set(subTags)].map((t) => <option key={t} value={t}>{meta.subTags[t] || t}</option>)}
				</select>}
				<select className={`input sm drop ${f.mailbox ? 'on' : ''}`} value={f.mailbox} onChange={(e) => set({ mailbox: e.target.value })} aria-label="Mailbox">
					<option value="">Every mailbox</option>{(meta.mailboxes || []).map((b: any) => <option key={b.id} value={b.id}>{b.address}</option>)}
				</select>
				<select className={`input sm drop ${f.maxComp || f.minComp ? 'on' : ''}`} value={`${f.minComp}-${f.maxComp}`} onChange={(e) => { const [a, b] = e.target.value.split('-'); set({ minComp: a, maxComp: b }); }} aria-label="Completeness">
					<option value="-">Any completeness</option><option value="100-">Complete (100%)</option><option value="-99">Not complete</option><option value="-49">Below 50%</option>
				</select>
				<label className="small row gap-4"><input type="checkbox" checked={f.attachments === '1'} onChange={(e) => set({ attachments: e.target.checked ? '1' : '' })} /> <MdAttachFile /> With attachments</label>
				{f.question && <span className="chip">Question: {f.question} <button className="link-btn" onClick={() => set({ question: '' })}>×</button></span>}
				{active > 0 && <button className="btn ghost sm" onClick={() => { setSearch(''); set(Object.fromEntries(FILTER_KEYS.map((k) => [k, '']))); }}>Clear filters</button>}
				<span className="grow" />
				<select className="input sm drop" value="" onChange={(e) => { if (e.target.value) setSp(new URLSearchParams(e.target.value)); }} aria-label="Saved views">
					<option value="">Saved views{meta.views?.length ? ` (${meta.views.length})` : ''}</option>{(meta.views || []).map((v: any) => <option key={v.id} value={v.query}>{v.name}</option>)}
				</select>
				<button className="btn ghost icon sm" title="Save this view" aria-label="Save this view" onClick={() => setSaving(true)}><MdBookmarkAdd /></button>
				<div className="segmented" title="Reading pane">
					<button className={pane === 'right' ? 'on' : ''} onClick={() => setPane('right')} title="Reading pane on the right" aria-label="Reading pane on the right"><MdViewSidebar /></button>
					<button className={pane === 'bottom' ? 'on' : ''} onClick={() => setPane('bottom')} title="Reading pane below" aria-label="Reading pane below"><MdViewAgenda /></button>
					<button className={pane === 'off' ? 'on' : ''} onClick={() => setPane('off')} title="No reading pane (opens in a window)" aria-label="No reading pane"><MdViewList /></button>
				</div>
				{can('manager') && <div className="row gap-4">
					<select className="input sm" value={syncDays} onChange={(e) => setSyncDays(Number(e.target.value))} aria-label="Sync window" title="How far back mail is read">
						<option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option>
					</select>
					<button className="btn sm" disabled={sync.isPending} onClick={() => sync.mutate(syncDays !== meta.syncDays ? syncDays : undefined)}><MdSync /> Sync</button>
				</div>}
			</div>

			<div className={`email-layout pane-${pane} ${open ? 'has-open' : ''}`}>
				<div className="email-list card">
					{isLoading ? <Loader /> : !rows.length ? <Empty text={tab === 'not_for_reply' ? 'Nothing here.' : 'No emails match. Change the filters, or press Sync to read new mail.'} /> : (
						<div className="table-wrap sticky"><table className="table email-table">
							<thead><tr>
								<Th k="criticality" l="!" />
								{compact ? <Th k="received" l="Email" /> : <><Th k="sender" l="From" /><Th k="subject" l="Subject" /><Th k="group" l="Group" /><Th k="mailbox" l="Mailbox" /></>}
								<Th k="completeness" l="Complete" num />
								<Th k="status" l="Status" />
								{!compact && <><Th k="received" l="Received" /><Th k="waiting" l="Waiting" /></>}
							</tr></thead>
							<tbody>{rows.map((r) => (
								<tr key={r.id} data-email={r.id} className={`click ${open === r.id ? 'selected' : ''}`} onClick={() => setOpen(r.id)}>
									<td><LevelTag level={r.criticality} /></td>
									{compact ? (
										<td className="small" style={{ maxWidth: 360 }}>
											<div className="row-between gap-8"><b className="truncate">{r.from_name || r.from_address}</b><span className="xs faint nowrap">{fmtDate(r.last_inbound_at, 'd MMM, HH:mm')}</span></div>
											<div className="truncate">{r.has_attachments && <MdAttachFile className="faint" />} {r.subject || '(no subject)'}</div>
											<div className="xs faint truncate">{(meta.groups.find((g: any) => g.key === r.primary_group) || {}).label}{r.sub_tags?.[0] ? ` · ${meta.subTags[r.sub_tags[0]]}` : ''}{r.questions > 0 ? ` · ${r.questions} question${r.questions > 1 ? 's' : ''}` : ''}</div>
										</td>
									) : <>
										<td className="small" style={{ maxWidth: 180 }}><div className="truncate"><b>{r.from_name || r.from_address}</b></div></td>
										<td className="small" style={{ maxWidth: 380 }}>
											<div className="truncate">{r.has_attachments && <MdAttachFile className="faint" />} {r.subject || '(no subject)'}</div>
											<div className="xs faint truncate">{r.questions > 0 ? `${r.questions} question${r.questions > 1 ? 's' : ''} · ` : ''}{r.snippet}</div>
										</td>
										<td className="xs">{(meta.groups.find((g: any) => g.key === r.primary_group) || {}).label}{r.sub_tags?.[0] ? <div className="faint">{meta.subTags[r.sub_tags[0]]}</div> : null}</td>
										<td className="xs faint" style={{ maxWidth: 160 }}>{(r.mailboxes || []).map((a: string) => a.split('@')[0]).join(', ')}</td>
									</>}
									<td className="num"><Completeness v={r.completeness} /></td>
									<td><StatusTag s={r.reply_status} /></td>
									{!compact && <><td className="xs nowrap" title={fmtDateTime(r.last_inbound_at)}>{fmtDate(r.last_inbound_at, 'd MMM, HH:mm')}</td>
										<td className="xs nowrap">{r.reply_status === 'sent' ? '' : waiting(r.last_inbound_at)}</td></>}
								</tr>
							))}</tbody>
						</table></div>
					)}
					{data && <div className="row-between list-foot">
						<span className="xs faint">{rows.length.toLocaleString('en-IN')} of {data.total.toLocaleString('en-IN')}{isFetching ? ' · updating' : ''} · j/k to move, / to search</span>
						{rows.length < data.total && <button className="btn sm" onClick={() => setLimit(limit + 200)}>Show more</button>}
					</div>}
				</div>
				{open && pane !== 'off' && <div className="email-pane card"><EmailPane id={open} meta={meta} onClose={() => setOpen(null)} /></div>}
			</div>
			{open && pane === 'off' && <Modal wide title="Email" onClose={() => setOpen(null)}><EmailPane id={open} meta={meta} /></Modal>}
			{saving && (
				<Modal title="Save this view" onClose={() => setSaving(false)} footer={<><button className="btn" onClick={() => setSaving(false)}>Cancel</button><button className="btn primary" disabled={!viewName.trim()} onClick={() => saveView.mutate()}>Save</button></>}>
					<div className="field"><label>Name</label><input className="input" autoFocus value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="e.g. Critical Kalyan, completeness below 50%" /></div>
					{(meta.views || []).length > 0 && <div className="mt-16"><div className="xs faint mb-8">Your saved views</div>{meta.views.map((v: any) => <div key={v.id} className="row-between small">{v.name}<button className="btn ghost icon sm" aria-label={`Delete ${v.name}`} onClick={() => delView.mutate(v.id)}><MdDelete /></button></div>)}</div>}
				</Modal>
			)}
		</>
	);
}

const STAGE_COLOR: Record<string, string> = { received: '#64748B', preparing: '#CA8A04', quote_sent: '#2563EB', confirmed: '#7C3AED', paid: '#0D9488', dispatched: '#16A34A', closed: '#94A3B8' };

function BulkTab({ meta }: { meta: any }) {
	const [sp, setSp] = useSearchParams();
	const f = { q: sp.get('q') || '', stage: sp.get('stage') || '', sort: sp.get('sort') || 'updated', dir: sp.get('dir') || 'desc' };
	const set = (p: Partial<typeof f>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(p)) { if (v) n.set(k, v); else n.delete(k); } setSp(n, { replace: true }); };
	const [search, setSearch] = useState(f.q);
	useEffect(() => { const t = setTimeout(() => search !== f.q && set({ q: search }), 350); return () => clearTimeout(t); });
	const { data, isLoading } = useQuery({ queryKey: ['bulk', f], queryFn: () => api(`/bulk${qs(f)}`), placeholderData: keepPreviousData });
	const open = Number(sp.get('open')) || null;
	const setOpen = (id: number | null) => { const n = new URLSearchParams(sp); if (id) n.set('open', String(id)); else n.delete('open'); setSp(n, { replace: true }); };
	const stages: any[] = meta.stages || [];
	const Th = ({ k, l, num }: { k: string; l: string; num?: boolean }) => (
		<th className={`${num ? 'num ' : ''}sortable${f.sort === k ? ' on' : ''}`}><button type="button" className="th-sort" onClick={() => set({ sort: k, dir: f.sort === k && f.dir === 'desc' ? 'asc' : 'desc' })}>{l}<span className="arrow">{f.sort === k ? (f.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>
	);
	const counts = useMemo(() => { const c: Record<string, number> = {}; for (const r of data || []) c[r.stage] = (c[r.stage] || 0) + 1; return c; }, [data]);
	return (
		<>
			<div className="filter-strip wrap mb-8">
				<div className="search-box"><MdSearch /><input className="input sm" placeholder="Search sender, subject, quote no. or book code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search bulk requests" /></div>
				<div className="chips">{stages.map((s) => (
					<button key={s.key} className={`chip ${f.stage.split(',').includes(s.key) ? 'on' : ''}`} onClick={() => { const cur = f.stage.split(',').filter(Boolean); set({ stage: (cur.includes(s.key) ? cur.filter((x) => x !== s.key) : [...cur, s.key]).join(',') }); }}>
						{s.label}{!f.stage && counts[s.key] ? ` (${counts[s.key]})` : ''}
					</button>
				))}</div>
			</div>
			<div className={`email-layout pane-right ${open ? 'has-open' : ''}`}>
				<div className="email-list card">
					{isLoading ? <Loader /> : !(data || []).length ? <Empty text="No bulk orders or quote requests yet. Emails sorted into New order — bulk appear here." /> : (
						<div className="table-wrap sticky"><table className="table">
							<thead><tr><Th k="criticality" l="!" /><Th k="sender" l="From" /><Th k="subject" l="Subject" /><Th k="stage" l="Stage" /><Th k="value" l="Value" num /><th>Quote</th><Th k="received" l="Received" /><Th k="updated" l="Updated" /></tr></thead>
							<tbody>{data.map((r: any) => (
								<tr key={r.id} className={`click ${open === r.conversation_id ? 'selected' : ''}`} onClick={() => setOpen(r.conversation_id)}>
									<td><LevelTag level={r.criticality} /></td>
									<td className="small"><b>{r.from_name || r.from_address}</b></td>
									<td className="small" style={{ maxWidth: 300 }}><div className="truncate">{r.subject}</div><div className="xs faint">{r.lines} book line{r.lines === 1 ? '' : 's'}</div></td>
									<td><span className="stage-tag" style={{ '--st': STAGE_COLOR[r.stage] } as any}>{stages.find((s) => s.key === r.stage)?.label || r.stage}</span></td>
									<td className="num small">{r.value ? inr(r.value) : '–'}</td>
									<td className="xs">{r.quote_no || '–'}</td>
									<td className="xs nowrap">{fmtDate(r.last_inbound_at, 'd MMM')}</td>
									<td className="xs nowrap">{ago(r.updated_at)}</td>
								</tr>
							))}</tbody>
						</table></div>
					)}
				</div>
				{open && <div className="email-pane card"><EmailPane id={open} meta={meta} onClose={() => setOpen(null)} /></div>}
			</div>
		</>
	);
}

function QuestionsTab({ onShow }: { onShow: (key: string) => void }) {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const { data, isLoading } = useQuery({ queryKey: ['open-questions'], queryFn: () => api('/open-questions') });
	const [ans, setAns] = useState<Record<string, string>>({});
	const save = useMutation({
		mutationFn: (q2: any) => api('/standing-answers', { body: { question_key: q2.key, question: q2.text, answer: ans[q2.key], group_key: q2.grp } }),
		onSuccess: () => { qc.invalidateQueries(); toast('Saved as a standing answer. Every email that asks this is being completed.'); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	if (isLoading) return <Loader />;
	if (!data?.types?.length) return <Empty text="No open questions: every email that needs a reply has what it needs." />;
	return (
		<div className="col gap-16">
			<div className="small faint">What Gita Mail could not find, grouped by type, with how many emails each one holds back. Questions marked "needs an upload" are answered by uploading the file named; others can be answered once here for every email.</div>
			{data.types.map((t: any) => (
				<div key={t.fact} className="card">
					<div className="card-head"><div><h2>{t.label} <span className="badge">{t.emails} email{t.emails > 1 ? 's' : ''}</span></h2>{t.needsUpload && <div className="sub">Needs an upload: {t.needsUpload}</div>}</div></div>
					<div className="card-body flush"><div className="table-wrap"><table className="table">
						<thead><tr><th>Question</th><th className="num">Emails</th><th>Latest</th><th>{t.kind === 'lookup' ? '' : 'Answer once for every email'}</th></tr></thead>
						<tbody>{t.questions.map((q2: any) => (
							<tr key={q2.key}>
								<td className="small" style={{ maxWidth: 420 }}>{q2.text}<div className="xs faint">{q2.key}</div></td>
								<td className="num"><button className="link-btn" onClick={() => onShow(q2.key)}>{q2.emails}</button></td>
								<td className="xs nowrap">{ago(q2.latest)}</td>
								<td>{q2.kind === 'lookup' ? <span className="xs faint">Answered on each email (it is different for each reader)</span> : can('analyst') && (
									<div className="row gap-4"><input className="input sm" value={ans[q2.key] || ''} onChange={(e) => setAns({ ...ans, [q2.key]: e.target.value })} placeholder="Answer" aria-label={`Answer: ${q2.text}`} />
										<button className="btn sm primary" disabled={!ans[q2.key]?.trim() || save.isPending} onClick={() => save.mutate(q2)}>Save for all</button></div>
								)}</td>
							</tr>
						))}</tbody>
					</table></div></div>
				</div>
			))}
		</div>
	);
}
