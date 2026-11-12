import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MdAdd, MdArrowDownward, MdArrowUpward, MdCallMerge, MdEdit, MdLock, MdVisibility, MdVisibilityOff } from 'react-icons/md';
import { api } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card, Loader, Modal } from '../../components/ui';
import { num, usePurposes, type PurposeDef } from '../../lib/purposes';
import { COLORS, ago } from '../../lib/format';

/**
 * Settings → Reasons for contacting. Every email thread is tagged with one or more reasons; each customer record
 * collects all of them. Managers can add, rename, describe, regroup, reorder, hide and merge reasons here.
 */
export default function Reasons() {
	const { can } = useAuth();
	const manager = can('manager');
	const toast = useToast();
	const qc = useQueryClient();
	const P = usePurposes();
	const [edit, setEdit] = useState<Partial<PurposeDef> & { keywordsText?: string; _new?: boolean } | null>(null);
	const [merge, setMerge] = useState<PurposeDef | null>(null);
	const [into, setInto] = useState('');
	const [recheck, setRecheck] = useState(false);
	const done = (msg: string) => ({ onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ['purposes'] }); qc.invalidateQueries({ queryKey: ['customer-db'] }); toast(r?.retagging?.length ? `${msg}. Older emails are being checked for the keywords.` : msg); }, onError: (e: any) => toast(e.message, 'error') });
	const saveR = useMutation({ mutationFn: (reasons: any[]) => api('/settings/purposes', { method: 'PUT', body: { reasons } }), ...done('Saved') });
	const mergeR = useMutation({ mutationFn: () => api('/settings/purposes/merge', { body: { from: merge!.key, into } }), ...done('Merged'), onSettled: () => setMerge(null) });
	if (P.isLoading || !P.data) return <Loader />;
	const all = P.all;
	const live = all.filter((d) => d.active).sort((a, b) => a.sort_order - b.sort_order);
	const groups = [...new Set(live.map((d) => d.group_name))];
	const gone = all.filter((d) => !d.active);
	const move = (d: PurposeDef, dir: -1 | 1) => {
		const list = live.filter((x) => x.group_name === d.group_name);
		const i = list.findIndex((x) => x.key === d.key);
		const other = list[i + dir];
		if (!other) return;
		saveR.mutate([{ key: d.key, sort_order: other.sort_order }, { key: other.key, sort_order: d.sort_order }]);
	};
	const moveGroup = (g: string, dir: -1 | 1) => {
		const order = [...groups];
		const i = order.indexOf(g);
		if (!order[i + dir]) return;
		[order[i], order[i + dir]] = [order[i + dir], order[i]];
		let n = 0;
		saveR.mutate(order.flatMap((grp) => live.filter((d) => d.group_name === grp).map((d) => ({ key: d.key, sort_order: (n += 10) }))));
	};
	const renameGroup = (g: string) => {
		const name = prompt(`New name for the group "${g}"`, g);
		if (name && name.trim() && name !== g) saveR.mutate(live.filter((d) => d.group_name === g).map((d) => ({ key: d.key, group_name: name.trim() })));
	};
	const save = () => {
		if (!edit) return;
		const body: any = { label: edit.label, description: edit.description, group_name: edit.group_name, keywords: edit.keywordsText };
		if (!edit._new) body.key = edit.key;
		saveR.mutate([body], { onSuccess: () => setEdit(null) });
	};
	const running = (P.data.retags || []).filter((r: any) => r.status === 'queued');
	return (
		<>
			<Card className="mb-16" accent={COLORS.teal} title="Reasons for contacting"
				sub={<>Every email thread is tagged with one or more reasons, and each customer record collects every reason that customer has written about. The description tells the AI when to use a reason; keywords (English or Hindi) let the free rules engine tag emails without the AI. Up to {P.data.max} reasons.</>}
				actions={manager ? <div className="row gap-8"><button className="btn sm" onClick={() => setRecheck(true)}>Re-check with AI for a date range</button><button className="btn sm primary" onClick={() => setEdit({ _new: true, label: '', description: '', group_name: groups[0] || 'Other', keywordsText: '' })}><MdAdd /> Add a reason</button></div> : undefined}>
				{running.length > 0 && <div className="small" style={{ color: COLORS.amber }}>Checking older emails for new keywords: {running.map((r: any) => `${all.find((d) => d.key === r.key)?.label || r.key} (${num(r.checked)} checked, ${num(r.tagged)} tagged)`).join('; ')}</div>}
				{(P.data.retags || []).filter((r: any) => r.status === 'done').slice(0, 3).map((r: any) => <div key={r.created_at + r.key} className="xs faint">Keyword check done {ago(r.finished_at)}: {all.find((d) => d.key === r.key)?.label || r.key}, {num(r.tagged)} older threads tagged.</div>)}
				{!manager && <div className="small faint">Managers and admins can change the reasons.</div>}
			</Card>
			{groups.map((g, gi) => (
				<Card key={g} flush className="mb-16" title={g}
					actions={manager ? <div className="row gap-4"><button className="btn ghost icon sm" disabled={gi === 0} aria-label="Move group up" onClick={() => moveGroup(g, -1)}><MdArrowUpward /></button><button className="btn ghost icon sm" disabled={gi === groups.length - 1} aria-label="Move group down" onClick={() => moveGroup(g, 1)}><MdArrowDownward /></button><button className="btn ghost sm" onClick={() => renameGroup(g)}>Rename group</button></div> : undefined}>
					<div className="table-wrap"><table className="table">
						<thead><tr><th>Reason</th><th>When to use it</th><th>Keywords</th><th className="num">Customers</th><th className="num">Threads</th><th /></tr></thead>
						<tbody>{live.filter((d) => d.group_name === g).map((d, i, list) => (
							<tr key={d.key}>
								<td style={{ maxWidth: 220 }}><b>{d.label}</b>{d.locked && <span className="badge" title="Always needed: can be renamed and described, not hidden or merged away" style={{ marginLeft: 6 }}><MdLock style={{ verticalAlign: 'middle' }} /> Locked</span>}</td>
								<td className="xs" style={{ maxWidth: 320 }}>{d.description}</td>
								<td className="xs" style={{ maxWidth: 220 }}><div className="row wrap gap-4">{(d.keywords || []).map((k) => <span key={k} className="chip">{k}</span>)}</div></td>
								<td className="num small"><Link to={`/admin/customers?purposes=${d.key}`}>{num(d.customers)}</Link></td>
								<td className="num small">{num(d.threads)}</td>
								<td className="nowrap">{manager && <div className="row gap-4" style={{ justifyContent: 'flex-end' }}>
									<button className="btn ghost icon sm" disabled={i === 0} aria-label="Move up" onClick={() => move(d, -1)}><MdArrowUpward /></button>
									<button className="btn ghost icon sm" disabled={i === list.length - 1} aria-label="Move down" onClick={() => move(d, 1)}><MdArrowDownward /></button>
									<button className="btn ghost icon sm" title="Edit" aria-label="Edit" onClick={() => setEdit({ ...d, keywordsText: (d.keywords || []).join(', ') })}><MdEdit /></button>
									{!d.locked && <button className="btn ghost icon sm" title="Hide" aria-label="Hide" onClick={() => confirm(`Hide "${d.label}"? It stops being offered to the AI and in filters; old records keep it, marked (hidden).`) && saveR.mutate([{ key: d.key, hidden: true }])}><MdVisibilityOff /></button>}
									{!d.locked && <button className="btn ghost icon sm" title="Merge into another reason" aria-label="Merge" onClick={() => { setMerge(d); setInto(''); }}><MdCallMerge /></button>}
								</div>}</td>
							</tr>))}</tbody>
					</table></div>
				</Card>
			))}
			{gone.length > 0 && (
				<Card flush title="Hidden and merged" sub="Kept on older records. A hidden reason can be shown again; a merge cannot be undone.">
					<div className="table-wrap"><table className="table"><tbody>{gone.map((d) => (
						<tr key={d.key}><td><b>{d.label}</b></td><td className="small">{d.merged_into ? `Merged into ${all.find((x) => x.key === d.merged_into)?.label || d.merged_into}` : 'Hidden'}</td><td className="num small">{num(d.customers)} customers</td>
							<td>{manager && !d.merged_into && <button className="btn sm" onClick={() => saveR.mutate([{ key: d.key, hidden: false }])}><MdVisibility /> Show again</button>}</td></tr>))}</tbody></table></div>
				</Card>
			)}
			{edit && (
				<Modal title={edit._new ? 'Add a reason' : `Edit "${edit.label}"`} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={saveR.isPending} onClick={save}>Save</button></>}>
					<div className="col gap-16">
						<div className="field"><label>Name</label><input className="input" maxLength={60} value={edit.label || ''} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></div>
						<div className="field"><label>When to use it ({(edit.description || '').length} of 200 characters)</label><textarea className="input" rows={3} maxLength={200} value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /><span className="hint">Read by the AI to decide when this reason applies.</span></div>
						<div className="field"><label>Group</label><input className="input" list="reason-groups" value={edit.group_name || ''} onChange={(e) => setEdit({ ...edit, group_name: e.target.value })} /><datalist id="reason-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></div>
						<div className="field"><label>Keywords (separate with commas; English or Hindi)</label><input className="input" value={edit.keywordsText || ''} onChange={(e) => setEdit({ ...edit, keywordsText: e.target.value })} /><span className="hint">Up to 30, each up to 40 characters. English keywords match whole words; Hindi keywords match anywhere. When keywords are added, older emails are checked for them in the background at no AI cost.</span></div>
					</div>
				</Modal>
			)}
			{merge && (
				<Modal title={`Merge "${merge.label}" into…`} onClose={() => setMerge(null)} footer={<><button className="btn" onClick={() => setMerge(null)}>Cancel</button><button className="btn primary" disabled={!into || mergeR.isPending} onClick={() => mergeR.mutate()}>Merge</button></>}>
					<p className="small">{num(merge.threads)} threads and {num(merge.customers)} customers tagged "{merge.label}" will be tagged with the reason you choose instead. <b>A merge cannot be undone.</b></p>
					<select className="input" value={into} onChange={(e) => setInto(e.target.value)}><option value="">Choose a reason</option>{live.filter((d) => d.key !== merge.key).map((d) => <option key={d.key} value={d.key}>{d.label} ({num(d.customers)} customers)</option>)}</select>
				</Modal>
			)}
			{recheck && <Recheck onClose={() => setRecheck(false)} />}
		</>
	);
}

