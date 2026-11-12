/**
 * Kalyan dispatch (uploaded monthly). One row per dispatch of an issue (or a run of issues) to a subscriber.
 *
 * What the file means (confirmed by Gita Press, and profiled on the May–October 2026 file):
 *  - subperiod: 1Y = 1-year subscription, FY = 5-year, LM = life member (a lowercase "fy" is FY);
 *  - Fromissue / Toissue: the issue numbers in that dispatch, one issue a month (1 to 12). Most rows are a single
 *    issue; a row like 1 → 5 is a new subscriber receiving the earlier issues of the year;
 *  - DispMode: ORDINARY (no barcode, no tracking), REGISTERED (always a barcode: the tracking and dispatch number),
 *    BY SHOP (collected at a shop);
 *  - Returnsts is not used for now (future enhancement): it stays only in the stored original file.
 *
 * Every dispatch row is kept. The key is subscriber + issues + dispatch date; the barcode cannot be the key because
 * ordinary post has none. A few subscribers have two rows with the same key (two copies): they are numbered so
 * neither is lost, and loading the same file again changes nothing.
 */
import { one, q } from '../db';
import { setStep } from './batches';

/** 'YYYY-MM' of an issue: its number is the month; the year comes from the dispatch date (an issue can go out a month or two either side of the year end). */
const YEAR = (issue: string) => `(extract(year from dispdate)::int + case when ${issue} - extract(month from dispdate) > 6 then -1 when extract(month from dispdate) - ${issue} > 6 then 1 else 0 end)`;
const TO_YM = `to_char(make_date(${YEAR('to_issue')}, to_issue, 1), 'YYYY-MM')`;
const FROM_YM = `to_char(make_date(${YEAR('to_issue')} - case when from_issue > to_issue then 1 else 0 end, from_issue, 1), 'YYYY-MM')`;

const STEPS = ['dispatches', 'subscribers', 'rollup', 'profile', 'cleanup'] as const;

