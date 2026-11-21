/** Settings → AI (provider, model, keys) and the signature previews (Settings → Reply drafts, and each reply). */
import { HttpError, type Router } from '../http';
import { one } from '../db';
import { audit } from '../audit';
import { requireRole } from '../auth';
import { getOrg } from '../settings';
import { aiConfig, describeAiConfig, loadAiConfig, saveAiConfig, testAi, MODELS } from '../ai/config';
import { aiModel, aiProvider, clearAiPause, rulesRequested } from '../ai/llm';
import { stripOk } from '../drafts';
import { analysisCoverage, queueRulesForAi } from '../analyze';
import { outgoingFor, previewHtml, sampleOutgoing, signatureSettings } from '../email/signature';

export function registerAi(r: Router, deps: { kickWorker: () => Promise<unknown> }) {
	r.get('/api/settings/ai', async (ctx) => {
		requireRole(ctx.user, 'admin');
		const c = await loadAiConfig(true);
		return { ...describeAiConfig(c), effective: { provider: aiProvider(), model: aiModel(), rules: rulesRequested() } };
	});
	r.put('/api/settings/ai', async (ctx) => {
		requireRole(ctx.user, 'admin');
		const b = ctx.body || {};
		let c;
		try {
			c = await saveAiConfig({ provider: b.provider, anthropicModel: b.anthropicModel, geminiModel: b.geminiModel, anthropicKey: b.anthropicKey, geminiKey: b.geminiKey, analyseAll: b.analyseAll }, ctx.user!.email);
		} catch (e: any) { throw new HttpError(400, e.message); }
		await clearAiPause();
		// with an AI now available, the threads the rules engine analysed are analysed again straight away
		if (aiProvider() !== 'heuristic') { await queueRulesForAi(ctx.user!.orgId); deps.kickWorker().catch(() => {}); }
		// the keys themselves are never written to the audit log
		await audit(ctx, 'settings.ai', null, null, { provider: c.provider, anthropicModel: c.anthropicModel, geminiModel: c.geminiModel, anthropicKey: b.anthropicKey === null ? 'removed' : b.anthropicKey ? 'changed' : undefined, geminiKey: b.geminiKey === null ? 'removed' : b.geminiKey ? 'changed' : undefined });
		return { ...describeAiConfig(c), effective: { provider: aiProvider(), model: aiModel(), rules: rulesRequested() } };
	});
	r.get('/api/settings/ai/coverage', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		return analysisCoverage(ctx.user!.orgId);
	});
	r.post('/api/settings/ai/reanalyse', async (ctx) => {
		requireRole(ctx.user, 'admin');
		if (aiProvider() === 'heuristic') throw new HttpError(400, 'Choose Claude or Gemini and save its key first');
		const n = await queueRulesForAi(ctx.user!.orgId);
		await clearAiPause();
		await audit(ctx, 'analysis.reanalyse_with_ai', null, null, { threads: n });
		deps.kickWorker().catch(() => {});
		return { queued: n };
	});
	r.post('/api/settings/ai/test', async (ctx) => {
		requireRole(ctx.user, 'admin');
		const b = ctx.body || {};
		const provider = b.provider === 'anthropic' ? 'anthropic' : b.provider === 'gemini' ? 'gemini' : null;
		if (!provider) throw new HttpError(400, 'Choose Claude or Gemini to test');
		const c = aiConfig();
		const model = String(b.model || (provider === 'anthropic' ? c.anthropicModel || process.env.ANTHROPIC_MODEL || MODELS.anthropic[0].id : c.geminiModel || process.env.GEMINI_MODEL || MODELS.gemini[0].id)).trim();
		const key = String(b.key || '').trim() || (provider === 'anthropic' ? c.anthropicKey || process.env.ANTHROPIC_API_KEY || '' : c.geminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
		return testAi(provider, model, key);
	});

	// signature previews
	r.post('/api/settings/signature/preview', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const org = await getOrg(ctx.user!.orgId);
		const b = ctx.body || {};
		const s = signatureSettings({ ...(org.settings as any), ...['replySignature', 'replySignatureHi', 'replyLogo', 'replyFooter'].reduce((a, k) => (b[k] === undefined ? a : { ...a, [k]: b[k] }), {}) });
		return { html: previewHtml(sampleOutgoing(s, !!b.hindi, org.name).html) };
	});
	r.get('/api/drafts/:id/preview', async (ctx) => {
		requireRole(ctx.user, 'viewer');
		const d = await one<any>('select conversation_id, body from reply_drafts where id=$1 and org_id=$2', [Number(ctx.params.id), ctx.user!.orgId]);
		if (!d) throw new HttpError(404, 'Draft not found');
		const out = await outgoingFor(ctx.user!.orgId, d.conversation_id, stripOk(d.body));
		return { html: previewHtml(out.html) };
	});
}
