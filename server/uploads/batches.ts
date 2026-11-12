/**
 * One place for every kind of upload other than stock: orders, Kalyan dispatch, the book list and the price list.
 *
 * Large files (the Kalyan file is about 750,000 rows) are read in the browser and sent here in small batches of
 * rows, then worked through in the background, so no single request is large or slow. The original file is stored
 * with the upload and can be downloaded again. Uploads are kept for at least five years; removing one hides it and
 * takes its rows out of use, and only an admin can erase it for good.
 */
import { one, q } from '../db';
import { HttpError } from '../http';
import { clean, dateOnly, getMappings, headKey, phone10, pin6, stateName, subType, validEmail } from './common';
import { processOrders } from './orders';
import { processKalyan } from './kalyan';

export type UploadKind = 'orders' | 'kalyan';

/** Columns each file must have (compared without case, spaces or punctuation). */
export const COLUMNS: Record<UploadKind, { key: string; label: string; optional?: boolean }[]> = {
	orders: ['orderId', 'orderMongoId', 'siteCategory', 'customerName', 'email', 'phone', 'totalAmount', 'subtotal', 'postage', 'paymentMethod', 'orderStatusCode', 'orderStatusLabel', 'paymentStatus',
		'createdAt', 'trackingId', 'deliveryPartner', 'shipFirstName', 'shipLastName', 'shipAddress1', 'shipAddress2', 'shipCity', 'shipPincode', 'shipMobile'].map((label) => ({ key: headKey(label), label })),
	kalyan: [...['subperiod', 'custno', 'NAME', 'ADDRESS', 'city', 'pin', 'state', 'PhoneNo', 'DispMode', 'sbarcodeno', 'dispdate', 'Fromissue', 'Toissue', 'EmailID'].map((label) => ({ key: headKey(label), label })),
		{ key: 'returnsts', label: 'Returnsts', optional: true }],
};
export const KIND_LABEL: Record<string, string> = { orders: 'Orders', kalyan: 'Kalyan dispatch', books: 'Book list', prices: 'Price list', hq: 'Head office stock', branch: 'Branch stock' };

const mine = async (orgId: number, id: number) => {
	const b = await one<any>('select * from upload_batches where id=$1 and org_id=$2', [id, orgId]);
	if (!b) throw new HttpError(404, 'Upload not found');
	return b;
};

/** Checks the column headings before anything is written, and opens the upload. */
export async function startBatch(orgId: number, userId: number | null, input: { kind: string; fileName?: string; fileSize?: number; header?: unknown[] }) {
	const kind = input.kind as UploadKind;
	if (!COLUMNS[kind]) throw new HttpError(400, 'Choose the Orders or the Kalyan dispatch upload');
	const header = (Array.isArray(input.header) ? input.header : []).map((h) => clean(h, 80));
	const keys = header.map(headKey);
	const other: UploadKind = kind === 'orders' ? 'kalyan' : 'orders';
	const looksOther = COLUMNS[other].filter((c) => !c.optional && keys.includes(c.key)).length >= 8;
	const missing = COLUMNS[kind].filter((c) => !c.optional && !keys.includes(c.key)).map((c) => c.label);
	if (missing.length && looksOther) throw new HttpError(400, `This looks like the ${KIND_LABEL[other]} file. Please upload it in the ${KIND_LABEL[other]} slot.`);
	if (missing.length) throw new HttpError(400, `${missing.length === 1 ? 'A column is' : 'Some columns are'} missing from the first row of the file: ${missing.join(', ')}. The ${KIND_LABEL[kind]} file needs: ${COLUMNS[kind].filter((c) => !c.optional).map((c) => c.label).join(', ')}.`);
	const dup = keys.filter((k, i) => k && COLUMNS[kind].some((c) => c.key === k) && keys.indexOf(k) !== i);
	if (dup.length) throw new HttpError(400, `A column appears twice in the file: ${[...new Set(dup)].join(', ')}.`);
	const b = await one<any>(
		`insert into upload_batches (org_id, kind, file_name, file_size, status, header, uploaded_by) values ($1,$2,$3,$4,'receiving',$5,$6) returning id`,
		[orgId, kind, clean(input.fileName || `${kind}.csv`, 200), Math.max(0, Number(input.fileSize) || 0), header, userId],
	);
	return { id: b.id as number, kind };
}

