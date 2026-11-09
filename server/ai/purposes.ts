/**
 * Why a reader or customer contacted Gita Press. A thread can have several purposes; the customer record collects
 * every purpose they have ever written about, so the team can find people for follow-up, upsell and cross-sell
 * (e.g. Kalyan readers who never ordered books). Kept at the level of "Kalyan", not its sub-reasons.
 */
import type { BusinessCategory } from './types';
import { ADDRESS_INTENT } from '../directory';

export const PURPOSES = [
	'kalyan', 'book_order', 'order_tracking', 'availability_price', 'international', 'bulk_order', 'dealer',
	'suggestion_content', 'suggestion_printing', 'seva', 'complaint', 'payment_refund', 'translation', 'permission',
	'scripture_question', 'branch_address', 'ebook_website', 'book_fair_event', 'donation', 'visit_stay', 'job', 'other',
] as const;
export type Purpose = (typeof PURPOSES)[number];

export const PURPOSE_LABELS: Record<Purpose, string> = {
	kalyan: 'Kalyan',
	book_order: 'Book order',
	order_tracking: 'Book order tracking',
	availability_price: 'Availability / price enquiry',
	international: 'International order',
	bulk_order: 'Bulk order',
	dealer: 'Dealer / bookseller enquiry',
	suggestion_content: 'Suggestion: book content / edits',
	suggestion_printing: 'Suggestion: printing',
	seva: 'Voluntary service (seva)',
	complaint: 'Complaint (damaged / wrong / not received)',
	payment_refund: 'Payment / refund',
	translation: 'Translation / new-language request',
	permission: 'Permission to reprint / quote',
	scripture_question: 'Scripture question',
	branch_address: 'Branch address / contact',
	ebook_website: 'E-book / website / app',
	book_fair_event: 'Book fair / event',
	donation: 'Donation offer',
	visit_stay: 'Visit / stay at Gita Bhawan',
	job: 'Job enquiry',
	other: 'Other',
};

export const PURPOSE_HINTS: Record<Purpose, string> = {
	kalyan: 'anything about Kalyan or Kalyana-Kalpataru: subscribing, renewing, issues not received, address change, special issues',
	book_order: 'wants to buy or order books (new order, list of titles, how to order)',
	order_tracking: 'asks where an existing order or parcel is, dispatch status, tracking number, delay',
	availability_price: 'asks whether a book, language or edition is available, or its price',
	international: 'order, enquiry or subscription from outside India, or shipping abroad',
	bulk_order: 'large quantities for distribution, temples, schools, events, gifting, or a quotation',
	dealer: 'wants to become a dealer, bookseller, distributor or stockist, or an existing dealer writing about trade',
	suggestion_content: 'points out a textual error, typo or translation mistake, or suggests an edit or new title',
	suggestion_printing: 'suggests improvements to printing, paper, binding, font size or format',
	seva: 'offers to volunteer or give their time or skills (seva)',
	complaint: 'damaged, misprinted, wrong or missing books, order not received, or unhappy with service',
	payment_refund: 'payment failed or deducted, payment confirmation, refund, invoice',
	translation: 'asks for a book in another language, or offers to translate',
	permission: 'asks permission to quote, reprint, record or publish Gita Press content',
	scripture_question: 'a question about the meaning of a scripture or passage, or spiritual guidance',
	branch_address: 'asks for the address, phone number or timings of a branch, shop or the head office',
	ebook_website: 'e-books, the website, the app, online login or online payment problems',
	book_fair_event: 'book fairs, exhibitions, stalls, events, media',
	donation: 'offers or asks about donating money',
	visit_stay: 'wants to visit Gita Press or stay at Gita Bhawan, Rishikesh',
	job: 'job application or vacancy question',
	other: 'none of the above',
};

