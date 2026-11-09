/** Why a reader contacted Gita Press (several per thread; the customer record collects all of them). Mirrors server/ai/purposes.ts. */
export const PURPOSE_LABELS: Record<string, string> = {
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
export const PURPOSE_KEYS = Object.keys(PURPOSE_LABELS);
export const purposeLabel = (k: string) => PURPOSE_LABELS[k] || k;
/** Without the bracketed detail, for chips. */
export const shortPurpose = (k: string) => purposeLabel(k).replace(/\s*\(.*\)$/, '');

/** Reads a file the user picked and returns it as base64 for an upload. */
export const fileToBase64 = (f: File) => new Promise<string>((resolve, reject) => {
	const r = new FileReader();
	r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
	r.onerror = () => reject(new Error('Could not read the file'));
	r.readAsDataURL(f);
});

export const inr = (n?: number | null) => (n === null || n === undefined ? '–' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
export const num = (n?: number | null) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-IN'));
