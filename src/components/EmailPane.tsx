/**
 * The reading pane: questions at the top, the original email with attachments, the facts found, and the reply
 * draft with found facts in green and missing ones in yellow. Rewrite properly (AI, side by side), Send (30-second
 * undo) and Send later. Bulk orders get the quote builder. Nothing is ever sent without a person pressing Send.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MdAttachFile, MdAutoAwesome, MdCancel, MdCheckCircle, MdEdit, MdOpenInNew, MdPictureAsPdf, MdRefresh, MdSchedule, MdSend, MdUndo } from 'react-icons/md';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Loader, Modal } from './ui';
import { fmtDateTime, ago } from '../lib/format';
import { openFile, download } from '../lib/files';

const MARK = /\[\[\s*(ok|provide)\s*:\s?(.*?)\]\](?!\])/gis;
export const LEVEL_COLOR: Record<string, string> = { critical: '#DC2626', high: '#EA580C', medium: '#CA8A04', low: '#64748B' };
export const STATUS_LABEL: Record<string, string> = { ready: 'Ready to send', pending: 'Pending information', sent: 'Sent', queued: 'Sending…', not_for_reply: 'Not for reply' };
export const inr = (n?: number | null) => (n === null || n === undefined ? '–' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

/** The draft with found facts green and missing information yellow. */
export function Marked({ body }: { body: string }) {
	const parts: ReactNode[] = [];
	let last = 0;
	let i = 0;
	for (const m of body.matchAll(MARK)) {
		parts.push(body.slice(last, m.index));
		parts.push(m[1].toLowerCase() === 'ok'
			? <mark key={i++} className="fact-ok" title="Filled in from Gita Mail's data">{m[2]}</mark>
			: <mark key={i++} className="fact-missing" title="Answer the question at the top">{m[2]}</mark>);
		last = (m.index || 0) + m[0].length;
	}
	parts.push(body.slice(last));
	return <div className="draft-marked">{parts}</div>;
}

export function LevelTag({ level }: { level?: string | null }) {
	if (!level) return null;
	return <span className="level-tag" style={{ '--lv': LEVEL_COLOR[level] || '#64748B' } as any}>{level[0].toUpperCase() + level.slice(1)}</span>;
}
export function StatusTag({ s }: { s?: string | null }) {
	if (!s) return null;
	return <span className={`status-tag s-${s}`}>{STATUS_LABEL[s] || s}</span>;
}
export function Completeness({ v }: { v?: number | null }) {
	if (v === null || v === undefined) return <span className="faint xs">–</span>;
	const tone = v >= 100 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)';
	return <span className="comp"><span className="comp-bar"><span style={{ width: `${v}%`, background: tone }} /></span><span className="xs">{v}%</span></span>;
}

