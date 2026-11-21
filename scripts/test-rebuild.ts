/**
 * Tests for the rebuild: pricing rules, the book list (Suchi), Kalyan customer uploads, email classification,
 * facts, questions and completeness, standing answers, the send queue (never automatic), bulk quotes and
 * "delete everything and rebuild". Needs DATABASE_URL to a test database: npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ensureSchema, getPool, one, q } from '../server/db';
import { defaultOrgId, issueSession } from '../server/auth';
import { getOrg } from '../server/settings';
import { ingestMessages } from '../server/ingest';
import { analysePending } from '../server/analyze';
import { DEFAULTS, postageFor, discountFor, quoteTotals, saveMaster, getMaster } from '../server/master/values';
import { toEntry, parseSuchiPdf, applySuchi, parseSuchiTable, SUCHI_COLUMNS, suchiRows } from '../server/master/suchi';
import { stateByPrefix, checkHeader } from '../server/kalyan/customers';
import { startBatch, addRows, finishBatch, confirmBatch, processBatches } from '../server/uploads/batches';
import { enrichPending, enrichConversation, orderIdsIn, custnosIn, booksWithQty, markAllForEnrich } from '../server/email/enrich';
import { saveEmailConfig, emailConfig } from '../server/email/config';
import { queueSend, cancelSend, runSendQueue } from '../server/email/sendQueue';
import { makeQuote, priceItems } from '../server/email/quote';
import { forgetStock } from '../server/stock/stock';
import { writeXlsx } from '../server/xlsx';
import { handle } from '../server/api';

// ── pricing rules ──
const F = DEFAULTS.freight, D = DEFAULTS.discount;
assert.equal(postageFor(F, 100), 40);
assert.equal(postageFor(F, 101), 70);
assert.equal(postageFor(F, 300), 70);
assert.equal(postageFor(F, 700), 150);
assert.equal(postageFor(F, 1000), 200);
assert.equal(postageFor(F, 1001), 0, 'free above ₹1,000');
assert.equal(discountFor(D, 2000).amount, 0);
assert.equal(discountFor(D, 2001).pct, 10);
assert.equal(discountFor(D, 5000).pct, 10);
assert.equal(discountFor(D, 5001).pct, 20);
assert.equal(discountFor(D, 15000).pct, 20);
assert.equal(discountFor(D, 20000).net, 15200, '20% then 5% on the net');
const t1 = quoteTotals(D, F, 900, { discount: true });
assert.equal(t1.postage, 200);
assert.equal(t1.total, 1100);
const t2 = quoteTotals(D, F, 2500, { discount: true });
assert.equal(t2.discount.amount, 250);
assert.equal(t2.postage, 0, 'postage on the value before discount');
assert.equal(t2.total, 2250);
assert.equal(quoteTotals(D, F, 2500, { discount: false }).total, 2500, 'no discount on retail lines');

// ── book list (Suchi) ──
const e6 = toEntry('6', 'गीता साधक संजीवनी (परिशिष्ट सहित) Hardbound · Best Seller · Marathi 7 · English 1080-1081', 'ग्रन्थाकार Large', '1296', '16', '₹450');
assert.equal(e6.price, 450);
assert.equal(e6.sizeEn, 'Large');
assert.equal(e6.pages, 1296);
assert.ok(e6.bestSeller);
assert.deepEqual(e6.editions.find((x) => x.language === 'English')?.codes, ['1080-1081']);
const e26 = toEntry('26', 'श्रीमद्भागवत महापुराण (प्रथम खण्ड) Hardbound SET (2 VOLUMES) — codes 26, 27 · Set Code CB003', 'ग्रन्थाकार Large', '1024', '20', '₹440');
assert.deepEqual(e26.set, { setCode: 'CB003', codes: ['26', '27'], volumes: 2 });
assert.equal(toEntry('2385', 'Srimadbhagavadgita Deluxe Edition', 'Large', '240', '—', '₹300').carton, null, '— means not known');
assert.equal(toEntry('1012', 'पञ्चामृत Best Seller', 'स्टीकर Sticker', '—', '4000', '₹3').sizeEn, 'Sticker');
const pdf = process.env.SUCHI_PDF || '/mnt/user-data/uploads/cde615b0-Final_Gita_Press_Suchi_Codewise_Oct_2026_V8.pdf';
if (fs.existsSync(pdf)) {
	const r = await parseSuchiPdf(new Uint8Array(fs.readFileSync(pdf)));
	assert.equal(r.entries.length, 1911, 'every title in the October 2026 Suchi');
	assert.equal(r.entries.filter((e) => e.price === null).length, 0, 'every title has a price');
	assert.equal(r.entries.find((e) => e.code === '6')?.price, 450);
	assert.equal(r.entries.find((e) => e.code === '26')?.set?.setCode, 'CB003');
	// the Excel layout Gita Mail downloads reads back the same
	const back = parseSuchiTable(writeXlsx([{ name: 'Suchi', header: SUCHI_COLUMNS, rows: suchiRows(r.entries.slice(0, 50)) }]), 'suchi.xlsx').entries;
	assert.equal(back.length, 50);
	assert.equal(back.find((e) => e.code === '26')?.set?.setCode, 'CB003');
	console.log(`  Suchi PDF read with ${r.reader}: ${r.entries.length} titles`);
}

// ── text lookups ──
assert.deepEqual(orderIdsIn('Where is my order GPHO_351981 and gpho 351980?'), ['GPHO_351981', 'GPHO_351980']);
assert.deepEqual(custnosIn('मेरी कल्याण ग्राहक संख्या 345262 है'), ['345262']);
assert.deepEqual(custnosIn('Kalyan customer no. 4670'), ['4670']);
assert.deepEqual(booksWithQty('code 6 x 10, 1388 - 2'), [{ code: '6', qty: 10 }, { code: '1388', qty: 2 }]);
assert.equal(stateByPrefix('UTTAR PRAD'), 'Uttar Pradesh');
assert.equal(stateByPrefix('WEST BENGA'), 'West Bengal');
assert.equal(stateByPrefix('MADHYA PRA'), 'Madhya Pradesh');
assert.deepEqual(checkHeader('kalyan_current', ['Duration', 'No', 'Name', 'Address', 'Location', 'State', 'Country', 'Post code', '', '']).slice(8), ['Receipt no', 'Payment date']);
assert.throws(() => checkHeader('kalyan_master', ['Name', 'City']), /customer number column/);

// ── database ──
await ensureSchema();
const orgId = await defaultOrgId();
await q(`update organisations set internal_domains='{gitapress.org}' where id=$1`, [orgId]);
const org = await getOrg(orgId, true);
// start clean (a run that stopped half way leaves its test rows)
await q(`delete from kalyan_customer_years where org_id=$1 and custno like '9900%'`, [orgId]);
await q(`delete from kalyan_customers where org_id=$1 and custno like '9900%'`, [orgId]);
await q(`delete from kalyan_dispatches where org_id=$1 and custno like '9900%'`, [orgId]);
await q(`delete from orders where org_id=$1 and order_key like 'GPHO_9900%'`, [orgId]);
await q(`delete from conversations where org_id=$1 and id in (select conversation_id from emails where from_address like '%.rb@%' or from_address='newsletter@shop.example.com')`, [orgId]);
await q(`delete from emails where org_id=$1 and (from_address like '%.rb@%' or from_address='newsletter@shop.example.com')`, [orgId]);
await q(`delete from standing_answers where org_id=$1 and question_key='intl_shipping'`, [orgId]);
const admin = (await one<any>(`select id from users where org_id=$1 and role='admin' limit 1`, [orgId])) || (await one<any>(`insert into users (org_id, email, full_name, role) values ($1,'rb-admin@gitapress.org','Admin','admin') returning id`, [orgId]));
const user = { id: admin.id, orgId, email: 'rb-admin@gitapress.org', fullName: 'Admin', role: 'admin', allMailboxes: true, sessionId: 't', authProvider: 'local', timezone: 'Asia/Kolkata' } as any;

// master data: values validated and kept with history
await assert.rejects(saveMaster(orgId, admin.id, 'bank', { ...DEFAULTS.bank, ifsc: 'BAD' }), /IFSC/);
await saveMaster(orgId, admin.id, 'freight', { ...DEFAULTS.freight, international: 'By registered air mail: ₹1,200 for up to 2 kg' });
assert.equal((await getMaster(orgId, 'freight')).international, 'By registered air mail: ₹1,200 for up to 2 kg');
assert.ok((await one<any>(`select count(*)::int n from master_history where org_id=$1 and key='freight'`, [orgId])).n >= 1);
await saveMaster(orgId, admin.id, 'freight', DEFAULTS.freight);

// books: two codes from the Suchi with prices and links
await applySuchi(orgId, admin.id, 'test.pdf', new Uint8Array([1]), [
	toEntry('9901', 'परीक्षा गीता Hardbound', 'ग्रन्थाकार Large', '400', '20', '₹450'),
	toEntry('9902', 'परीक्षा भजन', 'पुस्तकाकार Medium', '200', '100', '₹80'),
]);
await q(`update book_titles set name = case code when '9901' then 'Test Gita Tattva Vivechani' else 'Test Bhajan Sangrah' end, gitapress_url='https://gitapress.org/product/test-' || code, amazon_url='https://www.amazon.in/dp/TEST' || code, in_links=true where org_id=$1 and code in ('9901','9902')`, [orgId]);
assert.equal((await one<any>(`select suchi_price::float p from book_titles where org_id=$1 and code='9901'`, [orgId])).p, 450);
// stock at Gorakhpur (Main + Retail)
const up = await one<any>(`insert into stock_uploads (org_id, scope, file_name, period_from, period_to, locations, row_count) values ($1,'hq','test.xlsx','2026-11-04','2026-11-06','{gorakhpur}',2) returning id`, [orgId]);
await q(`insert into stock_rows (upload_id, org_id, location, godown, godown_kind, code, name, language, batch, price, closing_qty) values
	($1,$2,'gorakhpur','Main Stock Location','main','9901','Test Gita','Hindi','9901_Rs.450',450,100), ($1,$2,'gorakhpur','Retail Dispatch Stock Location','retail','9901','Test Gita','Hindi','9901_Rs.450',450,20),
	($1,$2,'gorakhpur','Main Stock Location','main','9902','Test Bhajan','Hindi','9902_Rs.80',80,30)`, [up.id, orgId]);
forgetStock(orgId);
// an order and a Kalyan customer with a registered-post dispatch
await q(`insert into orders (org_id, order_key, order_id, customer_name, email, email_ok, total, subtotal, postage, status_code, status_label, payment_status, ordered_at, tracking_id, tracking_ok, partner)
	values ($1,'GPHO_990001','GPHO_990001','Asha Verma','asha.rb@gmail.com',true,115,75,40,'4','Shipped','4','2026-11-10T10:00:00Z','EE123456789IN',true,'India Post') on conflict do nothing`, [orgId]);
await q(`insert into kalyan_dispatches (org_id, custno, from_issue, to_issue, dispdate, mode, barcode, subperiod) values ($1,'990001',11,11,'2026-11-05','REGISTERED','MP273300182IN','1Y') on conflict do nothing`, [orgId]);

// ── Kalyan customer uploads: master, then current year (additive, net new into master) ──
const master = await startBatch(orgId, admin.id, { kind: 'kalyan_master', fileName: 'master.xlsx', header: ['BookID', 'CustNo', 'SubPeriod', 'Custtype', 'title', 'firstname', 'midname', 'lastname', 'add1', 'city', 'pin', 'state', 'country', 'regdate', 'DispMode', 'DeadCustomer', 'CREATEDBY'] });
await addRows(orgId, master.id, { start: 0, rows: [
	['KK', '990001', '1Y', 'S', 'SRI', 'RAM', '', 'SHARMA', 'GANDHI NAGAR', 'JAIPUR', '302015', 'RAJASTHAN', 'INDIA', '1997-10-27 00:00:00', 'REGISTERED', 'N', 'clerk'],
	['KK', '990002', 'FY', 'S', 'SMT', 'SITA', '', 'DEVI', 'CIVIL LINES', 'BHOPAL', '462001', 'MADHYA PRADESH', 'INDIA', '1998-08-25 00:00:00', 'ORDINARY', 'N', 'clerk'],
	['KK', '', '1Y', 'S', '', 'NO', '', 'NUMBER', '', '', '', '', '', '', '', '', ''],
] });
let mb = await finishBatch(orgId, master.id, { rows: 3 });
assert.equal(mb.status, 'review', 'nothing applied before the check summary is confirmed');
assert.equal(mb.review.customers, 2);
assert.equal(mb.review.newToMaster >= 0, true);
assert.equal(mb.rows_rejected, 1, 'row without a customer number rejected');
await confirmBatch(orgId, master.id, {});
await processBatches(orgId);
const k1 = await one<any>(`select * from kalyan_customers where org_id=$1 and custno='990001'`, [orgId]);
assert.equal(k1.name, 'SRI RAM SHARMA');
assert.equal(k1.state_norm, 'Rajasthan');
assert.equal(k1.regdate, '1997-10-27');
assert.ok(!('createdby' in (k1.extra || {})), 'unneeded columns are not kept');
const cur = await startBatch(orgId, admin.id, { kind: 'kalyan_current', fileName: 'current.xlsx', header: ['Duration', 'No', 'Name', 'Address', 'Location', 'State', 'Country', 'Post code', '', ''] });
await addRows(orgId, cur.id, { start: 0, rows: [
	['1Y', '990001', 'SRI RAM SHARMA', 'GANDHI NAGAR JAIPUR', 'JAIPUR', 'RAJASTHAN', 'INDIA', '302015', '19339', '17/10/2026'],
	['1Y', '990003', 'SRI J.P. TIWARI', 'SHARDA SADAN FAIZABAD', 'FAIZABAD', 'UTTAR PRAD', 'INDIA', '224001', '19340', '01/11/2026'],
] });
const cb = await finishBatch(orgId, cur.id, { rows: 2 });
assert.equal(cb.review.year, 2026, 'year from the latest payment date');
assert.equal(cb.review.newToMaster, 1);
await confirmBatch(orgId, cur.id, {});
await processBatches(orgId);
const k3 = await one<any>(`select * from kalyan_customers where org_id=$1 and custno='990003'`, [orgId]);
assert.ok(k3 && k3.in_master && k3.source === 'current', 'net new customer added to the master database');
const y1 = await one<any>(`select receipt_no, paid_on::text as paid_on, state from kalyan_customer_years where org_id=$1 and custno='990001' and year=2026`, [orgId]);
assert.equal(y1.receipt_no, '19339');
assert.equal(y1.paid_on, '2026-10-17');
assert.equal((await one<any>(`select state from kalyan_customer_years where org_id=$1 and custno='990003'`, [orgId])).state, 'Uttar Pradesh', 'cut-short state from the PIN');
assert.ok((await one<any>(`select 1 as x from kalyan_customers where org_id=$1 and custno='990002'`, [orgId])), 'additive: master customers not in the current file stay');

// ── emails: classification, facts, questions, completeness ──
await saveEmailConfig(orgId, { kalyanYearStartMonth: 1 });
const box = await one<any>(`insert into mailboxes (org_id, provider, address) values ($1,'demo','booksales@gitapress.org') on conflict (org_id, provider, lower(address)) do update set status='active' returning *`, [orgId]);
const base = { threadId: null, inReplyTo: null, references: [], cc: [], hasAttachments: false, importance: null, webLink: null, folder: 'inbox' as const, isAutomated: false, to: [{ address: 'booksales@gitapress.org', name: '' }] };
let n = 0;
const send = async (from: string, name: string, subject: string, body: string, extra: any = {}) => {
	n++;
	await ingestMessages(org, box, [{ ...base, providerMessageId: `rb${n}-${Date.now()}`, internetMessageId: `<rb${n}-${Date.now()}@x>`, from: { address: from, name }, subject, bodyText: body, sentAt: new Date(Date.now() - 3600_000), ...extra }]);
	return one<any>(`select id from conversations where org_id=$1 and subject=$2 order by id desc limit 1`, [orgId, subject]);
};
const cOrder = await send('asha.rb@gmail.com', 'Asha Verma', 'Where is my order GPHO_990001', 'Namaste, I placed order GPHO_990001 last week. Please share the tracking status of my order.');
const cKalyan = await send('ram.rb@gmail.com', 'Ram Sharma', 'कल्याण का अंक नहीं मिला', 'मेरी कल्याण ग्राहक संख्या 990001 है। नवंबर का अंक अभी तक नहीं मिला है। कृपया बताएं कब भेजा गया।');
const cBulk = await send('trust.rb@example.org', 'Shri Ram Trust', 'Quotation for 20 copies of code 9901', 'Our trust needs code 9901 x 20 and code 9902 x 50 for distribution. Please send a quotation with discount.');
const cIntl = await send('dev.rb@example.com', 'Dev Patel', 'Books to USA', 'I live in the USA, New Jersey. Please send code 9901 x 2 by post to United States. What is the shipping cost?');
const cNews = await send('newsletter@shop.example.com', 'Shop', 'Weekly newsletter', 'Our weekly offers. Unsubscribe here.', { isAutomated: true });
await analysePending(orgId, 50);
await enrichPending(orgId, Date.now() + 60_000);
const get = (id: number) => one<any>('select * from conversations where id=$1', [id]);
const draftOf = (id: number) => one<any>('select * from reply_drafts where conversation_id=$1', [id]);

const o = await get(cOrder.id);
assert.equal(o.primary_group, 'order_issues', `order group: ${o.business_category}/${o.subcategory}`);
assert.ok(['tracking', 'not_received'].includes(o.sub_tags[0]), `order sub-tag ${o.sub_tags}`);
assert.equal(o.completeness, 100, `order complete: ${JSON.stringify(o.facts)}`);
assert.equal(o.reply_status, 'ready');
const od = await draftOf(cOrder.id);
assert.match(od.body, /\[\[ok: GPHO_990001\]\]/, 'found facts are marked green');
assert.match(od.body, /EE123456789IN/);
assert.match(od.body, /indiapost/);
assert.ok(!/\[\[provide:/.test(od.body), 'nothing left to answer');

const kc = await get(cKalyan.id);
assert.equal(kc.primary_group, 'kalyan', `kalyan group ${kc.business_category}`);
assert.deepEqual(kc.sub_tags, ['delivery_status']);
assert.equal(kc.reader_language, 'hi');
const kd = await draftOf(cKalyan.id);
assert.match(kd.body, /MP273300182IN/, 'registered post number in the reply');
assert.match(kd.body, /आदरणीय/, 'Hindi reply to a Hindi email');
assert.equal(kc.completeness, 100, JSON.stringify(kc.facts));

const bk = await get(cBulk.id);
assert.equal(bk.primary_group, 'bulk_order', `bulk group ${bk.business_category} ${bk.purposes}`);
const bd = await draftOf(cBulk.id);
assert.match(bd.body, /₹13,000/, 'book value 20×450 + 50×80');
assert.match(bd.body, /20%/, 'bulk discount');
assert.match(bd.body, /₹10,400/, 'total after 20% discount, postage free above ₹1,000');
assert.match(bd.body, /305201010035092/, 'bank details in a payment reply');
assert.equal(bk.completeness, 100, JSON.stringify(bk.facts));
const bulkReq = await one<any>('select * from bulk_requests where conversation_id=$1', [cBulk.id]);
assert.equal(bulkReq.stage, 'received');
assert.equal(Number(bulkReq.value), 10400);

const it = await get(cIntl.id);
assert.equal(it.primary_group, 'international');
assert.ok(it.completeness < 100, 'international shipping not yet known');
assert.ok(it.open_questions.some((x: any) => x.fact === 'intl_shipping'), 'specific question asked');
assert.match((await draftOf(cIntl.id)).body, /SWIFT/, 'international payment details include SWIFT');
// answered once for all emails (a standing answer) → complete
await q(`insert into standing_answers (org_id, question_key, question, answer) values ($1,'intl_shipping','International shipping','By air mail, ₹1,200 per 2 kg') on conflict (org_id, question_key) do update set answer=excluded.answer`, [orgId]);
await markAllForEnrich(orgId);
await enrichPending(orgId, Date.now() + 60_000);
const it2 = await get(cIntl.id);
assert.equal(it2.completeness, 100, 'standing answer lifts completeness');
assert.match((await draftOf(cIntl.id)).body, /₹1,200 per 2 kg/);

const nw = await get(cNews.id);
assert.equal(nw.not_for_reply, true, 'automated mail goes to Not for reply');

// a lookup answered on the email (the order number) re-runs the lookups
const cNoOrder = await send('meera.rb@gmail.com', 'Meera', 'My order has not arrived', 'I ordered books two weeks ago and they have not arrived. Please check.');
await analysePending(orgId, 10);
await enrichPending(orgId, Date.now() + 60_000);
const nb = await get(cNoOrder.id);
assert.equal(nb.primary_group, 'order_issues', `${nb.business_category}/${nb.subcategory}`);
assert.ok(nb.open_questions.some((x: any) => x.fact === 'order_number'), 'order not found → question');
assert.equal(nb.reply_status, 'pending');
await q(`update conversations set answers = '{"order":"GPHO_990001"}' where id=$1`, [cNoOrder.id]);
await enrichConversation(cNoOrder.id);
assert.equal((await get(cNoOrder.id)).completeness, 100, 'order number typed by staff completes the facts');

// criticality: base level and waiting past the SLA
const cfg = await emailConfig(orgId);
const { criticality } = await import('../server/email/enrich');
assert.equal(criticality(cfg, 'order_issues', ['damaged_wrong'], {}, '', 0), 'critical');
assert.equal(criticality(cfg, 'retail_order', [], {}, '', 0), 'medium');
assert.equal(criticality(cfg, 'retail_order', [], {}, '', 2.5), 'high', 'past the SLA');
assert.equal(criticality(cfg, 'others', [], {}, '', 5), 'critical', 'past twice the SLA');
assert.equal(criticality(cfg, 'order_issues', ['not_received'], {}, 'I paid ₹500 and the money was deducted', 0), 'critical', 'money taken, not received');

// ── send queue: only Send puts a reply in the queue; undo; send later; nothing automatic ──
assert.equal(await runSendQueue(), 0, 'no queued replies, nothing is sent');
await q('update reply_drafts set send_mailbox_id=$2 where id=$1', [od.id, box.id]); // the demo mailbox stands in for Gmail
await assert.rejects(saveEmailConfig(orgId, { autoSend: { enabled: true } }), /cannot be switched on/);
const q1 = await queueSend({ user }, user, od.id, {});
assert.ok(q1.undoSeconds === 30);
assert.equal((await draftOf(cOrder.id)).status, 'queued');
await cancelSend({ user }, user, od.id);
assert.equal((await draftOf(cOrder.id)).status, 'draft', 'undo within 30 seconds');
await assert.rejects(queueSend({ user }, user, od.id, {}, new Date(Date.now() - 1000).toISOString()), /at least a minute/);
await assert.rejects(queueSend({ user }, user, (await draftOf(cIntl.id)).id ?? 0, { body: 'x [[provide: y]]' }), /yellow/);
await queueSend({ user }, user, od.id, {});
await q(`update reply_drafts set send_at = now() - interval '1 second' where id=$1`, [od.id]);
await runSendQueue();
const after = await draftOf(cOrder.id);
assert.equal(after.status, 'draft', 'a send that fails (no Gmail here) goes back to draft');
assert.ok(after.last_error);

// ── bulk quote ──
const priced = await priceItems(orgId, [{ code: '9901', qty: 20 }, { code: '9902', qty: 50 }]);
assert.equal(priced.totals.total, 10400);
const quote = await makeQuote(orgId, admin.id, bulkReq.id, [{ code: '9901', qty: 20 }, { code: '9902', qty: 50 }]);
assert.match(quote.quoteNo, /^GP-Q-\d{4}-\d{4}$/);
const withQuote = await one<any>('select quote_pdf, stage from bulk_requests where id=$1', [bulkReq.id]);
assert.equal(Buffer.from(withQuote.quote_pdf).subarray(0, 4).toString(), '%PDF');
assert.equal(withQuote.stage, 'preparing');
const bdr = await draftOf(cBulk.id);
assert.ok(bdr.attachments.some((a: any) => a.kind === 'quote'), 'quote PDF attached to the reply');
assert.match(bdr.body, new RegExp(quote.quoteNo));

// ── API: delete everything and rebuild keeps master data ──
const { token } = await issueSession(admin.id, { ip: '', ua: 'test' } as any);
const call = async (method: string, path: string, body?: any) => {
	const res = await handle(new Request(`http://x${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));
	return { status: res.status, data: await res.json().catch(() => null) };
};
const list = await call('GET', '/api/emails?tab=all');
assert.equal(list.status, 200);
assert.ok(list.data.rows.some((r: any) => r.id === cBulk.id));
const tabs = await call('GET', '/api/emails?tab=kalyan');
assert.ok(tabs.data.rows.every((r: any) => r.primary_group === 'kalyan'));
const oq = await call('GET', '/api/open-questions');
assert.equal(oq.status, 200);
const dash = await call('GET', '/api/kalyan/dashboard?year=2026');
assert.equal(dash.status, 200);
assert.ok(dash.data.current.active >= 2);
assert.ok(dash.data.current.new >= 2);
const before = await call('GET', '/api/system/reset');
assert.ok(before.data.delete.Emails > 0);
assert.equal((await call('POST', '/api/system/reset', { confirm: 'NO' })).status, 400);
const reset = await call('POST', '/api/system/reset', { confirm: 'DELETE', haveBackup: true, sync: false });
assert.equal(reset.status, 200, JSON.stringify(reset.data));
assert.equal((await one<any>('select count(*)::int n from emails where org_id=$1', [orgId])).n, 0);
assert.equal((await one<any>('select count(*)::int n from kalyan_customers where org_id=$1', [orgId])).n, 0);
assert.equal((await one<any>('select count(*)::int n from book_titles where org_id=$1', [orgId])).n, 0);
assert.equal((await one<any>('select count(*)::int n from orders where org_id=$1', [orgId])).n, 0);
assert.ok((await one<any>('select count(*)::int n from standing_answers where org_id=$1', [orgId])).n >= 1, 'standing answers kept');
assert.ok((await one<any>('select count(*)::int n from master_history where org_id=$1', [orgId])).n >= 1, 'master data kept');
assert.ok((await one<any>('select count(*)::int n from mailboxes where org_id=$1', [orgId])).n >= 1, 'mailboxes kept');
assert.ok((await one<any>('select count(*)::int n from reply_templates where org_id=$1', [orgId])).n >= 1, 'templates kept');

console.log('All rebuild tests passed');
await getPool().end();
