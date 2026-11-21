/**
 * The AI provider chosen in Settings → AI: Claude (Anthropic), Gemini (Google) or the rules engine only, the model
 * for each, and API keys entered there (encrypted with ENCRYPTION_KEY; never sent back to the browser). What is set
 * here takes priority over .env; anything left empty falls back to .env, so an existing installation keeps working.
 *
 * The choice is held in memory (llm.ts reads it on every call) and reloaded every minute, so a change made in
 * Settings applies at once without a restart.
 */
import { one, q } from '../db';
import { encrypt, decrypt } from '../crypto';

export type ChosenProvider = 'env' | 'anthropic' | 'gemini' | 'heuristic';
export interface AiConfig { provider: ChosenProvider; anthropicModel: string; geminiModel: string; anthropicKey: string; geminiKey: string; updatedAt?: string; updatedBy?: string }

export const MODELS = {
	anthropic: [
		{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'basic: fastest, lowest cost' },
		{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'better drafts and analysis' },
		{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'most capable, highest cost' },
	],
	gemini: [
		{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', note: 'basic: fastest, lowest cost' },
		{ id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', note: 'better drafts and analysis' },
		{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: 'most capable Flash model' },
	],
};

const EMPTY: AiConfig = { provider: 'env', anthropicModel: '', geminiModel: '', anthropicKey: '', geminiKey: '' };
let current: AiConfig = { ...EMPTY };
let loadedAt = 0;

/** The in-memory choice (llm.ts). */
export const aiConfig = (): AiConfig => current;

const KEY = 'ai';
async function row(): Promise<any> {
	return (await one<any>('select value from app_settings where key=$1', [KEY]).catch(() => null))?.value || {};
}

export async function loadAiConfig(force = false): Promise<AiConfig> {
	if (!force && Date.now() - loadedAt < 60_000) return current;
	const v = await row();
	const dec = (s?: string) => { if (!s) return ''; try { return decrypt(s); } catch { return ''; } };
	current = {
		provider: (['env', 'anthropic', 'gemini', 'heuristic'] as const).includes(v.provider) ? v.provider : 'env',
		anthropicModel: String(v.anthropicModel || ''),
		geminiModel: String(v.geminiModel || ''),
		anthropicKey: dec(v.anthropicKey),
		geminiKey: dec(v.geminiKey),
		updatedAt: v.updatedAt,
		updatedBy: v.updatedBy,
	};
	loadedAt = Date.now();
	return current;
}

/** Keys: a new value replaces the saved one, '' keeps it, null removes it. */
export async function saveAiConfig(input: { provider?: string; anthropicModel?: string; geminiModel?: string; anthropicKey?: string | null; geminiKey?: string | null }, by: string): Promise<AiConfig> {
	const v = await row();
	const next: any = { ...v };
	if (input.provider !== undefined) {
		if (!['env', 'anthropic', 'gemini', 'heuristic'].includes(input.provider)) throw new Error('Unknown AI provider');
		next.provider = input.provider;
	}
	const model = (m: unknown) => { const s = String(m ?? '').trim(); if (s && !/^[a-z0-9][a-z0-9._:/-]{1,80}$/i.test(s)) throw new Error(`"${s}" is not a model name`); return s; };
	if (input.anthropicModel !== undefined) next.anthropicModel = model(input.anthropicModel);
	if (input.geminiModel !== undefined) next.geminiModel = model(input.geminiModel);
	for (const k of ['anthropicKey', 'geminiKey'] as const) {
		const val = input[k];
		if (val === null) delete next[k];
		else if (typeof val === 'string' && val.trim()) {
			const key = val.trim();
			if (key.length < 20 || /\s/.test(key)) throw new Error('That does not look like an API key: paste it with no spaces or quotes');
			next[k] = encrypt(key);
		}
	}
	next.updatedAt = new Date().toISOString();
	next.updatedBy = by;
	await q('insert into app_settings (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()', [KEY, JSON.stringify(next)]);
	return loadAiConfig(true);
}

/** What the Settings page shows: never the keys themselves, only where each comes from and its last four characters. */
export function describeAiConfig(c: AiConfig) {
	const key = (saved: string, env: string | undefined) => (saved ? { set: true, source: 'settings', hint: `…${saved.slice(-4)}` } : env ? { set: true, source: 'env', hint: `…${env.slice(-4)}` } : { set: false, source: null, hint: '' });
	return {
		provider: c.provider,
		anthropicModel: c.anthropicModel,
		geminiModel: c.geminiModel,
		keys: { anthropic: key(c.anthropicKey, process.env.ANTHROPIC_API_KEY), gemini: key(c.geminiKey, process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) },
		env: { provider: process.env.AI_PROVIDER || '', anthropicModel: process.env.ANTHROPIC_MODEL || '', geminiModel: process.env.GEMINI_MODEL || '' },
		updatedAt: c.updatedAt || null,
		updatedBy: c.updatedBy || null,
		models: MODELS,
	};
}

/** Checks a key and model with the provider (no email content is sent). */
export async function testAi(provider: 'anthropic' | 'gemini', model: string, key: string): Promise<{ ok: boolean; message: string }> {
	if (!key) return { ok: false, message: 'No API key: enter one, or set it in .env' };
	try {
		if (provider === 'anthropic') {
			const res = await fetch(`${(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/models/${encodeURIComponent(model)}`, {
				headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}) },
				signal: AbortSignal.timeout(15000),
			});
			if (res.ok) return { ok: true, message: `Claude accepted the key; ${model} is available` };
			if (res.status === 401 || res.status === 403) return { ok: false, message: 'Claude rejected the key (401/403). Create a new key at console.anthropic.com' };
			if (res.status === 404) return { ok: false, message: `Claude has no model "${model}". Choose one from the list` };
			return { ok: false, message: `Claude answered ${res.status}` };
		}
		const res = await fetch(`${(process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')}/models/${encodeURIComponent(model)}`, {
			headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000),
		});
		if (res.ok) return { ok: true, message: `Gemini accepted the key; ${model} is available` };
		if (res.status === 404) return { ok: false, message: `Gemini has no model "${model}". Choose one from the list` };
		if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, message: `Gemini rejected the key (${res.status}). Create a new key at aistudio.google.com` };
		return { ok: false, message: `Gemini answered ${res.status}` };
	} catch (e: any) {
		return { ok: false, message: `Could not reach ${provider === 'anthropic' ? 'Anthropic' : 'Google'}: ${e.message}` };
	}
}