export default function EmailPane({ id, meta, onClose }: { id: number; meta: any; onClose?: () => void }) {
	const { can } = useAuth();
	const toast = useToast();
	const qc = useQueryClient();
	const { data, isLoading, refetch } = useQuery({ queryKey: ['email', id], queryFn: () => api(`/emails/${id}`), refetchInterval: (q: any) => (q.state.data?.draft?.status === 'queued' ? 3000 : false) });
	const refresh = () => { qc.invalidateQueries({ queryKey: ['email', id] }); qc.invalidateQueries({ queryKey: ['emails'] }); qc.invalidateQueries({ queryKey: ['emails-meta'] }); };
	const err = (e: any) => toast(e.message, 'error');
	const [answers, setAnswers] = useState<Record<string, { value: string; standing: boolean }>>({});
	useEffect(() => setAnswers({}), [id]);
	const [edit, setEdit] = useState<string | null>(null);
	const [rewrite, setRewrite] = useState<{ before: string; after: string } | null>(null);
	const [later, setLater] = useState(false);
	const [laterAt, setLaterAt] = useState('');
	const [showAll, setShowAll] = useState(false);
	const editor = useRef<HTMLTextAreaElement>(null);

	const answer = useMutation({ mutationFn: () => api(`/emails/${id}/answers`, { body: { answers: Object.entries(answers).filter(([, a]) => a.value.trim()).map(([key, a]) => ({ key, ...a })) } }), onSuccess: (r: any) => { setAnswers({}); refresh(); toast(r.standing ? `Saved, and kept as a standing answer for every email that asks (${r.standing})` : 'Answer added to the reply'); }, onError: err });
	const tag = useMutation({ mutationFn: (body: any) => api(`/emails/${id}`, { method: 'PATCH', body }), onSuccess: refresh, onError: err });
	const recheck = useMutation({ mutationFn: () => api(`/emails/${id}/refresh`, { body: {} }), onSuccess: () => { refresh(); toast('Facts looked up again'); }, onError: err });
	const saveText = useMutation({ mutationFn: (body: string) => api(`/drafts/${data.draft.id}`, { method: 'PUT', body: { body } }), onSuccess: () => { setEdit(null); refresh(); toast('Reply saved'); }, onError: err });
	const doRewrite = useMutation({ mutationFn: () => api(`/emails/${id}/rewrite`, { body: {} }), onSuccess: setRewrite, onError: err });
	const accept = useMutation({ mutationFn: (body: string) => api(`/emails/${id}/rewrite/accept`, { body: { body } }), onSuccess: () => { setRewrite(null); refresh(); toast('Rewritten reply saved'); }, onError: err });
	const send = useMutation({
		mutationFn: (sendAt?: string) => api(`/emails/${id}/send`, { body: { sendAt: sendAt || null } }),
		onSuccess: (r: any) => { refresh(); setLater(false); toast(r.undoSeconds ? `Sending in ${r.undoSeconds} seconds. Undo is on the email.` : `Will be sent on ${fmtDateTime(r.sendAt)}`); },
		onError: err,
	});
	const undo = useMutation({ mutationFn: () => api(`/emails/${id}/send/cancel`, { body: {} }), onSuccess: () => { refresh(); toast('Not sent. The reply is back as a draft.'); }, onError: err });

	// countdown for the undo window
	const [now, setNow] = useState(Date.now());
	useEffect(() => { if (data?.draft?.status !== 'queued') return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [data?.draft?.status]);

	const c = data?.conversation;
	const groups: any[] = meta?.groups || [];
	const group = groups.find((g) => g.key === c?.primary_group);
	const questions: any[] = c?.open_questions || [];
	const facts: any[] = c?.facts || [];
	const draft = data?.draft;
	const missing = useMemo(() => (draft?.body || '').match(/\[\[\s*provide\s*:/gi)?.length || 0, [draft?.body]);
	if (isLoading || !c) return <div className="pane"><Loader /></div>;
	const inbound = data.emails.filter((e: any) => e.direction === 'inbound');
	const shown = showAll ? data.emails : data.emails.slice(-2);
	const secs = draft?.send_at ? Math.max(0, Math.round((new Date(draft.send_at).getTime() - now) / 1000)) : 0;
	const analyst = can('analyst');

	return (
		<div className="pane">
			<div className="pane-head">
				<div className="grow">
					<h2 className="pane-subject">{c.subject || '(no subject)'}</h2>
					<div className="xs faint">{inbound.at(-1)?.from_name} &lt;{inbound.at(-1)?.from_address}&gt; · to {data.mailboxes.join(', ')} · {fmtDateTime(c.last_inbound_at)}</div>
				</div>
				{onClose && <button className="btn ghost icon sm" aria-label="Close" onClick={onClose}><MdCancel /></button>}
			</div>

			<div className="pane-tags">
				<select className="input sm" disabled={!analyst} value={c.primary_group || ''} onChange={(e) => tag.mutate({ primary_group: e.target.value, sub_tags: [] })} aria-label="Group">
					{groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
				</select>
				{group?.subTags?.length > 0 && <select className="input sm" disabled={!analyst} value={c.sub_tags?.[0] || ''} onChange={(e) => tag.mutate({ primary_group: c.primary_group, sub_tags: [e.target.value] })} aria-label="Sub-tag">
					{group.subTags.map((t: string) => <option key={t} value={t}>{meta.subTags[t] || t}</option>)}
				</select>}
				<select className="input sm" disabled={!analyst} value={c.criticality || ''} onChange={(e) => tag.mutate({ criticality: e.target.value })} aria-label="Criticality" style={{ color: LEVEL_COLOR[c.criticality] }}>
					{(meta?.levels || []).map((l: any) => <option key={l.key} value={l.key}>{l.label}</option>)}
				</select>
				<StatusTag s={c.reply_status} />
				<Completeness v={c.completeness} />
				{c.group_locked && <span className="xs faint" title="Set by a person; Gita Mail will not change it">set by hand</span>}
				<span className="grow" />
				<button className="btn ghost sm" disabled={!analyst} onClick={() => tag.mutate({ not_for_reply: !c.not_for_reply })}>{c.not_for_reply ? 'Needs a reply' : 'Not for reply'}</button>
				<button className="btn ghost icon sm" title="Look up the facts again" aria-label="Look up the facts again" onClick={() => recheck.mutate()}><MdRefresh /></button>
			</div>

			{/* 1. questions at the top */}
			{questions.length > 0 && !c.not_for_reply && (
				<div className="questions">
					<div className="q-head"><b>{questions.length} question{questions.length > 1 ? 's' : ''} to complete this reply</b><span className="xs faint">An answer fills the yellow item. Tick "for all emails" to keep it as a standing answer.</span></div>
					{questions.map((q2) => {
						const a = answers[q2.key] || { value: '', standing: false };
						return (
							<div key={q2.key} className="q-row">
								<label className="small" htmlFor={`q-${q2.key}`}>{q2.text}{q2.needsUpload && <span className="xs faint"> · or upload: {q2.needsUpload}</span>}</label>
								<div className="row gap-8">
									<input id={`q-${q2.key}`} className="input sm grow" value={a.value} disabled={!analyst} placeholder={q2.kind === 'lookup' ? 'Type it to look it up' : 'Answer'}
										onChange={(e) => setAnswers({ ...answers, [q2.key]: { ...a, value: e.target.value } })}
										onKeyDown={(e) => { if (e.key === 'Enter' && a.value.trim()) answer.mutate(); }} />
									{q2.kind !== 'lookup' && <label className="xs nowrap row gap-4" title="Keep this answer and use it on every email with the same question"><input type="checkbox" checked={a.standing} onChange={(e) => setAnswers({ ...answers, [q2.key]: { ...a, standing: e.target.checked } })} /> for all emails</label>}
								</div>
							</div>
						);
					})}
					{analyst && <button className="btn sm primary" disabled={answer.isPending || !Object.values(answers).some((a) => a.value.trim())} onClick={() => answer.mutate()}><MdCheckCircle /> {answer.isPending ? 'Saving…' : 'Add answers to the reply'}</button>}
				</div>
			)}

			{/* 2. the original email */}
			<div className="pane-thread">
				{data.emails.length > 2 && <button className="btn ghost sm" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show the latest only' : `Show all ${data.emails.length} messages`}</button>}
				{shown.map((e: any) => (
					<div key={e.id} className={`pane-msg ${e.direction}`}>
						<div className="xs faint">{e.direction === 'inbound' ? <b>{e.from_name || e.from_address}</b> : <b>Gita Press ({e.from_address})</b>} · {fmtDateTime(e.sent_at)} · {e.mailbox}</div>
						<div className="msg-body">{e.body_clean || e.body_text}</div>
						{(e.attachments || []).length > 0 && (
							<div className="attachments">
								{e.attachments.map((a: any, i: number) => (
									<span key={i} className="attachment">
										<MdAttachFile /> <button className="link-btn" onClick={() => openFile(`/emails/attachment/${e.id}/${i}`).catch(err)}>{a.filename}</button>
										<span className="xs faint"> {Math.round((a.size || 0) / 1024)} KB</span>
										{c.primary_group === 'bulk_order' && /sheet|excel|csv|pdf/i.test(`${a.mimeType} ${a.filename}`) && data.bulk && <ReadCodes emailId={e.id} idx={i} bulkId={data.bulk.id} />}
									</span>
								))}
							</div>
						)}
					</div>
				))}
			</div>

			{/* facts found and missing */}
			{facts.length > 0 && (
				<div className="facts-list">
					{facts.map((f) => (
						<span key={f.key} className={`fact-chip ${f.value !== null ? 'ok' : 'missing'}`} title={f.value !== null ? `${f.value}\n(from ${f.source})` : 'Not found: see the questions above'}>
							{f.value !== null ? '✓' : '?'} {f.label}
						</span>
					))}
				</div>
			)}

			{/* bulk orders: the quote builder */}
			{c.primary_group === 'bulk_order' && data.bulk && <QuoteBuilder bulk={data.bulk} international={false} stages={meta?.stages || []} onDone={refresh} />}

			{/* 3. the reply */}
			{c.not_for_reply ? <div className="small faint pane-note">This email is marked "Not for reply". Select "Needs a reply" above if it does need one.</div>
				: !draft ? <div className="small faint pane-note">No reply draft yet. It appears once the email has been analysed{c.reply_status === 'sent' ? '; this email has already been answered' : ''}.</div>
					: (
						<div className="reply">
							<div className="row-between">
								<div className="small"><b>Reply</b> <span className="faint">to {(draft.to_addresses || []).join(', ')}{draft.cc_addresses?.length ? ` · cc ${draft.cc_addresses.join(', ')}` : ''} · from {draft.send_from || 'the mailbox it came to'}</span></div>
								<div className="row gap-4">
									{(draft.attachments || []).map((a: any) => <button key={a.name} className="btn ghost sm" onClick={() => openFile(`/bulk/${a.bulkId}/quote.pdf`).catch(err)}><MdPictureAsPdf /> {a.name}</button>)}
								</div>
							</div>
							{draft.status === 'sent' ? <div className="small mt-8"><MdCheckCircle style={{ color: 'var(--green)' }} /> Sent {ago(draft.sent_at)}{draft.sent_by_name ? ` by ${draft.sent_by_name}` : ''}.</div> : null}
							{draft.last_error && draft.status === 'draft' && <div className="small mt-8" style={{ color: 'var(--red)' }}>Last attempt to send failed: {draft.last_error}</div>}
							{edit !== null ? (
								<>
									<textarea ref={editor} className="input mt-8 reply-edit" rows={18} value={edit} onChange={(e) => setEdit(e.target.value)} />
									<div className="xs faint">[[ok: …]] is shown green and [[provide: …]] yellow. Keep a yellow item as it is if you have not answered it yet.</div>
									<div className="row gap-8 mt-8"><button className="btn primary sm" disabled={saveText.isPending} onClick={() => saveText.mutate(edit)}>Save</button><button className="btn sm" onClick={() => setEdit(null)}>Cancel</button></div>
								</>
							) : <Marked body={draft.body} />}
							{draft.status === 'queued' ? (
								<div className="send-bar queued">
									<MdSchedule /> {secs > 60 ? `Will be sent on ${fmtDateTime(draft.send_at)}` : secs > 0 ? `Sending in ${secs} seconds` : 'Sending…'}
									<button className="btn sm" disabled={undo.isPending} onClick={() => undo.mutate()}><MdUndo /> {secs > 60 ? 'Cancel send later' : 'Undo'}</button>
								</div>
							) : draft.status !== 'sent' && analyst && edit === null && (
								<div className="send-bar">
									<button className="btn primary" disabled={!!missing || send.isPending} title={missing ? `Answer the ${missing} yellow item(s) first` : 'Sends after 30 seconds (you can undo)'} onClick={() => send.mutate(undefined)}><MdSend /> Send</button>
									<button className="btn" disabled={!!missing} onClick={() => setLater(!later)}><MdSchedule /> Send later</button>
									<button className="btn" disabled={doRewrite.isPending} onClick={() => doRewrite.mutate()}><MdAutoAwesome /> {doRewrite.isPending ? 'Rewriting…' : 'Rewrite properly'}</button>
									<button className="btn ghost" onClick={() => setEdit(draft.body)}><MdEdit /> Edit text</button>
									{missing > 0 && <span className="xs" style={{ color: 'var(--amber)' }}>{missing} yellow item{missing > 1 ? 's' : ''} left</span>}
								</div>
							)}
							{later && (
								<div className="row gap-8 mt-8">
									<input type="datetime-local" className="input sm" value={laterAt} onChange={(e) => setLaterAt(e.target.value)} aria-label="Send on" />
									<button className="btn sm primary" disabled={!laterAt || send.isPending} onClick={() => send.mutate(new Date(laterAt).toISOString())}>Schedule</button>
								</div>
							)}
						</div>
					)}

			{rewrite && (
				<Modal wide title="Rewrite properly: check before using" onClose={() => setRewrite(null)}
					footer={<><button className="btn" onClick={() => setRewrite(null)}>Keep the current reply</button><button className="btn primary" disabled={accept.isPending} onClick={() => accept.mutate(rewrite.after)}>Use the rewritten reply</button></>}>
					<div className="grid g-2" style={{ gap: 12 }}>
						<div><div className="xs faint mb-8">Current</div><div className="rewrite-box">{rewrite.before}</div></div>
						<div><div className="xs faint mb-8">Rewritten (every figure kept)</div><div className="rewrite-box">{rewrite.after}</div></div>
					</div>
				</Modal>
			)}
			<button hidden onClick={() => refetch()} />
		</div>
	);
}

function ReadCodes({ emailId, idx, bulkId }: { emailId: number; idx: number; bulkId: number }) {
	const toast = useToast();
	const qc = useQueryClient();
	const read = useMutation({
		mutationFn: () => api(`/emails/attachment/${emailId}/${idx}/read`, { body: {} }),
		onSuccess: (r: any) => { toast(r.note, r.items.length ? 'ok' : 'error'); if (r.items.length) qc.setQueryData(['quote-items', bulkId], r.items.map((x: any) => ({ code: x.code, qty: x.qty || 1 }))); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	return <button className="btn ghost sm" disabled={read.isPending} onClick={() => read.mutate()} title="Read book codes and quantities into the quote builder">{read.isPending ? 'Reading…' : 'Read codes for the quote'}</button>;
}

function QuoteBuilder({ bulk, international, stages, onDone }: { bulk: any; international: boolean; stages: any[]; onDone: () => void }) {
	const toast = useToast();
	const qc = useQueryClient();
	const { can } = useAuth();
	const fromRead = qc.getQueryData<any[]>(['quote-items', bulk.id]);
	const initial = (fromRead || (bulk.items || []).map((i: any) => ({ code: i.code, qty: i.qty }))) as { code: string; qty: number }[];
	const [items, setItems] = useState<{ code: string; qty: number }[]>(initial.length ? initial : [{ code: '', qty: 1 }]);
	useEffect(() => { if (fromRead?.length) setItems(fromRead); }, [fromRead]);
	const valid = items.filter((i) => i.code.trim() && i.qty > 0);
	const price = useQuery({ queryKey: ['quote-price', bulk.id, JSON.stringify(valid)], enabled: valid.length > 0, queryFn: () => api('/quote/price', { body: { items: valid, international } }), retry: false });
	const make = useMutation({ mutationFn: () => api(`/bulk/${bulk.id}/quote`, { body: { items: valid } }), onSuccess: (r: any) => { onDone(); toast(`Quote ${r.quoteNo} made and attached to the reply`); }, onError: (e: any) => toast(e.message, 'error') });
	const stage = useMutation({ mutationFn: (s: string) => api(`/bulk/${bulk.id}`, { method: 'PATCH', body: { stage: s } }), onSuccess: onDone });
	const p = price.data;
	return (
		<details className="quote-builder" open={!bulk.quote_no}>
			<summary className="row-between">
				<span><b>Quote builder</b> {bulk.quote_no ? <span className="xs faint">· {bulk.quote_no} made {ago(bulk.quote_at)}</span> : null}</span>
				<select className="input sm" value={bulk.stage} onClick={(e) => e.stopPropagation()} onChange={(e) => stage.mutate(e.target.value)} aria-label="Stage">
					{stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
				</select>
			</summary>
			<div className="table-wrap mt-8"><table className="table">
				<thead><tr><th>Code</th><th>Book</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th><th className="num">At Gorakhpur</th><th /></tr></thead>
				<tbody>
					{items.map((it, i) => {
						const line = p?.lines?.find((l: any) => l.code === it.code.trim().toUpperCase() || l.code === it.code.trim());
						return (
							<tr key={i}>
								<td><input className="input sm" style={{ width: 80 }} value={it.code} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} aria-label="Code" /></td>
								<td className="small">{line ? <>{line.title}{line.hindi ? <div className="xs faint">{line.hindi}</div> : null}</> : <span className="faint">–</span>}</td>
								<td className="num"><input className="input sm" type="number" min={1} style={{ width: 80 }} value={it.qty} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} aria-label="Quantity" /></td>
								<td className="num small">{line ? inr(line.price) : ''}</td><td className="num small">{line ? inr(line.amount) : ''}</td>
								<td className="num small">{line?.available ?? ''}</td>
								<td><button className="btn ghost sm" onClick={() => setItems(items.filter((_x, j) => j !== i))} aria-label="Remove line">×</button></td>
							</tr>
						);
					})}
				</tbody>
			</table></div>
			<div className="row-between mt-8">
				<button className="btn ghost sm" onClick={() => setItems([...items, { code: '', qty: 1 }])}>+ Add a book (or a set code)</button>
				{p && <div className="small quote-totals">
					<span>Books {inr(p.totals.bookValue)}</span><span>Discount {p.totals.discount.amount ? `− ${inr(p.totals.discount.amount)} (${p.totals.discount.label})` : 'none'}</span>
					<span>Postage {p.totals.postage === null ? 'to confirm' : p.totals.postage === 0 ? 'free' : inr(p.totals.postage)}</span><b>Total {inr(p.totals.total)}</b>
				</div>}
			</div>
			{p?.missing?.length > 0 && <div className="xs mt-8" style={{ color: 'var(--amber)' }}>No price for {p.missing.join(', ')}: add it in Master data → Books.</div>}
			{price.error && <div className="xs mt-8" style={{ color: 'var(--red)' }}>{(price.error as any).message}</div>}
			{can('analyst') && <div className="row gap-8 mt-8">
				<button className="btn primary sm" disabled={!valid.length || make.isPending} onClick={() => make.mutate()}><MdPictureAsPdf /> {make.isPending ? 'Making…' : bulk.quote_no ? 'Make the quote again' : 'Make quote PDF and attach'}</button>
				{bulk.quote_no && <button className="btn sm" onClick={() => openFile(`/bulk/${bulk.id}/quote.pdf`).catch((e) => toast(e.message, 'error'))}><MdOpenInNew /> Open quote</button>}
				{bulk.quote_no && <button className="btn ghost sm" onClick={() => download(`/bulk/${bulk.id}/quote.pdf`, `Gita-Press-Quote-${bulk.quote_no}.pdf`).catch((e) => toast(e.message, 'error'))}>Download</button>}
			</div>}
		</details>
	);
}
