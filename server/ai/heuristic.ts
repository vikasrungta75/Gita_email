/**
 * Deterministic analyser. Used when no LLM is configured, as a fallback when the LLM call fails,
 * and in tests. Tuned for Gita Press: readers, book orders, Kalyan subscriptions, VPP dispatch,
 * distributors and general business email, in English and Hindi.
 */
import { normaliseSubcategory } from './taxonomy';
import { guessPurposes } from './purposes';
import { CATEGORY_LABELS, type Analysis, type BusinessCategory, type Category, type ProposalStage, type Sentiment, type ThreadInput } from './types';

const NEG: [RegExp, number][] = [
	[/\b(unacceptable|appalling|disgraceful|ridiculous|shocking|outrageous|furious|livid)\b/i, 3],
	[/\b(very|extremely|deeply|really) (disappointed|unhappy|frustrated|concerned|annoyed)\b/i, 3],
	[/\b(disappointed|unhappy|frustrated|annoyed|upset|dissatisfied|not happy|poor service|terrible|awful|worst)\b/i, 2],
	[/\b(complain(t|ing)?|failure|failed|missed|late again|still (not|no|waiting)|no one (has )?(called|replied|responded)|chas(e|ing))\b/i, 1.5],
	[/\b(late|delay(ed)?|overdue|damaged?|broken|lost|missing|wrong|incorrect|error|overcharg(ed|e)|dispute|refund|credit note)\b/i, 1],
	[/\b(issue|problem|concern|unfortunately|again)\b/i, 0.5],
	[/\b(cancel|legal action|consumer forum|lawyer|chargeback|social media|claim)\b/i, 3],
	[/बहुत (निराश|दुखी)|शर्मनाक|बेकार सेवा|शिकायत/i, 2.5],
	[/नहीं मिला|नहीं मिली|नहीं मिले|खराब|फटे|फटी|फटा|गलत/i, 1.2],
	[/!{2,}/, 1],
];
const POS: [RegExp, number][] = [
	[/\b(excellent|outstanding|fantastic|brilliant|superb|amazing|exceptional)\b/i, 2.5],
	[/\b(thank you so much|really appreciate|much appreciated|great job|well done|impressed|delighted|very happy|pleased)\b/i, 2],
	[/\b(thanks|thank you|appreciate|great|good|happy|helpful|smooth|on time|resolved|sorted|blessings)\b/i, 0.8],
	[/धन्यवाद|आभार|प्रसन्न|बहुत अच्छा/i, 1.5],
];
const PROMO = /\b(unsubscribe|opt[- ]?out|view (this|it) in (your|a) browser|free listing|list your business|grow your (business|sales)|boost your (sales|business)|seo services|digital marketing|create opportunities|limited[- ]time offer|special offer|book your (stall|space)|visitor registration|register (now|today)|webinar|expo 20\d\d|second[- ]hand|used machine|policy violation notice|anyone can edit your|justdial|indiamart|tradeindia|bulk sms|whatsapp marketing)\b/i;
const NEGATION = /\b(not|no|never|isn't|wasn't|aren't|don't|didn't)\s+(\w+\s+)?$/i;

// Hindi words have no \b boundaries in JS regex, so they are matched as plain alternatives
const CATS: [Category, RegExp][] = [
	['delay', /\b(late|delay(ed|s)?|not (yet )?(arrived|delivered|dispatched)|hasn'?t arrived|still waiting|overdue|taking (so )?long)\b|देर|विलंब|अभी तक नहीं/i],
	['not_received', /\b(not received|never (received|arrived)|did(n'?t| not) (receive|get)|have not got|haven'?t (received|got)|parcel (is )?missing|lost (in post|parcel))\b|नहीं मिल|प्राप्त नहीं/i],
	['damage', /\b(damaged?|torn|wet|water damaged|pages? (missing|torn|blank|upside down)|misprint(ed)?|printing (error|mistake)|binding (is )?(loose|broken)|cover (is )?(torn|damaged))\b|फटे|फटी|फटा|खराब|छपाई|क्षतिग्रस्त/i],
	['wrong_item', /\b(wrong (book|item|edition|language|title|copy)|sent (me )?the wrong|missing (book|item|copy|copies)|short (supplied|shipped)|incomplete (order|set))\b|गलत पुस्तक|गलत किताब/i],
	['billing', /\b(invoice|gst|tax invoice|billed|overcharg|incorrect (charge|amount)|gstin)\b/i],
	['payment', /\b(payment (failed|failure|pending|deducted)|money (was )?deducted|amount (was )?debited|debited but|upi|transaction (failed|id)|paid but)\b|भुगतान|पैसे कट/i],
	['refund', /\b(refund|cancel (my |the )?order|cancellation|money back|return (the|my) (book|order))\b|रिफंड|पैसे वापस/i],
	['pricing', /\b(price|cost|how much|discount|mrp|price list|catalogue)\b|मूल्य|कीमत|दाम/i],
	['out_of_stock', /\b(out of stock|not available|unavailable|reprint|back in stock)\b|उपलब्ध नहीं/i],
	['subscription', /\b(kalyan|kalyana[- ]?kalpataru|subscription|subscriber|annual (member|subscription)|renew(al)?|issue not received)\b|कल्याण|सदस्यता|ग्राहक संख्या|वार्षिक/i],
	['address_change', /\b(change (of|my) address|new address|address (has )?changed|update (my )?address|wrong address)\b|पता बदल/i],
	['tracking', /\b(track(ing)?|tracking (number|id)|vpp|v\.p\.p|india post|speed post|registered post|consignment|courier|awb|where is my (order|parcel))\b|वी\.?पी\.?पी|डाक/i],
	['website_app', /\b(the app|mobile app|e-?books?|log ?in|password|otp|android|iphone|website (is )?(down|not working|not opening))\b/i],
	['bulk_order', /\b(bulk|wholesale|distributor|dealer(ship)?|bookseller|book seller|stockist|trade discount|for (our )?(temple|school|ashram|library|satsang)|\d{1,3}(,\d{3})+ (copies|books)|\d{3,} (copies|books|nos))\b|थोक|विक्रेता/i],
	['language_edition', /\b(translation|translate|in (english|tamil|telugu|kannada|marathi|gujarati|bengali|odia|malayalam|nepali|sanskrit)( edition| version)?|edition|large print|pocket size|audio ?book)\b|अनुवाद|संस्करण/i],
	['content_query', /\b(shloka|sloka|verse|chapter|meaning of|commentary|tika|scripture)\b|श्लोक|अध्याय/i],
	['communication', /\b(no (one|response|reply|update)|not (been )?(updated|informed|told)|nobody (replied|answered)|ignored|chasing|still waiting for (a )?(reply|response|update)|phone (is )?not (answered|picked))\b|कोई जवाब नहीं|उत्तर नहीं/i],
	['contract', /\b(consumer (forum|court)|legal|lawyer|advocate|police complaint|social media|twitter|chargeback|escalat(e|ion)|terminate|cancel (the|our) dealership)\b|उपभोक्ता/i],
	['service_failure', /\b(failed|failure|not delivered|delivered to the wrong|returned to sender|rts|undelivered)\b/i],
	['compliment', /\b(thank you so much|great (job|service|work)|well done|excellent service|really appreciate|blessings|grateful|jai shri krishna|radhe radhe|hari om)\b|आभार|जय श्री कृष्ण|राधे राधे|हरि ॐ/i],
	['enquiry', /\b(could you (please )?(let me know|confirm|advise)|can you (confirm|advise|tell)|enquir(y|e|ies)|query|question|wondering|is it possible|do you have)\b|कृपया बताएं|क्या आप/i],
];

const URGENT = /\b(urgent(ly)?|asap|immediately|right away|critical|(need|needs|needed|require|required|must|by|before) (it |this |a response |an answer |them )?(today|tonight)|today please|within the hour|end of (the )?day|top priority|emergency|for (a |the )?(puja|katha|yagya|wedding|event) (on|this|next))\b|तुरंत|जल्दी|अति आवश्यक/i;
const LEGAL = /\b(legal action|lawyer|advocate|consumer (forum|court)|police complaint|post (this )?on (social media|twitter|facebook)|chargeback|cancel (the |our )?dealership|formal (complaint|claim)|compensation|final (notice|warning))\b|उपभोक्ता फोरम|कानूनी/i;

const COMMIT_US = /\b(we will|we'll|i will|i'll|we are going to|we're going to|we shall|let me|i am going to|we can confirm we will)\b/i;
const REQUEST = /\b(please|kindly|can you|could you|would you|need you to|we need|require|request that|i'd like you to|make sure)\b/i;

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function sentences(text: string): string[] {
	return text
		.replace(/\n+/g, '. ')
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.trim().replace(/^[-•*]\s*/, ''))
		.filter((s) => s.length > 3);
}

function scoreText(text: string): number {
	let neg = 0;
	let pos = 0;
	for (const s of sentences(text)) {
		for (const [re, w] of NEG) {
			const m = re.exec(s);
			if (m) {
				const before = s.slice(0, m.index);
				neg += NEGATION.test(before) && w < 2.5 ? -0.3 * w : w;
			}
		}
		for (const [re, w] of POS) {
			const m = re.exec(s);
			if (m) {
				const before = s.slice(0, m.index);
				if (NEGATION.test(before)) neg += w;
				else pos += w;
			}
		}
	}
	const shouting = (text.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !/^(ASAP|VPP|GST|GSTIN|UPI|OTP|MRP|PIN|INV|NEFT|RTGS|IMPS|IFSC|PAN|PDF|URGENT|NOTE|ISBN|COD|AWB)$/.test(w)).length;
	if (shouting >= 3) neg += Math.min((shouting - 2) * 0.5, 2);
	if (/\bURGENT\b/.test(text)) neg += 0.5;
	const raw = (pos - neg) / Math.max(3, pos + neg);
	return Math.max(-1, Math.min(1, Number(raw.toFixed(2))));
}

const toSentiment = (s: number): Sentiment => (s <= -0.2 ? 'negative' : s >= 0.2 ? 'positive' : 'neutral');

function parseDue(text: string, base: Date): string | null {
	const t = text.toLowerCase();
	const d = new Date(base);
	const iso = (x: Date) => x.toISOString().slice(0, 10);
	if (/\b(today|end of (the )?day|eod|by close of business|cob|this afternoon|tonight)\b/.test(t)) return iso(d);
	if (/\btomorrow\b/.test(t)) { d.setUTCDate(d.getUTCDate() + 1); return iso(d); }
	const within = /\bwithin (\d{1,2}) ?(hours|hrs|days|working days)\b/.exec(t);
	if (within) {
		const n = Number(within[1]);
		d.setUTCDate(d.getUTCDate() + (within[2].startsWith('h') ? Math.ceil(n / 24) : n));
		return iso(d);
	}
	const day = /\b(?:by|on|before|this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(t);
	if (day) {
		const target = DAYS.indexOf(day[1]);
		let diff = (target - d.getUTCDay() + 7) % 7 || 7;
		if (/next\s/.test(day[0]) && diff < 7) diff += 0;
		d.setUTCDate(d.getUTCDate() + diff);
		return iso(d);
	}
	if (/\b(end of (the )?week|this week)\b/.test(t)) {
		const diff = (5 - d.getUTCDay() + 7) % 7;
		d.setUTCDate(d.getUTCDate() + diff);
		return iso(d);
	}
	const dm = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(t);
	if (dm) {
		const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(dm[2]);
		const x = new Date(Date.UTC(d.getUTCFullYear(), month, Number(dm[1])));
		if (x.getTime() < base.getTime() - 30 * 86400_000) x.setUTCFullYear(x.getUTCFullYear() + 1);
		return iso(x);
	}
	const num = /\bby\s+(\d{1,2})[/.-](\d{1,2})\b/.exec(t);
	if (num) {
		const x = new Date(Date.UTC(d.getUTCFullYear(), Number(num[2]) - 1, Number(num[1])));
		if (!isNaN(x.getTime())) return iso(x);
	}
	return null;
}

const uniq = <T,>(a: T[]) => [...new Set(a)];

function entities(text: string) {
	return {
		shipment_refs: uniq([
			...(text.match(/\b(?:GP|ORD|ORDER|VPP|SUB|KAL|REF|AWB)[-#:\s]?(?:NO\.?\s*)?\d{4,}[A-Z0-9-]*\b/gi) || []).map((s) => s.toUpperCase().replace(/\s+/g, '')),
			...(text.match(/\b[A-Z]{2}\d{9}IN\b/g) || []), // India Post article numbers
		]).slice(0, 10),
		invoice_refs: uniq((text.match(/\b(?:INV|INVOICE|CN|CREDIT NOTE)[-#:\s]*(?:NO\.?\s*)?\d{3,}\b/gi) || []).map((s) => s.toUpperCase())).slice(0, 10),
		// book titles and codes (kept in the vehicle_regs slot of the shared schema)
		vehicle_regs: uniq([
			...(text.match(/\b(?:Bhagavad Gita|Shrimad Bhagavad Gita|Gita Tattva Vivechani|Sadhak Sanjeevani|Ramcharitmanas|Ramayana?|Mahabharata?|Bhagavata? Purana?|Hanuman Chalisa|Sundar Kand|Vishnu Sahasranam|Kalyan)\b/gi) || []),
			...(text.match(/\b(?:book|code|item) (?:no\.?|code|#)\s?\d{1,5}\b/gi) || []),
			...(text.match(/गीता|रामचरितमानस|सुन्दरकाण्ड|हनुमान चालीसा|भागवत|महाभारत/g) || []),
		]).slice(0, 10),
		amounts: uniq(text.match(/(?:₹|Rs\.?|INR|रु\.?|£|\$|€|USD|GBP)\s?\d[\d,]*(?:\.\d{1,2})?(?:k|m|lakh)?/gi) || []).slice(0, 10),
		locations: uniq((text.match(/\b(?:PIN|pin ?code|pincode)[:\s-]*\d{6}\b|\b(?:branch|shop|store|depot) (?:in |at )?[A-Z][a-z]+(?: [A-Z][a-z]+)?/gi) || [])).slice(0, 8),
		dates: [] as string[],
	};
}

const BUSINESS_RULES: [BusinessCategory, RegExp, number][] = [
	['sales_proposal', /\b(bulk|wholesale|distributor|dealer(ship)?|bookseller|stockist|trade discount|quotation|quote|price list|tender|proposal|\d{1,3}(,\d{3})+ (copies|books)|\d{3,} (copies|books|nos)|for (our )?(temple|school|ashram|library|satsang|institution))\b|थोक|विक्रेता/gi, 3],
	['kalyan', /\b(kalyan|kalyana[- ]?kalpataru|subscription|subscriber|annual (member|subscription)|renewal)\b|कल्याण|सदस्यता|ग्राहक संख्या/gi, 3],
	['dispatch', /\b(vpp|v\.p\.p|india post|speed post|registered post|courier|parcel|dispatch(ed)?|tracking|delivered|delivery|consignment|returned to sender|rts)\b|डाक|पार्सल/gi, 2],
	['book_orders', /\b(order(ed)?|order (no|number|id)|cart|checkout|website|app|e-?book|buy|purchase|copies of|book code)\b|ऑर्डर|पुस्तक मंगा/gi, 2],
	['billing_finance', /\b(invoice|gst|payment|refund|upi|neft|rtgs|bank|deducted|debited|transaction|accounts?|statement|tds)\b|भुगतान|रिफंड/gi, 2],
	['publications', /\b(translation|translate|edition|reprint|errata|typo|proof ?read|manuscript|permission to (print|publish|quote)|copyright|commentary|tika|shloka|verse)\b|अनुवाद|संस्करण|श्लोक/gi, 2],
	['vendor_partner', /\b(paper (mill|supply|rate)|ink|binding|printing (press|machine)|plates?|vendor|supplier|purchase order|po number|software|licen[sc]e|amc|maintenance contract|transporter)\b/gi, 2],
	['people_hr', /\b(career|job|vacancy|recruit|hiring|interview|candidate|payroll|salary|leave application|resume|cv|appointment letter)\b|नौकरी|आवेदन/gi, 3],
	['events_marketing', /\b(book fair|pustak mela|exhibition|stall|event|newsletter|media|press release|interview request|documentary|webinar)\b|पुस्तक मेला|प्रदर्शनी/gi, 2],
];

function classifyBusiness(input: ThreadInput, text: string, hasIssues: boolean, negative: boolean): BusinessCategory {
	if (input.isAutomated) return /webinar|event|book fair|newsletter|register/i.test(text) ? 'events_marketing' : 'notifications';
	const scores = new Map<BusinessCategory, number>();
	for (const [cat, re, w] of BUSINESS_RULES) scores.set(cat, (text.match(re) || []).length * w);
	const external = !input.isInternal;
	const first = input.messages[0];
	// we asked an outside company for a quote → procurement, not sales
	if (external && first?.direction === 'outbound' && /\b(quote|quotation|price|rate)\b/i.test(`${first.subject} ${first.body}`) && /\b(paper|ink|binding|printing|supply|supplier|transport)\b/i.test(`${first.subject} ${first.body}`)) {
		scores.set('vendor_partner', (scores.get('vendor_partner') || 0) + 8);
		scores.set('sales_proposal', 0);
	}
	// an unhappy customer is a customer-service matter, whatever the topic
	// Kalyan complaints go to the Kalyan team; any other unhappy reader is a customer-service matter, whatever the topic
	if (external && negative && first?.direction === 'inbound') return (scores.get('kalyan') || 0) >= 3 ? 'kalyan' : 'customer_service';
	if (external && hasIssues) scores.set('customer_service', (scores.get('customer_service') || 0) + 6);
	const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
	if (best && best[1] >= 2) return best[0];
	if (!external) return 'internal';
	return input.messages.some((m) => m.direction === 'inbound') ? 'customer_service' : 'other';
}

function detectProposal(msgs: ThreadInput['messages'], text: string): Analysis['proposal'] {
	const kindMatch = /\b(bulk order|bulk|dealership|distributor|price list|tender|quotation|quote|proposal|renewal)\b/i.exec(text);
	const kind = kindMatch ? kindMatch[1].toLowerCase().replace('quotation', 'quote').replace('bulk order', 'bulk').replace(' ', '_') : 'bulk_order';
	const out = msgs.filter((m) => m.direction === 'outbound').map((m) => m.body).join('\n');
	const inn = msgs.filter((m) => m.direction !== 'outbound').map((m) => m.body).join('\n');
	const last = msgs[msgs.length - 1];
	let stage: ProposalStage = 'request_received';
	if (/\b(we will send|we'll send|preparing|working on (the|our) (quote|proposal)|will revert with)\b/i.test(out)) stage = 'in_preparation';
	if (/\b(please find (attached )?(our|the) (quote|quotation|proposal|rates|bid)|attached (is|are) our|we are pleased to (submit|quote)|submitted)\b/i.test(out)) stage = 'submitted';
	if (/\b(counter|revised (rate|quote|offer)|discount|negotiat|best and final|can you do better|match (the|their) rate)\b/i.test(text)) stage = 'negotiation';
	if (/\b(accepted|approved|go ahead|awarded|pleased to confirm|signed|is acceptable|we accept)\b/i.test(inn)) stage = 'won';
	if (/\b(unsuccessful|not been selected|decided to go with|regret to inform|declined|not proceed)\b/i.test(inn)) stage = 'lost';
	if (stage === 'submitted' && last && last.direction === 'outbound' && Date.now() - new Date(last.sentAt).getTime() > 14 * 86400_000) stage = 'no_response';
	const dl = sentences(text).find((x) => /\b(deadline|due|by|before|submission|closing date|no later than)\b/i.test(x) && parseDue(x, new Date(msgs[0].sentAt)));
	const amount = (text.match(/(?:₹|Rs\.?|INR|\$|£)\s?\d[\d,]*(?:\.\d{1,2})?(?:k|lakh)?/i) || [])[0] || null;
	const scope = (text.match(/\b\d[\d,]{2,}\s?(?:copies|books|nos|sets)(?:\s+of\s+(?:the\s+)?[A-Z][A-Za-z ]{2,40})?/i) || [])[0] || null;
	const next = stage === 'request_received' ? 'Prepare and send the quote' : stage === 'in_preparation' ? 'Finish and submit the proposal' : stage === 'submitted' ? 'Follow up for a decision' : stage === 'negotiation' ? 'Agree final terms' : stage === 'no_response' ? 'Chase for a decision' : null;
	return { kind, stage, deadline: dl ? parseDue(dl, new Date(msgs[0].sentAt)) : null, value: amount, lanes_or_scope: scope, next_step: next };
}

/** Subgroup rules per group, checked in order; the first match wins, otherwise the group's fallback. */
const SUB_RULES: Partial<Record<BusinessCategory, [string, RegExp][]>> = {
	customer_service: [
		['damaged_book', /\b(damaged?|torn|wet|misprint(ed)?|pages? (missing|torn|blank)|binding)\b|फटे|फटी|फटा|खराब|छपाई|क्षतिग्रस्त/i],
		['wrong_item', /\b(wrong (book|item|edition|language|title)|sent (me )?the wrong|missing (book|item|cop(y|ies))|short (supplied|shipped))\b|गलत पुस्तक|गलत किताब/i],
		['not_received', /\b(not received|never (received|arrived)|did(n'?t| not) (receive|get)|haven'?t (received|got))\b|नहीं मिल|प्राप्त नहीं/i],
		['complaint_service', /\b(no (one|response|reply)|nobody|ignored|rude|poor service|unacceptable|complain)\b|शिकायत|कोई जवाब नहीं/i],
		['feedback', /\b(thank you so much|grateful|blessings|appreciate|suggestion|feedback)\b|आभार|धन्यवाद/i],
	],
	book_orders: [
		['payment_issue', /\b(payment (failed|pending|deducted)|money (was )?deducted|debited|paid but|transaction)\b|भुगतान|पैसे कट/i],
		['cancellation', /\b(cancel|change (my |the )?order|modify|add (one|another) (book|title))\b|रद्द/i],
		['ebook_app', /\b(app|e-?books?|website|log ?in|password|otp|android|iphone)\b/i],
		['order_status', /\b(status|where is my order|when will (my|the) order|dispatched yet|order (no|number|id))\b/i],
		['availability', /\b(available|availability|in stock|price|cost|how much)\b|उपलब्ध|मूल्य|कीमत/i],
	],
	kalyan: [
		['issue_not_received', /\b(not received|did(n'?t| not) (receive|get)|missing issue|haven'?t (received|got))\b|नहीं मिल|प्राप्त नहीं/i],
		['address_change', /\b(change (of|my) address|new address|address (has )?changed|update (my )?address)\b|पता बदल/i],
		['back_issues', /\b(back issues?|old issues?|special issue|visheshank|annual number)\b|विशेषांक|पुराने अंक/i],
		['new_subscription', /\b(new subscri|want to subscribe|become a subscriber|how (can|do) i subscribe|start (a |my )?subscription)\b|नई सदस्यता|ग्राहक बनना/i],
		['renewal', /\b(renew|renewal|expir)\b|नवीनीकरण/i],
	],
	dispatch: [
		['vpp_return', /\b(vpp (was |is )?(returned|refused)|returned to (sender|you)|rts|not collected|refused)\b/i],
		['courier_damage', /\b(damaged|broken|opened|torn) (parcel|packet|package|box)|(parcel|packet|package) (arrived |was )?(damaged|opened|torn)\b/i],
		['address_problem', /\b(wrong address|incomplete address|address (not found|incorrect)|undeliverable)\b/i],
		['delivery_delay', /\b(late|delay(ed)?|stuck|still (in transit|not delivered)|taking (so )?long)\b|देर|विलंब/i],
		['tracking', /\b(track|tracking|consignment|awb|where is)\b/i],
	],
	sales_proposal: [
		['international', /\b(usa|uk|canada|australia|nepal|mauritius|fiji|singapore|dubai|uae|overseas|international|export|shipping abroad)\b/i],
		['dealership', /\b(dealership|become (a )?(dealer|distributor|stockist)|bookseller|book seller|open a (shop|stall))\b|विक्रेता बनना/i],
		['negotiation', /\b(counter|revised|(more|better|higher|extra|additional) discount|negotiat|best price|can you do better|follow(ing)? up on (the|our) quote)\b/i],
		['distributor_order', /\b(repeat order|our usual order|as (per|usual)|restock|our (dealer|distributor) (code|number))\b/i],
		['institution_order', /\b(temple|school|ashram|library|satsang|trust|college|university|event|distribution|\d{1,3}(,\d{3})+ (copies|books))\b|मंदिर|विद्यालय|आश्रम/i],
		['quote_request', /\b(quote|quotation|price list|rates?|trade discount)\b/i],
	],
	publications: [
		['permission', /\b(permission|copyright|reproduce|reprint (rights)?|quote from|record|youtube|podcast)\b|अनुमति/i],
		['errata', /\b(error|mistake|typo|errata|misprint|wrong (word|verse|translation))\b|त्रुटि|गलती/i],
		['manuscript', /\b(manuscript|article|submission|submit (my|an)|publish my)\b|लेख|पांडुलिपि/i],
		['translation_request', /\b(translation|translate|in (english|tamil|telugu|kannada|marathi|gujarati|bengali|odia|malayalam|nepali)|language)\b|अनुवाद/i],
		['content_question', /\b(meaning|shloka|sloka|verse|chapter|commentary|explain)\b|श्लोक|अध्याय|अर्थ/i],
	],
	billing_finance: [
		['refund_status', /\b(refund|money back)\b|रिफंड|पैसे वापस/i],
		['invoice_gst', /\b(invoice|gst|gstin|tax bill|bill)\b/i],
		['bank_details', /\b(bank details|account (number|details)|ifsc|how (can|do) i pay|payment (method|mode)|upi id)\b/i],
		['payment_confirmation', /\b(paid|payment|transferred|utr|receipt|screenshot)\b|भुगतान/i],
	],
	vendor_partner: [
		['rate_revision', /\b(rate revision|revised rates?|price increase|new rates?)\b/i],
		['supplier_invoice', /\b(invoice|outstanding|payment due|pending payment|ledger)\b/i],
		['purchase_order', /\b(purchase order|po (no|number)|\bpo\b|order confirmation)\b/i],
	],
	people_hr: [['job_application', /\b(apply|application|resume|cv|vacancy|job|career|interview)\b|नौकरी|आवेदन/i]],
	internal: [['stock_reprint', /\b(stock|reprint|print run|production|inventory)\b|स्टॉक|पुनर्मुद्रण/i]],
	events_marketing: [
		['book_fair', /\b(book fair|pustak mela|exhibition|stall)\b|पुस्तक मेला|प्रदर्शनी/i],
		['media_request', /\b(media|journalist|interview|documentary|press|tv|channel|newspaper)\b/i],
		['newsletter', /\b(newsletter|unsubscribe|promotion|webinar)\b/i],
	],
	notifications: [
		['payment_gateway', /\b(razorpay|payu|paytm|ccavenue|settlement|transaction|payment received)\b/i],
		['courier_updates', /\b(india post|speed post|courier|shipment|delivered|out for delivery|consignment)\b/i],
	],
};

/** The subgroup for a thread, from its group and text (rules engine; the AI picks it directly). */
export function guessSubcategory(group: BusinessCategory, text: string): string {
	for (const [key, re] of SUB_RULES[group] || []) if (re.test(text)) return key;
	return normaliseSubcategory(group, '');
}

const P = (what: string) => `[[provide: ${what}]]`;

/** A complete reply in the customer's language; anything only the team can know is a [[provide: …]] placeholder. */
function draftReply(input: ThreadInput, categories: Category[], ent: ReturnType<typeof entities>, sentiment: Sentiment, lastInbound: ThreadInput['messages'][number] | undefined, all: string): string {
	const text = `${lastInbound?.subject || ''}\n${lastInbound?.body || ''}`;
	const hi = /[ऀ-ॿ]{4,}/.test(text) && (text.match(/[ऀ-ॿ]/g) || []).length > (text.match(/[A-Za-z]/g) || []).length / 3;
	const ref = ent.shipment_refs[0];
	const qty = (all.match(/\b\d[\d,]{2,}\s?(?:copies|books|nos|sets)(?:\s+of\s+(?:the\s+)?[A-Z][A-Za-z ]{2,40})?/i) || [])[0];
	const by = (all.match(/\b(?:within|in|by)\s+(?:\d+\s+(?:days?|weeks?|months?)|(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?)/i) || [])[0];
	const lines: string[] = [];
	const add = (en: string, h: string) => lines.push(hi ? h : en);
	const has = (c: Category) => categories.includes(c);
	add(sentiment === 'negative' ? 'Thank you for writing to us, and please accept our sincere apologies for the inconvenience.' : 'Thank you for writing to us.',
		sentiment === 'negative' ? 'आपके पत्र के लिए धन्यवाद। आपको हुई असुविधा के लिए हम क्षमा चाहते हैं।' : 'आपके पत्र के लिए धन्यवाद।');
	if ((has('not_received') || has('delay') || has('tracking') || (has('service_failure') && !has('payment'))) && !(has('payment') && !has('not_received') && !has('tracking')))
		add(`We have checked your order${ref ? ` ${ref}` : ''}. It was dispatched on ${P('dispatch date')} by ${P('VPP / India Post / courier')} with tracking number ${P('tracking number')}, and it should reach you by ${P('expected delivery date')}.`,
			`हमने आपके ऑर्डर${ref ? ` ${ref}` : ''} की जाँच की है। यह ${P('dispatch date')} को ${P('VPP / India Post / courier')} द्वारा भेजा गया था, ट्रैकिंग संख्या ${P('tracking number')} है, और यह ${P('expected delivery date')} तक आप तक पहुँच जाना चाहिए।`);
	if (has('damage') || has('wrong_item'))
		add(`We are sorry that the book reached you ${has('damage') ? 'damaged' : 'incorrect'}. ${P('confirm replacement: new copy to be sent on (date), or other resolution')}. ${P('whether the customer needs to return the copy, and how')}.`,
			`हमें खेद है कि पुस्तक आप तक ${has('damage') ? 'क्षतिग्रस्त' : 'गलत'} पहुँची। ${P('confirm replacement: new copy to be sent on (date), or other resolution')}। ${P('whether the customer needs to return the copy, and how')}।`);
	if (has('payment') || has('refund'))
		add(`We have looked into the payment you mentioned. ${P('payment status: order placed, or refund initiated on (date) with reference (number)')}. Refunds normally reach your account within ${P('refund timeline')}.`,
			`हमने आपके भुगतान की जाँच की है। ${P('payment status: order placed, or refund initiated on (date) with reference (number)')}। रिफंड सामान्यतः ${P('refund timeline')} में आपके खाते में पहुँच जाता है।`);
	if (has('subscription'))
		add(`Regarding your Kalyan subscription${ref ? ` (${ref})` : ''}: ${P('subscription status, validity and the dispatch date of the missing or next issue')}.`,
			`आपकी कल्याण सदस्यता${ref ? ` (${ref})` : ''} के संबंध में: ${P('subscription status, validity and the dispatch date of the missing or next issue')}।`);
	if (has('address_change'))
		add(`We have noted your new address. ${P('confirm the address has been updated, and from which issue or order it applies')}.`,
			`हमने आपका नया पता नोट कर लिया है। ${P('confirm the address has been updated, and from which issue or order it applies')}।`);
	if (has('bulk_order'))
		add(`Thank you for your interest in ordering ${qty || 'in bulk'}${by ? ` ${by}` : ''}. ${P(`confirm whether ${qty || 'this quantity'} can be supplied${by ? ` ${by}` : ' by the requested date'} (yes / no / partial)`)}. ${P('price, trade discount, delivery charges and payment terms for this order')}. ${P('how to place the order and whom to contact')}.`,
			`${qty || 'थोक'} पुस्तकें मँगाने में आपकी रुचि के लिए धन्यवाद। ${P(`confirm whether ${qty || 'this quantity'} can be supplied${by ? ` ${by}` : ' by the requested date'} (yes / no / partial)`)}। ${P('price, trade discount, delivery charges and payment terms for this order')}। ${P('how to place the order and whom to contact')}।`);
	if (has('out_of_stock') || has('pricing'))
		add(`${P('availability and price of the requested title(s)')}.`, `${P('availability and price of the requested title(s)')}।`);
	if (has('language_edition')) add(`${P('whether the title is available in the requested language or edition, and how to order it')}.`, `${P('whether the title is available in the requested language or edition, and how to order it')}।`);
	if (has('website_app')) add(`${P('solution or steps for the website, app or e-book issue')}.`, `${P('solution or steps for the website, app or e-book issue')}।`);
	if (has('content_query')) add(`${P('answer to the scripture or content question, or the department that will reply')}.`, `${P('answer to the scripture or content question, or the department that will reply')}।`);
	if (lines.length === 1) add(`${P("answer to the customer's question")}.`, `${P("answer to the customer's question")}।`);
	add('Please write to us if you need any further help.', 'किसी भी अन्य सहायता के लिए कृपया हमें लिखें।');
	const greeting = hi ? 'आदरणीय महोदय/महोदया,' : `Respected ${lastInbound?.fromName?.split(' ')[0] ? `${lastInbound.fromName.split(' ')[0]} ji` : 'Sir/Madam'},`;
	return [greeting, '', ...lines.flatMap((l) => [l, '']), input.replySignature || `Regards,\n${input.orgName}`].join('\n');
}

export function heuristicAnalyse(input: ThreadInput): Analysis {
	const msgs = input.messages;
	const inbound = msgs.filter((m) => m.direction === 'inbound');
	const outbound = msgs.filter((m) => m.direction === 'outbound');
	const all = msgs.map((m) => `${m.subject}\n${m.body}`).join('\n');
	// internal threads have no customer side: treat every message as the "voice" of the thread
	const voice = input.isInternal ? msgs : inbound;
	const inboundText = voice.map((m) => `${m.subject}\n${m.body}`).join('\n') || all;

	const message_sentiments = msgs.map((m) => {
		const s = scoreText(`${m.subject}. ${m.body}`);
		return { index: m.index, sentiment: toSentiment(s), score: s };
	});
	// customer sentiment weighted towards recent inbound messages
	let wsum = 0;
	let w = 0;
	voice.forEach((m, i) => {
		const weight = 1 + i;
		wsum += (message_sentiments.find((x) => x.index === m.index)?.score ?? 0) * weight;
		w += weight;
	});
	const score = w ? Number((wsum / w).toFixed(2)) : 0;
	const sentiment = toSentiment(score);

	const categories = uniq(CATS.filter(([, re]) => re.test(inboundText)).map(([c]) => c)) as Category[];
	if (sentiment === 'negative' && !categories.some((c) => c !== 'enquiry' && c !== 'compliment')) categories.push('complaint');
	if (sentiment === 'negative') {
		const i = categories.indexOf('compliment');
		if (i >= 0) categories.splice(i, 1);
	}
	const lastInbound = inbound[inbound.length - 1];
	const lastInboundText = lastInbound ? `${lastInbound.subject} ${lastInbound.body}` : '';
	const urgentHits = (inboundText.match(new RegExp(URGENT, 'gi')) || []).length;
	const legal = LEGAL.test(inboundText);
	const chasing = inbound.length >= 3 && /\b(chas|still|again|follow(ing)? up|second time|third time|reminder)/i.test(lastInboundText);
	const urgency: Analysis['urgency'] = legal || (urgentHits >= 2 && sentiment === 'negative')
		? 'critical'
		: urgentHits >= 1 || (sentiment === 'negative' && chasing)
			? 'high'
			: sentiment === 'negative'
				? 'medium'
				: 'low';

	let escalation = 10;
	if (sentiment === 'negative') escalation += Math.round(-score * 45);
	if (legal) escalation += 35;
	if (chasing) escalation += 15;
	if (urgentHits) escalation += 8 * Math.min(urgentHits, 2);
	if (categories.includes('contract')) escalation += 10;
	if (categories.includes('payment') && sentiment === 'negative') escalation += 8; // money deducted but order not placed
	if (input.customerTier === 'strategic') escalation += 5;
	escalation = Math.max(0, Math.min(100, escalation));

	const sevFor = (c: Category): Analysis['issues'][number]['severity'] => {
		if (legal && (c === 'contract' || c === 'service_failure')) return 'critical';
		if (['damage', 'service_failure', 'not_received', 'wrong_item', 'payment'].includes(c)) return sentiment === 'negative' ? 'high' : 'medium';
		if (['delay', 'billing', 'communication', 'subscription', 'refund'].includes(c)) return sentiment === 'negative' ? (urgency === 'critical' || urgency === 'high' ? 'high' : 'medium') : 'low';
		return 'low';
	};
	const issueCats = categories.filter((c) => !['compliment', 'enquiry', 'pricing', 'bulk_order', 'language_edition', 'content_query', 'website_app', 'subscription', 'tracking'].includes(c) || sentiment === 'negative');
	const issues = issueCats
		.filter((c) => c !== 'compliment' && c !== 'enquiry')
		.map((c) => {
			const re = CATS.find(([k]) => k === c)![1];
			const sent = sentences(inboundText).find((s) => re.test(s)) || '';
			return { category: c, description: sent ? sent.slice(0, 220) : CATEGORY_LABELS[c], severity: sevFor(c) };
		})
		.slice(0, 6);

	// action items & commitments
	const action_items: Analysis['action_items'] = [];
	const lastOutboundIdx = Math.max(-1, ...msgs.filter((m) => m.direction === 'outbound').map((m) => m.index));
	for (const m of msgs) {
		// customer requests that we have already replied to are no longer open
		const answered = m.direction === 'inbound' && m.index < lastOutboundIdx;
		for (const raw of sentences(m.body).slice(0, 40)) {
			const s = raw.replace(/\.{2,}$/, '.');
			if (answered && !COMMIT_US.test(s)) continue;
			if (/^(ok|okay|thanks|thank you|great|perfect)\b/i.test(s)) continue;
			// generic chasers ("Please respond ASAP.", "Please chase.") are not actionable on their own
			if (/^(please\s+)?(respond|reply|chase|advise|confirm|call me|revert)( asap| urgently| today)?[.!]?$/i.test(s.trim()) || s.trim().length < 18) continue;
			// statements about the customer's own plans are not requests to us
			if (m.direction === 'inbound' && /^we need to (confirm|check|let|tell|inform) (with )?our\b/i.test(s)) continue;
			if (s.length > 260 || /^(hi|hello|dear|regards|thanks)\b/i.test(s)) continue;
			const base = new Date(m.sentAt);
			if ((m.direction === 'outbound' || m.direction === 'internal') && COMMIT_US.test(s)) {
				action_items.push({ description: s.replace(/\s+/g, ' '), owner_side: 'us', owner_name: m.fromName || m.from, is_commitment: true, due_date: parseDue(s, base), message_index: m.index });
			} else if ((m.direction === 'inbound' || (m.direction === 'internal' && m.index === msgs.length - 1)) && REQUEST.test(s) && /\?|please|kindly|need|require|can you|could you/i.test(s)) {
				action_items.push({ description: s.replace(/\s+/g, ' '), owner_side: 'us', owner_name: null, is_commitment: false, due_date: parseDue(s, base), message_index: m.index });
			} else if (m.direction === 'inbound' && COMMIT_US.test(s)) {
				action_items.push({ description: s.replace(/\s+/g, ' '), owner_side: 'customer', owner_name: m.fromName || m.from, is_commitment: true, due_date: parseDue(s, base), message_index: m.index });
			}
		}
	}
	// requests answered by a later outbound message are less likely still open; keep the latest few
	const trimmed = action_items.slice(-8);

	const lastMsg = msgs[msgs.length - 1];
	const lastIsInbound = !!lastMsg && lastMsg.direction === 'inbound';
	// a short "thanks / ok / received" closing note does not need a reply
	const ackOnly = lastIsInbound && lastMsg.body.trim().length < 160 && !/\?/.test(lastMsg.body) &&
		/^\s*(hi[^\n]*\n+)?\s*(ok|okay|great|perfect|thanks|thank you|many thanks|cheers|noted|received|much appreciated|brilliant|lovely|excellent|that's great|sounds good)\b/i.test(lastMsg.body);
	// cold marketing and sales pitches do not need an answer
	const promo = PROMO.test(`${msgs[0]?.subject || ''}\n${(msgs[0]?.body || '').slice(0, 3000)}`) && outbound.length === 0;
	const awaiting = lastIsInbound && !ackOnly && !input.isAutomated && !promo;
	const ent = entities(all);

	const primary = categories.find((c) => c !== 'complaint') || categories[0];
	const firstLine = sentences(lastInbound?.body || msgs[msgs.length - 1]?.body || '').find((s) => s.length > 25) || '';
	const who = input.isInternal ? 'Internal thread:' : input.customerName || 'The customer';
	const business_category = classifyBusiness(input, all, issues.length > 0, sentiment === 'negative');
	const proposal = business_category === 'sales_proposal' ? detectProposal(msgs, all) : null;
	const internalSummary = input.isInternal || input.isAutomated
		? [
			input.isAutomated ? `Automated message from ${msgs[0]?.fromName || msgs[0]?.from}.` : `Internal thread between ${uniq(msgs.map((m) => (m.fromName || m.from).split(' ')[0])).slice(0, 4).join(', ')} (${msgs.length} message${msgs.length > 1 ? 's' : ''}).`,
			firstLine || sentences(msgs[msgs.length - 1]?.body || '').find((x) => x.length > 20) ? `Latest: "${(firstLine || sentences(msgs[msgs.length - 1]?.body || '').find((x) => x.length > 20) || '').slice(0, 180)}"` : '',
		]
		: null;
	const summaryParts = internalSummary || [
		`${who} ${sentiment === 'negative' ? 'raised' : 'wrote about'} ${primary ? CATEGORY_LABELS[primary].toLowerCase() : 'a general matter'}${ent.shipment_refs[0] ? ` (${ent.shipment_refs[0]})` : ''}.`,
		firstLine ? `Latest: "${firstLine.slice(0, 160)}${firstLine.length > 160 ? '…' : ''}"` : '',
		outbound.length
			? awaiting
				? `${outbound.length} reply${outbound.length > 1 ? 'ies' : ''} sent; the customer has written again and is awaiting a response.`
				: `Our team has responded (${outbound.length} reply${outbound.length > 1 ? 'ies' : ''}).`
			: awaiting
				? 'No reply has been sent yet.'
				: '',
	];

	const customer_state: Analysis['customer_state'] =
		sentiment === 'negative' ? (escalation >= 60 || legal ? 'dissatisfied' : 'at_risk') : sentiment === 'positive' ? 'satisfied' : 'neutral';
	const rag: Analysis['rag_suggestion'] =
		legal || (sentiment === 'negative' && (urgency === 'critical' || urgency === 'high' || escalation >= 65))
			? 'red'
			: sentiment === 'negative' || issues.some((i) => i.severity !== 'low')
				? 'amber'
				: 'green';

	const suggested_reply = awaiting ? draftReply(input, categories, ent, sentiment, lastInbound, all) : '';

	if (proposal && !internalSummary) summaryParts.push(`Proposal stage: ${proposal.stage.replace(/_/g, ' ')}${proposal.deadline ? `, deadline ${proposal.deadline}` : ''}.`);
	const subcategory = guessSubcategory(business_category, inboundText);
	return {
		business_category,
		subcategory,
		purposes: input.isInternal || input.isAutomated ? [] : guessPurposes(inboundText, business_category, subcategory),
		proposal,
		summary: summaryParts.filter(Boolean).join(' '),
		sentiment,
		sentiment_score: score,
		customer_state,
		urgency,
		escalation_risk: escalation,
		categories,
		topics: categories.slice(0, 5).map((c) => CATEGORY_LABELS[c].toLowerCase()),
		issues,
		action_items: trimmed,
		entities: ent,
		message_sentiments,
		requires_reply: awaiting,
		suggested_reply,
		rag_suggestion: rag,
		rag_reason:
			rag === 'red'
				? legal
					? 'Customer has used legal, cancellation or penalty language.'
					: `Negative sentiment with ${urgency} urgency and escalation risk ${escalation}.`
				: rag === 'amber'
					? `Open ${issues[0] ? CATEGORY_LABELS[issues[0].category].toLowerCase() : 'concern'} needs attention before it escalates.`
					: 'No open concerns detected.',
		legal_or_churn_signal: legal,
	};
}
