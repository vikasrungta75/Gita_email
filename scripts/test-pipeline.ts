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
	assert.equal(ov.months[1].qty, 300 + 20 + 90 + 1, 'October sales: HQ retail + Bhilwara + Patna (Main Stock and every Delhi godown are transfers, as decided in November 2026)');
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

// ── Stage 1: book list, orders, Kalyan, customer links, tiers, upload history, editable reasons ──
{
	const orgId = await defaultOrgId();
	const { writeXlsx } = await import('../server/xlsx');
	const { streamTableRows } = await import('../src/lib/xlsxStream');
	const books = await import('../server/master/books');
	const batches = await import('../server/uploads/batches');
	const { runAnalytics } = await import('../server/analytics');
	const { listCustomerDb } = await import('../server/profiles');
	const { importStock } = await import('../server/stock/stock');
	const link = await import('../server/customers/link');

	// sends a generated file through the same path as the browser: read in batches, then rows, then finish
	const send = async (kind: 'orders' | 'kalyan', data: Uint8Array, name: string) => {
		let id = 0, n = 0;
		await streamTableRows(data, name, async (rows) => {
			if (!id) id = (await batches.startBatch(orgId, null, { kind, fileName: name, fileSize: data.length, header: rows.shift() })).id;
			if (rows.length) { await batches.addRows(orgId, id, { start: n, rows }); n += rows.length; }
		}, { batch: 2 });
		await batches.addFilePart(orgId, id, 0, data);
		await batches.finishBatch(orgId, id, { rows: n });
		await batches.processBatches(orgId, Date.now() + 120_000);
		return one<any>('select * from upload_batches where id=$1', [id]);
	};
	const csv = (rows: unknown[][]) => new TextEncoder().encode(rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n'));

	// ── book list ──
	const BH = ['Code', 'English name', 'Language', 'Hindi title', 'Other names (separate with ;)', 'gitapress.org Website Link', 'Amazon Website Link'];
	const bookFile = writeXlsx([{ name: 'Books', header: BH, rows: [
		[1, 'Gita-Tattva-Vivechani', 'Hindi', 'गीता-तत्त्व-विवेचनी - ( 1 )', '', 'gitapress.org/book/1', 'https://www.amazon.in/dp/B001'],
		['1.0', '', 'Hindi', '', '', '', 'https://www.amazon.in/dp/B001'],
		[457, 'Gita Tattva Vivechani', 'English', '', 'Tattva Vivechani', 'https://www.gitapress.org/book/457', '#N/A'],
		[639, 'Shri Narayaniyam', 'Sanskrit', 'श्री नारायणीयम्-639', '', '#N/A', '#N/A'],
		['CB035', 'Bal Kahaniyan', 'Hindi', 'बाल कहानियाँ', '', 'https://example.com/x', 'https://www.amazon.in/dp/B035'],
		[1638, 'Hanuman Chalisa', 'English', 'हनुमानचालीसा (अंग्रेजी)', '', 'https://www.gitapress.org/book/1638', 'https://www.amazon.in/dp/B1638'],
	] }]);
	const parsed = await books.parseBookFile(orgId, 'books.xlsx', bookFile);
	assert.equal(parsed.rows.length, 5, '1 and 1.0 are the same book');
	assert.ok(parsed.problems.some((p) => /more than once/.test(p)));
	const prev = await books.previewBooks(orgId, parsed.rows);
	assert.ok(prev.hasStock && prev.notInFile > 0, 'codes in Tally but not in the file are counted');
	const applied = await books.applyBooks(orgId, null, 'books.xlsx', bookFile);
	assert.ok(applied.batchId > 0);
	const b639 = await one<any>(`select * from book_titles where code='639'`);
	assert.equal(b639.hindi_title, 'श्री नारायणीयम्', 'code stripped from the Hindi title');
	assert.equal(b639.hindi_raw, 'श्री नारायणीयम्-639', 'original text kept');
	assert.equal(b639.gitapress_url, null, '#N/A stored as empty');
	assert.ok(b639.flags.includes('no_gitapress_link') && b639.flags.includes('no_amazon_link'));
	assert.equal((await one<any>(`select hindi_title from book_titles where code='1'`)).hindi_title, 'गीता-तत्त्व-विवेचनी');
	assert.equal((await one<any>(`select gitapress_url from book_titles where code='1'`)).gitapress_url, 'https://gitapress.org/book/1', 'link without https:// accepted');
	assert.ok((await one<any>(`select flags from book_titles where code='CB035'`)).flags.includes('bad_gitapress_link'), 'a gitapress.org link must be on gitapress.org');
	const fam = await q<any>(`select code, family from book_titles where code in ('1','457')`);
	assert.equal(fam[0].family, fam[1].family, 'Hindi and English editions are one title family');
	await books.saveBook(orgId, null, { code: '457', family: 'Tattva Vivechani (English)' });
	await books.applyBooks(orgId, null, 'books.xlsx', bookFile);
	assert.equal((await one<any>(`select family from book_titles where code='457'`)).family, 'Tattva Vivechani (English)', 'a family set by hand is never overwritten');
	await assert.rejects(books.saveBook(orgId, null, { code: '1638', amazon_url: 'https://flipkart.com/x' }), /amazon\.in or amazon\.com/);
	await books.setBookRemoved(orgId, null, 'CB035', true);
	assert.equal((await books.listBooks(orgId, new URLSearchParams({ q: 'CB035' }))).rows.length, 0, 'a removed book is hidden');
	assert.equal((await books.listBooks(orgId, new URLSearchParams({ status: 'removed' }))).rows.length, 1, '...and listed under Removed');
	await books.setBookRemoved(orgId, null, 'CB035', false);
	// a new code in a Tally file is added as "Needs details"; a godown of another branch is ignored
	const GROUPS2 = ['', '', '', '', '', '', '', 'Opening Balance', '', '', 'Inwards', '', '', 'Outwards', '', '', 'Closing Balance', '', ''];
	const HEAD2 = ['Sl No', 'Code', 'Product Name', 'GodownName', 'BatchName', 'Category', 'Unit', 'Qty', 'Rate', 'Value', 'Qty', 'Rate', 'Value', 'Qty', 'Rate', 'Value', 'Qty', 'Rate', 'Value'];
	const row2 = (i: number, code: string, name: string, godown: string) => [String(i), code, name, godown, `${code}_Rs.50`, 'Hindi', 'Nos', 10, 50, 500, '', '', '', 2, 50, 100, 8, 50, 400];
	const kol = await importStock(orgId, null, 'branch', 'kolkata.xlsx', writeXlsx([{ name: 'KOLKATA', header: ['Gita Press - Kolkata'], rows: [['Road'], ['Gita Stock Summary'], ['1-Nov-26 to 7-Nov-26'], GROUPS2, HEAD2,
		row2(1, '99901', 'New Book Not In List', 'Kolkata Branch Location'), row2(2, '1638', 'Hanuman Chalisa', 'Bangalore Branch Location'), row2(3, '1638', 'Hanuman Chalisa', 'Rishikesh Branch Location'), ['Total']] }]));
	assert.ok(kol.warnings.some((w: string) => /2 rows were ignored because the godown belongs to another location/.test(w)), 'godowns of other locations are ignored');
	assert.equal((await one<any>(`select count(*)::int n from stock_rows where upload_id=$1`, [kol.upload.id])).n, 1);
	assert.equal((await one<any>(`select status from book_titles where code='99901'`)).status, 'needs_details', 'new stock code flagged');

	// ── orders ──
	const OH = ['orderId', 'orderMongoId', 'siteCategory', 'customerName', 'email', 'phone', 'totalAmount', 'subTotal', 'postage', 'paymentMethod', 'orderStatusCode', 'orderStatusLabel', 'paymentStatus', 'createdAt', 'trackingId', 'deliveryPartner', 'shipFirstName', 'shipLastName', 'shipAddress1', 'shipAddress2', 'shipCity', 'shipPincode', 'shipMobile'];
	const ord = (id: string, name: string, email: string, phone: string, amt: number, date: string, track: string, partner: string, status = 'Shipped', pin = '273005') =>
		[id, `m${id}`, 'Gorakhpur', name, email, phone, amt, amt - 50, 50, id.includes('_') ? 'ONLINE' : 'Imported', status === 'Shipped' ? 4 : 2, status, 4, date, track, partner, name, '', 'Street 1', '', 'Gorakhpur', pin, phone];
	const o1 = [OH,
		ord('GPHO_9001', 'Asha Devi', 'asha@example.com', '9876500001', 2500, '2026-10-12T10:00:00Z', 'RU123456789IN', 'India Post'),
		ord('GPHO_9001', 'Asha Devi', 'asha@example.com', '9876500001', 2500, '2026-10-12T10:00:00Z', 'RU123456789IN', 'India Post'),
		ord('GPHO9001', 'Mohan Lal', '', '9876500002', 300, '2026-10-11T18:30:00Z', '5.0E+12', 'www.delhivery.in'),
		ord('GPHO_9002', 'Asha Devi', '', '+91 98765 00001', 1200, '2026-10-20T10:00:00Z', '', 'Trackon', 'Processing'),
		ord('GPHO_9003', 'Kiran', 'kiran@bad', '9876500003', 99, '2026-10-21T10:00:00Z', 'TRK1234567', 'Blue Courier'),
	];
	const ob = await send('orders', csv(o1), 'orders.csv');
	assert.equal(ob.status, 'done', ob.error);
	assert.equal(ob.rows_total, 4, 'exact copies counted once; GPHO9001 and GPHO_9001 are two different orders');
	assert.equal(ob.profile.damagedTracking, 1);
	assert.ok(ob.warnings.some((w: string) => /5\.0E\+12/.test(w)));
	assert.ok(Object.keys(ob.profile.unknownCouriers).includes('Blue Courier'));
	assert.equal(ob.profile.couriers.Delhivery, 1, 'courier names merged');
	const dmg = await one<any>(`select tracking_id, tracking_ok from orders where order_key='GPHO9001'`);
	assert.ok(!dmg.tracking_ok, 'damaged tracking number never used');
	assert.equal((await one<any>(`select email, email_ok from orders where order_key='GPHO_9003'`)).email_ok, false, 'a cut-short email is not used');
	// the next file has all orders to date: a status change updates the order and is added to its history
	const o2 = [OH, ...o1.slice(1).filter((r) => r[0] !== 'GPHO_9002'), ord('GPHO_9002', 'Asha Devi', '', '9876500001', 1200, '2026-10-20T10:00:00Z', 'EK998877665', 'Ekart', 'Shipped')];
	const ob2 = await send('orders', csv(o2), 'orders2.csv');
	assert.equal(ob2.rows_updated, 1);
	assert.equal(ob2.rows_new, 0);
	assert.equal((await one<any>(`select status_label, partner from orders where order_key='GPHO_9002'`)).status_label, 'Shipped');
	assert.equal((await one<any>(`select count(*)::int n from order_status_history where order_key='GPHO_9002'`)).n, 2, 'status history kept');

	// ── Kalyan ──
	const KH = ['subperiod', 'custno', 'NAME', 'ADDRESS', 'city', 'pin', 'state', 'PhoneNo', 'DispMode', 'sbarcodeno', 'dispdate', 'Fromissue', 'Toissue', 'EmailID', 'Returnsts'];
	const xd = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400_000) + 25569;
	const kRows: unknown[][] = [KH];
	for (const [m, d] of [[5, '2026-05-10'], [6, '2026-06-10'], [7, '2026-07-10'], [8, '2026-08-10']] as const) {
		kRows.push(['1Y', 101, 'SRI ASHA DEVI', 'Street 1', 'GORAKHPUR', 273005, 'UTTAR PRADESH', 9876500001, m === 8 ? 'REGISTERED' : 'ORDINARY', m === 8 ? 'RA108IN' : '', xd(d), m, m, '', '']);
		kRows.push(['LM', 102, 'SRI RAM', 'Road 2', 'PUNE', 411001, 'MAHARASTRA', 9876500009, 'REGISTERED', `RM10${m}IN`, xd(d), m, m, 'ram@example', 'ACCEPT']);
		if (m !== 8) for (let k = 0; k < 6; k++) kRows.push(['1Y', 200 + k, `READER ${k}`, 'x', 'PATNA', 800001, 'BIHAR', '', 'ORDINARY', '', xd(d), m, m, '', '']);
	}
	kRows.push(['fy', 103, 'SMT SITA', 'Lane 3', 'DELHI', 110006, 'NEW DELHI', 9876500003, 'REGISTERED', 'RM999IN', xd('2026-07-15'), 1, 7, 'sita@example.com', '']);
	kRows.push(['1Y', 101, 'SRI ASHA DEVI', 'Street 1', 'GORAKHPUR', 273005, 'UTTAR PRADESH', 9876500001, 'ORDINARY', '', xd('2026-05-10'), 5, 5, '', '']);
	const kFile = writeXlsx([{ name: 'Sheet1', header: KH, rows: kRows.slice(1) }]);
	const kb = await send('kalyan', kFile, 'kalyan.xlsx');
	assert.equal(kb.status, 'done', kb.error);
	assert.equal(kb.rows_total, kRows.length - 1, 'every dispatch row kept, including two rows with the same key');
	assert.equal(kb.profile.sameKeyRows, 1);
	assert.ok(kb.warnings.some((w: string) => /August 2026: no ordinary-post dispatches/.test(w)), 'a month with no ordinary post is flagged');
	assert.ok(kb.warnings.some((w: string) => /cut short or not valid/.test(w)));
	const again = await send('kalyan', kFile, 'kalyan-again.xlsx');
	assert.equal(again.rows_new, 0, 'loading the same file again adds nothing');
	assert.equal((await one<any>(`select count(*)::int n from kalyan_dispatches`)).n, kRows.length - 1);
	const s101 = await one<any>(`select *, renewal_est::text as renewal_est from kalyan_subscribers where custno='101'`);
	assert.equal(s101.sub_type, '1Y');
	assert.equal(String(s101.renewal_est).slice(0, 10), '2027-01-01', '1-year subscription: renewal in January of the next year');
	assert.equal((await one<any>(`select renewal_est::text as renewal_est from kalyan_subscribers where custno='103'`)).renewal_est, '2031-01-01', '5-year subscriber who started this year (catch-up from issue 1)');
	assert.equal((await one<any>(`select renewal_est from kalyan_subscribers where custno='102'`)).renewal_est, null, 'life member: never');
	assert.equal((await one<any>(`select state_norm from kalyan_subscribers where custno='102'`)).state_norm, 'Maharashtra');

	// ── one customer per person ──
	await q(`insert into contacts (org_id, customer_id, email, name) select $1, id, 'asha@example.com', 'Asha' from customers where org_id=$1 order by id limit 1 on conflict do nothing`, [orgId]);
	const emailCustomer = (await one<any>(`select customer_id from contacts where email='asha@example.com'`)).customer_id;
	await runAnalytics(orgId, 'test');
	assert.equal((await one<any>(`select customer_id from orders where order_key='GPHO_9001'`)).customer_id, emailCustomer, 'order linked by email to the customer who wrote');
	assert.equal((await one<any>(`select customer_id from orders where order_key='GPHO_9002'`)).customer_id, emailCustomer, 'order with no email linked by mobile');
	assert.equal((await one<any>(`select customer_id from kalyan_subscribers where custno='101'`)).customer_id, emailCustomer, 'Kalyan subscriber linked by mobile');
	const asha = await one<any>(`select * from customers where id=$1`, [emailCustomer]);
	assert.ok(asha.kalyan_buyer && asha.orders_count === 2 && Number(asha.orders_spend) === 3700);
	assert.ok(asha.matched_by.includes('email') && asha.matched_by.includes('phone'), 'how each link was made is recorded');
	assert.notEqual((await one<any>(`select customer_id from orders where order_key='GPHO9001'`)).customer_id, emailCustomer, 'a different person is not merged');
	// same name and PIN code: a suggestion, never a merge
	const twinA = await one<any>(`select customer_id from kalyan_subscribers where custno='200'`);
	await q(`insert into kalyan_subscribers (org_id, custno, name, city, pin, state, sub_type, dispatches) values ($1, '999', 'READER 0', 'PATNA', '800001', 'BIHAR', '1Y', 1)`, [orgId]);
	await q(`insert into kalyan_dispatches (org_id, custno, from_issue, to_issue, dispdate, mode) values ($1, '999', 8, 8, '2026-08-10', 'ORDINARY')`, [orgId]);
	await runAnalytics(orgId, 'test');
	const twinB = await one<any>(`select customer_id from kalyan_subscribers where custno='999'`);
	assert.notEqual(twinA.customer_id, twinB.customer_id);
	assert.ok(await one(`select 1 from customer_reviews where kind='name_pin' and customer_a=least($1::bigint,$2::bigint) and customer_b=greatest($1::bigint,$2::bigint)`, [twinA.customer_id, twinB.customer_id]), 'same name and PIN listed for staff');
	// tiers, filters, sorting and the record's history
	const tiers = await link.computeTiers(orgId);
	assert.ok(tiers.ranked > 0);
	assert.equal((await one<any>(`select buyer_tier from customers where id=$1`, [emailCustomer])).buyer_tier, 'platinum', 'the biggest buyer is Platinum');
	const plat = await listCustomerDb(orgId, new URLSearchParams({ tier: 'platinum' }));
	assert.ok(plat.rows.every((r: any) => r.buyer_tier === 'platinum') && plat.rows.some((r: any) => r.id === emailCustomer));
	assert.ok((await listCustomerDb(orgId, new URLSearchParams({ kalyan: 'yes', orders: 'yes' }))).rows.some((r: any) => r.id === emailCustomer));
	const bySpend = (await listCustomerDb(orgId, new URLSearchParams({ sort: 'spend' }))).rows.map((r: any) => r.orders_spend);
	assert.deepEqual(bySpend, [...bySpend].sort((x, y) => y - x), 'sorted by spend');
	assert.ok((await listCustomerDb(orgId, new URLSearchParams({ q: '101' }))).rows.some((r: any) => r.id === emailCustomer), 'search by Kalyan subscriber number');
	const hist = await link.customerHistory(orgId, emailCustomer);
	assert.equal(hist.orders.length, 2);
	assert.ok(hist.dispatches.length >= 4);
	// split: move the Kalyan subscription to a new customer
	const sp = await link.splitCustomer(orgId, emailCustomer, { custnos: ['101'], name: 'Asha Devi (Kalyan)' });
	assert.equal((await one<any>(`select customer_id from kalyan_subscribers where custno='101'`)).customer_id, sp.id);
	assert.equal((await one<any>(`select kalyan_buyer from customers where id=$1`, [emailCustomer])).kalyan_buyer, false);
	// important buyers: alert when they go quiet
	await q(`update orders set ordered_at = now() - interval '120 days' where customer_id=$1`, [emailCustomer]);
	await link.refreshStats(orgId);
	await link.computeTiers(orgId);
	assert.ok((await link.raiseBuyerAlerts(orgId)).buyersQuiet >= 1);
	assert.equal((await link.raiseBuyerAlerts(orgId)).buyersQuiet, 0, 'raised once');
	// replies to send: Platinum and Gold first
	const { listDrafts } = await import('../server/drafts');
	assert.ok(Array.isArray(await listDrafts('d.org_id=$1', [orgId], 'draft')));

	// ── history: kept, removable, original downloadable; the retention job never touches it ──
	const hist2 = await batches.uploadHistory(orgId, new URLSearchParams());
	for (const k of ['orders', 'kalyan', 'books', 'hq', 'branch']) assert.ok(hist2.some((h: any) => h.kind === k), `${k} in the one history`);
	assert.ok((await batches.batchFile(orgId, ob.id))!.bytes.length > 100, 'original file stored');
	const before = (await one<any>(`select count(*)::int n from orders`)).n;
	await q(`update organisations set settings = settings || '{"retentionDays":30}'::jsonb where id=$1`, [orgId]);
	(await import('../server/settings')).invalidateOrg(orgId);
	await (await import('../server/worker')).purgeExpired(orgId);
	assert.equal((await one<any>(`select count(*)::int n from orders`)).n, before, 'retention does not delete uploaded data');
	assert.equal((await one<any>(`select count(*)::int n from upload_batches where deleted_at is null`)).n >= 5, true);
	const extra = await send('orders', csv([OH, ord('GPHO_9100', 'New Person', 'new@example.com', '9876500100', 50, '2026-11-01T10:00:00Z', '', 'India Post')]), 'one-more.csv');
	const rm = await batches.removeBatch(orgId, extra.id, null);
	assert.equal(rm.rowsTakenOut, 1, 'removing takes out only the rows this upload brought in');
	assert.ok(await one(`select 1 from orders where order_key='GPHO_9001'`), 'older orders stay');
	await assert.rejects(batches.removeBatch(orgId, ob.id, null, true), /Remove it first/);
	await batches.removeBatch(orgId, extra.id, null, true);
	assert.equal(await one(`select 1 from upload_batches where id=$1`, [extra.id]), null, 'erased permanently');
	await assert.rejects(batches.startBatch(orgId, null, { kind: 'orders', header: KH }), /Kalyan dispatch file/, 'a Kalyan file in the Orders slot is refused');
	await assert.rejects(batches.startBatch(orgId, null, { kind: 'orders', header: OH.slice(2) }), /missing.*orderId/);
}

