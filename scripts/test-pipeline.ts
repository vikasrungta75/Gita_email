/** Pipeline self-test against a throwaway database: npm test (needs DATABASE_URL to an empty test DB) */
import assert from 'node:assert/strict';
import { ensureSchema, getPool, q, one } from '../server/db';
import { defaultOrgId } from '../server/auth';
import { getOrg } from '../server/settings';
import { ingestMessages } from '../server/ingest';
import { analysePending, backfillSubcategories } from '../server/analyze';
import { SUBCATEGORIES, normaliseSubcategory } from '../server/ai/taxonomy';
import { DEFAULT_TEMPLATES, listTemplates, templatesForGroup } from '../server/templates';
import { importCsv, matchReference, parseCsv } from '../server/reference';
import { categoryReport } from '../server/views';
import { heuristicAnalyse } from '../server/ai/heuristic';
import { cleanBody, normalizeSubject, redactPII } from '../server/text';
import { placeholders, sendDraft, bodyToHtml, fillDraft } from '../server/drafts';
import { buildMime } from '../server/connectors/gmail';

assert.equal(normalizeSubject('RE: Fwd: [EXT] Late delivery'), 'late delivery');
assert.match(cleanBody('Thanks, done.\n\nOn Mon, 1 Jan 2026 at 10:00, Bob <b@x.com> wrote:\n> old text'), /^Thanks, done\.$/);
assert.equal(redactPII('card 4111 1111 1111 1111'), 'card [card-number]');

const msg = (body: string, subject = 'Order') => ({ index: 0, emailId: 1, direction: 'inbound' as const, from: 'r@gmail.com', fromName: 'Ramesh Sharma', sentAt: new Date().toISOString(), subject, body });
const input = (body: string, subject?: string) => ({ conversationId: 1, customerName: 'Ramesh Sharma', customerTier: 'standard', orgName: 'Gita Press', isInternal: false, isAutomated: false, replySignature: 'Regards,\nGita Press', messages: [msg(body, subject)] });

// legal escalation → red
const a = heuristicAnalyse(input('This is my third email and nobody has answered. This is very disappointing. I will file a complaint in the consumer forum.'));
assert.equal(a.sentiment, 'negative');
assert.equal(a.rag_suggestion, 'red');
assert.ok(a.legal_or_churn_signal);

// bulk request: categorised, and the draft asks the team to decide instead of guessing
const bulk = heuristicAnalyse(input('Our trust needs 5,000 copies of the Shrimad Bhagavad Gita within 2 months. Please confirm whether this can be supplied and the price with trade discount.', 'Requirement of 5,000 copies'));
assert.equal(bulk.business_category, 'sales_proposal');
assert.ok(bulk.categories.includes('bulk_order'));
assert.ok(bulk.requires_reply);
const ph = placeholders(bulk.suggested_reply);
assert.ok(ph.some((p) => /5,000/.test(p) && /yes \/ no/i.test(p)), `draft must ask whether 5,000 copies can be supplied: ${ph.join(' | ')}`);
assert.ok(bulk.suggested_reply.includes('Regards,\nGita Press'), 'signature added');

// Hindi complaint: categorised, negative, and the draft is written in Hindi
const hi = heuristicAnalyse(input('आदरणीय महोदय, मुझे गीता की प्रति मिली परंतु उसके पृष्ठ फटे हुए हैं। कृपया नई प्रति भेजें।', 'पुस्तक के पृष्ठ फटे हुए हैं'));
assert.ok(hi.categories.includes('damage'), `Hindi damage detected: ${hi.categories}`);
assert.equal(hi.sentiment, 'negative');
assert.match(hi.suggested_reply, /आदरणीय महोदय\/महोदया/);
assert.ok(placeholders(hi.suggested_reply).length >= 1);

// Kalyan subscription
const kal = heuristicAnalyse(input('मेरी कल्याण ग्राहक संख्या SUB-74013 है। इस माह का अंक अभी तक नहीं मिला है।', 'कल्याण का अंक'));
assert.equal(kal.business_category, 'kalyan');