const MONTH_OK = (n: number) => Number.isInteger(n) && n >= 1 && n <= 12;

/** A batch of rows read by the browser. Safe to send twice: a row number is stored once. */
export async function addRows(orgId: number, id: number, input: { start?: number; rows?: unknown[][] }) {
	const b = await mine(orgId, id);
	if (b.status !== 'receiving') throw new HttpError(400, 'This upload is already complete');
	const rows = Array.isArray(input.rows) ? input.rows : [];
	const start = Math.max(0, Math.floor(Number(input.start) || 0));
	if (!rows.length) return { received: 0 };
	if (rows.length > 6000) throw new HttpError(413, 'Too many rows in one batch');
	const keys: string[] = (b.header as string[]).map(headKey);
	const ix = (k: string) => keys.indexOf(k);
	const problems: string[] = [];
	let rejected = 0;
	if (b.kind === 'orders') {
		const cols = COLUMNS.orders.map((c) => ({ label: c.label, i: ix(c.key) }));
		const data = rows.map((r, n) => ({ rowno: start + n, data: Object.fromEntries(cols.map((c) => [c.label, clean(r[c.i], 400)])) })).filter((x) => Object.values(x.data).some(Boolean));
		await q(`insert into upload_stage (batch_id, rowno, data) select $1, x.rowno, x.data from jsonb_to_recordset($2::jsonb) as x(rowno int, data jsonb) on conflict do nothing`, [id, JSON.stringify(data)]);
	} else {
		const m = await getMappings(orgId);
		const c = Object.fromEntries(COLUMNS.kalyan.map((x) => [x.key, ix(x.key)]));
		const out: any[] = [];
		rows.forEach((r, n) => {
			const rowno = start + n;
			if (!r || !r.some((v) => v !== '' && v !== null && v !== undefined)) return;
			const custno = clean(r[c.custno], 30).replace(/\.0+$/, '');
			const disp = dateOnly(r[c.dispdate]);
			const from = Number(clean(r[c.fromissue], 6));
			const to = Number(clean(r[c.toissue], 6));
			const bad = !custno ? 'no subscriber number' : !disp ? `dispatch date not readable ("${clean(r[c.dispdate], 30)}")` : !MONTH_OK(from) || !MONTH_OK(to) ? `issue number not 1 to 12 ("${clean(r[c.fromissue], 6)}" to "${clean(r[c.toissue], 6)}")` : '';
			if (bad) { rejected++; if (problems.length < 5) problems.push(`Row ${rowno + 2}: ${bad}`); return; }
			const emailRaw = clean(r[c.emailid], 200);
			const email = validEmail(emailRaw);
			const pin = pin6(r[c.pin]);
			out.push({
				rowno, custno, subperiod: subType(r[c.subperiod]), name: clean(r[c.name], 200), address: clean(r[c.address], 300), city: clean(r[c.city], 80), pin, state: clean(r[c.state], 80),
				state_norm: stateName(m, r[c.state], pin), phone: clean(r[c.phoneno], 30).replace(/\.0+$/, ''), phone10: phone10(r[c.phoneno]), mode: clean(r[c.dispmode], 30).toUpperCase(),
				barcode: clean(r[c.sbarcodeno], 40).toUpperCase() || null, dispdate: disp, from_issue: from, to_issue: to, email: email || emailRaw.toLowerCase() || null, email_ok: !!email,
			});
		});
		if (out.length) await q(
			`insert into kalyan_stage (batch_id, rowno, custno, subperiod, name, address, city, pin, state, state_norm, phone, phone10, mode, barcode, dispdate, from_issue, to_issue, email, email_ok)
			 select $1, x.rowno, x.custno, x.subperiod, x.name, x.address, x.city, x.pin, x.state, x.state_norm, x.phone, x.phone10, x.mode, x.barcode, x.dispdate, x.from_issue, x.to_issue, x.email, x.email_ok
			   from jsonb_to_recordset($2::jsonb) as x(rowno int, custno text, subperiod text, name text, address text, city text, pin text, state text, state_norm text, phone text, phone10 text, mode text,
			        barcode text, dispdate date, from_issue smallint, to_issue smallint, email text, email_ok boolean)
			 on conflict do nothing`,
			[id, JSON.stringify(out)],
		);
	}
	await q(`update upload_batches set rows_received = rows_received + $2, rows_rejected = rows_rejected + $3, warnings = (warnings || $4::text[])[1:40] where id=$1`, [id, rows.length, rejected, problems]);
	return { received: rows.length, rejected };
}

