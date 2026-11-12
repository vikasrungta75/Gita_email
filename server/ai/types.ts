import { PURPOSES, activePurposeKeys } from './purposes';
export const CATEGORIES = [
	'service_failure',
	'delay',
	'not_received',
	'damage',
	'wrong_item',
	'billing',
	'payment',
	'refund',
	'pricing',
	'out_of_stock',
	'subscription',
	'address_change',
	'tracking',
	'website_app',
	'bulk_order',
	'language_edition',
	'content_query',
	'communication',
	'contract',
	'complaint',
	'compliment',
	'enquiry',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
	service_failure: 'Service failure',
	delay: 'Delivery delay',
	not_received: 'Order or parcel not received',
	damage: 'Damaged or misprinted book',
	wrong_item: 'Wrong or missing item',
	billing: 'Invoice and GST',
	payment: 'Payment failed or deducted',
	refund: 'Refund or cancellation',
	pricing: 'Price and availability',
	out_of_stock: 'Out of stock',
	subscription: 'Kalyan subscription',
	address_change: 'Address change',
	tracking: 'Tracking and VPP status',
	website_app: 'Website, app and e-books',
	bulk_order: 'Bulk and distributor orders',
	language_edition: 'Language, edition and translation',
	content_query: 'Scripture and content question',
	communication: 'Poor communication',
	contract: 'Escalation and legal',
	complaint: 'General complaint',
	compliment: 'Compliment',
	enquiry: 'Enquiry',
};

/** What kind of email this is: a comprehensive view across all mail, not only complaints. */
export const BUSINESS_CATEGORIES = [
	'customer_service',
	'book_orders',
	'kalyan',
	'dispatch',
	'sales_proposal',
	'publications',
	'billing_finance',
	'vendor_partner',
	'people_hr',
	'internal',
	'events_marketing',
	'notifications',
	'other',
] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];

export const BUSINESS_LABELS: Record<BusinessCategory, string> = {
	customer_service: 'Reader and customer service',
	book_orders: 'Book orders and e-books',
	kalyan: 'Kalyan subscriptions',
	dispatch: 'Dispatch, VPP and delivery',
	sales_proposal: 'Bulk orders, distributors and quotes',
	publications: 'Publications, translations and editorial',
	billing_finance: 'Payments, refunds and accounts',
	vendor_partner: 'Printing, paper and suppliers',
	people_hr: 'Careers and staff',
	internal: 'Internal team',
	events_marketing: 'Events, media and newsletters',
	notifications: 'Automated notifications',
	other: 'Other',
};

export const PROPOSAL_STAGES = ['request_received', 'in_preparation', 'submitted', 'negotiation', 'won', 'lost', 'no_response'] as const;
export type ProposalStage = (typeof PROPOSAL_STAGES)[number];

export type Sentiment = 'positive' | 'neutral' | 'negative';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface ThreadMessage {
	index: number;
	emailId: number;
	direction: 'inbound' | 'outbound' | 'internal';
	from: string;
	fromName: string;
	sentAt: string;
	subject: string;
	body: string;
}

export interface ThreadInput {
	conversationId: number;
	customerName: string;
	customerTier: string;
	orgName: string;
	isInternal: boolean;
	isAutomated: boolean;
	messages: ThreadMessage[];
	/** Facts the team has given for replies: shipping times, prices, policies (Settings → Reply drafts) */
	replyKnowledge?: string;
	replySignature?: string;
	/** default reply templates for the likely subgroup(s), as plain text */
	replyTemplates?: { group: string; subgroup: string; label: string; body: string }[];
	/** what the customer database knows about this reader (address, subscriber no., language) */
	customerProfile?: string;
	/** matched catalogue, FAQ and policy entries from the reference data */
	reference?: { kind: string; title: string; text: string }[];
	/** live stock (Tally) for the books the reader mentions, and Gita Press addresses when relevant */
	stockInfo?: string;
}

