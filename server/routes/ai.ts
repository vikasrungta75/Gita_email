/** Settings → AI (provider, model, keys) and the signature previews (Settings → Reply drafts, and each reply). */
import { HttpError, type Router } from '../http';
import { one } from '../db';
import { audit } from '../audit';
import { requireRole } from '../auth';
import { getOrg } from '../settings';
import { aiConfig, describeAiConfig, loadAiConfig, saveAiConfig, testAi, MODELS } from '../ai/config';
import { aiModel, aiProvider, clearAiPause } from '../ai/llm';
import { stripOk } from '../drafts';
import { outgoingFor, previewHtml, sampleOutgoing, signatureSettings } from '../email/signature';

export function registerAi(r: Router) {
	r.get('/api/settings/ai', async (ctx) => {
		requireRole(ctx.user, 'admin');
		const c = await loadAiConfig(true);
		return { ...describeAiConfig(c), effective: { provider: aiProvider(), model: aiModel() } };
	});
	r.put('/api/settings/ai', async (ctx) => {
		requireRole(ctx.user, 'admin');
		const b = ctx.body || {};
		let c;
		try {
			c = await saveAiConfig({ provider: b.provider, anthropicModel: b.anthropicModel, geminiModel: b.geminiModel, anthropicKey: b.anthropicKey, geminiKey: b.geminiKey }, ctx.user!.email);
		} catch (e: any) { throw new HttpError(400, e.message); }
		await clearAiPause();
		// the keys themselves are never written to the audit log
		await audit(ctx, 'settings.ai', null, null, { provider: c.provider, anthropicModel: c.anthropicModel, geminiModel: c.geminiModel, anthropicKey: b.anthropicKey === null ? 'removed' : b.anthropicKey ? 'changed' : undefined, geminiKey: b.geminiKey === null ? 'removed' : b.geminiKey ? 'changed' : undefined });
		return { ...describeAiConfig(c), effective: { provider: aiProvider(), model: aiModel() } };
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