/** A piece of the original file, so it can be downloaded again exactly as uploaded. */
export async function addFilePart(orgId: number, id: number, seq: number, bytes: Uint8Array) {
	const b = await mine(orgId, id);
	if (b.status !== 'receiving') throw new HttpError(400, 'This upload is already complete');
	if (!Number.isInteger(seq) || seq < 0 || seq > 400) throw new HttpError(400, 'File part out of range');
	await q('insert into upload_file_parts (batch_id, seq, bytes) values ($1,$2,$3) on conflict (batch_id, seq) do update set bytes=excluded.bytes', [id, seq, Buffer.from(bytes)]);
	return { success: true };
}

/** Everything has been sent: the upload is queued and worked through in the background. */
export async function finishBatch(orgId: number, id: number, input: { rows?: number }) {
	const b = await mine(orgId, id);
	if (b.status !== 'receiving') return b;
	const sent = Math.max(0, Number(input.rows) || 0);
	const staged = b.kind === 'orders'
		? (await one<any>('select count(*)::int n from upload_stage where batch_id=$1', [id]))!.n
		: (await one<any>('select count(*)::int n from kalyan_stage where batch_id=$1', [id]))!.n;
	if (!staged) {
		await q(`update upload_batches set status='failed', error='No rows could be read from this file.', finished_at=now() where id=$1`, [id]);
		throw new HttpError(400, b.rows_rejected ? `No rows could be used: ${(b.warnings || []).slice(0, 3).join('; ')}` : 'No rows were found in this file.');
	}
	if (sent && Math.abs(sent - b.rows_received) > 0) throw new HttpError(400, `Only ${b.rows_received} of ${sent} rows arrived. Please upload the file again.`);
	await q(`update upload_batches set status='queued', step='queued', rows_total=$2 where id=$1`, [id, staged]);
	return mine(orgId, id);
}

const lease = async (name: string, holder: string, secs: number) => (await q<any>(
	`insert into worker_lease (name, holder, until) values ($1, $2, now() + make_interval(secs => $3))
	 on conflict (name) do update set holder=excluded.holder, until=excluded.until where worker_lease.until < now() returning holder`, [name, holder, secs])).length > 0;

/**
 * Works through queued uploads, oldest first, one at a time. Each step is saved, so a run that is cut short carries
 * on from the same step next time. Returns what was done.
 */
