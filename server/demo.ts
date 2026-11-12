/**
 * Demo dataset for Gita Press: 4 Gmail mailboxes, readers writing in Hindi and English, booksellers,
 * temples and distributors, suppliers, internal and automated mail, over the last 60 days,
 * including cross-mailbox duplicates. Everything goes through the real ingestion and analysis pipeline.
 * Only loadable when DEMO_DATA_ENABLED=true.
 */
import { one, q } from './db';
import { getOrg } from './settings';
import { ingestMessages } from './ingest';
import type { MailboxRow, NormalizedMessage } from './connectors/types';

const DOMAIN = 'gitapress.org';
const MAILBOXES = [
	['orders@gitapress.org', 'Book orders'],
	['kalyan@gitapress.org', 'Kalyan'],
	['booksales@gitapress.org', 'Bulk sales'],
	['info@gitapress.org', 'Enquiries'],
] as const;

const STAFF = [
	['Ramesh Tripathi', 'ramesh.tripathi@gitapress.org'],
	['Sushma Pandey', 'sushma.pandey@gitapress.org'],
	['Alok Srivastava', 'alok.srivastava@gitapress.org'],
	['Neha Dubey', 'neha.dubey@gitapress.org'],
];

const READERS: [string, string][] = [
	['Ramesh Sharma', 'ramesh.sharma1958@gmail.com'], ['Sunita Agarwal', 'sunita.agarwal.jpr@gmail.com'], ['Vinod Mishra', 'vinodmishra.vns@gmail.com'],
	['Priya Iyer', 'priya.iyer.chennai@gmail.com'], ['Anil Gupta', 'anilgupta.kanpur@gmail.com'], ['Kavita Joshi', 'kavita.joshi71@gmail.com'],
	['Suresh Patel', 'sureshpatel.amd@gmail.com'], ['Meena Tiwari', 'meena.tiwari.bpl@gmail.com'], ['Rajesh Verma', 'rajeshverma.lko@gmail.com'],
	['Lakshmi Narayanan', 'lakshmi.narayanan.blr@gmail.com'], ['Deepak Singh', 'deepaksingh.patna@gmail.com'], ['Anjali Desai', 'anjali.desai.pune@gmail.com'],
	['Gopal Das', 'gopaldas.mathura@gmail.com'], ['Shanti Devi', 'shantidevi.haridwar@gmail.com'], ['Harish Chandra', 'harishchandra.ddn@gmail.com'],
];

const ORGS: { name: string; domain: string; tier: 'strategic' | 'key' | 'standard'; contact: [string, string]; kind: string }[] = [
	{ name: 'Shri Radha Krishna Mandir Trust', domain: 'radhakrishnamandirtrust.in', tier: 'strategic', contact: ['Pt. Mahesh Shastri', 'mahesh.shastri'], kind: 'customer' },
	{ name: 'Shri Ram Pustak Bhandar', domain: 'shrirampustak.in', tier: 'key', contact: ['Mohan Lal Gupta', 'mohanlal'], kind: 'partner' },
	{ name: 'Bhakti Book Distributors', domain: 'bhaktibooks.co.in', tier: 'key', contact: ['Sanjay Khandelwal', 'sanjay'], kind: 'partner' },
	{ name: 'Vidya Niketan Senior Secondary School', domain: 'vidyaniketanschool.edu.in', tier: 'standard', contact: ['Mrs. Rekha Saxena', 'principal'], kind: 'customer' },
	{ name: 'Sanatan Dharma Sabha Nairobi', domain: 'sanatansabhanairobi.org', tier: 'standard', contact: ['Hitesh Shah', 'hitesh.shah'], kind: 'prospect' },
	{ name: 'Saraswati Paper Mills', domain: 'saraswatipapermills.in', tier: 'standard', contact: ['Vikram Bansal', 'vikram.bansal'], kind: 'vendor' },
];

type Step = { dir: 'in' | 'out' | 'int'; after: number; text: string };
interface Scenario { mood: number; mailbox: number; subject: string; steps: Step[] }

