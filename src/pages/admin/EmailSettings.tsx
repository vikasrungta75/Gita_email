/**
 * Settings for emails: sync window, groups and criticality, SLA, the facts a complete reply needs, which reason
 * belongs to which group, the Kalyan year; Pending questions with the completeness summary and weekly trend;
 * Auto-send (defined for later, cannot be switched on); and "Delete emails" (AI-analysed, not AI-analysed, or both).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MdDelete, MdDeleteForever, MdSave } from 'react-icons/md';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card, Empty, Loader, Modal, Switch } from '../../components/ui';
import Chart from '../../components/Chart';
import { COLORS, ago } from '../../lib/format';
import { num } from '../../lib/purposes';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function EmailRules() {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const { data } = useQuery({ queryKey: ['settings-email'], queryFn: () => api('/settings/email') });
	const [c, setC] = useState<any>(null);
	useEffect(() => { if (data && !c) setC(structuredClone(data.config)); }, [data]);
	const save = useMutation({ mutationFn: () => api('/settings/email', { method: 'PUT', body: c }), onSuccess: (r: any) => { setC(r); qc.invalidateQueries(); toast('Saved. Every open email is being worked out again with the new rules.'); }, onError: (e: any) => toast(e.message, 'error') });
	if (!data || !c) return <Loader />;
	const m = can('manager');
	const keyLabel = (k: string) => { const [g, t] = k.split('/'); return `${data.groups.find((x: any) => x.key === g)?.label || g}${t ? ` → ${data.subTags[t] || t}` : ''}`; };
	const factKeys = Object.keys(data.facts);
	const rows = data.groups.flatMap((g: any) => [g.key, ...g.subTags.map((t: string) => `${g.key}/${t}`)]);
	return (
		<div className="col gap-16">
			<Card title="Reading mail" sub="How far back mail is read, and how often. Changing the window reads the mailboxes again from that far back on the next sync.">
				<div className="row wrap gap-16">
					<label className="small">Sync window <select className="input sm" disabled={!m} value={c.syncDays} onChange={(e) => setC({ ...c, syncDays: Number(e.target.value) })}><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option></select></label>
					<label className="small">Read mail every <input className="input sm" type="number" min={1} max={60} style={{ width: 70 }} disabled={!m} value={c.syncEveryMinutes} onChange={(e) => setC({ ...c, syncEveryMinutes: Number(e.target.value) })} /> minutes</label>
				</div>
			</Card>
			<Card title="Criticality and reply-time target" sub="Each group or sub-tag starts at a level. An email waiting longer than the target (working days, Monday to Saturday) becomes High; longer than twice the target, Critical. Money taken but books not received is always Critical." flush>
				<div className="table-wrap"><table className="table">
					<thead><tr><th>Group / sub-tag</th><th>Starts at</th><th>Reply within (working days)</th></tr></thead>
					<tbody>{rows.map((k: string) => (
						<tr key={k}>
							<td className="small" style={{ paddingLeft: k.includes('/') ? 32 : undefined }}>{keyLabel(k)}</td>
							<td><select className="input sm" disabled={!m} value={c.baseLevel[k] || ''} onChange={(e) => setC({ ...c, baseLevel: { ...c.baseLevel, [k]: e.target.value } })}>{!c.baseLevel[k] && <option value="">(as the group)</option>}{data.levels.map((l: string) => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}</select></td>
							<td>{!k.includes('/') && <input className="input sm" type="number" step="0.5" style={{ width: 80 }} disabled={!m} value={c.slaWorkingDays[k] ?? 2} onChange={(e) => setC({ ...c, slaWorkingDays: { ...c.slaWorkingDays, [k]: Number(e.target.value) } })} />}</td>
						</tr>
					))}</tbody>
				</table></div>
			</Card>
			<Card title="Completeness: the facts a complete reply needs" sub="For each group (or sub-tag), the facts Gita Mail looks up. Completeness is the share found; each missing fact becomes a question on the email. A sub-tag without its own list uses the group's." flush>
				<div className="table-wrap"><table className="table">
					<thead><tr><th>Group / sub-tag</th><th>Facts needed</th></tr></thead>
					<tbody>{rows.map((k: string) => (
						<tr key={k}>
							<td className="small nowrap" style={{ paddingLeft: k.includes('/') ? 32 : undefined }}>{keyLabel(k)}</td>
							<td><div className="chips">{factKeys.map((f) => {
								const own = c.facts[k];
								const on = (own || []).includes(f);
								return <button key={f} className={`chip ${on ? 'on' : ''}`} disabled={!m} title={data.facts[f].question} onClick={() => setC({ ...c, facts: { ...c.facts, [k]: on ? own.filter((x: string) => x !== f) : [...(own || []), f] } })}>{data.facts[f].label}</button>;
							})}{!c.facts[k] && <span className="xs faint">uses the group's list</span>}</div></td>
						</tr>
					))}</tbody>
				</table></div>
			</Card>
			<Card title="Reasons for contacting → group" sub="The 22 reasons stay as a second tag on each email. When the analysis cannot tell the group, the reason decides it." flush>
				<div className="table-wrap"><table className="table"><tbody>{Object.entries(data.reasons).map(([k, l]) => (
					<tr key={k}><td className="small">{l as string}</td><td><select className="input sm" disabled={!m} value={c.reasonGroup[k] || 'others'} onChange={(e) => setC({ ...c, reasonGroup: { ...c.reasonGroup, [k]: e.target.value } })}>{data.groups.map((g: any) => <option key={g.key} value={g.key}>{g.label}</option>)}</select></td></tr>
				))}</tbody></table></div>
			</Card>
			<Card title="Kalyan customers" sub="The current year for the customer dashboard and 'active this year', and which columns of the complete customer file are kept.">
				<label className="small">The year starts in <select className="input sm" disabled={!m} value={c.kalyanYearStartMonth} onChange={(e) => setC({ ...c, kalyanYearStartMonth: Number(e.target.value) })}>{MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</select></label>
				<div className="field mt-8"><label>Columns kept from the complete customer file (one per line)</label><textarea className="input" rows={6} disabled={!m} value={c.kalyanMasterFields.join('\n')} onChange={(e) => setC({ ...c, kalyanMasterFields: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} /><span className="hint">Add a column name from the file to keep it. The default list drops internal columns such as CREATEDBY and MODIFIEDBY.</span></div>
			</Card>
			{m && <div><button className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}><MdSave /> Save email settings</button></div>}
		</div>
	);
}

export function PendingQuestions() {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const sum = useQuery({ queryKey: ['completeness'], queryFn: () => api('/settings/completeness') });
	const oq = useQuery({ queryKey: ['open-questions'], queryFn: () => api('/open-questions') });
	const sa = useQuery({ queryKey: ['standing-answers'], queryFn: () => api('/standing-answers') });
	const [ans, setAns] = useState<Record<string, string>>({});
	const save = useMutation({ mutationFn: (q2: any) => api('/standing-answers', { body: { question_key: q2.key, question: q2.text, answer: ans[q2.key], group_key: q2.grp } }), onSuccess: () => { qc.invalidateQueries(); toast('Standing answer saved. Matching emails are being completed.'); }, onError: (e: any) => toast(e.message, 'error') });
	const del = useMutation({ mutationFn: (id: number) => api(`/standing-answers/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries(); toast('Standing answer removed'); }, onError: (e: any) => toast(e.message, 'error') });
	const d = sum.data;
	if (!d) return <Loader />;
	const gl = (k: string) => d.groups.find((g: any) => g.key === k)?.label || k;
	const totals = d.byGroup.reduce((a: any, r: any) => ({ emails: a.emails + r.emails, complete: a.complete + r.complete }), { emails: 0, complete: 0 });
	return (
		<div className="col gap-16">
			<div className="grid g-2">
				<Card title="Completeness by group" sub={`${num(totals.complete)} of ${num(totals.emails)} emails waiting for a reply have every fact they need.`} flush>
					{!d.byGroup.length ? <Empty text="No emails waiting." /> : <div className="table-wrap"><table className="table">
						<thead><tr><th>Group</th><th>Sub-tag</th><th className="num">Emails</th><th className="num">Complete</th><th className="num">Average</th><th className="num">Ready</th></tr></thead>
						<tbody>{d.byGroup.map((r: any, i: number) => <tr key={i}><td className="small">{gl(r.g)}</td><td className="xs">{d.subTags[r.t] || ''}</td><td className="num small">{num(r.emails)}</td><td className="num small">{num(r.complete)}</td><td className="num small">{r.avg ?? 0}%</td><td className="num small">{num(r.ready)}</td></tr>)}</tbody>
					</table></div>}
				</Card>
				<Card title="Weekly completeness trend" sub="Average completeness of emails waiting for a reply, week by week: answers and uploads lift it.">
					{!d.trend.length ? <Empty text="The trend starts once emails have been worked out for a few days." /> : <Chart type="line" height={260} options={{ xaxis: { categories: d.trend.map((t: any) => t.week) }, yaxis: { min: 0, max: 100 }, colors: [COLORS.green], stroke: { width: 3, curve: 'smooth' } }} series={[{ name: 'Average completeness %', data: d.trend.map((t: any) => t.avg) }]} />}
				</Card>
			</div>
			<Card title="Open questions by type" flush sub="Answer a question once here and it is used on every email that asks it (a standing answer).">
				{!d.questions.length ? <Empty text="No open questions." /> : <div className="table-wrap"><table className="table"><thead><tr><th>Type</th><th className="num">Emails held back</th><th className="num">Different questions</th></tr></thead>
					<tbody>{d.questions.map((r: any) => <tr key={r.fact}><td className="small">{r.label}</td><td className="num small">{num(r.n)}</td><td className="num small">{num(r.distinct_questions)}</td></tr>)}</tbody></table></div>}
			</Card>
			<Card title="Pending questions" flush>
				{!oq.data?.types?.length ? <Empty text="Nothing pending." /> : <div className="table-wrap"><table className="table">
					<thead><tr><th>Question</th><th className="num">Emails</th><th>Answer for all emails</th></tr></thead>
					<tbody>{oq.data.types.flatMap((t: any) => t.questions).filter((q2: any) => q2.kind !== 'lookup').map((q2: any) => (
						<tr key={q2.key}><td className="small" style={{ maxWidth: 480 }}>{q2.text}{q2.needs_upload ? <div className="xs faint">or upload: {q2.needs_upload}</div> : null}</td><td className="num small">{q2.emails}</td>
							<td>{can('analyst') && <div className="row gap-4"><input className="input sm" value={ans[q2.key] || ''} onChange={(e) => setAns({ ...ans, [q2.key]: e.target.value })} aria-label={`Answer: ${q2.text}`} /><button className="btn sm primary" disabled={!ans[q2.key]?.trim() || save.isPending} onClick={() => save.mutate(q2)}>Save</button></div>}</td></tr>
					))}</tbody>
				</table></div>}
			</Card>
			<Card title="Standing answers" flush sub="Answers saved once and used on every email with the same question, and how many emails each one completed.">
				{!sa.data?.length ? <Empty text="No standing answers yet." /> : <div className="table-wrap"><table className="table">
					<thead><tr><th>Question</th><th>Answer</th><th className="num">Emails it completed</th><th>Saved</th><th /></tr></thead>
					<tbody>{sa.data.map((s: any) => {
						const n = d.unlocked.find((u: any) => u.id === s.id)?.emails || 0;
						return <tr key={s.id}><td className="small" style={{ maxWidth: 320 }}>{s.question}</td><td className="small" style={{ maxWidth: 320 }}>{s.answer}</td><td className="num small">{num(n)}</td><td className="xs">{ago(s.updated_at)}{s.created_by_name ? ` · ${s.created_by_name}` : ''}</td>
							<td>{can('manager') && <button className="btn ghost icon sm" aria-label="Remove" onClick={() => confirm('Remove this standing answer? Emails that used it will ask the question again.') && del.mutate(s.id)}><MdDelete /></button>}</td></tr>;
					})}</tbody>
				</table></div>}
			</Card>
		</div>
	);
}

export function AutoSend() {
	const { data } = useQuery({ queryKey: ['settings-email'], queryFn: () => api('/settings/email') });
	if (!data) return <Loader />;
	return (
		<Card title="Auto-send (coming later)" accent={COLORS.amber}
			sub="When it is ready, admins will choose which groups or sub-tags are sent automatically once a reply is Ready to send. In this version it cannot be switched on: every reply is sent by a person pressing Send, with 30 seconds to undo.">
			<Switch checked={false} onChange={() => {}} label="Send automatically (not available yet)" />
			<div className="mt-16 small faint">Groups that could be sent automatically later:</div>
			<div className="chips mt-8">{data.groups.map((g: any) => <span key={g.key} className="chip" aria-disabled="true">{g.label}</span>)}</div>
		</Card>
	);
}

const WHICH = [
	{ v: 'ai', l: 'Emails analysed by the AI', d: 'Every email the AI has analysed, with its reply drafts. Replies already sent stay in Gmail.' },
	{ v: 'not_ai', l: 'Emails not analysed by the AI', d: 'Emails the rules engine analysed earlier, and emails still waiting for the AI (not shown in Emails).' },
	{ v: 'both', l: 'Both', d: 'Every email in Gita Mail.' },
] as const;

/** Settings → System status (admins): delete emails, either the ones the AI analysed or the ones it did not, or both. */
export function DeleteEmailsCard() {
	const toast = useToast();
	const qc = useQueryClient();
	const [open, setOpen] = useState(false);
	const [which, setWhich] = useState<'ai' | 'not_ai' | 'both'>('not_ai');
	const [readAgain, setReadAgain] = useState(false);
	const [typed, setTyped] = useState('');
	const [haveBackup, setHaveBackup] = useState(false);
	const pre = useQuery({ queryKey: ['delete-emails-preview'], queryFn: () => api('/system/delete-emails'), enabled: open });
	const go = useMutation({
		mutationFn: () => api('/system/delete-emails', { body: { which, confirm: typed, haveBackup, readAgain } }),
		onSuccess: (r: any) => { setOpen(false); setTyped(''); qc.invalidateQueries(); toast(`${num(r.emails)} emails in ${num(r.threads)} threads deleted${r.backup ? `; backup saved at ${r.backup}` : ''}${r.readAgain ? '. The mailboxes are being read again.' : ''}`); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const sum = (k: string) => (k === 'both' ? ['ai', 'not_ai'] : [k]).reduce((a, x) => ({ threads: a.threads + (pre.data?.[x]?.threads || 0), emails: a.emails + (pre.data?.[x]?.emails || 0), replies: a.replies + (pre.data?.[x]?.replies || 0), bulk: a.bulk + (pre.data?.[x]?.bulk || 0) }), { threads: 0, emails: 0, replies: 0, bulk: 0 });
	const chosen = sum(which);
	return (
		<Card title="Delete emails" accent={COLORS.red}
			sub="Deletes emails from Gita Mail only (they stay in Gmail): the ones the AI analysed, the ones it did not, or both. Nothing else is deleted: master data, stock, tracking, customers, settings and mailboxes are kept. A backup is taken first.">
			<button className="btn" style={{ color: 'var(--red)' }} onClick={() => setOpen(true)}><MdDeleteForever /> Delete emails…</button>
			{open && (
				<Modal title="Delete emails" onClose={() => setOpen(false)}
					footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" style={{ background: 'var(--red)' }} disabled={typed !== 'DELETE' || go.isPending || !chosen.threads} onClick={() => go.mutate()}>{go.isPending ? 'Backing up and deleting…' : `Delete ${num(chosen.emails)} emails`}</button></>}>
					{!pre.data ? <Loader /> : <>
						<div className="col gap-8">
							{WHICH.map((w) => {
								const n = sum(w.v);
								return (
									<label key={w.v} className={`choice ${which === w.v ? 'on' : ''}`}>
										<input type="radio" name="delete-which" checked={which === w.v} onChange={() => setWhich(w.v)} />
										<span><b>{w.l}</b>: {num(n.emails)} emails in {num(n.threads)} threads{n.replies ? `, ${num(n.replies)} unsent replies` : ''}{n.bulk ? `, ${num(n.bulk)} bulk requests` : ''}<br /><span className="xs faint">{w.d}</span></span>
									</label>
								);
							})}
						</div>
						<div className="small mt-16"><b>Kept:</b> {pre.data.keep.join(' · ')}</div>
						<label className="small row gap-4 mt-16"><input type="checkbox" checked={readAgain} onChange={(e) => setReadAgain(e.target.checked)} /> Read the mailboxes again afterwards, so the deleted emails come back from Gmail and are analysed by the AI afresh</label>
						<label className="small row gap-4 mt-8"><input type="checkbox" checked={haveBackup} onChange={(e) => setHaveBackup(e.target.checked)} /> I have a backup (only needed if the automatic backup cannot be made)</label>
						<div className="field mt-8"><label>Type DELETE to confirm</label><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} /></div>
					</>}
				</Modal>
			)}
		</Card>
	);
}