export async function processBatches(orgId: number, deadline = Date.now() + 10 * 60_000) {
	const holder = Math.random().toString(36).slice(2);
	if (!(await lease('uploads', holder, Math.ceil((deadline - Date.now()) / 1000) + 60))) return { skipped: 'another run is working on uploads' };
	const done: any[] = [];
	try {
		// an upload the browser never finished is closed after a day; its staged rows are dropped
		const stale = await q<any>(`update upload_batches set status='failed', error='The upload was not completed.', finished_at=now() where org_id=$1 and status='receiving' and uploaded_at < now() - interval '24 hours' returning id`, [orgId]);
		for (const s of stale) { await q('delete from upload_stage where batch_id=$1', [s.id]); await q('delete from kalyan_stage where batch_id=$1', [s.id]); }
		for (;;) {
			if (Date.now() > deadline - 20_000) break;
			const b = await one<any>(`select * from upload_batches where org_id=$1 and status in ('queued','processing') and deleted_at is null order by id limit 1`, [orgId]);
			if (!b) break;
			const started = Date.now();
			await q(`update upload_batches set status='processing' where id=$1`, [b.id]);
			try {
				const finished = b.kind === 'orders' ? await processOrders(orgId, b, deadline) : await processKalyan(orgId, b, deadline);
				await q(`update upload_batches set timing = jsonb_set(timing, '{ms}', to_jsonb(coalesce((timing->>'ms')::int, 0) + $2::int)) where id=$1`, [b.id, Date.now() - started]);
				if (!finished) break;
				await q(`update upload_batches set status='done', step='done', finished_at=now() where id=$1`, [b.id]);
				await q(`insert into analytics_runs (org_id, trigger, status) values ($1, $2, 'queued')`, [orgId, `upload:${b.kind}:${b.id}`]);
				done.push({ id: b.id, kind: b.kind });
			} catch (e: any) {
				console.error('[uploads]', b.kind, b.id, e);
				await q(`update upload_batches set status='failed', error=$2, finished_at=now() where id=$1`, [b.id, String(e.message || e).slice(0, 500)]);
				done.push({ id: b.id, kind: b.kind, error: e.message });
			}
		}
	} finally {
		await q(`update worker_lease set until=now() where name='uploads' and holder=$1`, [holder]).catch(() => {});
	}
	return { done };
}

export const setStep = (id: number, step: string) => q('update upload_batches set step=$2 where id=$1', [id, step]);

/** Every upload of every kind, newest first: one history for the Uploads page. Stock uploads come from their own table. */
export async function uploadHistory(orgId: number, qs: URLSearchParams) {
	const kind = qs.get('kind') || '';
	const from = dateOnly(qs.get('from') || '');
	const to = dateOnly(qs.get('to') || '');
	const rows = await q<any>(
		`select * from (
		   select 'b' || b.id as key, b.id, b.kind, b.file_name, b.file_size, b.status, b.step, b.rows_received, b.rows_total, b.rows_new, b.rows_updated, b.rows_unchanged, b.rows_rejected, b.profile, b.warnings, b.error, b.timing,
		          b.uploaded_at, b.finished_at, u.full_name as uploaded_by, b.deleted_at, b.deleted_reason, d.full_name as deleted_by,
		          exists (select 1 from upload_file_parts f where f.batch_id=b.id) as has_file, null::text as period_from, null::text as period_to, null::text[] as locations
		     from upload_batches b left join users u on u.id=b.uploaded_by left join users d on d.id=b.deleted_by where b.org_id=$1
		   union all
		   select 's' || s.id, s.id, s.scope, s.file_name, (select length(f.bytes) from stock_files f where f.upload_id=s.id)::bigint, 'done', 'done', s.row_count, s.row_count, 0, 0, 0, 0, jsonb_build_object('sheets', s.sheets), s.warnings, null, '{}'::jsonb,
		          s.uploaded_at, s.uploaded_at, u.full_name, s.deleted_at, s.deleted_reason, d.full_name,
		          exists (select 1 from stock_files f where f.upload_id=s.id), s.period_from::text, s.period_to::text, s.locations
		     from stock_uploads s left join users u on u.id=s.uploaded_by left join users d on d.id=s.deleted_by where s.org_id=$1
		 ) x where ($2 = '' or x.kind = $2) and ($3::date is null or x.uploaded_at >= $3::date) and ($4::date is null or x.uploaded_at < $4::date + 1)
		 order by x.uploaded_at desc limit 2000`,
		[orgId, kind, from, to],
	);
	return rows;
}