// ── Appendix A: editable reasons for contacting ──
{
	const orgId = await defaultOrgId();
	const defs = await import('../server/ai/purposeDefs');
	const P = await import('../server/ai/purposes');
	const { analysisSchema } = await import('../server/ai/types');
	const { requireRole } = await import('../server/auth');
	const { listCustomerDb } = await import('../server/profiles');
	const { crossSell } = await import('../server/stock/inventory');
	const seeded = await defs.getPurposeDefs(orgId);
	assert.deepEqual(seeded.map((d) => d.key).sort(), [...P.PURPOSES].sort(), 'seeded from the 22 reasons');
	assert.ok(seeded.every((d) => d.label === (P.PURPOSE_LABELS as any)[d.key]));
	assert.deepEqual(seeded.filter((d) => d.locked).map((d) => d.key).sort(), ['international', 'kalyan', 'other']);
	// a new reason with keywords reaches the rules engine and the AI choices
	await defs.savePurposes(orgId, null, { reasons: [{ label: 'Audio books', description: 'Asks for audio recordings of books.', group_name: 'Service and engagement', keywords: 'audio book, ऑडियो' }] });
	assert.ok(P.activePurposeKeys().includes('audio_books'));
	assert.ok((analysisSchema() as any).properties.purposes.items.enum.includes('audio_books'));
	assert.ok(P.guessPurposes('Do you have an Audio Book of the Gita?', 'customer_service').includes('audio_books'));
	assert.ok(P.guessPurposes('क्या गीता का ऑडियो उपलब्ध है', 'customer_service').includes('audio_books'), 'Hindi keyword');
	assert.ok(!P.guessPurposes('My audiobookstore order', 'customer_service').includes('audio_books'), 'whole words only');
	// free re-tag: an older thread with the keyword gets the reason; a thread set by hand is left alone
	const cust = await one<any>(`select id from customers where org_id=$1 order by id limit 1`, [orgId]);
	const mk = async (locked: boolean) => {
		const c = await one<any>(`insert into conversations (org_id, customer_id, subject, analysed_at, purposes, purposes_locked, business_category) values ($1,$2,'Audio book please', now(), '{other}', $3, 'customer_service') returning id`, [orgId, cust.id, locked]);
		const mb = await one<any>(`select id from mailboxes where org_id=$1 order by id limit 1`, [orgId]);
		await q(`insert into emails (org_id, mailbox_id, conversation_id, direction, from_address, subject, body_text, body_clean, sent_at, provider_message_id, dedup_key, content_hash)
		         values ($1,$2,$3,'inbound','a@b.com','Audio','I want the audio book','I want the audio book', now(), $4, $4, $4)`, [orgId, mb.id, c.id, `m-audio-${locked}`]);
		return c.id;
	};
	const free = await mk(false).catch((e) => { throw new Error(`could not create a test thread: ${e.message}`); });
	const held = await mk(true);
	await defs.savePurposes(orgId, null, { reasons: [{ key: 'audio_books', keywords: 'audio book, audiobook, ऑडियो' }] });
	await defs.retagTick(orgId);
	assert.deepEqual((await one<any>(`select purposes from conversations where id=$1`, [free])).purposes, ['audio_books'], 'keyword re-tag adds the reason and drops "other"');
	assert.deepEqual((await one<any>(`select purposes from conversations where id=$1`, [held])).purposes, ['other'], 'threads set by hand are skipped');
	assert.ok((await one<any>(`select purposes from customers where id=$1`, [cust.id])).purposes.includes('audio_books'), 'customer refreshed');
	assert.ok((await listCustomerDb(orgId, new URLSearchParams({ purposes: 'audio_books' }))).rows.some((r: any) => r.id === cust.id), 'filter by a new reason');
	// rename keeps the key; hide removes it from the AI but not from old records
	await defs.savePurposes(orgId, null, { reasons: [{ key: 'audio_books', label: 'Audio and video' }] });
	assert.equal(P.purposeLabel('audio_books'), 'Audio and video');
	await defs.savePurposes(orgId, null, { reasons: [{ key: 'audio_books', hidden: true }] });
	assert.ok(!P.activePurposeKeys().includes('audio_books'));
	assert.ok(!(analysisSchema() as any).properties.purposes.items.enum.includes('audio_books'));
	assert.ok((await one<any>(`select purposes from conversations where id=$1`, [free])).purposes.includes('audio_books'), 'kept on old records');
	await assert.rejects(defs.savePurposes(orgId, null, { reasons: [{ key: 'kalyan', hidden: true }] }), /cannot be hidden/);
	await assert.rejects(defs.savePurposes(orgId, null, { reasons: [{ key: 'job', label: 'Kalyan' }] }), /same name/);
	await assert.rejects(defs.savePurposes(orgId, null, { reasons: [{ label: 'No description', description: '' }] }), /needs a description/);
	// merge: tags move without duplicates; a locked reason cannot be merged away
	await q(`update customers set purposes = '{book_order,availability_price}' where id=$1`, [cust.id]);
	const m = await defs.mergePurpose(orgId, null, 'availability_price', 'book_order');
	assert.ok(m.customers >= 1);
	assert.deepEqual((await one<any>(`select purposes from customers where id=$1`, [cust.id])).purposes, ['book_order'], 'no duplicate after a merge');
	assert.deepEqual(P.normalisePurposes(['availability_price']), ['book_order'], 'old key follows the merge');
	await assert.rejects(defs.mergePurpose(orgId, null, 'kalyan', 'other'), /cannot be merged away/);
	await assert.rejects(defs.mergePurpose(orgId, null, 'job', 'audio_books'), /hidden or merged/);
	const cs = await crossSell(orgId);
	assert.ok(cs.segments.every((s: any) => !s.has.includes('availability_price') && !s.not.includes('availability_price')), 'cross-sell groups follow the merge');
	// only managers and above may change the list
	assert.throws(() => requireRole({ id: 1, orgId, role: 'analyst' } as any, 'manager'), (e: any) => e.status === 403);
}
console.log('All pipeline tests passed');
await getPool().end();