const RULES: [Purpose, RegExp][] = [
	['kalyan', /\bkaly[a]?an[a]?\b|kalpataru|कल्याण|visheshank|विशेषांक/i],
	['order_tracking', /\b(track(ing)?|awb|consignment|where is my (order|parcel)|not (yet )?(been )?dispatched|dispatch (status|date)|order status|delay(ed)?|still not (received|arrived))\b|ट्रैकिंग|कब तक (मिलेगा|मिलेगी|आएगा)|अभी तक नहीं (मिला|मिली|आया)/i],
	['book_order', /\b(i (want|would like) to (buy|order|purchase)|please send (me )?(the )?(following )?books?|place an order|order (for|of) books?|how (can|do) i (buy|order)|book order|purchase)\b|मंगाना|मँगाना|मंगवाना|भेजने की कृपा|ऑर्डर|आर्डर|खरीदना/i],
	['availability_price', /\b(available|availability|in stock|out of stock|price|cost|rate|mrp|how much)\b|उपलब्ध|मूल्य|कीमत|दाम/i],
	['international', /\b(usa|u\.s\.a|united states|canada|uk|united kingdom|england|london|australia|new zealand|singapore|malaysia|mauritius|fiji|dubai|uae|abroad|outside india|overseas|international shipping|ship to .{2,20}(country|abroad)|foreign)\b|विदेश/i],
	['bulk_order', /\b(bulk|wholesale|\d{3,}\s*(copies|books|nos|pieces)|in large quantit|for distribution|quotation|bhandara|wedding gift|return gift|for (our|the) (temple|school|ashram|trust))\b|थोक|प्रतियाँ|वितरण/i],
	['dealer', /\b(dealer|dealership|distributor|stockist|bookseller|book seller|book stall|agency|franchise|retailer)\b|विक्रेता|एजेंसी|डीलर/i],
	['suggestion_content', /\b(typo|misprint(ed)? (word|text)|error in (the )?(text|book|translation|page)|mistake in (the )?(text|book|verse|shloka|translation)|correction|wrong (word|meaning|translation)|please correct)\b|अशुद्धि|त्रुटि|गलती|संशोधन/i],
	['suggestion_printing', /\b(font size|larger font|bigger font|large print|paper quality|binding|print quality|printing quality|suggest(ion)? .{0,30}print)\b|छपाई|बड़े अक्षर|मोटे अक्षर|कागज/i],
	['seva', /\b(volunteer|voluntary|seva|sewa|offer (my )?(service|help|time)|free of cost .{0,20}help|contribute my (time|skills))\b|सेवा करना|सेवा देना|स्वयंसेवक/i],
	['complaint', /\b(damaged|torn|missing pages?|misprint|wrong (book|item|edition)|not received|never (received|arrived)|complain|disappointed|poor service)\b|फटे|खराब|गलत पुस्तक|शिकायत|नहीं मिला/i],
	['payment_refund', /\b(refund|payment (failed|deducted|not)|money (deducted|debited)|amount (deducted|debited)|transaction (failed|id)|utr|invoice|gst bill)\b|रिफंड|भुगतान|पैसे कट/i],
	['translation', /\b(translat(e|ion)|in (tamil|telugu|kannada|malayalam|bengali|bangla|gujarati|marathi|odia|oriya|assamese|punjabi|nepali|urdu|english) (language|version|edition)?|other languages?)\b|अनुवाद/i],
	['permission', /\b(permission|copyright|reprint|reproduce|quote from|use (your|the) (text|content|images)|youtube|record(ing)? (of|the) (text|book))\b|अनुमति/i],
	['scripture_question', /\b(meaning of|what does .{3,40} mean|explain (the )?(verse|shloka|chapter)|shloka|verse \d|sadhana|spiritual (question|guidance))\b|अर्थ|श्लोक|शंका|जिज्ञासा/i],
	['branch_address', ADDRESS_INTENT],
	['ebook_website', /\b(e-?book|website|web site|online (order|payment)|app\b|login|log in|password|pdf)\b|वेबसाइट|ऐप/i],
	['book_fair_event', /\b(book fair|exhibition|pustak mela|stall at|interview|documentary)\b|पुस्तक मेला|प्रदर्शनी/i],
	['donation', /\b(donat(e|ion)|contribut(e|ion) (money|funds)|daan|dan raashi)\b|दान|अनुदान/i],
	['visit_stay', /\b(visit (gita press|the press|gorakhpur)|stay at|accommodation|room booking|gita bhawan|swargashram|leela chitra)\b|ठहरने|आवास|गीताभवन/i],
	['job', /\b(job|vacancy|vacancies|career|resume|curriculum vitae|cv attached|apply for (the )?post)\b|नौकरी|रिक्ति/i],
];