/** When each kind was last uploaded and when the next one is expected (shown on the Uploads page and used for overdue alerts). */
export async function uploadStatus(orgId: number, expect: Record<string, number>) {
	const last = await q<any>(
		`select kind, max(uploaded_at) as last from upload_batches where org_id=$1 and deleted_at is null and status in ('done','queued','processing') group by 1
		 union all select scope, max(uploaded_at) from stock_uploads where org_id=$1 and deleted_at is null group by 1`, [orgId]);
	const active = await q<any>(`select id, kind, file_name, status, step, rows_received, rows_total, error, uploaded_at from upload_batches where org_id=$1 and status in ('receiving','queued','processing') and deleted_at is null and uploaded_at > now() - interval '2 days' order by id`, [orgId]);
	const out: Record<string, any> = {};
	for (const k of Object.keys(KIND_LABEL)) {
		const l = last.find((x) => x.kind === k)?.last || null;
		const days = expect[k];
		const due = l && days ? new Date(new Date(l).getTime() + days * 86400_000) : null;
		out[k] = { label: KIND_LABEL[k], last: l, everyDays: days || null, due, overdue: !!(due && due.getTime() < Date.now()) };
	}
	return { kinds: out, active };
}

export async function batchFile(orgId: number, id: number) {
	const b = await mine(orgId, id);
	const parts = await q<any>('select bytes from upload_file_parts where batch_id=$1 order by seq', [id]);
	if (!parts.length) return null;
	return { fileName: b.file_name as string, bytes: Buffer.concat(parts.map((p) => p.bytes)) };
}

/**
 * Removing an upload takes out the rows that only this upload brought in (orders first seen in it; Kalyan
 * dispatches loaded by it). Rows a later upload also carries stay. The upload and its file are kept and listed as
 * removed; only an admin can erase them for good.
 */
export async function removeBatch(orgId: number, id: number, userId: number | null, permanent = false) {
	const b = await mine(orgId, id);
	if (permanent) {
		if (!b.deleted_at) throw new HttpError(400, 'Only a removed upload can be erased permanently. Remove it first.');
		await q('delete from upload_batches where id=$1', [id]);
		return { success: true };
	}
	if (b.deleted_at) throw new HttpError(400, 'This upload is already removed');
	if (b.status === 'processing') throw new HttpError(400, 'This upload is being worked on. Please try again in a few minutes.');
	let taken = 0;
	if (b.kind === 'orders') {
		taken = (await q<any>(`delete from orders where org_id=$1 and first_batch=$2 and last_batch=$2 returning order_key`, [orgId, id])).length;
		await q('delete from order_status_history where org_id=$1 and batch_id=$2', [orgId, id]);
	} else if (b.kind === 'kalyan') {
		taken = (await one<any>(`with d as (delete from kalyan_dispatches where org_id=$1 and batch_id=$2 returning 1) select count(*)::int n from d`, [orgId, id]))!.n;
		const { rollupSubscribers } = await import('./kalyan');
		await rollupSubscribers(orgId, null);
		await q(`delete from kalyan_subscribers where org_id=$1 and dispatches = 0`, [orgId]);
	} else throw new HttpError(400, 'A book list or price list upload cannot be removed; upload a corrected file instead. The original file stays available for download.');
	await q('delete from upload_stage where batch_id=$1', [id]);
	await q('delete from kalyan_stage where batch_id=$1', [id]);
	await q(`update upload_batches set deleted_at=now(), deleted_by=$2, deleted_reason='removed' where id=$1`, [id, userId]);
	await q(`insert into analytics_runs (org_id, trigger, status) values ($1, $2, 'queued')`, [orgId, `removed:${b.kind}:${id}`]);
	return { success: true, rowsTakenOut: taken };
}
