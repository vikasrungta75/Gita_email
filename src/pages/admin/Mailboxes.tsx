import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { MdAdd, MdSync, MdPause, MdPlayArrow, MdDelete, MdUpload, MdScience, MdMail, MdBusiness, MdInfoOutline, MdRestartAlt, MdCheckCircle } from 'react-icons/md';

const GLogo = () => (<svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>);
const MsLogo = () => (
	<svg width="15" height="15" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" /><rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" /></svg>
);
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card, Empty, Loader, Modal, PageHead } from '../../components/ui';
import { COLORS, ago } from '../../lib/format';

const PROVIDER: Record<string, string> = {
	microsoft_app: 'Microsoft 365 shared mailbox',
	microsoft: 'Personal Outlook (delegated)',
	gmail: 'Gmail (own inbox)',
	gmail_app: 'Google Workspace shared mailbox',
	upload: 'Imported files',
	demo: 'Demo data',
};

export default function Mailboxes() {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const [sp, setSp] = useSearchParams();
	const [add, setAdd] = useState(false);
	const [addr, setAddr] = useState('');
	const [name, setName] = useState('');
	const [backfill, setBackfill] = useState(90);
	const fileRef = useRef<HTMLInputElement>(null);
	const { data, isLoading } = useQuery({ queryKey: ['mailboxes'], queryFn: () => api('/mailboxes'), refetchInterval: 15_000 });
	const refresh = () => { qc.invalidateQueries(); };

	useEffect(() => {
		if (sp.get('connected')) { toast(`Connected ${sp.get('connected')}. The first sync has started.`); setSp((p) => { p.delete('connected'); return p; }, { replace: true }); }
		if (sp.get('error')) { toast(`Connection failed: ${sp.get('error')}`, 'error'); setSp((p) => { p.delete('error'); return p; }, { replace: true }); }
	}, [sp, setSp, toast]);

	const connect = useMutation({
		mutationFn: (provider: string) => api(`/connect/${provider}/start`, { body: { backfillDays: backfill } }),
		onSuccess: (r) => { window.location.href = r.url; },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const consent = useMutation({
		mutationFn: () => api('/connect/microsoft-admin/start', { body: {} }),
		onSuccess: (r) => { window.location.href = r.url; },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const [test, setTest] = useState<any>(null);
	const keyRef = useRef<HTMLInputElement>(null);
	const uploadKey = useMutation({
		mutationFn: async (f: File) => api('/settings/google-service-account', { body: { json: await f.text() } }),
		onSuccess: (r) => { refresh(); toast(`Service account key saved (${r.clientEmail})`); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const testAccess = useMutation({
		mutationFn: () => api('/mailboxes/test', { body: { address: addr } }),
		onSuccess: (r) => setTest(r),
		onError: (e: any) => setTest({ ok: false, reason: e.message }),
	});
	const addApp = useMutation({
		mutationFn: () => api('/mailboxes', { body: { address: addr, displayName: name, backfillDays: backfill } }),
		onSuccess: (mb) => { setAdd(false); setAddr(''); setName(''); refresh(); toast('Mailbox added. Starting the first sync.'); api(`/mailboxes/${mb.id}/sync`, { body: {} }).then(refresh).catch(() => {}); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const sync = useMutation({
		mutationFn: (id: number) => api(`/mailboxes/${id}/sync`, { body: {} }),
		onSuccess: (r) => { refresh(); toast(r.queued ? 'Sync started' : 'Sync complete'); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const patch = useMutation({ mutationFn: (b: { id: number; body: any }) => api(`/mailboxes/${b.id}`, { method: 'PATCH', body: b.body }), onSuccess: refresh });
	const remove = useMutation({ mutationFn: (b: { id: number; purge: boolean }) => api(`/mailboxes/${b.id}?purge=${b.purge}`, { method: 'DELETE' }), onSuccess: () => { refresh(); toast('Mailbox removed'); } });
	const demo = useMutation({
		mutationFn: (load: boolean) => api('/system/demo', { method: load ? 'POST' : 'DELETE', body: load ? {} : undefined }),
		onSuccess: (r, load) => { refresh(); toast(load ? `Demo data loaded: ${r.inserted} emails, ${r.duplicates} duplicates removed, ${r.analysed} conversations analysed` : 'Demo data removed'); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const upload = useMutation({
		mutationFn: async (files: FileList) => {
			const list = await Promise.all([...files].map((f) => new Promise<any>((res) => {
				const r = new FileReader();
				r.onload = () => res({ name: f.name, content: String(r.result).split(',')[1] });
				r.readAsDataURL(f);
			})));
			return api('/mailboxes/upload', { body: { files: list } });
		},
		onSuccess: (r) => { refresh(); toast(`Imported ${r.inserted} emails (${r.duplicates} duplicates, ${r.skipped} skipped), analysed ${r.analysed} conversations`); },
		onError: (e: any) => toast(e.message, 'error'),
	});

	const p = data?.providers || {};
	return (
		<>
			<PageHead kw="Mailboxes" rest="and connections" sub="Mail is read for analysis and never moved, labelled or deleted. A reply leaves Gmail only when a person presses Send on a draft, as a reply in the same thread." />
			<div className="grid g-3 mb-16">
				<Card title={<h2><span className="kw">Your</span> own Gmail</h2>} accent={COLORS.pink}
					sub="Connected automatically when you sign in with Google">
					<div className="small muted mb-16">Each person's inbox is connected the moment they sign in with their Google Workspace account. Mail is read for analysis; replies go out only when they press Send. You, administrators and managers see its analysis. Use this button only to reconnect after an error.</div>
					<button className="btn" disabled={!p.google || connect.isPending} onClick={() => connect.mutate('google')}><GLogo /> Reconnect my Gmail</button>
					{!p.google && <div className="xs faint mt-8">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify first (see docs/GOOGLE_WORKSPACE_SETUP.md).</div>}
				</Card>
				<Card title={<h2><span className="kw">1.</span> Workspace access for shared mailboxes</h2>} accent={COLORS.general}
					sub="orders@, kalyan@, dispatch@… read through domain-wide delegation, set once by a Workspace administrator">
					{p.googleWorkspace ? (
						<>
							<div className="notice ok small mb-8"><MdCheckCircle /><span>Service account ready: <span className="mono">{p.googleServiceAccount}</span></span></div>
							<div className="xs muted">In the Google Admin console, Security → API controls → Domain-wide delegation must list client ID <b className="mono">{p.googleServiceClientId}</b> with scope <span className="mono">{p.googleScope}</span>.</div>
						</>
					) : (
						<div className="small muted">Upload the service account key (JSON) created in Google Cloud, then authorise its client ID for <span className="mono">gmail.readonly</span> and <span className="mono">gmail.send</span> in the Google Admin console. See docs/GOOGLE_WORKSPACE_SETUP.md.</div>
					)}
					{can('admin') && (
						<>
							<input ref={keyRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadKey.mutate(f); e.target.value = ''; }} />
							<button className={`btn ${p.googleWorkspace ? '' : 'action'} mt-8`} disabled={uploadKey.isPending} onClick={() => keyRef.current?.click()}>
								<MdUpload /> {uploadKey.isPending ? 'Saving…' : p.googleWorkspace ? 'Replace key file' : 'Upload service account key'}
							</button>
						</>
					)}
				</Card>
				<Card title={<h2><span className="kw">2.</span> Add shared mailboxes</h2>} accent={COLORS.blue}
					sub="Test access before adding. Only the addresses you add here are read.">
					<div className="small muted mb-16">Delegation can technically reach any mailbox in your domain, so the app reads only the mailboxes listed below and every addition is recorded in the audit log.</div>
					{can('admin') && <button className="btn action" disabled={!p.googleWorkspace && !p.microsoftApp} onClick={() => setAdd(true)}><MdBusiness /> Add mailbox</button>}
					{!p.googleWorkspace && !p.microsoftApp && <div className="xs faint mt-8">Available after step 1.</div>}
				</Card>
			</div>
			{can('admin') && (
				<div className="row wrap mb-16">
					<input ref={fileRef} type="file" accept=".eml,message/rfc822" multiple hidden onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)} />
					<button className="btn sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}><MdUpload /> {upload.isPending ? 'Importing…' : 'Import .eml files'}</button>
					{data?.demoEnabled && <button className="btn sm" onClick={() => demo.mutate(true)} disabled={demo.isPending}><MdScience /> {demo.isPending ? 'Loading…' : 'Load Gita Press demo data'}</button>}
					{p.microsoft && <button className="btn sm" disabled={connect.isPending} onClick={() => connect.mutate('microsoft')}><MsLogo /> Connect Outlook</button>}
				</div>
			)}
			{can('admin') && (
				<div className="row mb-16 small muted">
					<MdInfoOutline /> When a new mailbox is connected, the first sync looks back
					<select className="input" style={{ width: 120, padding: '5px 8px' }} value={backfill} onChange={(e) => setBackfill(Number(e.target.value))} aria-label="Backfill">
						<option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>180 days</option>
					</select>
				</div>
			)}
			<Card title="Monitored mailboxes" accent={COLORS.navy} flush
				actions={can('admin') && (data?.rows || []).some((m: any) => m.provider === 'demo') && <button className="btn danger sm" onClick={() => confirm('Remove all demo data?') && demo.mutate(false)}>Remove demo data</button>}>
				{isLoading ? <Loader /> : !data?.rows?.length ? <Empty text="No mailboxes connected yet" /> : (
					<div className="table-wrap">
						<table className="table">
							<thead><tr><th>Mailbox</th><th>Connection</th><th>Status</th><th className="num">Emails</th><th className="num">Duplicates</th><th>Last sync</th><th /></tr></thead>
							<tbody>
								{data.rows.map((m: any) => (
									<tr key={m.id}>
										<td><b>{m.display_name || m.address}</b><div className="xs faint">{m.address}</div></td>
										<td className="small">{PROVIDER[m.provider]}<div className="xs faint">backfill {m.backfill_days} days</div></td>
										<td>
											<span className={`badge ${m.status === 'active' ? 'green' : m.status === 'error' ? 'red' : m.status === 'paused' ? '' : 'amber'}`}>{m.status[0].toUpperCase() + m.status.slice(1)}</span>
											{m.last_error && <div className="xs" style={{ color: COLORS.red, maxWidth: 280 }}>{m.last_error}</div>}
										</td>
										<td className="num">{m.emails}</td>
										<td className="num">{m.duplicates}</td>
										<td className="small">
											{ago(m.last_synced_at)}
											{m.last_run && <div className="xs faint">{m.last_run.fetched} fetched · {m.last_run.inserted} new{m.last_run.error ? ' · failed' : ''}</div>}
										</td>
										<td className="nowrap">
											{['microsoft', 'microsoft_app', 'gmail'].includes(m.provider) && can('manager') && (
												<button className="btn sm" onClick={() => sync.mutate(m.id)} disabled={sync.isPending}><MdSync /> Sync</button>
											)}
											{can('admin') && <>
												{m.status === 'paused'
													? <button className="btn ghost sm" title="Resume" onClick={() => patch.mutate({ id: m.id, body: { status: 'active' } })}><MdPlayArrow /></button>
													: <button className="btn ghost sm" title="Pause" onClick={() => patch.mutate({ id: m.id, body: { status: 'paused' } })}><MdPause /></button>}
												{['microsoft', 'microsoft_app', 'gmail'].includes(m.provider) && <button className="btn ghost sm" title="Re-sync from scratch" onClick={() => confirm('Restart sync from the backfill window? Existing emails are kept and duplicates are skipped.') && patch.mutate({ id: m.id, body: { resetSync: true } })}><MdRestartAlt /></button>}
												<button className="btn ghost sm" title="Remove" onClick={() => {
													if (!confirm(`Stop monitoring ${m.address}?`)) return;
													remove.mutate({ id: m.id, purge: confirm('Also delete the emails and conversations that only came from this mailbox?') });
												}}><MdDelete /></button>
											</>}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Card>
			{add && (
				<Modal title={p.googleWorkspace ? 'Add a Google Workspace mailbox' : 'Add a Microsoft 365 mailbox'} onClose={() => setAdd(false)}
					footer={<><button className="btn" onClick={() => setAdd(false)}>Cancel</button><button className="btn primary" disabled={!addr || addApp.isPending} onClick={() => addApp.mutate()}><MdAdd /> Add mailbox</button></>}>
					<div className="field"><label>Mailbox address</label>
						<div className="row"><input className="input" value={addr} onChange={(e) => { setAddr(e.target.value); setTest(null); }} placeholder="orders@gitapress.org" />
							<button className="btn" disabled={!addr || testAccess.isPending} onClick={() => testAccess.mutate()}>{testAccess.isPending ? 'Testing…' : 'Test access'}</button></div>
						{test && (test.ok
							? <div className="notice ok small mt-8"><MdCheckCircle /><span>{test.message || `Access granted. Inbox has ${test.totalItems} items (${test.unread} unread).`}</span></div>
							: <div className="notice error small mt-8"><MdInfoOutline /><span>{test.reason || test.message}</span></div>)}
					</div>
					<div className="field"><label>Display name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Book orders" /></div>
					<div className="field"><label>Look back</label>
						<select className="input" value={backfill} onChange={(e) => setBackfill(Number(e.target.value))}>
							<option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>180 days</option>
						</select>
					</div>
					<div className="notice"><MdInfoOutline /><span className="small">{p.googleWorkspace ? 'The address must be a mailbox (user or shared) in your Google Workspace domain. Group aliases cannot be read: add the member mailbox that receives the mail.' : 'The mailbox must be included in the application access policy for the app, otherwise Microsoft Graph returns "Access denied".'}</span></div>
				</Modal>
			)}
		</>
	);
}