/** Purposes that follow from the group and subgroup the thread was put in. */
const FROM_SUBGROUP: Record<string, Purpose[]> = {
	'kalyan:*': ['kalyan'],
	'book_orders:new_order': ['book_order'], 'book_orders:order_status': ['order_tracking'], 'book_orders:payment_issue': ['payment_refund'],
	'book_orders:cancellation': ['book_order'], 'book_orders:ebook_app': ['ebook_website'], 'book_orders:availability': ['availability_price'],
	'customer_service:damaged_book': ['complaint'], 'customer_service:wrong_item': ['complaint'], 'customer_service:not_received': ['complaint', 'order_tracking'],
	'customer_service:complaint_service': ['complaint'], 'customer_service:general_query': [],
	'dispatch:*': ['order_tracking'], 'dispatch:courier_damage': ['complaint'],
	'sales_proposal:quote_request': ['bulk_order'], 'sales_proposal:institution_order': ['bulk_order'], 'sales_proposal:dealership': ['dealer'],
	'sales_proposal:distributor_order': ['dealer'], 'sales_proposal:negotiation': ['bulk_order'], 'sales_proposal:international': ['international'],
	'publications:translation_request': ['translation'], 'publications:errata': ['suggestion_content'], 'publications:permission': ['permission'],
	'publications:content_question': ['scripture_question'], 'publications:manuscript': ['suggestion_content'],
	'billing_finance:*': ['payment_refund'],
	'people_hr:job_application': ['job'],
	'events_marketing:book_fair': ['book_fair_event'], 'events_marketing:media_request': ['book_fair_event'],
};

/** Groups that are not about a reader or customer: no purposes recorded. */
export const NO_PURPOSE_GROUPS: BusinessCategory[] = ['internal', 'notifications', 'vendor_partner'];

export function purposesFromSubgroup(group: string, sub: string | null | undefined): Purpose[] {
	return FROM_SUBGROUP[`${group}:${sub}`] || FROM_SUBGROUP[`${group}:*`] || [];
}

/** Rules engine: purposes from what the reader wrote, plus the group and subgroup. */
export function guessPurposes(text: string, group: string, sub?: string | null, opts: { abroad?: boolean } = {}): Purpose[] {
	if ((NO_PURPOSE_GROUPS as string[]).includes(group)) return [];
	const found = new Set<Purpose>(purposesFromSubgroup(group, sub));
	for (const [p, re] of RULES) if (re.test(text)) found.add(p);
	if (opts.abroad) found.add('international');
	// "order" words in a tracking question are about the existing order, not a new one
	if (found.has('order_tracking') && found.has('book_order') && !/\b(also|new order|another order|additional)\b|और (पुस्तकें|किताबें)/i.test(text)) found.delete('book_order');
	if (!found.size) found.add('other');
	return normalisePurposes([...found]);
}

export function normalisePurposes(v: unknown): Purpose[] {
	const list = (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim().toLowerCase()).filter((x): x is Purpose => (PURPOSES as readonly string[]).includes(x));
	const out = [...new Set(list)];
	return out.length > 1 ? out.filter((x) => x !== 'other') : out;
}

export const purposesForPrompt = () => PURPOSES.map((p) => `${p} (${PURPOSE_HINTS[p]})`).join('; ');
