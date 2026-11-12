import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * Why a reader contacted Gita Press (several per thread; the customer record collects all of them).
 * The list is edited in Settings → Reasons for contacting; this one is only the starting list, used until the
 * current list has loaded.
 */
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

export interface PurposeDef { key: string; label: string; description: string; keywords: string[]; group_name: string; sort_order: number; hidden: boolean; locked: boolean; builtin: boolean; merged_into: string | null; active: boolean; customers: number; threads: number }
let LIVE: Record<string, PurposeDef> = {};
/** The current name of a reason; a hidden or merged one is marked so on old records. */
export const purposeLabel = (k: string) => {
	const d = LIVE[k];
	if (!d) return PURPOSE_LABELS[k] || k;
	if (d.merged_into) return `${d.label} (merged into ${LIVE[d.merged_into]?.label || d.merged_into})`;
	return d.hidden ? `${d.label} (hidden)` : d.label;
};
/** Without the bracketed detail, for chips. */
export const shortPurpose = (k: string) => purposeLabel(k).replace(/\s*\((?!hidden|merged).*\)$/, '');

/** The reasons in use now, grouped as in Settings. Labels update everywhere as soon as they are saved. */
export function usePurposes() {
	const q = useQuery({ queryKey: ['purposes'], queryFn: () => api<{ purposes: PurposeDef[]; groups: string[]; retags: any[]; max: number }>('/purposes'), staleTime: 60_000 });
	const all = q.data?.purposes || [];
	if (all.length) LIVE = Object.fromEntries(all.map((d) => [d.key, d]));
	const active = all.length ? all.filter((d) => d.active).sort((a, b) => a.sort_order - b.sort_order) : PURPOSE_KEYS.map((k, i) => ({ key: k, label: PURPOSE_LABELS[k], group_name: '', sort_order: i } as PurposeDef));
	const groups = q.data?.groups?.length ? q.data.groups : [''];
	/** options for a picker, grouped under headings */
	const options = (extra?: (k: string) => any) => groups.flatMap((g) => active.filter((d) => d.group_name === g || !g).map((d) => ({ v: d.key, l: d.label, group: g || undefined, ...(extra ? { extra: extra(d.key) } : {}) })));
	return { ...q, all, active, activeKeys: active.map((d) => d.key), groups, options };
}

/** Reads a file the user picked and returns it as base64 for an upload. */
export const fileToBase64 = (f: File) => new Promise<string>((resolve, reject) => {
	const r = new FileReader();
	r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
	r.onerror = () => reject(new Error('Could not read the file'));
	r.readAsDataURL(f);
});

export const inr = (n?: number | null) => (n === null || n === undefined ? '–' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
export const num = (n?: number | null) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-IN'));
