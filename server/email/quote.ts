/**
 * Bulk orders and quotes: a bilingual (English and Hindi) PDF quotation built from the book list prices, the
 * discount slabs, the freight slabs and the bank details with the payment QR. It is attached to the reply
 * email; sending that reply moves the request to "Quote sent".
 */
import path from 'node:path';
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { one, q } from '../db';
import { HttpError } from '../http';
import { getOrg } from '../settings';
import { normCode } from '../master/books';
import { getMaster, quoteTotals, bankQr, round2 } from '../master/values';
import { currentStock } from '../stock/stock';
import { HQ_KEY } from '../directory';
import { GITAPRESS_LOGO_PNG_BASE64 } from '../assets';

export const STAGES = [
	{ key: 'received', label: 'Request received' },
	{ key: 'preparing', label: 'In preparation' },
	{ key: 'quote_sent', label: 'Quote sent' },
	{ key: 'confirmed', label: 'Confirmed' },
	{ key: 'paid', label: 'Payment received' },
	{ key: 'dispatched', label: 'Dispatched' },
	{ key: 'closed', label: 'Closed' },
];
export const STAGE_KEYS = STAGES.map((s) => s.key);

const FONT = path.resolve('server/static/fonts/NotoSansDevanagari-Regular.ttf');
const BOLD = path.resolve('server/static/fonts/NotoSansDevanagari-Bold.ttf');
const inr = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export interface QuoteItem { code: string; qty: number }

/** Prices, availability and totals for a list of books (the same rules as the reply). */
export async function priceItems(orgId: number, items: QuoteItem[], international = false) {
	const clean = items.map((i) => ({ code: normCode(i.code), qty: Math.max(1, Math.min(100000, Math.round(Number(i.qty) || 0))) })).filter((i) => i.code);
	if (!clean.length) throw new HttpError(400, 'Add at least one book with a quantity');
	if (clean.length > 200) throw new HttpError(400, 'A quote can have at most 200 lines');
	// a set code (e.g. CB003) can be added as a whole set: its books are listed one by one
	const sets = new Map((await q<any>('select set_code, codes from book_sets where org_id=$1', [orgId])).map((s) => [s.set_code, s.codes as string[]]));
	const expanded: QuoteItem[] = [];
	for (const i of clean) {
		const set = sets.get(i.code);
		const meta = await one<any>('select 1 from book_titles where org_id=$1 and code=$2 and coalesce(suchi_price, mrp) is not null', [orgId, i.code]);
		if (set && !meta) set.forEach((c) => expanded.push({ code: c, qty: i.qty }));
		else expanded.push(i);
	}
	const codes = [...new Set(expanded.map((i) => i.code))];
	const meta = new Map((await q<any>(`select code, name, hindi_title, suchi_title, size_en, coalesce(suchi_price, mrp)::float as price from book_titles where org_id=$1 and code = any($2::text[])`, [orgId, codes])).map((m) => [m.code, m]));
	const cur = await currentStock(orgId);
	const lines = expanded.map((i) => {
		const m = meta.get(i.code);
		const s = cur.books.get(i.code);
		const price = m?.price ?? s?.locs.get(HQ_KEY)?.price ?? null;
		return {
			code: i.code, qty: i.qty, title: m?.name || s?.name || `Code ${i.code}`, hindi: m?.hindi_title || (m?.suchi_title && /[ऀ-ॿ]/.test(m.suchi_title) ? m.suchi_title : null),
			size: m?.size_en || null, price, amount: price === null ? null : round2(price * i.qty), available: cur.asOf[HQ_KEY] ? Math.round(s?.locs.get(HQ_KEY)?.qty || 0) : null,
		};
	});
	const missing = lines.filter((l) => l.price === null).map((l) => l.code);
	const value = lines.reduce((a, l) => a + (l.amount || 0), 0);
	const totals = quoteTotals(await getMaster(orgId, 'discount'), await getMaster(orgId, 'freight'), value, { discount: true, international });
	return { lines, totals, missing, stockAsOf: cur.asOf[HQ_KEY] || null };
}