export interface Analysis {
	business_category: BusinessCategory;
	/** subgroup within business_category, see taxonomy.ts */
	subcategory: string;
	/** why the reader contacted Gita Press (several allowed), see purposes.ts */
	purposes: string[];
	proposal: null | {
		kind: string; // rfq, rfp, tender, quote, rate_request, proposal, contract_renewal
		stage: ProposalStage;
		deadline: string | null;
		value: string | null;
		lanes_or_scope: string | null;
		next_step: string | null;
	};
	summary: string;
	sentiment: Sentiment;
	sentiment_score: number;
	customer_state: 'satisfied' | 'neutral' | 'at_risk' | 'dissatisfied';
	urgency: 'low' | 'medium' | 'high' | 'critical';
	escalation_risk: number;
	categories: Category[];
	topics: string[];
	issues: { category: Category; description: string; severity: Severity }[];
	action_items: {
		description: string;
		owner_side: 'us' | 'customer';
		owner_name?: string | null;
		is_commitment: boolean;
		due_date?: string | null;
		message_index?: number | null;
	}[];
	entities: {
		shipment_refs: string[];
		invoice_refs: string[];
		vehicle_regs: string[];
		amounts: string[];
		locations: string[];
		dates: string[];
	};
	message_sentiments: { index: number; sentiment: Sentiment; score: number }[];
	requires_reply: boolean;
	suggested_reply: string;
	rag_suggestion: 'red' | 'amber' | 'green';
	rag_reason: string;
	legal_or_churn_signal: boolean;
}

