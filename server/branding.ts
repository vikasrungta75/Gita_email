/**
 * The footer added to every reply when it is sent: the Gita Press logo, the website link and an address.
 * The address is the Gita Press branch in the reader's city when one is on file, otherwise the head office
 * in Gorakhpur. Branch addresses are kept in Settings → Reply drafts; a city is used only once its address
 * is filled in, so a reader is never sent an incomplete or guessed address.
 */
import { one } from './db';
import { getOrg } from './settings';
import { merged } from './profiles';
import { placeInText, resolveDirectory } from './directory';

export interface Branch { city: string; state: string; address: string; phone?: string; email?: string; address_hi?: string; key?: string }

export const WEBSITE = 'https://www.gitapress.org';
/** From gitapress.org/contactUs */
export const HEAD_OFFICE: Branch = {
	key: 'gorakhpur',
	city: 'Gorakhpur',
	state: 'Uttar Pradesh',
	address: 'Gita Press, P.O. Gita Press, Gorakhpur 273005, Uttar Pradesh, India',
	address_hi: 'गीताप्रेस, पो० गीताप्रेस, गोरखपुर 273005, उत्तर प्रदेश',
	phone: 'Books +91 92354 00244 · Kalyan +91 92354 00242',
	email: 'booksales@gitapress.org',
};

/** Branches from the official list with Settings corrections (server/directory.ts). Accepts org settings or an older saved list. */
export function branches(input?: Branch[] | Record<string, any>): Branch[] {
	const settings = Array.isArray(input) ? { branches: input } : input || {};
	return resolveDirectory(settings).filter((d) => !d.head_office).map((d) => ({
		key: d.key, city: d.city, state: d.state, address: `${d.address} ${d.pin}`, address_hi: `${d.address_hi} ${d.pin}`, phone: d.phones.join(', '), email: d.email || '',
	}));
}

/** The branch in the reader's city (address on file), else the head office. */
export function pickBranch(list: Branch[], place: { city?: string; address?: string }): { branch: Branch; why: string } {
	const key = placeInText(`${place.city || ''} ${place.address || ''}`);
	const b = key && key !== 'gorakhpur' ? list.find((x) => x.key === key && x.address.trim()) : null;
	if (b) return { branch: b, why: `the reader is in ${b.city}` };
	const known = place.city ? `there is no Gita Press branch in ${place.city}` : 'the reader\'s city is not known';
	return { branch: HEAD_OFFICE, why: key === 'gorakhpur' ? 'the reader is in Gorakhpur' : `${known}, so the head office is used` };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function footerParts(b: Branch, orgName = 'Gita Press, Gorakhpur') {
	const title = b === HEAD_OFFICE || b.city === 'Gorakhpur' ? orgName : `Gita Press, ${b.city} branch`;
	const text = ['', '--', title, b.address, b.address_hi && b.address_hi !== b.address ? b.address_hi : '', b.phone ? `Phone: ${b.phone}` : '', b.email ? `Email: ${b.email}` : '', WEBSITE].filter((x, i) => i < 2 || x).join('\n');
	const html = `<table cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid #e5e7eb;padding-top:12px;font-family:Arial,'Noto Sans','Noto Sans Devanagari',sans-serif;font-size:12.5px;line-height:1.5;color:#475569"><tr>
<td style="padding-right:12px;vertical-align:top"><img src="cid:gitapress-logo" width="48" height="46" alt="Gita Press" style="display:block"></td>
<td style="vertical-align:top"><b style="color:#0f172a;font-size:13.5px">${esc(title)}</b><br>${esc(b.address)}${b.address_hi && b.address_hi !== b.address ? `<br>${esc(b.address_hi)}` : ''}${b.phone ? `<br>Phone: ${esc(b.phone)}` : ''}${b.email ? `<br>Email: <a href="mailto:${esc(b.email)}" style="color:#4f46e5">${esc(b.email)}</a>` : ''}<br><a href="${WEBSITE}" style="color:#4f46e5">www.gitapress.org</a></td>
</tr></table>`;
	return { title, text, html };
}

/** The footer for a draft, chosen from the customer's city or address. */
export async function footerForConversation(orgId: number, conversationId: number) {
	const org = await getOrg(orgId);
	if ((org.settings as any).replyFooter === false) return null;
	const cu = await one<any>('select cu.profile, cu.profile_manual from conversations c left join customers cu on cu.id=c.customer_id where c.id=$1', [conversationId]);
	const p = cu ? merged(cu) : {};
	const { branch, why } = pickBranch(branches(org.settings as any), { city: p.city, address: p.address });
	return { branch, why, ...footerParts(branch, org.name) };
}
