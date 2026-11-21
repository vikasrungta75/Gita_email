/**
 * Settings → AI (admins): which AI writes the analysis, the reply rewrites and Mail Sage. Claude, Gemini, the rules
 * engine only, or whatever .env says. The model for each provider, and the API keys: saved encrypted, never shown
 * again (only their last four characters), and checked with the provider before you rely on them.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MdAutorenew, MdCheckCircle, MdErrorOutline, MdSave, MdWifiTethering } from 'react-icons/md';
import { api } from '../../api/client';
import { useToast } from '../../contexts/ToastContext';
import { Card, Loader, Switch } from '../../components/ui';
import { COLORS, fmtDateTime } from '../../lib/format';

const PROVIDERS = [
	{ v: 'gemini', l: 'Gemini (Google)', d: 'Google AI Studio key. Low cost; Flash-Lite is the basic model.' },
	{ v: 'anthropic', l: 'Claude (Anthropic)', d: 'Anthropic Console key. Strong Hindi and English writing.' },
	{ v: 'heuristic', l: 'Rules only (no AI)', d: 'No email text leaves this server. Drafts, facts and questions still work; Rewrite properly and Mail Sage do not.' },
	{ v: 'env', l: 'As in the .env file', d: 'Use AI_PROVIDER and the keys in .env, as before.' },
];
const NAME: Record<string, string> = { gemini: 'Gemini', anthropic: 'Claude', heuristic: 'Rules only', azure: 'Azure OpenAI', openai: 'OpenAI' };

export default function AiSettings() {
	const toast = useToast();
	const qc = useQueryClient();
	const { data, isLoading } = useQuery({ queryKey: ['settings-ai'], queryFn: () => api('/settings/ai') });
	const [f, setF] = useState<any>(null);
	const [keys, setKeys] = useState<{ anthropic: string; gemini: string }>({ anthropic: '', gemini: '' });
	const [tests, setTests] = useState<Record<string, { ok: boolean; message: string } | 'testing'>>({});
	useEffect(() => { if (data) setF({ analyseAll: data.analyseAll !== false, provider: data.provider, anthropicModel: data.anthropicModel || data.env.anthropicModel || data.models.anthropic[0].id, geminiModel: data.geminiModel || data.env.geminiModel || data.models.gemini[0].id }); }, [data]);
	const save = useMutation({
		mutationFn: (extra: Record<string, unknown> = {}) => api('/settings/ai', { method: 'PUT', body: { ...f, anthropicKey: keys.anthropic || undefined, geminiKey: keys.gemini || undefined, ...extra } }),
		onSuccess: (r: any) => { qc.setQueryData(['settings-ai'], r); qc.invalidateQueries({ queryKey: ['system-status'] }); setKeys({ anthropic: '', gemini: '' }); toast(`AI settings saved: ${NAME[r.effective.provider] || r.effective.provider}${r.effective.provider === 'heuristic' ? '' : ` · ${r.effective.model}`}`); },
		onError: (e: any) => toast(e.message, 'error'),
	});
	const test = async (p: 'anthropic' | 'gemini') => {
		setTests((t) => ({ ...t, [p]: 'testing' }));
		try { const r = await api('/settings/ai/test', { body: { provider: p, model: p === 'anthropic' ? f.anthropicModel : f.geminiModel, key: keys[p] || undefined } }); setTests((t) => ({ ...t, [p]: r })); }
		catch (e: any) { setTests((t) => ({ ...t, [p]: { ok: false, message: e.message } })); }
	};
	if (isLoading || !data || !f) return <Loader />;
	const eff = data.effective;
	const wanted = f.provider === 'env' ? null : f.provider;
	const missingKey = (wanted === 'anthropic' || wanted === 'gemini') && !data.keys[wanted].set && !keys[wanted as 'anthropic' | 'gemini'];
	const provBlock = (p: 'gemini' | 'anthropic') => {
		const k = data.keys[p];
		const t = tests[p];
		const models = data.models[p] as { id: string; label: string; note: string }[];
		const custom = !models.some((m) => m.id === f[`${p}Model`]);
		return (
			<Card key={p} title={p === 'gemini' ? 'Gemini (Google)' : 'Claude (Anthropic)'} accent={p === 'gemini' ? COLORS.blue : COLORS.amber} style={{ opacity: f.provider === p || f.provider === 'env' ? 1 : 0.75 }}
				sub={p === 'gemini' ? <>Key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com</a> → Get API key</> : <>Key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a> → API keys</>}>
				<div className="col gap-12">
					<div className="field"><label>Model</label>
						<select className="input" value={custom ? '__other' : f[`${p}Model`]} onChange={(e) => setF({ ...f, [`${p}Model`]: e.target.value === '__other' ? '' : e.target.value })}>
							{models.map((m) => <option key={m.id} value={m.id}>{m.label}: {m.note}</option>)}
							<option value="__other">Another model…</option>
						</select>
						{custom && <input className="input mt-8" placeholder={p === 'gemini' ? 'e.g. gemini-3.6-flash' : 'e.g. claude-sonnet-5-5'} value={f[`${p}Model`]} onChange={(e) => setF({ ...f, [`${p}Model`]: e.target.value })} aria-label="Model name" />}
					</div>
					<div className="field"><label>API key</label>
						<input className="input mono" type="password" autoComplete="off" placeholder={k.set ? `Saved (${k.source === 'env' ? 'from .env' : 'in Settings'}, ending ${k.hint}). Type a new key to replace it` : 'Paste the key'} value={keys[p]} onChange={(e) => setKeys({ ...keys, [p]: e.target.value.trim() })} />
						<span className="hint">Stored encrypted on this server and never shown again. {k.source === 'settings' && <button className="btn ghost sm" style={{ padding: 0, height: 'auto' }} onClick={() => save.mutate({ [`${p}Key`]: null })}>Remove the saved key</button>}</span>
					</div>
					<div className="row gap-8">
						<button className="btn sm" onClick={() => test(p)} disabled={t === 'testing'}><MdWifiTethering /> {t === 'testing' ? 'Testing…' : 'Test the key and model'}</button>
						{t && t !== 'testing' && <span className="small row gap-4" style={{ color: t.ok ? 'var(--green)' : 'var(--red)' }}>{t.ok ? <MdCheckCircle /> : <MdErrorOutline />} {t.message}</span>}
					</div>
				</div>
			</Card>
		);
	};
	return (
		<div className="col gap-16">
			<Card title="AI used by Gita Mail" accent={COLORS.purple}
				sub="Analysis of new email, Rewrite properly and Mail Sage use the AI chosen here. Changes apply at once, no restart needed. Nothing is ever sent automatically, whichever AI is chosen."
				actions={<button className="btn primary" disabled={save.isPending || missingKey} title={missingKey ? 'Enter the key for this provider first' : undefined} onClick={() => save.mutate({})}><MdSave /> Save</button>}>
				<div className="small mb-16">Now using: <b>{NAME[eff.provider] || eff.provider}</b>{eff.provider !== 'heuristic' && <> · <span className="mono">{eff.model}</span></>}
					{data.updatedAt && <span className="faint"> · changed {fmtDateTime(data.updatedAt)}{data.updatedBy ? ` by ${data.updatedBy}` : ''}</span>}</div>
				<div className="grid g-2" style={{ gap: 10 }}>
					{PROVIDERS.map((p) => (
						<label key={p.v} className={`choice ${f.provider === p.v ? 'on' : ''}`}>
							<input type="radio" name="ai-provider" checked={f.provider === p.v} onChange={() => setF({ ...f, provider: p.v })} />
							<span><b>{p.l}</b><br /><span className="xs faint">{p.d}</span>
								{p.v === 'env' && <><br /><span className="xs faint">.env now says: {data.env.provider || 'not set'}{data.env.provider === 'gemini' && data.env.geminiModel ? ` · ${data.env.geminiModel}` : data.env.provider === 'anthropic' && data.env.anthropicModel ? ` · ${data.env.anthropicModel}` : ''}</span></>}</span>
						</label>
					))}
				</div>
				{missingKey && <div className="small mt-8" style={{ color: 'var(--amber)' }}>Enter the {NAME[wanted!]} key below before saving, or the rules engine is used.</div>}
				<div className="mt-16"><Switch checked={f.analyseAll} onChange={(v) => setF({ ...f, analyseAll: v })} label="Analyse every email with the AI, automated notifications (newsletters, payment and delivery messages) too" /></div>
			</Card>
			<Coverage />
			<div className="grid g-2">{provBlock('gemini')}{provBlock('anthropic')}</div>
		</div>
	);
}

/** How many threads the AI and the rules engine analysed; threads the rules engine analysed are analysed again by the AI. */
function Coverage() {
	const toast = useToast();
	const qc = useQueryClient();
	const { data } = useQuery({ queryKey: ['ai-coverage'], queryFn: () => api('/settings/ai/coverage'), refetchInterval: 15_000 });
	const go = useMutation({ mutationFn: () => api('/settings/ai/reanalyse', { body: {} }), onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ['ai-coverage'] }); toast(`${r.queued} threads queued for the AI; they are analysed in the background, newest and those awaiting a reply first`); }, onError: (e: any) => toast(e.message, 'error') });
	if (!data) return null;
	const total = data.by_ai + data.by_rules;
	const pct = total ? Math.round((100 * data.by_ai) / total) : 0;
	return (
		<Card title="Analysis by AI" accent={COLORS.teal}
			sub="The rules engine is only a stand-in: every thread it analysed (because there was no AI key, the AI was unavailable, or it was an automated notification) is analysed again by the AI in the background. Replies someone has edited and groups set by hand are kept."
			actions={<button className="btn sm" disabled={go.isPending || !data.aiOn || !data.waiting_for_ai} onClick={() => go.mutate()}><MdAutorenew /> {go.isPending ? 'Queuing…' : 'Analyse them with AI now'}</button>}>
			<div className="row gap-16 wrap small">
				<span><b>{total.toLocaleString('en-IN')}</b> threads analysed</span>
				<span style={{ color: 'var(--green)' }}><b>{data.by_ai.toLocaleString('en-IN')}</b> by the AI ({pct}%)</span>
				<span style={{ color: data.by_rules ? 'var(--amber)' : undefined }}><b>{data.by_rules.toLocaleString('en-IN')}</b> by the rules engine</span>
				{data.new > 0 && <span><b>{data.new.toLocaleString('en-IN')}</b> new, not analysed yet</span>}
			</div>
			<div className="progress mt-8" aria-label={`${pct}% analysed by AI`}><div style={{ width: `${pct}%` }} /></div>
			<div className="xs faint mt-8">
				{!data.aiOn ? 'No AI is set up, so nothing can be analysed again yet: choose Gemini or Claude above and save its key.'
					: data.paused ? 'The AI is paused (a quota or key problem); analysis continues by itself once it is available again.'
						: data.waiting_for_ai ? `${data.waiting_for_ai.toLocaleString('en-IN')} waiting for the AI${data.retry_later ? `, ${data.retry_later.toLocaleString('en-IN')} of them tried in the last 30 minutes and retried later` : ''}. They are worked through in the background, newest and those awaiting a reply first.`
							: 'Every thread has been analysed by the AI.'}
				{!data.analyseAll && data.by_rules > data.waiting_for_ai ? ` Automated notifications stay with the rules engine (switched off above).` : ''}
			</div>
		</Card>
	);
}