// subgroups: every analysis gets one that belongs to its group
assert.equal(bulk.subcategory, 'institution_order');
assert.equal(hi.subcategory, 'damaged_book');
assert.equal(kal.subcategory, 'issue_not_received');
assert.equal(normaliseSubcategory('kalyan', 'nonsense'), 'renewal');
for (const [g, list] of Object.entries(DEFAULT_TEMPLATES))
	for (const sub of Object.keys(list)) assert.ok(SUBCATEGORIES[g as keyof typeof SUBCATEGORIES].some((x) => x.key === sub), `template ${g}/${sub} matches a subgroup`);
for (const [g, list] of Object.entries(SUBCATEGORIES))
	for (const sg of list) if (sg.replies) assert.ok(DEFAULT_TEMPLATES[g]?.[sg.key], `subgroup ${g}/${sg.key} has a default template`);
assert.deepEqual(parseCsv('a,b\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);

// outgoing email: Hindi subject encoded, threaded headers present, placeholders highlighted in HTML
const mime = buildMime({ from: 'orders@gitapress.org', to: ['r@gmail.com'], cc: [], subject: 'Re: पुस्तक', text: 'धन्यवाद', html: '<p>धन्यवाद</p>', inReplyTo: '<a@b>', references: ['<a@b>'] });
assert.match(mime, /Subject: =\?UTF-8\?B\?/);
assert.match(mime, /In-Reply-To: <a@b>/);
assert.match(bodyToHtml('Yes [[provide: date]]'), /background:#fff176/);

await ensureSchema();
const orgId = await defaultOrgId();
await q(`update organisations set internal_domains='{gitapress.org}' where id=$1`, [orgId]);
const org = await getOrg(orgId, true);
const mk = async (addr: string) => one<any>(`insert into mailboxes (org_id, provider, address) values ($1,'demo',$2) on conflict (org_id, provider, lower(address)) do update set status='active' returning *`, [orgId, addr]);
const m1 = await mk('orders@gitapress.org');
const m2 = await mk('info@gitapress.org');
const base = { threadId: null, inReplyTo: null, references: [], cc: [], hasAttachments: false, importance: null, webLink: null, folder: 'inbox' as const, isAutomated: false };
const email = { ...base, providerMessageId: 'p1', internetMessageId: '<abc@gmail.com>', from: { address: 'jo@gmail.com', name: 'Jyoti' }, to: [{ address: 'orders@gitapress.org', name: '' }], subject: 'Damaged book received', bodyText: 'The Gita I received has torn pages. Please send a new copy.', sentAt: new Date() };
const r1 = await ingestMessages(org, m1, [email]);
const r2 = await ingestMessages(org, m2, [{ ...email, providerMessageId: 'p2' }]);
assert.equal(r1.inserted, 1);
assert.equal(r2.duplicates, 1, 'same Message-ID in a second mailbox must be a duplicate');
const reply = { ...base, providerMessageId: 'p3', internetMessageId: '<r1@gitapress.org>', inReplyTo: '<abc@gmail.com>', from: { address: 'neha.dubey@gitapress.org', name: 'Neha' }, to: [{ address: 'jo@gmail.com', name: '' }], subject: 'RE: Damaged book received', bodyText: 'Sorry, we will send a new copy by Friday.', sentAt: new Date(Date.now() + 60_000), folder: 'sent' as const };
await ingestMessages(org, m1, [reply]);
const conv = await one<any>(`select * from conversations where normalized_subject='damaged book received'`);
assert.equal(conv.message_count, 2);
assert.equal(conv.duplicate_count, 1);
assert.equal(conv.awaiting_reply, false);

// a reader waiting on an answer gets a stored draft
const ask = { ...base, providerMessageId: 'p4', internetMessageId: '<ask@gmail.com>', from: { address: 'meena@gmail.com', name: 'Meena' }, to: [{ address: 'orders@gitapress.org', name: '' }], subject: 'Order GP-2610444 not received', bodyText: 'I placed order GP-2610444 three weeks ago and have not received it. Please tell me when it will arrive.', sentAt: new Date() };
await ingestMessages(org, m1, [ask]);
await analysePending(orgId, 10);
const acts = await q<any>('select * from action_items where conversation_id=$1', [conv.id]);
assert.ok(acts.some((x) => x.is_commitment && x.due_date), 'commitment with due date extracted');
const waiting = await one<any>(`select * from conversations where normalized_subject like 'order gp-2610444%'`);
const draft = await one<any>('select * from reply_drafts where conversation_id=$1', [waiting.id]);
assert.ok(draft, 'draft created for a conversation awaiting reply');
assert.equal(draft.status, 'draft');
assert.deepEqual(draft.to_addresses, ['meena@gmail.com']);
assert.ok(placeholders(draft.body).length > 0, 'draft has items to fill in');
assert.ok(!(await one('select 1 from reply_drafts where conversation_id=$1', [conv.id])), 'no draft once the team has replied');
// Send is refused while yellow items remain
const admin = await one<any>(`insert into users (org_id, email, full_name, role) values ($1,'t@gitapress.org','Test','admin') returning id`, [orgId]);
await assert.rejects(sendDraft({}, { id: admin.id, orgId } as any, draft.id, {}), /Fill in the/);
// answers typed in the small boxes go into the email; without the AI they are inserted as typed
const items = [...new Set(placeholders(draft.body))];
const filled = await fillDraft({ id: admin.id, orgId } as any, draft.id, [{ item: items[0], value: '3 November 2026' }]);
assert.equal(filled.filled, 1);
assert.ok(filled.draft.body.includes('3 November 2026'));
assert.equal(placeholders(filled.draft.body).length, placeholders(draft.body).length - placeholders(draft.body).filter((p) => p === items[0]).length, 'every occurrence of that item answered');
await assert.rejects(fillDraft({ id: admin.id, orgId } as any, draft.id, [{ item: 'not in the draft', value: 'x' }]), /no longer in the draft/);
assert.ok(waiting.subcategory && SUBCATEGORIES[waiting.business_category as keyof typeof SUBCATEGORIES].some((x) => x.key === waiting.subcategory), `subgroup stored: ${waiting.business_category}/${waiting.subcategory}`);
assert.match(draft.body, /^Respected Meena ji,/, 'rules-engine draft follows the default template');

// templates are seeded, editable and given to the AI for the likely group
const tpls = await listTemplates(orgId);
assert.equal(tpls.length, Object.values(DEFAULT_TEMPLATES).reduce((n, l) => n + Object.keys(l).length, 0), 'every default template seeded');
const forKalyan = await templatesForGroup(orgId, 'kalyan', 'issue_not_received');
assert.equal(forKalyan[0].subgroup, 'issue_not_received');

// reference data: catalogue upload and matching against an email
const imp = await importCsv(orgId, 'book', 'code,title,language,price,in_stock\nGP-17,Shrimad Bhagavad Gita Tattva Vivechani,Hindi,250,yes\nGP-18,Ramcharitmanas,Hindi,300,no\n', true);
assert.equal(imp.added, 2);
assert.equal((await importCsv(orgId, 'book', 'code,title,price\nGP-18,Ramcharitmanas,320\n', false)).updated, 1);
await importCsv(orgId, 'faq', 'question,answer,keywords\nHow long does dispatch take?,Within 3 to 5 working days.,dispatch time;how long\n', true);
const mt = await matchReference(orgId, 'Please send 20 copies of Shrimad Bhagavad Gita Tattva Vivechani. How long does dispatch take?');
assert.ok(mt.some((m) => /Tattva Vivechani/.test(m.title) && /₹250/.test(m.text)), `book matched: ${JSON.stringify(mt)}`);
assert.ok(mt.some((m) => m.kind === 'faq'), 'faq matched');
assert.ok(!mt.some((m) => /Ramcharitmanas/.test(m.title)), 'unrelated book not matched');
await importCsv(orgId, 'book', 'code,title,language,price,in_stock,author,binding\n26,Shrimad Bhagavat Mahapuran Part 1,Hindi,450,yes,Vedvyas,Hardbound\n', false);
const byCode = await matchReference(orgId, 'Shrimad Bhagwat Mahapuran khand dono code 26 bhejiye');
assert.ok(byCode.some((m) => /Mahapuran/.test(m.title) && /binding Hardbound/.test(m.text)), `short book code and extra columns: ${JSON.stringify(byCode)}`);
assert.ok((await matchReference(orgId, 'पुस्तक कोड 26 उपलब्ध है?')).some((m) => /Mahapuran/.test(m.title)), 'Hindi code cited');

// customer database: the rules engine reads phone, address, PIN, subscriber number and language
const { rulesProfile, buildProfile, listCustomerDb } = await import('../server/profiles');
const rp = rulesProfile(['Kalyan issue missing\nमेरी ग्राहक संख्या 74013 है। अक्टूबर का अंक नहीं मिला।\nRamesh Sharma\n12, Gandhi Nagar, Near Hanuman Mandir\nJaipur, Rajasthan 302015\nMob 98290 12345'], { orders: ['GP-2610444'], books: [] }, 'r@gmail.com');
assert.equal(rp.pin, '302015');
assert.deepEqual(rp.phones, ['9829012345']);
assert.equal(rp.state, 'Rajasthan');
assert.ok(rp.address?.includes('Gandhi Nagar'), `address: ${rp.address}`);
assert.deepEqual(rp.subscriber_numbers, ['74013']);
assert.equal(rp.language, 'Hindi');
const anyCustomer = await one<any>('select customer_id from conversations where customer_id is not null limit 1');
const bp = await buildProfile(anyCustomer.customer_id, false);
assert.equal(bp.source, 'rules');
const db = await listCustomerDb(orgId, new URLSearchParams({ q: '' }));
assert.ok(db.totals.total >= 1 && db.rows[0].p);

// enrichment: public postal and GST codes, activity, and possible duplicates
const { stateFromPin, gstinInfo, enrichCustomer } = await import('../server/enrich');
assert.equal(stateFromPin('302015'), 'Rajasthan');
assert.equal(stateFromPin('273005'), 'Uttar Pradesh');
assert.equal(stateFromPin('248001'), 'Uttarakhand');
assert.deepEqual(gstinInfo('09AAATG1234K1Z5'), { state: 'Uttar Pradesh', entity: 'Trust' });
await q(`update customers set profile = profile || '{"phones":["9829012345"]}' where id in (select id from customers where org_id=$1 order by id limit 2)`, [orgId]);
const twinIds = (await q<any>('select id from customers where org_id=$1 order by id limit 2', [orgId])).map((r) => r.id);
const en = await enrichCustomer(twinIds[0], { web: false });
assert.ok(en && en.activity.threads >= 0);
assert.ok(en!.possible_duplicates.some((d: any) => d.id === twinIds[1]), 'same phone found as possible duplicate');

// reply footer: the branch in the reader's city when its address is on file, otherwise the head office
const { branches: brList, pickBranch, footerParts, HEAD_OFFICE } = await import('../server/branding');
const bl = brList([{ city: 'Mumbai', state: 'Maharashtra', address: 'Gita Press, Test address, Mumbai 400002' }]);
assert.equal(pickBranch(bl, { city: 'Bombay' }).branch.city, 'Mumbai');
assert.equal(pickBranch(bl, { address: 'Flat 2, Dadar, Mumbai, 400014' }).branch.city, 'Mumbai');
assert.equal(pickBranch(bl, { city: 'Kolkata' }).branch.address, 'Gobind Bhawan, 151, Mahatma Gandhi Road, Kolkata 700007', 'official branch list fills addresses not saved in Settings');
assert.equal(pickBranch(bl, { city: 'Lucknow' }).branch, HEAD_OFFICE, 'no branch in Lucknow, so the head office');
assert.equal(pickBranch(bl, {}).branch, HEAD_OFFICE);
const fp = footerParts(HEAD_OFFICE);
assert.ok(fp.text.includes('273005') && fp.text.includes('www.gitapress.org') && fp.html.includes('cid:gitapress-logo'));
const mime2 = buildMime({ from: 'a@gitapress.org', to: ['r@gmail.com'], cc: [], subject: 'Re: x', text: 't', html: `<p>t</p>${fp.html}`, inline: [{ cid: 'gitapress-logo', contentType: 'image/png', base64: 'iVBORw0KGgo=', filename: 'logo.png' }] });
assert.match(mime2, /multipart\/related/);
assert.match(mime2, /Content-ID: <gitapress-logo>/);

// cold marketing is not waiting for a reply
const promo = heuristicAnalyse(input('Grow your business with our digital marketing and SEO services. Free listing for your books. Click to unsubscribe.', "Don't Just Advertise. Create Opportunities for Growth."));
assert.equal(promo.requires_reply, false);

// threads analysed before subgroups existed are back-filled; the report has headings and subheadings
await q('update conversations set subcategory=null where id=$1', [waiting.id]);
assert.ok((await backfillSubcategories(orgId)) >= 1);
assert.ok((await one<any>('select subcategory from conversations where id=$1', [waiting.id])).subcategory);
const rep = await categoryReport({ id: admin.id, orgId, email: 't@gitapress.org', role: 'admin', allMailboxes: true } as any, new URLSearchParams({ audience: 'all', to: new Date(Date.now() + 86400_000).toISOString() }));
const g = rep.groups.find((x: any) => x.conversations > 0)!;
assert.ok(g.label && g.subgroups.length, 'report group has subgroups');
assert.equal(rep.totals.conversations, rep.groups.reduce((n: number, x: any) => n + x.conversations, 0));
// ── stock uploads, stock and addresses in drafts, reasons for contacting, inventory ──
{
	const { writeXlsx, readXlsx } = await import('../server/xlsx');
	const { importStock, importTitles, stockContext, currentStock, skeleton } = await import('../server/stock/stock');
	const inventory = await import('../server/stock/inventory');
	const { guessPurposes } = await import('../server/ai/purposes');
	const { listCustomerDb } = await import('../server/profiles');
	const { nearestBranch } = await import('../server/directory');
	const HEAD = ['Sl No', 'Code', 'Product Name', 'GodownName', 'BatchName', 'Category', 'Unit', 'Qty', 'Rate', 'Value', 'Qty', 'Rate', 'Value', 'Qty', 'Rate', 'Value', 'Qty', 'Rate', 'Value'];
	const GROUPS = ['', '', '', '', '', '', '', 'Opening', '', '', 'Inwards', '', '', 'OutWards', '', '', 'Closing Balance', '', ''];
	// [code, name, godown, price, opening, in, out, closing]
	const tally = (unit: string, period: string, rows: [string, string, string, number, number, number, number, number, string?][]) => ({
		name: unit, header: [unit],
		rows: [['Gita Press Road'], ['Gita Stock Summary'], [period], GROUPS, HEAD,
			...rows.map((r, i) => [String(i + 1), r[0], r[1], r[2], `${r[0]}_Rs.${r[3]}`, r[8] || 'Hindi', 'Nos', r[4], r[3], r[4] * r[3], r[5] || '', r[5] ? r[3] : '', r[5] ? r[5] * r[3] : '', r[6] || '', r[6] ? r[3] : '', r[6] ? r[6] * r[3] : '', r[7], r[3], r[7] * r[3]]),
			['Total']],
	});
	const hqFile = (period: string, scale = 1) => writeXlsx([
		{ ...tally('Govind Bhawan Karyalaya', period, [['6', 'Gita Sadhak Sanjivani - ( 6 )', 'Main Stock Location', 450, 5000, 0, 400 * scale, 4600], ['6', 'Gita Sadhak Sanjivani - ( 6 )', 'Main Stock Location', 400, 50, 0, 0, 50], ['18', 'Gita Tattva Vivechani - ( 18 )', 'Main Stock Location', 200, 0, 0, 0, -5]]), name: 'MAIN STOCK' },
		{ ...tally('Govind Bhawan Karyalaya', period, [['6', 'Gita Sadhak Sanjivani - ( 6 )', 'Retail Dispatch Stock Location', 450, 120, 0, 20 * scale, 100], ['1638', 'Hanuman Chalisa - ( 1638 )', 'Retail Dispatch Stock Location', 5, 900, 0, 300 * scale, 600, 'English']]), name: 'RETAIL STOCK' },
		{ ...tally('Govind Bhawan Karyalaya', period, [['6', 'Gita Sadhak Sanjivani - ( 6 )', 'Semi Finished Books Location', 450, 7000, 0, 0, 7000]]), name: 'SEMI FINISHED' },
	]);
	const brFile = (period: string, scale = 1) => writeXlsx([
		{ ...tally('Govind Bhawan Karyalaya, Unit- Gita Press', period, [['6', 'Gita Sadhak Sanjivani - ( 6 )', 'Delhi Branch Location', 450, 30, 0, 25 * scale, 5], ['6', 'Gita Sadhak Sanjivani - ( 6 )', 'Delhi Branch Location', 480, 0, 0, 0, 0], ['6', 'Gita Sadhak Sanjivani - ( 6 )', 'Delhi Godown Location', 450, 40, 0, 30, 10], ['1638', 'Hanuman Chalisa - ( 1638 )', 'Delhi Branch Location', 5, 500, 0, 0, 500, 'English']]), name: 'DELHI' },
		{ ...tally('Gita Press - Bhilwara', period, [['1638', 'Hanuman Chalisa - ( 1638 )', 'Bhilwara Branch Location', 5, 100, 0, 90 * scale, 10, 'English'], ['6', 'Gita Sadhak Sanjivani - ( 6 )', 'Bhilwara Branch Location', 450, 2, 0, 0, 2]]), name: 'BHILWARA' },
	]);
	assert.equal(readXlsx(hqFile('1-Oct-26 to 31-Oct-26')).length, 3, 'workbook written and read back');
	await assert.rejects(importStock(orgId, null, 'hq', 'branch.xlsx', brFile('1-Oct-26 to 31-Oct-26')), /Branches slot/, 'branch file refused in the HQ slot');
	const up1 = await importStock(orgId, null, 'hq', 'hq-oct.xlsx', hqFile('1-Oct-26 to 31-Oct-26'));
	assert.deepEqual(up1.locations, ['gorakhpur']);
	assert.ok(up1.warnings.some((w: string) => /negative/.test(w)));
	await importStock(orgId, null, 'branch', 'br-oct.xlsx', brFile('1-Oct-26 to 31-Oct-26'));
	await importStock(orgId, null, 'hq', 'hq-sep.xlsx', hqFile('1-Sep-26 to 30-Sep-26', 2));
	await importStock(orgId, null, 'branch', 'br-sep.xlsx', brFile('1-Sep-26 to 30-Sep-26', 2));
	const again = await importStock(orgId, null, 'branch', 'br-oct.xlsx', brFile('1-Oct-26 to 31-Oct-26'));
	assert.equal(again.replaced, 1, 'same period uploaded again replaces the earlier upload');
	assert.equal((await one<any>(`select count(*)::int n from stock_uploads where scope='branch' and period_to='2026-10-31' and deleted_at is null`)).n, 1, 'the replaced upload is no longer used');
	assert.equal((await one<any>(`select count(*)::int n from stock_uploads where scope='branch' and period_to='2026-10-31' and deleted_reason='replaced'`)).n, 1, '...but it is kept');
	// a branch file split in two for the same period: the second part does not remove the first
	const part = writeXlsx([{ ...tally('Gita Press - Patna', '1-Oct-26 to 31-Oct-26', [['6', 'Gita Sadhak Sanjivani - ( 6 )', 'Patna Branch Location', 450, 9, 0, 1, 8]]), name: 'PATNA' }]);
	assert.equal((await importStock(orgId, null, 'branch', 'patna.xlsx', part)).replaced, 0);
	assert.equal((await one<any>(`select count(*)::int n from stock_uploads where scope='branch' and period_to='2026-10-31' and deleted_at is null`)).n, 2, 'both parts kept');
	const cur = await currentStock(orgId);
	const g6 = cur.books.get('6')!;
	assert.equal(g6.locs.get('gorakhpur')!.qty, 4750, 'Gorakhpur = Main + Retail, semi-finished excluded');
	assert.equal(g6.locs.get('gorakhpur')!.semi, 7000);
	assert.equal(g6.locs.get('gorakhpur')!.price, 450, 'highest in-stock batch price');
	assert.equal(g6.locs.get('delhi')!.qty, 15, 'branch = shop + godown');
	assert.equal(g6.locs.get('delhi')!.price, 450, 'the ₹480 batch has no stock, so ₹450');
	assert.equal(cur.books.get('18')!.locs.get('gorakhpur')!.qty, 0, 'negative stock counts as zero');
	assert.equal(skeleton('रामचरितमानस'), skeleton('Ramcharitmanas'));
	const ctxEn = await stockContext(orgId, 'Please send 2 copies of Gita Sadhak Sanjivani to Chandni Chowk, Delhi 110006.', {});
	assert.equal(ctxEn.books[0].code, '6');
	assert.equal(ctxEn.books[0].nearest?.key, 'delhi');
	assert.match(ctxEn.prompt, /Gorakhpur 4,750 copies at ₹450; Delhi branch .* 15 copies at ₹450/);
	assert.match(ctxEn.prompt, /post and abroad only from Gorakhpur/);
	const ctxAbroad = await stockContext(orgId, 'Do you have Hanuman Chalisa in English? I live in London.', { country: 'United Kingdom' });
	assert.equal(ctxAbroad.abroad, true);
	assert.equal(ctxAbroad.books[0].nearest, null, 'abroad: Gorakhpur only');
	const addr = await stockContext(orgId, 'What is the address of your Mumbai branch?', {});
	assert.deepEqual(addr.addresses.map((d: any) => d.key), ['mumbai', 'gorakhpur']);
	assert.match(addr.prompt, /9768954885/);
	const all = await stockContext(orgId, 'Please share the addresses of your shops.', {});
	assert.ok(all.fullList && all.addresses.length === 21, 'no place named: the whole list');
	assert.ok(!all.prompt.includes('gmail.com'), 'Gmail branch addresses stay staff-only');
	assert.equal(nearestBranch({ pin: '226001' })?.key, 'kanpur');
	assert.equal(nearestBranch({ state: 'Gujarat' })?.key, 'surat');
	// Hindi titles: template has every code; uploaded titles are matched in Devanagari emails
	const titles = writeXlsx([{ name: 'Hindi titles', header: ['Code', 'English name', 'Hindi title'], rows: [['1638', 'Hanuman Chalisa', 'हनुमानचालीसा (अंग्रेजी)']] }]);
	assert.equal((await importTitles(orgId, 't.xlsx', titles)).updated, 1);
	const hiCtx = await stockContext(orgId, 'कृपया गीता साधक संजीवनी भेजें', {});
	assert.equal(hiCtx.books[0]?.code, '6', 'Hindi email matched to the English Tally name');
	// reasons for contacting
	assert.deepEqual(guessPurposes('Kalyan ka November ank nahi mila. Subscriber no 12345', 'kalyan', 'issue_not_received'), ['kalyan']);
	assert.ok(guessPurposes('I want to become a dealer for Gita Press books in my town', 'sales_proposal', 'dealership').includes('dealer'));
	assert.ok(guessPurposes('We need 500 copies of Hanuman Chalisa for distribution at our temple', 'sales_proposal', 'institution_order').includes('bulk_order'));
	assert.ok(guessPurposes('There is a typo on page 45 of Gita Tattva Vivechani, please correct it', 'publications', 'errata').includes('suggestion_content'));
	assert.deepEqual(guessPurposes('Staff meeting at 4', 'internal', 'internal_coordination'), []);
	const kal = { ...base, providerMessageId: 'k1', internetMessageId: '<k1@gmail.com>', from: { address: 'ravi.k@gmail.com', name: 'Ravi Kumar' }, to: [{ address: 'kalyan@gitapress.org', name: '' }], subject: 'Kalyan issue not received', bodyText: 'Respected sir, my Kalyan October issue has not arrived. Also is Gita Sadhak Sanjivani available? My PIN is 110006.', sentAt: new Date() };
	await ingestMessages(org, m1, [kal]);
	await analysePending(orgId, 10);
	const kc = await one<any>(`select * from conversations where normalized_subject='kalyan issue not received'`);
	assert.ok(kc.purposes.includes('kalyan') && kc.purposes.includes('availability_price'), `several reasons on one thread: ${kc.purposes}`);
	const kd = await one<any>('select body from reply_drafts where conversation_id=$1', [kc.id]);
	assert.match(kd.body, /Gorakhpur: 4,750 copies at ₹450; Delhi branch: 15 copies at ₹450/, 'rules-engine draft carries live stock');
	const kcu = await one<any>('select purposes from customers where id=$1', [kc.customer_id]);
	assert.ok(kcu.purposes.includes('kalyan'), 'customer record collects the reasons');
	assert.equal((await one<any>('select count(*)::int n from book_requests where conversation_id=$1', [kc.id])).n, 1, 'asked-for book recorded');
	const dbAny = await listCustomerDb(orgId, new URLSearchParams({ purposes: 'kalyan' }));
	assert.ok(dbAny.rows.some((r: any) => r.id === kc.customer_id));
	const dbNot = await listCustomerDb(orgId, new URLSearchParams({ purposes: 'kalyan', not: 'book_order,availability_price' }));
	assert.ok(!dbNot.rows.some((r: any) => r.id === kc.customer_id), 'has A but never B');
	// inventory: two months of data, sales from retail and shops only
	const ov = await inventory.overview(orgId);
	assert.deepEqual(ov.months.map((m: any) => m.month), ['2026-09', '2026-10']);
	assert.equal(ov.months[1].qty, 300 + 20 + 25 + 90 + 1, 'October sales: HQ retail + Delhi shop + Bhilwara + Patna (Main Stock and Delhi godown are transfers)');
	const top = await inventory.topSellers(orgId, {});
	assert.equal(top.rows[0].code, '1638');
	const rep2 = await inventory.replenishment(orgId, {});
	assert.ok(rep2.rows.some((x: any) => x.location === 'bhilwara' && x.code === '1638' && x.send > 0), 'Bhilwara needs Hanuman Chalisa');
	const st = await inventory.stockStatus(orgId, { location: 'delhi' });
	assert.ok(st.rows.find((x: any) => x.code === '1638')?.status === 'no_sales');
	assert.ok((await inventory.crossSell(orgId)).segments.length > 3);
	assert.ok(await inventory.customerSuggestions(orgId, kc.customer_id));
	// uploads are never lost: removing hides, restoring brings back, the original file can be downloaded
	const { deleteUpload, restoreUpload, uploadFile } = await import('../server/stock/stock');
	const sep = await one<any>(`select id from stock_uploads where scope='hq' and period_to='2026-09-30'`);
	assert.ok((await uploadFile(orgId, sep.id))?.bytes?.length > 100, 'original file stored');
	await deleteUpload(orgId, sep.id, null);
	assert.deepEqual((await inventory.overview(orgId)).uploads.n, 4, 'removed upload left out of the figures');
	await assert.rejects(deleteUpload(orgId, kc.id, null, false), /not found/);
	await restoreUpload(orgId, sep.id);
	assert.equal((await inventory.overview(orgId)).uploads.n, 5);
	await assert.rejects(deleteUpload(orgId, sep.id, null, true), /Remove it first/, 'erasing needs a removed upload');
	// addresses: the Hindi list with corrections from Settings; corrections reach replies
	const { resolveDirectory } = await import('../server/directory');
	const dir = resolveDirectory({ directory: [{ key: 'mumbai', address_hi: 'दूकान नं. 7, बे व्यू टॉवर, चीरा बाजार, मुम्बई', needs_english_check: true }] });
	const mum = dir.find((d) => d.key === 'mumbai')!;
	assert.equal(mum.address_hi, 'दूकान नं. 7, बे व्यू टॉवर, चीरा बाजार, मुम्बई');
	assert.ok(mum.needs_english_check && mum.edited!.includes('address_hi'));
	assert.equal(resolveDirectory({ branches: [{ city: 'Delhi', address: '2610, Nai Sarak, Delhi 110006' }] }).find((d) => d.key === 'delhi')!.address, '2610, Nai Sarak, Delhi', 'older saved corrections still apply');
	await q(`update organisations set settings = settings || jsonb_build_object('directory', $2::jsonb) where id=$1`, [orgId, JSON.stringify([{ key: 'mumbai', address_hi: 'दूकान नं. 7, बे व्यू टॉवर, चीरा बाजार, मुम्बई', needs_english_check: true }])]);
	(await import('../server/settings')).invalidateOrg(orgId);
	const addr2 = await stockContext(orgId, 'What is the address of your Mumbai branch?', {});
	assert.match(addr2.prompt, /दूकान नं\. 7/, 'corrected Hindi address used in replies');
	assert.match(addr2.prompt, /follow the Hindi/);
	// customer database: country and sorting by any column
	const byCountry = await listCustomerDb(orgId, new URLSearchParams({ sort: 'name', dir: 'desc' }));
	const names = byCountry.rows.map((r: any) => r.name.toLowerCase());
	assert.deepEqual(names, [...names].sort().reverse(), 'sorted by name, descending');
	assert.ok(Array.isArray(byCountry.totals.countries));
}
console.log('All pipeline tests passed');
await getPool().end();
