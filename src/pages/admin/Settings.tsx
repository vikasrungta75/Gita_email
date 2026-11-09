import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MdCheckCircle, MdErrorOutline, MdRefresh, MdSave } from 'react-icons/md';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card, Loader, Modal, PageHead, Segmented, Switch } from '../../components/ui';
import Addresses from './Addresses';
import Mailboxes from './Mailboxes';
import Users from './Users';
import Processing from './Processing';
import Audit from './Audit';
import { COLORS, ago } from '../../lib/format';

const Status = ({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) => (
	<div className="row-between mb-8">
		<span className="row">{ok ? <MdCheckCircle style={{ color: COLORS.green }} /> : <MdErrorOutline style={{ color: COLORS.amber }} />} {label}</span>
		<span className="small faint">{detail}</span>
	</div>
);

/** Run the AI over threads from the last N days again, e.g. after changing the model, templates or reference data. */
function ReanalyseCard() {
	const toast = useToast();
	const qc = useQueryClient();
	const [days, setDays] = useState(7);
	const [confirm, setConfirm] = useState(false);
	const safe = Math.max(1, Math.min(365, Math.floor(days) || 1));
	const preview = useQuery({ queryKey: ['reanalyse-preview', safe], queryFn: () => api(`/system/reanalyse?days=${safe}`) });
	const run = useMutation({
		mutationFn: () => api('/system/reanalyse', { body: { days: safe } }),
		onSuccess: (r: any) => {
			setConfirm(false);
			qc.invalidateQueries();
			toast(r.remaining ? `${r.done} threads re-analysed, ${r.remaining} more are queued and continue in the background` : `${r.done} threads re-analysed`);
		},
		onError: (e: any) => toast(e.message, 'error'),
	});
	const p = preview.data;
	const nf = (v: number) => (v || 0).toLocaleString('en-IN');
	return (
		<Card title="Re-analyse email" accent={COLORS.teal}
			sub="Runs the AI again over conversations with any email in the last few days, using the current model, templates and reference data. Sent mail is included: each conversation is read with your replies. Nothing is deleted, and drafts you have edited are kept.">
			<div className="row wrap" style={{ gap: 12 }}>
				<span className="small">Conversations with mail in the last</span>
				<input className="input" type="number" min={1} max={365} style={{ width: 90 }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Days" />
				<span className="small">days</span>
				{[1, 7, 30, 90].map((d) => <button key={d} className={`btn sm${safe === d ? ' primary' : ''}`} onClick={() => setDays(d)}>{d === 1 ? '24 h' : `${d} d`}</button>)}
			</div>
			<div className="small mt-16">
				{preview.isLoading ? 'Counting…' : p ? <><b>{nf(p.threads)}</b> conversations, {nf(p.emails)} emails, of which <b>{nf(p.sent)}</b> sent by your team.</> : null}
			</div>
			{p && (p.provider === 'heuristic' || p.paused) && (
				<div className="small mt-8" style={{ color: COLORS.amber }}>{p.paused ? 'AI is paused right now, so results would use the rules engine until it resumes.' : 'No AI key is set, so only the rules engine would run.'}</div>
			)}
			<button className="btn primary mt-16" disabled={!p?.threads || run.isPending} onClick={() => setConfirm(true)}><MdRefresh /> {run.isPending ? 'Analysing…' : 'Re-analyse'}</button>
			{confirm && p && (
				<Modal title="Re-analyse recent email?" onClose={() => setConfirm(false)}
					footer={<><button className="btn" onClick={() => setConfirm(false)}>Cancel</button><button className="btn primary" onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? 'Working' : `Yes, ${nf(p.threads)} conversations`}</button></>}>
					<p className="small">{nf(p.threads)} conversations with mail in the last {safe} days will be analysed again with {p.model}. The first batch finishes now; the rest continue in the background (progress is under Analysis queue below). This uses AI credit.</p>
				</Modal>
			)}
		</Card>
	);
}

type Role = 'viewer' | 'analyst' | 'manager' | 'admin';
const TABS: { v: string; l: string; min: Role }[] = [
	{ v: 'general', l: 'General', min: 'manager' },
	{ v: 'replies', l: 'Reply drafts', min: 'manager' },
	{ v: 'addresses', l: 'Addresses', min: 'analyst' },
	{ v: 'mailboxes', l: 'Mailboxes', min: 'analyst' },
	{ v: 'users', l: 'Users and access', min: 'manager' },
	{ v: 'status', l: 'System status', min: 'analyst' },
	{ v: 'audit', l: 'Audit log', min: 'admin' },
];

/** Old addresses (/admin/mailboxes …) open the matching tab, keeping any message in the address. */
export function SettingsRedirect({ tab }: { tab: string }) {
	const loc = useLocation();
	const sp = new URLSearchParams(loc.search);
	sp.set('tab', tab);
	return <Navigate to={`/admin/settings?${sp.toString()}`} replace />;
}

/** Everything an admin sets up, one tab each, so nothing is more than one click deep. */
export default function Settings() {
	const { can } = useAuth();
	const [sp, setSp] = useSearchParams();
	const tabs = TABS.filter((t) => can(t.min));
	const tab = tabs.find((t) => t.v === sp.get('tab'))?.v || tabs[0]?.v;
	return (
		<>
			<PageHead kw="Settings" sub="Organisation, reply drafts, Gita Press addresses, mailboxes, users, system status and the audit log." />
			<div className="mb-16" style={{ overflowX: 'auto' }}>
				<Segmented value={tab} options={tabs.map(({ v, l }) => ({ v, l }))} onChange={(v) => setSp({ tab: v }, { replace: true })} />
			</div>
			<div className="settings-tab">
				{tab === 'general' && <OrgSettings part="general" />}
				{tab === 'replies' && <OrgSettings part="replies" />}
				{tab === 'addresses' && <Addresses />}
				{tab === 'mailboxes' && <Mailboxes />}
				{tab === 'users' && <Users />}
				{tab === 'status' && <><SystemStatus /><Processing /></>}
				{tab === 'audit' && <Audit />}
			</div>
		</>
	);
}

function useOrgForm() {
	const toast = useToast();
	const qc = useQueryClient();
	const s = useQuery({ queryKey: ['settings'], queryFn: () => api('/settings') });
	const [form, setForm] = useState<any>(null);
	const [dirty, setDirty] = useState(false);
	useEffect(() => {
		if (s.data) { setForm({ name: s.data.name, internalDomains: s.data.internalDomains.join(', '), ...s.data.settings }); setDirty(false); }
	}, [s.data]);
	const save = useMutation({
		mutationFn: () => api('/settings', {
			method: 'PATCH',
			body: {
				name: form.name,
				internalDomains: form.internalDomains.split(',').map((d: string) => d.trim()).filter(Boolean),
				settings: { slaHours: form.slaHours, piiRedaction: form.piiRedaction, retentionDays: form.retentionDays, analysisWindowDays: form.analysisWindowDays, ignoreAutomated: form.ignoreAutomated, autoDrafts: form.autoDrafts, replyKnowledge: form.replyKnowledge, replySignature: form.replySignature, defaultBackfillDays: form.defaultBackfillDays, replyFooter: form.replyFooter },
			},
		}),
		onSuccess: () => { qc.invalidateQueries(); toast('Settings saved'); setDirty(false); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const set = (patch: any) => { setForm({ ...form, ...patch }); setDirty(true); };
	return { form, set, save, dirty };
}

function SaveBar({ dirty, save, admin }: { dirty: boolean; save: any; admin: boolean }) {
	if (!admin) return <div className="small faint mb-16">Only admins can change these settings.</div>;
	return (
		<div className="row mb-16" style={{ justifyContent: 'flex-end', gap: 12 }}>
			{dirty && <span className="small" style={{ color: COLORS.amber }}>Unsaved changes</span>}
			<button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending || !dirty}><MdSave /> Save settings</button>
		</div>
	);
}

function OrgSettings({ part }: { part: 'general' | 'replies' }) {
	const { can } = useAuth();
	const admin = can('admin');
	const { form, set, save, dirty } = useOrgForm();
	if (!form) return <Loader />;
	const wrap = (children: ReactNode) => <><SaveBar dirty={dirty} save={save} admin={admin} />{children}</>;
	if (part === 'general') return wrap(
		<div className="grid g-2">
			<div className="col gap-16">
				<Card title="Organisation" accent={COLORS.navy}>
					<div className="col gap-16">
						<div className="field"><label>Organisation name</label><input className="input" disabled={!admin} value={form.name} onChange={(e) => set({ name: e.target.value })} /></div>
						<div className="field"><label>Internal email domains</label><input className="input" disabled={!admin} value={form.internalDomains} onChange={(e) => set({ internalDomains: e.target.value })} />
							<span className="hint">Senders on these domains are treated as your staff, so their emails count as replies, not customer messages.</span></div>
					</div>
				</Card>
				<Card title="Analysis and service levels" accent={COLORS.pink}>
					<div className="col gap-16">
						<div className="grid g-2">
							<div className="field"><label>Reply SLA (hours)</label><input className="input" type="number" disabled={!admin} value={form.slaHours} onChange={(e) => set({ slaHours: Number(e.target.value) })} /></div>
							<div className="field"><label>Health window (days)</label><input className="input" type="number" disabled={!admin} value={form.analysisWindowDays} onChange={(e) => set({ analysisWindowDays: Number(e.target.value) })} /></div>
						</div>
						<Switch checked={form.ignoreAutomated} onChange={(v) => admin && set({ ignoreAutomated: v })} label="Skip newsletters and automated email entirely (by default they are stored, categorised and never sent to AI)" />
					</div>
				</Card>
			</div>
			<div className="col gap-16">
				<Card title="Data protection" accent={COLORS.purple}>
					<div className="col gap-16">
						<Switch checked={form.piiRedaction} onChange={(v) => admin && set({ piiRedaction: v })} label="Redact card, bank, ID and password details before AI analysis" />
						<div className="field"><label>Retain email bodies for (days)</label><input className="input" type="number" disabled={!admin} value={form.retentionDays} onChange={(e) => set({ retentionDays: Number(e.target.value) })} />
							<span className="hint">After this period the email text is erased; summaries, ratings and metrics are kept. Stock uploads, customer records and reasons for contacting are never erased.</span></div>
					</div>
				</Card>
				<Card title="Security model" accent={COLORS.general}>
					<ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
						<li>Gmail read-only access for analysis; replies are sent only when a person presses Send</li>
						<li>OAuth refresh tokens encrypted at rest (AES-256-GCM)</li>
						<li>Signed sessions with server-side revocation and 12-hour expiry</li>
						<li>Role-based access with optional per-mailbox restriction</li>
						<li>Audit log of sign-ins, views, exports and configuration changes</li>
						<li>PII redaction before AI processing; configurable data retention</li>
					</ul>
				</Card>
			</div>
		</div>,
	);
	return wrap(
		<div className="col gap-16">
			<Card title={<h2><span className="kw">Reply</span> drafts</h2>} accent={COLORS.amber}
				sub="A complete reply is drafted for every email waiting on an answer. It stays in Gita Mail until someone presses Send.">
				<div className="col gap-16">
					<Switch checked={form.autoDrafts} onChange={(v) => admin && set({ autoDrafts: v })} label="Draft a reply for every email that needs one" />
					<div className="field"><label>Reference information for replies</label>
						<textarea className="input" rows={7} disabled={!admin} value={form.replyKnowledge || ''} onChange={(e) => set({ replyKnowledge: e.target.value })}
							placeholder={'Facts the AI may use instead of leaving a yellow placeholder, for example:\nVPP orders are dispatched within 3 to 5 working days.\nKalyan annual subscription: Rs 300, starts from the January issue.'} />
						<span className="hint">Stock and prices come from the Tally uploads (Inventory) and addresses from the Addresses tab, so they need not be typed here. Default replies and FAQs are in <a href="/help#templates">Help and templates</a>.</span></div>
					<div className="grid g-2">
						<div className="field"><label>Signature</label><textarea className="input" rows={3} disabled={!admin} value={form.replySignature || ''} onChange={(e) => set({ replySignature: e.target.value })} /></div>
						<div className="field"><label>History read when a mailbox is first connected (days)</label>
							<select className="input" disabled={!admin} value={form.defaultBackfillDays || 90} onChange={(e) => set({ defaultBackfillDays: Number(e.target.value) })}>
								<option value={30}>30 days</option><option value={90}>90 days (recommended)</option><option value={180}>180 days</option><option value={365}>365 days</option>
							</select></div>
					</div>
					<Switch checked={form.replyFooter !== false} onChange={(v) => admin && set({ replyFooter: v })} label="Add the Gita Press logo, website link and the address of the reader's branch (English and Hindi) under every reply" />
					<span className="hint">The addresses are edited in the <a href="/admin/settings?tab=addresses">Addresses</a> tab.</span>
				</div>
			</Card>
			{admin && <ReanalyseCard />}
		</div>,
	);
}

function SystemStatus() {
	const sys = useQuery({ queryKey: ['system-status'], queryFn: () => api('/system/status'), refetchInterval: 30_000 });
	const d = sys.data;
	return (
		<div className="grid g-2 mb-16">
			<Card title="System status" accent={COLORS.teal}>
				{!d ? <Loader /> : (
					<>
						<Status ok={d.ai.provider !== 'heuristic'} label="AI analysis" detail={d.ai.provider === 'heuristic' ? 'Built-in rules (add an AI key for full analysis)' : `${d.ai.provider} · ${d.ai.model}`} />
						<Status ok={d.mailer !== 'none'} label="Email delivery for alerts and reports" detail={d.mailer === 'none' ? 'Not configured' : d.mailer} />
						<Status ok={d.connectors.googleWorkspace} label="Google Workspace shared mailboxes" detail={d.connectors.googleWorkspace ? d.connectors.googleServiceAccount : 'Set GOOGLE_SERVICE_ACCOUNT_JSON'} />
						<Status ok={d.connectors.google} label="Sign in with Google and own Gmail" detail={d.connectors.google ? 'Enabled' : 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'} />
						<Status ok={d.webhooks.teams || d.webhooks.slack} label="Teams or Slack alerts" detail={[d.webhooks.teams && 'Teams', d.webhooks.slack && 'Slack'].filter(Boolean).join(', ') || 'Not configured'} />
						<Status ok={d.gmailSend} label="Send replies through Gmail" detail={d.gmailSend ? 'Enabled: replies go out only when someone presses Send' : 'Off (GMAIL_SEND_ENABLED=false)'} />
						{d.progress?.ai_paused_until && new Date(d.progress.ai_paused_until) > new Date() && (
							<Status ok={false} label="AI paused: quota reached" detail={`Resumes ${new Date(d.progress.ai_paused_until).toLocaleString()}`} />
						)}
						{d.progress?.ai_last_error && <Status ok={false} label="Last AI error" detail={`${d.progress.ai_last_error}${d.progress.ai_last_error_at ? ` (${new Date(d.progress.ai_last_error_at).toLocaleString()})` : ''}`} />}
						<Status ok={d.mailboxes.errors === 0} label="Mailboxes" detail={`${d.mailboxes.total} connected · ${d.mailboxes.errors} with errors`} />
						<Status ok={d.pendingAnalysis < 50} label="Analysis queue" detail={`${d.pendingAnalysis} conversations waiting`} />
						<div className="small faint mt-16">Last worker run {ago(d.lastWorkerRun)} · last mailbox sync {ago(d.mailboxes.last_synced)}</div>
					</>
				)}
			</Card>
			<Card title="AI usage this month" accent={COLORS.amber}>
				{d && (
					<div className="grid g-3">
						<div><div className="faint small">Calls</div><b style={{ fontSize: 20 }}>{d.aiUsageThisMonth.calls}</b></div>
						<div><div className="faint small">Input tokens</div><b style={{ fontSize: 20 }}>{d.aiUsageThisMonth.input_tokens.toLocaleString()}</b></div>
						<div><div className="faint small">Output tokens</div><b style={{ fontSize: 20 }}>{d.aiUsageThisMonth.output_tokens.toLocaleString()}</b></div>
					</div>
				)}
			</Card>
		</div>
	);
}