export async function processKalyan(orgId: number, batch: any, deadline: number): Promise<boolean> {
	if (batch.profile?.next === 'done') return true;
	let at = Math.max(0, STEPS.indexOf((batch.profile?.next || 'dispatches') as any));
	for (; at < STEPS.length; at++) {
		if (Date.now() > deadline - 30_000) return false;
		const step = STEPS[at];
		if (step === 'dispatches') {
			await setStep(batch.id, 'Saving dispatches');
			const r = await one<any>(
				`with src as (
				   select s.*, row_number() over (partition by custno, from_issue, to_issue, dispdate order by barcode nulls last, mode, rowno)::smallint as occ from kalyan_stage s where batch_id=$2),
				 up as (
				   insert into kalyan_dispatches (org_id, custno, from_issue, to_issue, dispdate, occ, mode, barcode, subperiod, batch_id)
				   select $1, custno, from_issue, to_issue, dispdate, occ, mode, barcode, subperiod, $2 from src
				   on conflict (org_id, custno, from_issue, to_issue, dispdate, occ) do update set mode=excluded.mode, barcode=excluded.barcode, subperiod=excluded.subperiod, batch_id=excluded.batch_id
				     where (kalyan_dispatches.mode, kalyan_dispatches.barcode, kalyan_dispatches.subperiod) is distinct from (excluded.mode, excluded.barcode, excluded.subperiod)
				   returning (xmax = 0) as ins)
				 select count(*) filter (where ins)::int as fresh, count(*) filter (where not ins)::int as updated, (select count(*)::int from src) as total, (select count(*)::int from src where occ > 1) as extra from up`,
				[orgId, batch.id],
			);
			await q(`update upload_batches set rows_total=$2, rows_new=$3, rows_updated=$4, rows_unchanged=$5 where id=$1`, [batch.id, r.total, r.fresh, r.updated, r.total - r.fresh - r.updated]);
			batch.profile = { ...(batch.profile || {}), sameKeyRows: r.extra };
		} else if (step === 'subscribers') {
			await setStep(batch.id, 'Updating subscribers');
			// the subscriber's details come from their latest dispatch; an older file never overwrites newer details
			await q(
				`insert into kalyan_subscribers (org_id, custno, name, address, city, pin, state, state_norm, phone, phone10, email, email_ok, sub_type, mode, last_dispatch)
				 select distinct on (custno) $1, custno, name, address, city, pin, state, state_norm, phone, phone10, email, email_ok, subperiod, mode, dispdate
				   from kalyan_stage where batch_id=$2 order by custno, dispdate desc, rowno desc
				 on conflict (org_id, custno) do update set name=excluded.name, address=excluded.address, city=excluded.city, pin=excluded.pin, state=excluded.state, state_norm=excluded.state_norm,
				   phone=excluded.phone, phone10=excluded.phone10, email=excluded.email, email_ok=excluded.email_ok, sub_type=excluded.sub_type, mode=excluded.mode, updated_at=now()
				   where kalyan_subscribers.last_dispatch is null or excluded.last_dispatch >= kalyan_subscribers.last_dispatch`,
				[orgId, batch.id],
			);
		} else if (step === 'rollup') {
			await setStep(batch.id, 'Working out first and latest issues');
			await rollupSubscribers(orgId, batch.id);
		} else if (step === 'profile') {
			await setStep(batch.id, 'Checking the file');
			const [range, modes, types, contact, months, all] = await Promise.all([
				one<any>(`select min(dispdate)::text as "from", max(dispdate)::text as "to", count(distinct custno)::int as subscribers from kalyan_stage where batch_id=$1`, [batch.id]),
				q<any>(`select mode as k, count(*)::int as n, count(barcode)::int as with_barcode from kalyan_stage where batch_id=$1 group by 1 order by 2 desc`, [batch.id]),
				q<any>(`select subperiod as k, count(*)::int as n from kalyan_stage where batch_id=$1 group by 1 order by 2 desc`, [batch.id]),
				one<any>(
					`select count(*)::int as subscribers, count(*) filter (where email_ok)::int as email_ok, count(*) filter (where email is not null and not email_ok)::int as email_bad, count(phone10)::int as phone_ok,
					        count(*) filter (where state_norm is null)::int as state_unknown, count(*) filter (where pin = '')::int as no_pin
					   from (select distinct on (custno) * from kalyan_stage where batch_id=$1 order by custno, dispdate desc, rowno desc) s`, [batch.id]),
				q<any>(`select to_char(dispdate, 'YYYY-MM') as month, count(*)::int as n from kalyan_stage where batch_id=$1 group by 1 order by 1`, [batch.id]),
				monthCompleteness(orgId),
			]);
			const mine = new Set(months.map((m) => m.month));
			const warn = all.filter((m) => mine.has(m.month) && m.warning).map((m) => `${m.label}: ${m.warning}`);
			const notes = [
				batch.profile?.sameKeyRows ? `${batch.profile.sameKeyRows} rows share the same subscriber, issues and dispatch date as another row (two copies); every row was kept` : '',
				contact.email_bad ? `${contact.email_bad} subscribers have an email address that is cut short or not valid; it is kept as a note and not used for matching or replies` : '',
				contact.state_unknown ? `${contact.state_unknown} subscribers have a state that was not recognised and no usable PIN code. Add the spelling in Settings → Master data → Mappings` : '',
				types.filter((t) => !['1Y', 'FY', 'LM'].includes(t.k)).length ? `Subscription types not recognised: ${types.filter((t) => !['1Y', 'FY', 'LM'].includes(t.k)).map((t) => t.k || '(blank)').join(', ')}` : '',
				modes.filter((t) => !['ORDINARY', 'REGISTERED', 'BY SHOP'].includes(t.k)).length ? `Dispatch modes not recognised: ${modes.filter((t) => !['ORDINARY', 'REGISTERED', 'BY SHOP'].includes(t.k)).map((t) => t.k || '(blank)').join(', ')}` : '',
			].filter(Boolean);
			await q(`update upload_batches set profile=$2, warnings = ($3::text[] || warnings)[1:40] where id=$1`,
				[batch.id, JSON.stringify({ ...range, modes, types, contact, months, sameKeyRows: batch.profile?.sameKeyRows || 0 }), [...warn, ...notes]]);
		} else if (step === 'cleanup') {
			await q('delete from kalyan_stage where batch_id=$1', [batch.id]);
		}
		// remember the next step, so a run that is cut short carries on from there
		await q(`update upload_batches set profile = coalesce(profile, '{}'::jsonb) || $2::jsonb where id=$1`, [batch.id, JSON.stringify({ next: STEPS[at + 1] || 'done', sameKeyRows: batch.profile?.sameKeyRows || 0 })]);
	}
	await q(`update upload_batches set profile = profile - 'next' where id=$1`, [batch.id]);
	return true;
}