const BOOKS = ['Sadhak Sanjeevani', 'Shrimad Bhagavad Gita Tattva Vivechani', 'Ramcharitmanas (Mota Type)', 'Sundar Kand', 'Hanuman Chalisa', 'Shrimad Bhagavata Purana (2 volumes)', 'Vishnu Sahasranam'];

/** Reader threads. `ref` is an order or subscriber number. */
const readerScenarios = (ref: string, book: string, rs: number): Scenario[] => [
	{ mood: -1, mailbox: 0, subject: `Order ${ref} not received`, steps: [
		{ dir: 'in', after: 0, text: `Respected Sir,\n\nI placed order ${ref} for ${book} on your website three weeks ago and paid Rs ${rs} by UPI. I have still not received the parcel and there is no tracking number in my account.\n\nPlease let me know when it will be delivered.\n\nJai Shri Krishna` },
	] },
	{ mood: -1, mailbox: 0, subject: `पुस्तक के पृष्ठ फटे हुए हैं - ${ref}`, steps: [
		{ dir: 'in', after: 0, text: `आदरणीय महोदय,\n\nमुझे ऑर्डर ${ref} में ${book} की प्रति मिली, परंतु उसके लगभग 20 पृष्ठ फटे हुए हैं और कुछ पृष्ठ उलटे छपे हैं। कृपया नई प्रति भेजने की व्यवस्था करें।\n\nसादर` },
	] },
	{ mood: -1, mailbox: 0, subject: `Payment deducted but order failed`, steps: [
		{ dir: 'in', after: 0, text: `Hello,\n\nRs ${rs} was deducted from my bank account but your website showed "payment failed" and no order was created. UPI transaction ID 4${rs}88231907. Please refund the amount or confirm the order urgently.\n\nThanks` },
		{ dir: 'in', after: 2880, text: `This is my second email. Still no reply and no refund. Please respond.` },
	] },
	{ mood: -1, mailbox: 1, subject: `कल्याण का अंक प्राप्त नहीं हुआ - ग्राहक संख्या ${ref}`, steps: [
		{ dir: 'in', after: 0, text: `आदरणीय महोदय,\n\nमेरी कल्याण ग्राहक संख्या ${ref} है। इस माह का अंक अभी तक नहीं मिला है, जबकि मेरे पड़ोसी को मिल चुका है। कृपया अंक पुनः भेजने का कष्ट करें।\n\nधन्यवाद` },
		{ dir: 'out', after: 1440, text: `आदरणीय महोदय,\n\nआपका पत्र प्राप्त हुआ। हमने अंक आज पुनः डाक से भेज दिया है।\n\nसादर` },
		{ dir: 'in', after: 7200, text: `अंक प्राप्त हो गया। बहुत धन्यवाद। राधे राधे।` },
	] },
	{ mood: 0, mailbox: 1, subject: `Change of address for Kalyan subscription ${ref}`, steps: [
		{ dir: 'in', after: 0, text: `Namaste,\n\nI have moved house. Please send my Kalyan issues from next month to my new address:\nFlat 302, Shanti Apartments, Gomti Nagar, Lucknow, PIN 226010.\n\nSubscriber number ${ref}.\n\nThank you` },
	] },
	{ mood: 0, mailbox: 3, subject: `Ramcharitmanas in Tamil with meaning?`, steps: [
		{ dir: 'in', after: 0, text: `Dear Gita Press,\n\nIs the Ramcharitmanas available in Tamil with word meaning? If yes, could you tell me the price and how I can order it from Chennai?\n\nRegards` },
	] },
	{ mood: 0, mailbox: 3, subject: `Question about Gita chapter 2 verse 47`, steps: [
		{ dir: 'in', after: 0, text: `Pranam,\n\nIn Sadhak Sanjeevani the commentary on chapter 2 verse 47 explains "karmanye vadhikaraste". Could you please tell me which edition has the detailed explanation in English?\n\nHari Om` },
	] },
	{ mood: 1, mailbox: 0, subject: `Thank you for the beautiful Gita`, steps: [
		{ dir: 'in', after: 0, text: `Respected Sir,\n\nI received ${book} today. The printing and binding are beautiful and the price is so reasonable. Thank you so much for your seva. Radhe Radhe.` },
	] },
	{ mood: -1, mailbox: 0, subject: `Wrong edition sent - ${ref}`, steps: [
		{ dir: 'in', after: 0, text: `Hello,\n\nI ordered the Hindi edition of ${book} (order ${ref}) but received the English edition. Please send the correct book and tell me how to return this one.\n\nRegards` },
		{ dir: 'out', after: 600, text: `Respected Sir,\n\nWe are sorry for the mistake. We will send the Hindi edition by Friday. You may keep the English copy.\n\nRegards,\nGita Press` },
		{ dir: 'in', after: 4320, text: `Thank you, I received the correct book.` },
	] },
	{ mood: -1, mailbox: 0, subject: `Third reminder - order ${ref} - no response`, steps: [
		{ dir: 'in', after: 0, text: `Sir,\n\nI placed order ${ref} more than a month ago and paid Rs ${rs}. Nothing has arrived.` },
		{ dir: 'in', after: 4320, text: `No reply to my last email. Please update me on order ${ref}.` },
		{ dir: 'in', after: 5760, text: `This is my third email and nobody has answered. This is very disappointing. If I do not get my books or a refund this week I will file a complaint in the consumer forum.` },
	] },
	{ mood: 0, mailbox: 0, subject: `Cannot log in to the Gita Press app`, steps: [
		{ dir: 'in', after: 0, text: `Hello,\n\nI bought e-books in the Gita Press app but after changing my phone I cannot log in. The OTP never arrives. How can I get my e-books back?\n\nThanks` },
	] },
	{ mood: 0, mailbox: 1, subject: `Kalyan subscription renewal`, steps: [
		{ dir: 'in', after: 0, text: `Namaste,\n\nMy Kalyan subscription ${ref} ends in December. How do I renew it for next year, and what is the fee?\n\nDhanyavad` },
		{ dir: 'out', after: 900, text: `Namaste,\n\nYou can renew by money order or online on our website. The annual fee and details are on the subscription page.\n\nRegards,\nKalyan office` },
	] },
];

