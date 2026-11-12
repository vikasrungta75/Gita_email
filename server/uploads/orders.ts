/**
 * Orders from the Gita Press shipping export. Each file holds all orders to date, so every row is matched to the
 * order already stored (by order number) and only what changed is updated; nothing is deleted. A change of status or
 * tracking number is added to the order's history.
 *
 * What the real file looks like (profiled 12 Nov 2026) and how it is handled:
 *  - many orders appear twice as exact copies: counted once;
 *  - order numbers come as GPHO341843 and GPHO_341629: matched without the underscore;
 *  - a third of the rows have no email: phone matters as much as email for finding the customer;
 *  - a fifth of the tracking numbers were turned into "5.0E+12" by Excel: marked damaged, never linked;
 *  - courier names are written several ways: merged to one name each (Settings → Master data → Mappings);
 *  - there is no book or quantity information, so orders and spend are counted, never books.
 */
import { q } from '../db';
import { setStep } from './batches';
import { amount, clean, courier, getMappings, hash, orderKey, phone10, pin6, tracking, validEmail, blank } from './common';

const count = (o: Record<string, number>, k: string | null | undefined) => { const key = k || 'Not stated'; o[key] = (o[key] || 0) + 1; };

export function normaliseOrder(m: Awaited<ReturnType<typeof getMappings>>, d: Record<string, string>) {
	const key = orderKey(d.orderId);
	const email = validEmail(d.email);
	const t = tracking(d.trackingId);
	const c = courier(m, d.deliveryPartner);
	const first = clean(d.shipFirstName, 120);
	const last = clean(d.shipLastName, 120);
	const shipName = last && !first.toLowerCase().endsWith(last.toLowerCase()) ? `${first} ${last}`.trim() : first || last;
	const a1 = clean(d.shipAddress1, 300);
	const a2 = clean(d.shipAddress2, 300);
	const at = d.createdAt && !Number.isNaN(Date.parse(d.createdAt)) ? new Date(d.createdAt).toISOString() : null;
	const total = amount(d.totalAmount);
	const subtotal = amount(d.subtotal);
	const postage = amount(d.postage);
	const o = {
		order_key: key, order_id: clean(d.orderId, 60), mongo_id: clean(d.orderMongoId, 60) || null, site: clean(d.siteCategory, 60) || null, customer_name: clean(d.customerName, 200),
		email: email || (blank(d.email) ? null : clean(d.email, 200).toLowerCase()), email_ok: !!email, phone: clean(d.phone, 30) || null, phone10: phone10(d.phone) || phone10(d.shipMobile),
		total: Number.isNaN(total as number) ? null : total, subtotal: Number.isNaN(subtotal as number) ? null : subtotal, postage: Number.isNaN(postage as number) ? null : postage,
		payment_method: clean(d.paymentMethod, 40) || null, status_code: clean(d.orderStatusCode, 20) || null,
		status_label: clean(d.orderStatusLabel, 60) || m.orderStatus[clean(d.orderStatusCode, 20)] || null, payment_status: clean(d.paymentStatus, 30) || null, ordered_at: at,
		tracking_id: t.id, tracking_ok: t.ok, partner_raw: clean(d.deliveryPartner, 80) || null, partner: c.name, ship_name: shipName || null,
		ship_address: [a1, a2 && a2.toLowerCase() !== a1.toLowerCase() ? a2 : ''].filter(Boolean).join(', ') || null, ship_city: clean(d.shipCity, 80) || null, ship_pin: pin6(d.shipPincode) || null,
		ship_phone10: phone10(d.shipMobile),
	};
	const problems = [
		!key && 'no order number', d.createdAt && !at && `order date not readable ("${clean(d.createdAt, 30)}")`, Number.isNaN(total as number) && `amount not readable ("${clean(d.totalAmount, 20)}")`,
	].filter(Boolean) as string[];
	return { o: { ...o, row_hash: hash(Object.values(o)) }, problems, damagedTracking: t.damaged, oddTracking: !!t.id && !t.ok && !t.damaged, unknownCourier: !!c.name && !c.known, invalidEmail: !email && !blank(d.email) };
}

const COLS = ['order_key', 'order_id', 'mongo_id', 'site', 'customer_name', 'email', 'email_ok', 'phone', 'phone10', 'total', 'subtotal', 'postage', 'payment_method', 'status_code', 'status_label', 'payment_status',
	'ordered_at', 'tracking_id', 'tracking_ok', 'partner_raw', 'partner', 'ship_name', 'ship_address', 'ship_city', 'ship_pin', 'ship_phone10', 'row_hash'];
const TYPES = 'order_key text, order_id text, mongo_id text, site text, customer_name text, email text, email_ok boolean, phone text, phone10 text, total numeric, subtotal numeric, postage numeric, payment_method text, status_code text, status_label text, payment_status text, ordered_at timestamptz, tracking_id text, tracking_ok boolean, partner_raw text, partner text, ship_name text, ship_address text, ship_city text, ship_pin text, ship_phone10 text, row_hash text';