/**
 * First and latest dispatch and issue for each subscriber, from every dispatch on file, and the estimated renewal.
 *
 * Kalyan runs by calendar year: issue 1 is January, and a new subscriber is sent a catch-up run of the earlier issues
 * of the year (a row such as 1 → 10). The file has no end date, so renewal is an estimate:
 *  - 1 year: due in January of the year after the latest issue received;
 *  - 5 years: known only when a catch-up row shows the year the subscription started; due five years after that.
 *    Otherwise "not known" (no date is guessed);
 *  - life member: never due.
 */
export async function rollupSubscribers(orgId: number, batchId: number | null) {
	const Y = YEAR('to_issue');
	await q(
		`with d as (
		   select custno, min(dispdate) as fd, max(dispdate) as ld, count(*)::int as n, min(${FROM_YM}) as fym, max(${TO_YM}) as lym,
		          min(${Y}) filter (where from_issue = 1 and to_issue > 1) as start_year
		     from kalyan_dispatches where org_id=$1 ${batchId ? 'and custno in (select custno from kalyan_stage where batch_id=$2)' : ''} group by custno)
		 update kalyan_subscribers s set first_dispatch=d.fd, last_dispatch=d.ld, dispatches=d.n, first_issue_ym=d.fym, last_issue_ym=d.lym,
		        start_known = (s.sub_type = '1Y' or (s.sub_type = 'FY' and d.start_year is not null)),
		        renewal_est = case when s.sub_type='1Y' then make_date(left(d.lym, 4)::int + 1, 1, 1)
		                           when s.sub_type='FY' and d.start_year is not null then make_date(d.start_year + 5, 1, 1) else null end
		   from d where s.org_id=$1 and s.custno=d.custno`,
		batchId ? [orgId, batchId] : [orgId],
	);
	if (!batchId) await q(`update kalyan_subscribers s set dispatches=0 where org_id=$1 and not exists (select 1 from kalyan_dispatches d where d.org_id=$1 and d.custno=s.custno)`, [orgId]);
	return {};
}

/**
 * Is each month's dispatch complete? Compares every month with the usual month: far fewer rows, or no ordinary-post
 * rows when ordinary post is normally a large share, means part of the month was probably left out of the file.
 * (In the May–October 2026 file, August and November have registered post only.)
 */
export async function monthCompleteness(orgId: number) {
	const rows = await q<any>(
		`select to_char(dispdate, 'YYYY-MM') as month, count(*)::int as n, count(*) filter (where mode='ORDINARY')::int as ordinary, count(*) filter (where mode='REGISTERED')::int as registered,
		        count(distinct custno)::int as subscribers, max(dispdate)::text as last_day
		   from kalyan_dispatches where org_id=$1 group by 1 order by 1`, [orgId]);
	if (!rows.length) return [];
	const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
	const median = (a: number[]) => { const s = sorted(a); return s.length ? s[Math.floor(s.length / 2)] : 0; };
	const usual = median(rows.map((r) => r.n));
	const usualOrdinary = median(rows.map((r) => (r.n ? r.ordinary / r.n : 0)));
	const now = new Date().toISOString().slice(0, 7);
	return rows.map((r) => {
		const share = r.n ? r.ordinary / r.n : 0;
		const running = r.month === now;
		const warning = rows.length < 3 ? '' : usualOrdinary > 0.2 && r.ordinary === 0
			? `no ordinary-post dispatches (usually about ${Math.round(usualOrdinary * 100)}% of a month)${running ? '; the month is still running' : ''}. Ordinary post may be missing from the file`
			: r.n < usual * 0.6 && !running ? `${r.n.toLocaleString('en-IN')} rows, well below the usual ${usual.toLocaleString('en-IN')}. Part of the month may be missing` : '';
		return { ...r, label: new Date(`${r.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }), ordinaryShare: Math.round(share * 100), warning };
	});
}