/** Bulk, distributor, supplier, internal, people and automated threads. ext: index into ORGS, or 'auto'. */
interface XThread { mailbox: number; subject: string; ext: number | 'auto' | 'job'; steps: { from: 'ext' | 'staff' | 'staff2'; after: number; text: string }[] }
const extraThreads: XThread[] = [
	{ mailbox: 2, ext: 0, subject: 'Requirement of 5,000 copies of Shrimad Bhagavad Gita', steps: [
		{ from: 'ext', after: 0, text: `Respected Sir,\n\nFor Gita Jayanti celebrations our trust needs 5,000 copies of the Shrimad Bhagavad Gita (Hindi, pocket size, with meaning) within 2 months, delivered to our temple in Indore.\n\nPlease confirm whether this quantity can be supplied in time, the price per copy with any trade discount for a religious trust, and the delivery charges.\n\nWith regards,\nPt. Mahesh Shastri\nShri Radha Krishna Mandir Trust` },
	] },
	{ mailbox: 2, ext: 1, subject: 'Dealership enquiry - Shri Ram Pustak Bhandar, Jaipur', steps: [
		{ from: 'ext', after: 0, text: `Namaste,\n\nWe run a religious bookshop in Jaipur and would like to become an authorised stockist of Gita Press books. Please send the dealership terms, trade discount and the latest price list.\n\nMohan Lal Gupta` },
	] },
	{ mailbox: 2, ext: 2, subject: 'Quote for 1,200 assorted titles for Diwali stock', steps: [
		{ from: 'ext', after: 0, text: `Dear Sir,\n\nPlease quote for 1,200 assorted copies (Sundar Kand, Hanuman Chalisa, Vishnu Sahasranam) for our Diwali stock, delivered to Kolkata by 15 November.` },
		{ from: 'staff', after: 1440, text: `Dear Sanjay ji,\n\nPlease find attached our quotation for the 1,200 copies with the standard distributor discount.\n\nRegards` },
		{ from: 'ext', after: 2880, text: `Thank you. Can you do better on the discount? Another publisher has offered 5% more. We would also need delivery by 10 November.` },
	] },
	{ mailbox: 2, ext: 3, subject: '300 copies of Hanuman Chalisa for school prayer', steps: [
		{ from: 'ext', after: 0, text: `Respected Sir,\n\nOur school would like 300 copies of the Hanuman Chalisa for morning prayer. Please quote.\n\nPrincipal` },
		{ from: 'staff', after: 1200, text: `Respected Madam,\n\nPlease find attached our quotation for 300 copies including delivery.\n\nRegards` },
		{ from: 'ext', after: 2880, text: `Thank you. The quotation is approved, please go ahead. Payment will be made by NEFT.` },
	] },
	{ mailbox: 3, ext: 4, subject: 'Books for our community library in Nairobi', steps: [
		{ from: 'ext', after: 0, text: `Namaste,\n\nOur Sabha in Nairobi would like to order about 400 books for our community library. Do you ship to Kenya, and can you send a price list in USD?\n\nHitesh Shah` },
	] },
	{ mailbox: 3, ext: 5, subject: 'Revised paper rates from December', steps: [
		{ from: 'ext', after: 0, text: `Dear Sir,\n\nDue to the increase in pulp prices our rate for 58 GSM maplitho paper will be revised from 1 December. The revised rate sheet is attached. Please confirm your requirement for the next quarter.\n\nVikram Bansal\nSaraswati Paper Mills` },
		{ from: 'staff', after: 2000, text: `Vikram ji,\n\nWe have received the revised rates. We will review and confirm our quarterly requirement by next week.\n\nRegards` },
	] },
	{ mailbox: 0, ext: 'auto', subject: 'Daily settlement report', steps: [
		{ from: 'ext', after: 0, text: `Your settlement for yesterday has been processed. 214 payments, total Rs 1,86,450. This is an automated message.` },
	] },
	{ mailbox: 3, ext: 'job', subject: 'Application for the post of Hindi proofreader', steps: [
		{ from: 'ext', after: 0, text: `Respected Sir,\n\nI wish to apply for the post of Hindi proofreader advertised on your career page. I have an MA in Hindi and 6 years of experience. My resume is attached.\n\nRegards` },
	] },
	{ mailbox: 0, ext: -1, subject: 'Sundar Kand (pocket) out of stock at Gorakhpur', steps: [
		{ from: 'staff', after: 0, text: `Alok ji,\n\nSundar Kand pocket size is out of stock in the Gorakhpur godown and we have 40 pending orders. When is the reprint due?` },
		{ from: 'staff2', after: 300, text: `The reprint is with the press. I will confirm the date by tomorrow and update the website stock.` },
	] },
];