/** The quotation PDF. */
export async function quotePdf(orgId: number, input: { quoteNo: string; date: Date; to: { name: string; email: string }; subject: string; international: boolean; priced: Awaited<ReturnType<typeof priceItems>> }): Promise<Buffer> {
	const org = await getOrg(orgId);
	const bank = await getMaster(orgId, 'bank');
	const qr = await bankQr(orgId);
	const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Quotation ${input.quoteNo}`, Author: org.name } });
	const chunks: Buffer[] = [];
	doc.on('data', (c) => chunks.push(c));
	const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
	const hasFont = fs.existsSync(FONT);
	if (hasFont) { doc.registerFont('body', FONT); doc.registerFont('bold', BOLD); }
	const f = (bold = false) => doc.font(hasFont ? (bold ? 'bold' : 'body') : bold ? 'Helvetica-Bold' : 'Helvetica');
	const W = doc.page.width - 80;

	// header
	try { doc.image(Buffer.from(GITAPRESS_LOGO_PNG_BASE64, 'base64'), 40, 36, { width: 52 }); } catch { /* no logo */ }
	f(true).fontSize(16).fillColor('#7a1f1f').text('Gita Press, Gorakhpur', 104, 40);
	f().fontSize(9).fillColor('#444').text('Gobind Bhawan Karyalaya · गीताप्रेस, गोरखपुर — 273005 · booksales@gitapress.org · www.gitapress.org', 104, 60);
	f(true).fontSize(14).fillColor('#111').text('Quotation  /  कोटेशन', 40, 104);
	f().fontSize(9.5).fillColor('#333');
	const dt = input.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
	const valid = new Date(input.date.getTime() + 30 * 86400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
	doc.text(`Quote no. / कोटेशन संख्या: ${input.quoteNo}`, 40, 126).text(`Date / दिनांक: ${dt}    Valid until / मान्य: ${valid}`);
	doc.text(`To / प्रति: ${input.to.name || ''}${input.to.email ? ` <${input.to.email}>` : ''}`).text(`Subject / विषय: ${input.subject}`.slice(0, 160));

	// table
	const cols = [{ h: 'Code\nकोड', w: 46 }, { h: 'Book / पुस्तक', w: W - 46 - 50 - 60 - 76 - 70 }, { h: 'Qty\nसंख्या', w: 50, r: true }, { h: 'Price\nमूल्य', w: 60, r: true }, { h: 'Amount\nराशि', w: 76, r: true }, { h: 'In stock\nउपलब्ध', w: 70, r: true }];
	let y = doc.y + 12;
	const row = (cells: string[], bold = false, fill?: string) => {
		const heights = cells.map((c, i) => { f(bold).fontSize(8.5); return doc.heightOfString(c, { width: cols[i].w - 8 }); });
		const h = Math.max(...heights) + 8;
		if (y + h > doc.page.height - 60) { doc.addPage(); y = 40; }
		if (fill) doc.rect(40, y, W, h).fill(fill);
		let x = 40;
		cells.forEach((c, i) => { f(bold).fontSize(8.5).fillColor('#111').text(c, x + 4, y + 4, { width: cols[i].w - 8, align: (cols[i] as any).r ? 'right' : 'left' }); x += cols[i].w; });
		doc.moveTo(40, y + h).lineTo(40 + W, y + h).strokeColor('#ddd').lineWidth(0.5).stroke();
		y += h;
	};
	row(cols.map((c) => c.h), true, '#f3ece4');
	for (const l of input.priced.lines) {
		row([l.code, `${l.title}${l.hindi ? `\n${l.hindi}` : ''}${l.size ? ` (${l.size})` : ''}`, String(l.qty), inr(l.price), inr(l.amount), l.available === null ? '–' : l.available >= l.qty ? 'Yes / हाँ' : l.available > 0 ? `${l.available} only` : 'No / नहीं']);
	}
	const t = input.priced.totals;
	y += 8;
	const total = (label: string, value: string, bold = false) => {
		if (y > doc.page.height - 80) { doc.addPage(); y = 40; }
		f(bold).fontSize(bold ? 10.5 : 9.5).fillColor('#111').text(label, 40, y, { width: W - 120, align: 'right' }).text(value, 40 + W - 110, y, { width: 110, align: 'right' });
		y += bold ? 18 : 15;
	};
	total('Book value / पुस्तकों का मूल्य', inr(t.bookValue));
	total(`Discount / छूट (${t.discount.label})`, t.discount.amount ? `− ${inr(t.discount.amount)}` : inr(0));
	if (input.international) total('International shipping / विदेश भेजने का खर्च', 'Will be confirmed / सूचित किया जाएगा');
	else total('Postage / डाक खर्च', t.postage === 0 ? 'Free / निःशुल्क' : inr(t.postage));
	total(input.international ? 'Total (before shipping) / कुल' : 'Total payable / कुल देय राशि', inr(t.total), true);
	if (input.priced.missing.length) { f().fontSize(8.5).fillColor('#a33').text(`Price to be confirmed for: ${input.priced.missing.join(', ')}`, 40, y); y = doc.y + 6; }

	// bank details with QR
	if (y > doc.page.height - 200) { doc.addPage(); y = 40; }
	y += 10;
	f(true).fontSize(11).fillColor('#111').text('Bank details for payment / भुगतान हेतु बैंक विवरण', 40, y);
	y = doc.y + 4;
	const bankLines = [
		['Beneficiary / लाभार्थी', `${bank.beneficiary}${bank.beneficiaryNote ? ` (${bank.beneficiaryNote})` : ''}`], ['Account no. / खाता संख्या', bank.account], ['Bank / बैंक', bank.bank],
		['Branch / शाखा', bank.branch], ['IFSC', bank.ifsc], ...(input.international && bank.swift ? [['SWIFT / BIC', bank.swift]] : []), ...(bank.upi ? [['UPI', bank.upi]] : []),
	];
	const top = y;
	for (const [k, v] of bankLines) { f().fontSize(9).fillColor('#555').text(k, 40, y, { width: 130 }); f(true).fontSize(9).fillColor('#111').text(v, 172, y, { width: W - 132 - 130 }); y = Math.max(doc.y, y + 13); }
	if (qr) { try { doc.image(qr.bytes, 40 + W - 116, top, { width: 112 }); } catch { /* bad image */ } }
	y = Math.max(y, top + 118) + 6;
	f(true).fontSize(9).fillColor('#111').text('After paying, please send / भुगतान के बाद कृपया भेजें:', 40, y);
	f().fontSize(9).fillColor('#333');
	for (const a of bank.afterPaying) doc.text(`• ${a}`, 48);
	doc.moveDown(0.8);
	f().fontSize(8).fillColor('#666').text(
		`Prices as per the Gita Press code-wise catalogue. ${input.international ? 'Books are sent abroad only from Gorakhpur; shipping will be confirmed.' : 'Postage within India by book value; free above ₹1,000.'} Discount as per the Gita Press discount slabs${t.discount.amount ? '' : ' (from ₹2,001)'}. Availability is as of the latest stock upload${input.priced.stockAsOf ? ` (${input.priced.stockAsOf})` : ''} and may change.`,
		40, doc.y, { width: W },
	);
	doc.end();
	return done;
}

/** Builds and stores the quote for a bulk request; the reply draft gets the PDF as an attachment. */
export async function makeQuote(orgId: number, userId: number, bulkId: number, items: QuoteItem[]) {
	const b = await one<any>('select b.*, c.subject, c.primary_group from bulk_requests b join conversations c on c.id=b.conversation_id where b.id=$1 and b.org_id=$2', [bulkId, orgId]);
	if (!b) throw new HttpError(404, 'Bulk request not found');
	const international = b.primary_group === 'international';
	const priced = await priceItems(orgId, items, international);
	const last = await one<any>(`select from_name, from_address from emails where conversation_id=$1 and direction='inbound' order by sent_at desc limit 1`, [b.conversation_id]);
	const seq = (await one<any>(`select nextval('quote_seq')::int as n`))!.n;
	const now = new Date();
	const quoteNo = b.quote_no || `GP-Q-${now.getFullYear()}-${String(seq).padStart(4, '0')}`;
	const pdf = await quotePdf(orgId, { quoteNo, date: now, to: { name: last?.from_name || '', email: last?.from_address || '' }, subject: b.subject || 'Bulk order', international, priced });
	await q(
		`update bulk_requests set items=$2, totals=$3, value=$4, quote_no=$5, quote_pdf=$6, quote_at=now(), stage = case when stage='received' then 'preparing' else stage end, updated_at=now(), updated_by=$7 where id=$1`,
		[bulkId, JSON.stringify(priced.lines), JSON.stringify(priced.totals), priced.totals.total, quoteNo, pdf, userId],
	);
	// attach the PDF to the reply and mention it in the draft
	const d = await one<any>('select id, body, attachments from reply_drafts where conversation_id=$1', [b.conversation_id]);
	if (d) {
		const att = ((d.attachments || []) as any[]).filter((a) => a.kind !== 'quote').concat([{ kind: 'quote', bulkId, name: `Gita-Press-Quote-${quoteNo}.pdf` }]);
		const hindi = /[ऀ-ॿ]{6,}/.test(d.body);
		const note = hindi ? `कोटेशन ${quoteNo} संलग्न है (कुल देय राशि ${inr(priced.totals.total)})।` : `Please find attached quotation ${quoteNo} (total payable ${inr(priced.totals.total)}).`;
		const body = d.body.includes(quoteNo) ? d.body : d.body.replace(/\n\n(With regards|सादर शुभकामनाओं)/, `\n\n${note}\n\n$1`);
		await q(`update reply_drafts set attachments=$2, body=$3, updated_at=now() where id=$1`, [d.id, JSON.stringify(att), body === d.body ? `${d.body}\n\n${note}` : body]);
	}
	return { quoteNo, totals: priced.totals, lines: priced.lines, missing: priced.missing };
}