/** JSON schema handed to the LLM as a tool so the output is always structured. */
export const ANALYSIS_SCHEMA = {
	type: 'object',
	properties: {
		business_category: { type: 'string', enum: [...BUSINESS_CATEGORIES], description: 'What kind of email thread this is. customer_service = a reader or customer raising a complaint, problem or general question; book_orders = placing, changing or asking about a book or e-book order (website, app, phone, post); kalyan = Kalyan or Kalyana-Kalpataru magazine subscriptions, renewals, issues not received; dispatch = parcels, VPP (value payable post), India Post or courier tracking, delivery and returns; sales_proposal = bulk orders, booksellers, distributors, temples, schools and institutions asking for quotes, price lists, trade discounts or dealership (either direction); publications = editorial, translations, new editions, errata, reprints, permissions and content questions; billing_finance = invoices, GST, payments, refunds, bank and accounts; vendor_partner = printing, paper, ink, binding, logistics and software suppliers; people_hr = careers, staff, hiring, payroll; internal = only staff talking to each other about anything not above; events_marketing = events, book fairs, media, newsletters; notifications = automated system messages.' },
		subcategory: { type: 'string', description: 'The subgroup within business_category. Use one key from the list for that group given in the prompt.' },
		purposes: { type: 'array', items: { type: 'string', enum: [...PURPOSES] }, description: 'Every reason the external party contacted Gita Press in this thread (one or more), from the purposes list in the prompt. Empty for internal, automated and supplier threads.' },
		proposal: {
			type: ['object', 'null'],
			description: 'Only for sales_proposal threads (bulk orders, distributor or institutional quotes), otherwise null.',
			properties: {
				kind: { type: 'string', description: 'bulk_order, quote, price_list, dealership, tender, proposal, renewal' },
				stage: { type: 'string', enum: ['request_received', 'in_preparation', 'submitted', 'negotiation', 'won', 'lost', 'no_response'] },
				deadline: { type: ['string', 'null'], description: 'YYYY-MM-DD submission or decision deadline' },
				value: { type: ['string', 'null'], description: 'Order value, quantities or discount mentioned' },
				lanes_or_scope: { type: ['string', 'null'] },
				next_step: { type: ['string', 'null'] },
			},
		},
		summary: { type: 'string', description: '2-3 sentence factual summary in English of the conversation (translate Hindi or other languages): what the reader or customer wants, what has been done, current state.' },
		sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'], description: 'Overall customer sentiment, weighted to the most recent customer messages.' },
		sentiment_score: { type: 'number', description: '-1 (very negative) to 1 (very positive)' },
		customer_state: { type: 'string', enum: ['satisfied', 'neutral', 'at_risk', 'dissatisfied'] },
		urgency: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
		escalation_risk: { type: 'integer', description: '0-100 likelihood the customer escalates, churns, claims or involves management/legal.' },
		categories: { type: 'array', items: { type: 'string', enum: [...CATEGORIES] } },
		topics: { type: 'array', items: { type: 'string' }, description: 'Up to 5 short lowercase topic tags in English, e.g. "kalyan issue not received", "gita press damaged copy".' },
		issues: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					category: { type: 'string', enum: [...CATEGORIES] },
					description: { type: 'string' },
					severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
				},
				required: ['category', 'description', 'severity'],
			},
		},
		action_items: {
			type: 'array',
			description: 'Concrete follow-ups and commitments. owner_side=us when Gita Press (our team) must act or promised something; customer when the reader, customer or partner must act.',
			items: {
				type: 'object',
				properties: {
					description: { type: 'string' },
					owner_side: { type: 'string', enum: ['us', 'customer'] },
					owner_name: { type: ['string', 'null'] },
					is_commitment: { type: 'boolean', description: 'true if someone explicitly promised to do this' },
					due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD if a deadline is stated or clearly implied' },
					message_index: { type: ['integer', 'null'] },
				},
				required: ['description', 'owner_side', 'is_commitment'],
			},
		},
		entities: {
			type: 'object',
			properties: {
				shipment_refs: { type: 'array', items: { type: 'string' }, description: 'Order numbers, VPP or India Post tracking numbers, Kalyan subscriber numbers' },
				invoice_refs: { type: 'array', items: { type: 'string' } },
				vehicle_regs: { type: 'array', items: { type: 'string' }, description: 'Book titles or codes mentioned' },
				amounts: { type: 'array', items: { type: 'string' } },
				locations: { type: 'array', items: { type: 'string' } },
				dates: { type: 'array', items: { type: 'string' } },
			},
		},
		message_sentiments: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					index: { type: 'integer' },
					sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
					score: { type: 'number' },
				},
				required: ['index', 'sentiment', 'score'],
			},
		},
		requires_reply: { type: 'boolean' },
		suggested_reply: { type: 'string', description: 'A short, courteous draft reply from Gita Press in the same language the customer wrote in (Hindi or English), or empty if none needed. Never invent facts; use placeholders like [order number] or [dispatch date].' },
		rag_suggestion: { type: 'string', enum: ['red', 'amber', 'green'] },
		rag_reason: { type: 'string', description: 'One sentence explaining the RAG rating.' },
		legal_or_churn_signal: { type: 'boolean', description: 'Mentions of legal action, consumer forum, social media complaints, chargebacks, cancelling a dealership or subscription, or formal claims.' },
	},
	required: [
		'business_category', 'subcategory', 'purposes', 'proposal', 'summary', 'sentiment', 'sentiment_score', 'customer_state', 'urgency', 'escalation_risk', 'categories', 'topics',
		'issues', 'action_items', 'entities', 'message_sentiments', 'requires_reply', 'suggested_reply', 'rag_suggestion',
		'rag_reason', 'legal_or_churn_signal',
	],
} as const;

/** The schema for one analysis call: the reasons for contacting offered to the AI are the ones in use now (Settings → Reasons for contacting). */
export function analysisSchema() {
	const keys = activePurposeKeys();
	const props: any = { ...ANALYSIS_SCHEMA.properties };
	props.purposes = { ...props.purposes, items: { type: 'string', enum: keys.length ? keys : [...PURPOSES] } };
	return { ...ANALYSIS_SCHEMA, properties: props };
}
