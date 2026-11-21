/**
 * The signature of every reply, as it is sent and as it is previewed.
 *
 * Settings → Reply drafts holds the signature in English and in Hindi (the draft uses the reader's language), whether
 * the Gita Press logo is shown, and whether the address of the reader's branch (or the head office), phone, email and
 * website are added. In the HTML email the signature becomes one block: the closing line ("Regards,") stays in the
 * text, and the logo sits beside the signature lines and the address. The plain-text part keeps the same words.
 *
 * If the signature was edited out of a draft, nothing is moved: the logo and address are added under the reply.
 */
import { getOrg } from '../settings';
import { footerForConversation, footerParts, HEAD_OFFICE, WEBSITE, type Branch } from '../branding';
import { GITAPRESS_LOGO_PNG_BASE64 } from '../assets';

export const DEFAULT_SIGNATURE = 'Regards,\nCustomer Service\nGita Press, Gorakhpur';
export const DEFAULT_SIGNATURE_HI = 'सादर,\nग्राहक सेवा\nगीताप्रेस, गोरखपुर';
export const CLOSING = /^(regards|with regards|kind regards|warm regards|best regards|yours( sincerely| faithfully)?|thanks|thank you|sincerely|सादर|धन्यवाद|भवदीय|शुभकामनाओं सहित|सादर शुभकामनाओं सहित)[,.!]?$/i;
export const LOGO_CID = 'gitapress-logo';

export interface SignatureSettings { en: string; hi: string; logo: boolean; footer: boolean }

export function signatureSettings(settings: Record<string, any>): SignatureSettings {
	return {
		en: String(settings.replySignature || '').trim() || DEFAULT_SIGNATURE,
		hi: String(settings.replySignatureHi || '').trim() || DEFAULT_SIGNATURE_HI,
		logo: settings.replyLogo !== false,
		footer: settings.replyFooter !== false,
	};
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const PLACEHOLDER = /\[\[\s*provide\s*:\s*(.*?)\]\](?!\])/gis;
const FONT = `font-family:Arial,'Noto Sans','Noto Sans Devanagari',sans-serif`;
/** Plain text → HTML: escaped, line breaks kept, web addresses made into links. */
export const textToHtml = (text: string) => esc(text)
	.replace(PLACEHOLDER, (_m, p) => `<span style="background:#fff176">[provide: ${p.trim()}]</span>`)
	.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (u) => `<a href="${u}" style="color:#4f46e5">${u}</a>`)
	.replace(/\r?\n/g, '<br>');

const norm = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n');

/** Finds the signature at the end of the body. Returns the body without it, and the signature split at its closing line. */
export function splitBody(body: string, sigs: string[]): { main: string; closing: string | null; lines: string[] } | null {
	const lines = body.replace(/\s+$/, '').split(/\r?\n/);
	for (const sig of sigs) {
		const s = norm(sig).split('\n');
		if (!s.length) continue;
		const tail = lines.slice(-s.length).map((l) => l.trim());
		if (tail.join('\n') !== s.join('\n')) continue;
		const main = lines.slice(0, -s.length).join('\n').replace(/\s+$/, '');
		const closing = CLOSING.test(s[0]) ? s[0] : null;
		return { main, closing, lines: closing ? s.slice(1) : s };
	}
	return null;
}