export async function processOrders(orgId: number, batch: any, deadline: number): Promise<boolean> {
	const m = await getMappings(orgId);
	const p: any = { sites: {}, statuses: {}, paymentStatuses: {}, paymentMethods: {}, couriers: {}, unknownCouriers: {}, noEmail: 0, invalidEmail: 0, damagedTracking: 0, oddTracking: 0, noTracking: 0, copies: 0, from: null, to: null, ...(batch.profile?.partial || {}) };
	const seen = new Set<string>(p.seen || []);
	let fresh = p.fresh || 0, updated = p.updated || 0, unchanged = p.unchanged || 0, rejected = p.rejected || 0;
	const warnings: string[] = [];
	let after = p.after ?? -1;
	await setStep(batch.id, 'Reading orders');
	for (;;) {
		const page = await q<any>('select rowno, data from upload_stage where batch_id=$1 and rowno > $2 order by rowno limit 3000', [batch.id, after]);
		if (!page.length) break;
		const byKey = new Map<string, any>();
		for (const r of page) {
			const n = normaliseOrder(m, r.data);
			if (n.problems.length && !n.o.order_key) { rejected++; if (warnings.length < 20) warnings.push(`Row ${r.rowno + 2}: ${n.problems.join('; ')}`); continue; }
			if (n.problems.length && warnings.length < 20) warnings.push(`Row ${r.rowno + 2} (order ${n.o.order_id}): ${n.problems.join('; ')}`);
			if (seen.has(n.o.order_key) || byKey.has(n.o.order_key)) p.copies++;
			else {
				count(p.sites, n.o.site); count(p.statuses, n.o.status_label); count(p.paymentStatuses, n.o.payment_status); count(p.paymentMethods, n.o.payment_method); count(p.couriers, n.o.partner);
				if (n.unknownCourier) count(p.unknownCouriers, n.o.partner);
				if (!n.o.email) p.noEmail++;
				if (n.invalidEmail) p.invalidEmail++;
				if (n.damagedTracking) p.damagedTracking++;
				if (n.oddTracking) p.oddTracking++;
				if (!n.o.tracking_id) p.noTracking++;
				if (n.o.ordered_at) { if (!p.from || n.o.ordered_at < p.from) p.from = n.o.ordered_at; if (!p.to || n.o.ordered_at > p.to) p.to = n.o.ordered_at; }
			}
			byKey.set(n.o.order_key, n.o);
		}
		const list = [...byKey.values()];
		const keys = list.map((o) => o.order_key);
		const cur = new Map((await q<any>('select order_key, row_hash, status_code, status_label, payment_status, tracking_id from orders where org_id=$1 and order_key = any($2::text[])', [orgId, keys])).map((r) => [r.order_key, r]));
		const changed = list.filter((o) => cur.get(o.order_key)?.row_hash !== o.row_hash);
		const history = changed.filter((o) => { const c = cur.get(o.order_key); return !c || c.status_code !== o.status_code || c.status_label !== o.status_label || c.payment_status !== o.payment_status || c.tracking_id !== o.tracking_id; });
		for (const o of list) {
			if (seen.has(o.order_key)) continue;
			seen.add(o.order_key);
			const c = cur.get(o.order_key);
			if (!c) fresh++; else if (c.row_hash !== o.row_hash) updated++; else unchanged++;
		}
		if (changed.length) await q(
			`insert into orders (org_id, ${COLS.join(', ')}, first_batch, last_batch)
			 select $1, ${COLS.map((c) => `x.${c}`).join(', ')}, $3, $3 from jsonb_to_recordset($2::jsonb) as x(${TYPES})
			 on conflict (org_id, order_key) do update set ${COLS.filter((c) => c !== 'order_key').map((c) => `${c}=excluded.${c}`).join(', ')}, last_batch=$3, updated_at=now()`,
			[orgId, JSON.stringify(changed), batch.id],
		);
		// an order also carried by this file is "last seen" in it, even when nothing changed
		await q('update orders set last_batch=$3 where org_id=$1 and order_key = any($2::text[]) and last_batch is distinct from $3', [orgId, keys, batch.id]);
		if (history.length) await q(
			`insert into order_status_history (org_id, order_key, status_code, status_label, payment_status, tracking_id, batch_id)
			 select $1, x.order_key, x.status_code, x.status_label, x.payment_status, x.tracking_id, $3 from jsonb_to_recordset($2::jsonb) as x(order_key text, status_code text, status_label text, payment_status text, tracking_id text)`,
			[orgId, JSON.stringify(history), batch.id],
		);
		after = page[page.length - 1].rowno;
		if (Date.now() > deadline - 20_000) {
			// out of time: remember where this run stopped
			await q(`update upload_batches set profile = jsonb_build_object('partial', $2::jsonb), step=$3 where id=$1`, [batch.id, JSON.stringify({ ...p, seen: [...seen], fresh, updated, unchanged, rejected, after }), `Reading orders (${seen.size} so far)`]);
			return false;
		}
	}
	const notes = [
		p.copies ? `${p.copies} rows were exact copies of an order already in the file; each order is counted once` : '',
		p.damagedTracking ? `${p.damagedTracking} tracking numbers were damaged by Excel (they look like 5.0E+12) and cannot be used; export the file again with tracking numbers as text to repair them` : '',
		p.oddTracking ? `${p.oddTracking} tracking numbers do not look like tracking numbers and are not linked` : '',
		Object.keys(p.unknownCouriers).length ? `Delivery partners not recognised: ${Object.keys(p.unknownCouriers).slice(0, 8).join(', ')}. Add them in Settings → Master data → Mappings` : '',
		p.invalidEmail ? `${p.invalidEmail} email addresses are not valid and are not used for matching or replies` : '',
	].filter(Boolean);
	delete p.partial; delete p.seen; delete p.after; delete p.fresh; delete p.updated; delete p.unchanged; delete p.rejected;
	await q(
		`update upload_batches set rows_total=$2, rows_new=$3, rows_updated=$4, rows_unchanged=$5, rows_rejected=$6, profile=$7, warnings=$8 where id=$1`,
		[batch.id, seen.size, fresh, updated, unchanged, rejected, JSON.stringify({ ...p, orders: seen.size }), [...notes, ...warnings].slice(0, 40)],
	);
	await q('delete from upload_stage where batch_id=$1', [batch.id]);
	return true;
}