const AUTOMATED: [string, string][] = [['Payment Gateway', 'settlements@payments-demo.in'], ['India Post Business', 'noreply@indiapost-demo.in']];

function rnd(seed: number) {
	let s = seed;
	return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export async function loadDemoData(orgId: number, assignToUserId?: number) {
	const org = await getOrg(orgId);
	if (!org.internalDomains.includes(DOMAIN)) {
		await q(`update organisations set internal_domains = array_append(internal_domains, $2) where id=$1`, [orgId, DOMAIN]);
	}
	const freshOrg = await getOrg(orgId, true);
	const rand = rnd(108);
	const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];

	const mbs: MailboxRow[] = [];
	for (const [addr, name] of MAILBOXES) {
		const row = await one<MailboxRow>(
			`insert into mailboxes (org_id, provider, address, display_name, status, last_synced_at)
			 values ($1,'demo',$2,$3,'active', now())
			 on conflict (org_id, provider, lower(address)) do update set display_name=excluded.display_name returning *`,
			[orgId, addr, name],
		);
		mbs.push(row!);
	}
	for (const o of ORGS) {
		await q(
			`insert into customers (org_id, name, domains, tier, auto_created, kind) select $1,$2,$3,$4,false,$6
			 where not exists (select 1 from customers where org_id=$1 and $5 = any(domains))`,
			[orgId, o.name, [o.domain], o.tier, o.domain, o.kind],
		);
	}

	const byMailbox = new Map<number, NormalizedMessage[]>();
	const push = (id: number, m: NormalizedMessage) => { const a = byMailbox.get(id) || []; a.push(m); byMailbox.set(id, a); };
	const now = Date.now();
	let n = 0;

	for (let i = 0; i < 110; i++) {
		const [rname, raddr] = READERS[i % READERS.length];
		const list = readerScenarios(i % 3 === 1 ? `SUB-${74000 + i * 13}` : `GP-${2610000 + i * 37}`, pick(BOOKS), 150 + Math.floor(rand() * 18) * 50);
		// most reader mail is routine; about a third is a problem
		const pool = rand() < 0.36 ? list.filter((s) => s.mood < 0) : list.filter((s) => s.mood >= 0);
		const sc = pick(pool);
		const mb = mbs[sc.mailbox];
		const [sname, saddr] = pick(STAFF);
		let t = now - Math.floor(rand() * 60 * 1440) * 60_000;
		const thread = `demo-r-${i}`;
		let prev: string | null = null;
		for (const [si, st] of sc.steps.entries()) {
			t += st.after * 60_000;
			if (t > now) break;
			const mid = `<demo-r-${i}-${si}@${st.dir === 'in' ? 'gmail.com' : DOMAIN}>`;
			const msg: NormalizedMessage = {
				providerMessageId: `demo-r-${i}-${si}-${mb.id}`, internetMessageId: mid, threadId: thread, inReplyTo: prev, references: prev ? [prev] : [],
				from: st.dir === 'in' ? { address: raddr, name: rname } : { address: mb.address, name: `${mb.display_name}, Gita Press` },
				to: st.dir === 'in' ? [{ address: mb.address, name: mb.display_name }] : [{ address: raddr, name: rname }],
				cc: st.dir === 'out' ? [{ address: saddr, name: sname }] : [],
				subject: si === 0 ? sc.subject : `Re: ${sc.subject}`,
				bodyText: st.dir === 'in' ? `${st.text}\n\n${rname}` : st.text,
				sentAt: new Date(t), hasAttachments: false, importance: null, webLink: null,
				folder: st.dir === 'in' ? 'inbox' : 'sent', isAutomated: false,
			};
			push(mb.id, msg);
			// some readers write to two addresses at once → cross-mailbox duplicates
			if (st.dir === 'in' && rand() < 0.2) {
				const other = mbs[3];
				if (other.id !== mb.id) push(other.id, { ...msg, providerMessageId: `demo-r-${i}-${si}-${other.id}`, threadId: `${thread}-x`, to: [...msg.to, { address: other.address, name: other.display_name }] });
			}
			prev = mid;
			n++;
		}
	}

	for (let i = 0; i < 36; i++) {
		const xt = extraThreads[i % extraThreads.length];
		const round = Math.floor(i / extraThreads.length);
		const mb = mbs[xt.mailbox];
		const ext: [string, string, string] = xt.ext === 'auto'
			? [...AUTOMATED[i % AUTOMATED.length], ''] as [string, string, string]
			: xt.ext === 'job' ? ['Pooja Mishra', `pooja.mishra.${round}@gmail.com`, '']
			: xt.ext === -1 ? ['', '', '']
			: [ORGS[xt.ext].contact[0], `${ORGS[xt.ext].contact[1]}${round ? round : ''}@${ORGS[xt.ext].domain}`, ORGS[xt.ext].name];
		const [s1n, s1a] = STAFF[i % STAFF.length];
		const [s2n, s2a] = STAFF[(i + 2) % STAFF.length];
		let t = now - Math.floor(rand() * 50 * 1440) * 60_000;
		const thread = `demo-x-${i}`;
		let prev: string | null = null;
		for (const [si, st] of xt.steps.entries()) {
			t += st.after * 60_000;
			if (t > now) break;
			const from = st.from === 'ext' ? { address: ext[1], name: ext[0] } : st.from === 'staff' ? { address: s1a, name: s1n } : { address: s2a, name: s2n };
			const to = st.from === 'ext' ? [{ address: mb.address, name: mb.display_name }]
				: ext[1] ? [{ address: ext[1], name: ext[0] }] : [{ address: st.from === 'staff' ? s2a : s1a, name: st.from === 'staff' ? s2n : s1n }];
			const mid = `<demo-x-${i}-${si}@demo>`;
			push(mb.id, {
				providerMessageId: `demo-x-${i}-${si}`, internetMessageId: mid, threadId: thread, inReplyTo: prev, references: prev ? [prev] : [],
				from, to, cc: st.from !== 'ext' && ext[1] ? [{ address: mb.address, name: mb.display_name }] : [],
				subject: si === 0 ? `${xt.subject}${round ? ` (${round + 1})` : ''}` : `Re: ${xt.subject}${round ? ` (${round + 1})` : ''}`,
				bodyText: st.from === 'ext' ? st.text : `${st.text}\n\n${from.name}\nGita Press, Gorakhpur`,
				sentAt: new Date(t), hasAttachments: /attached/.test(st.text), importance: null, webLink: null,
				folder: st.from === 'ext' ? 'inbox' : 'sent', isAutomated: xt.ext === 'auto',
			});
			prev = mid;
			n++;
		}
	}

	let inserted = 0;
	let duplicates = 0;
	const all = [...byMailbox.entries()].flatMap(([id, msgs]) => msgs.map((m) => ({ id, m })));
	all.sort((a, b) => a.m.sentAt.getTime() - b.m.sentAt.getTime());
	for (const { id, m } of all) {
		const mb = mbs.find((x) => x.id === id)!;
		const r = await ingestMessages(freshOrg, mb, [m]);
		inserted += r.inserted;
		duplicates += r.duplicates;
	}
	await q(`update mailboxes set messages_synced = (select count(*) from emails e where e.mailbox_id = mailboxes.id) where org_id=$1 and provider='demo'`, [orgId]);
	await q(
		`update conversations set status='resolved', resolved_at=last_message_at + interval '1 day'
		  where org_id=$1 and status='open' and last_message_at < now() - interval '8 days'
		    and (last_outbound_at >= coalesce(last_inbound_at, last_outbound_at) or (id % 3) <> 0)
		    and id in (select distinct e.conversation_id from emails e join mailboxes m on m.id=e.mailbox_id where m.provider='demo')`,
		[orgId],
	);
	if (assignToUserId) {
		await q(
			`update conversations set assignee_id=$2 where org_id=$1 and status in ('open','in_progress') and (id % 3 = 0 or business_category = 'sales_proposal')
			   and id in (select distinct e.conversation_id from emails e join mailboxes m on m.id=e.mailbox_id where m.provider='demo')`,
			[orgId, assignToUserId],
		);
	}
	return { generated: n, inserted, duplicates };
}

export async function clearDemoData(orgId: number) {
	await q(`delete from conversations where org_id=$1 and id in (select distinct e.conversation_id from emails e join mailboxes m on m.id=e.mailbox_id where m.provider='demo')`, [orgId]);
	await q(`delete from mailboxes where org_id=$1 and provider='demo'`, [orgId]);
	await q(`delete from customers c where org_id=$1 and not c.from_uploads and c.orders_count = 0 and not c.kalyan_buyer and not exists (select 1 from conversations v where v.customer_id=c.id)`, [orgId]);
	await q(`delete from alerts a where org_id=$1 and conversation_id is null and customer_id is null`, [orgId]);
	await q(`delete from action_items where org_id=$1 and conversation_id is null and source='demo'`, [orgId]).catch(() => {});
}

/** Demo data is for demos only; the live site keeps it off unless DEMO_DATA_ENABLED=true. */
export const demoEnabled = () => process.env.DEMO_DATA_ENABLED === 'true';