/** The signature block: logo beside the signature lines and the branch details. */
export function signatureBlock(o: { lines: string[]; branch: Branch | null; logo: boolean; orgName?: string }): string {
	const b = o.branch;
	const details: string[] = [];
	if (b) {
		const f = footerParts(b, o.orgName);
		const title = f.title;
		// the branch name is shown unless the signature already names it
		if (!o.lines.some((l) => l.replace(/\s+/g, ' ').toLowerCase() === title.toLowerCase())) details.push(`<b style="color:#0f172a">${esc(title)}</b>`);
		details.push(esc(b.address));
		if (b.address_hi && b.address_hi !== b.address) details.push(esc(b.address_hi));
		if (b.phone) details.push(`Phone: ${esc(b.phone)}`);
		if (b.email) details.push(`Email: <a href="mailto:${esc(b.email)}" style="color:#4f46e5">${esc(b.email)}</a>`);
		details.push(`<a href="${WEBSITE}" style="color:#4f46e5">www.gitapress.org</a>`);
	}
	const sig = o.lines.map((l, i) => (i === 0 ? `<b style="color:#0f172a;font-size:14px">${esc(l)}</b>` : esc(l))).join('<br>');
	const text = [sig ? `<div style="color:#1e1205;font-size:13.5px;line-height:1.5">${sig}</div>` : '', details.length ? `<div style="color:#475569;font-size:12.5px;line-height:1.5;margin-top:${sig ? 6 : 0}px">${details.join('<br>')}</div>` : ''].join('');
	if (!text && !o.logo) return '';
	const logo = o.logo ? `<td style="padding-right:14px;vertical-align:top;${sig ? '' : 'padding-top:2px;'}"><img src="cid:${LOGO_CID}" width="56" height="54" alt="Gita Press" style="display:block;border:0"></td>` : '';
	const rule = o.logo ? 'border-left:2px solid #f59e0b;padding-left:14px;' : '';
	return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin-top:10px;${FONT}"><tr>${logo}<td style="vertical-align:top;${rule}">${text}</td></tr></table>`;
}

export interface Outgoing { text: string; html: string; inline: { cid: string; contentType: string; base64: string; filename: string }[] }

/** The reply as it is sent: plain text and HTML with the signature block, and the logo as an inline image. */
export function composeOutgoing(body: string, s: SignatureSettings, branch: Branch | null, orgName?: string): Outgoing {
	const split = splitBody(body, [s.en, s.hi, DEFAULT_SIGNATURE, DEFAULT_SIGNATURE_HI]);
	const footerText = branch ? footerParts(branch, orgName).text : '';
	const text = footerText ? `${body.replace(/\s+$/, '')}\n${footerText}` : body;
	const wrap = (inner: string) => `<div style="${FONT};font-size:14px;line-height:1.55;color:#1e1205">${inner}</div>`;
	let html: string;
	if (split) {
		const main = textToHtml(split.main) + (split.closing ? `<br><br>${esc(split.closing)}` : '');
		html = wrap(main + signatureBlock({ lines: split.lines, branch, logo: s.logo, orgName }));
	} else {
		const block = signatureBlock({ lines: [], branch, logo: s.logo, orgName });
		html = wrap(textToHtml(body) + (block ? `<div style="margin-top:18px;border-top:1px solid #e5e7eb;padding-top:4px">${block}</div>` : ''));
	}
	const usesLogo = html.includes(`cid:${LOGO_CID}`);
	return { text, html, inline: usesLogo ? [{ cid: LOGO_CID, contentType: 'image/png', base64: GITAPRESS_LOGO_PNG_BASE64, filename: 'gitapress-logo.png' }] : [] };
}

/** The reply for one conversation, with that reader's branch. */
export async function outgoingFor(orgId: number, conversationId: number, body: string): Promise<Outgoing> {
	const org = await getOrg(orgId);
	const s = signatureSettings(org.settings as any);
	const footer = s.footer ? await footerForConversation(orgId, conversationId).catch(() => null) : null;
	return composeOutgoing(body, s, footer?.branch || null, org.name);
}

/** For previews in the browser: the inline logo becomes the logo the web app serves. */
export const previewHtml = (html: string) => html.replace(new RegExp(`cid:${LOGO_CID}`, 'g'), '/brand/gitapress-logo.png');

/** A sample reply for the Settings preview. */
export function sampleOutgoing(s: SignatureSettings, hindi: boolean, orgName?: string): Outgoing {
	const sig = hindi ? s.hi : s.en;
	const body = hindi
		? `आदरणीय राम जी,\n\nआपका ऑर्डर GPHO_349350 भेज दिया गया है। ट्रैकिंग संख्या: CU240611607IN (इंडिया पोस्ट)।\n\n${sig}`
		: `Dear Ram ji,\n\nYour order GPHO_349350 has been dispatched. Tracking number: CU240611607IN (India Post), https://www.indiapost.gov.in\n\n${sig}`;
	return composeOutgoing(body, s, s.footer ? HEAD_OFFICE : null, orgName);
}