/** Uses the AI again for the threads in a date range, after reasons have changed. Shows the size first, because it uses AI credit. */
function Recheck({ onClose }: { onClose: () => void }) {
	const toast = useToast();
	const today = new Date().toISOString().slice(0, 10);
	const [r, setR] = useState({ from: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10), to: today });
	const est = useQuery({ queryKey: ['recheck', r], queryFn: () => api(`/settings/purposes/recheck?from=${r.from}&to=${r.to}`) });
	const go = useMutation({ mutationFn: () => api('/settings/purposes/recheck', { body: r }), onSuccess: (x: any) => { toast(`${num(x.marked)} threads will be analysed again in the background`); onClose(); }, onError: (e: any) => toast(e.message, 'error') });
	return (
		<Modal title="Re-check reasons with the AI" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!est.data?.threads || go.isPending} onClick={() => go.mutate()}>Re-check {num(est.data?.threads)} threads</button></>}>
			<div className="row gap-8 mb-16"><label className="small">From <input className="input sm" type="date" value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} /></label><label className="small">to <input className="input sm" type="date" value={r.to} max={today} onChange={(e) => setR({ ...r, to: e.target.value })} /></label></div>
			<p className="small">{est.data ? <>{num(est.data.threads)} threads ({num(est.data.emails)} emails) in this range.</> : 'Counting…'}</p>
			<p className="small" style={{ color: COLORS.amber }}>This uses AI credit for every thread. Reasons set by hand on a thread are kept. The free keyword check already runs automatically when you add keywords.</p>
		</Modal>
	);
}
