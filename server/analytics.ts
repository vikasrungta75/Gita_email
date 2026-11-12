/**
 * The analytics run: everything that is worked out from the uploads. It runs after every upload and on a schedule
 * (weekly, Monday 6 am India time by default; the frequency is changed in Settings → System status), and can be
 * started by hand. Free: database queries only, no AI.
 *
 * Stage 1 steps: link people across email, orders and Kalyan; order and Kalyan figures on each customer; tiers.
 * (Stage 3 adds the print and ship lists, actions and gaps to the same run.)
 */
import { one, q } from './db';
import { getOrg, invalidateOrg } from './settings';
import { HttpError } from './http';
import { computeTiers, linkPeople, raiseBuyerAlerts, refreshStats } from './customers/link';
import { forgetStock, inventorySettings, reclassifyGodowns } from './stock/stock';

export interface AnalyticsSchedule { frequency: 'daily' | 'twice_weekly' | 'weekly' | 'monthly'; hourIst: number }
export const SCHEDULE_DEFAULT: AnalyticsSchedule = { frequency: 'weekly', hourIst: 6 };
export const FREQUENCY_LABEL: Record<string, string> = { daily: 'Every day', twice_weekly: 'Twice a week (Monday and Thursday)', weekly: 'Every week (Monday)', monthly: 'Every month (1st)' };

export async function analyticsSchedule(orgId: number): Promise<AnalyticsSchedule> {
	return { ...SCHEDULE_DEFAULT, ...(((await getOrg(orgId)).settings as any).analytics || {}) };
}
export async function saveAnalyticsSchedule(orgId: number, input: any) {
	const cur = await analyticsSchedule(orgId);
	const next: AnalyticsSchedule = { frequency: FREQUENCY_LABEL[input?.frequency] ? input.frequency : cur.frequency, hourIst: Number.isFinite(Number(input?.hourIst)) ? Math.max(0, Math.min(23, Math.round(Number(input.hourIst)))) : cur.hourIst };
	if (input?.frequency && !FREQUENCY_LABEL[input.frequency]) throw new HttpError(400, 'Choose daily, twice a week, weekly or monthly');
	await q(`update organisations set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('analytics', $2::jsonb) where id=$1`, [orgId, JSON.stringify(next)]);
	invalidateOrg(orgId);
	return next;
}

/** The latest scheduled moment at or before `now` (India time). */
export function lastSlot(s: AnalyticsSchedule, now = new Date()): Date {
	const IST = 5.5 * 3600_000;
	const local = new Date(now.getTime() + IST);
	for (let back = 0; back < 40; back++) {
		const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - back, s.hourIst));
		const dow = d.getUTCDay();
		const ok = s.frequency === 'daily' || (s.frequency === 'weekly' && dow === 1) || (s.frequency === 'twice_weekly' && (dow === 1 || dow === 4)) || (s.frequency === 'monthly' && d.getUTCDate() === 1);
		if (ok && d.getTime() <= local.getTime()) return new Date(d.getTime() - IST);
	}
	return new Date(0);
}

export async function runAnalytics(orgId: number, trigger: string, runId?: number) {
	const run = runId ? { id: runId } : await one<any>(`insert into analytics_runs (org_id, trigger, status, started_at) values ($1,$2,'running',now()) returning id`, [orgId, trigger]);
	if (runId) await q(`update analytics_runs set status='running', started_at=now() where id=$1`, [runId]);
	const steps: Record<string, unknown> = {};
	const timed = async (name: string, fn: () => Promise<unknown>) => { const t = Date.now(); const res = await fn(); steps[name] = { ...(res && typeof res === 'object' ? res : {}), ms: Date.now() - t }; await q('update analytics_runs set steps=$2 where id=$1', [run!.id, JSON.stringify(steps)]); };
	try {
		// stock already uploaded follows the current list of transfer godowns (Delhi's three by default)
		await timed('Transfer godowns', async () => { await reclassifyGodowns(orgId, (await inventorySettings(orgId)).nonSalesGodowns); forgetStock(orgId); return {}; });
		await timed('Link order customers', () => linkPeople(orgId, 'orders'));
		await timed('Link Kalyan subscribers', () => linkPeople(orgId, 'kalyan'));
		await timed('Order and Kalyan figures', () => refreshStats(orgId));
		await timed('Tiers', () => computeTiers(orgId));
		await timed('Important buyer alerts', () => raiseBuyerAlerts(orgId));
		await q(`update analytics_runs set status='done', finished_at=now(), steps=$2 where id=$1`, [run!.id, JSON.stringify(steps)]);
	} catch (e: any) {
		console.error('[analytics]', e);
		await q(`update analytics_runs set status='failed', finished_at=now(), error=$2, steps=$3 where id=$1`, [run!.id, String(e.message || e).slice(0, 500), JSON.stringify(steps)]);
		throw e;
	}
	return { id: run!.id as number, steps };
}

/** Background: run once for everything queued (several uploads in a row need one run), and when the schedule says so. */
export async function analyticsTick(orgId: number) {
	// a run that never finished (the worker was stopped) is closed so it does not block the next one
	await q(`update analytics_runs set status='failed', error='The run was interrupted.', finished_at=now() where org_id=$1 and status='running' and started_at < now() - interval '30 minutes'`, [orgId]);
	if (await one('select 1 from analytics_runs where org_id=$1 and status=\'running\'', [orgId])) return { skipped: 'a run is in progress' };
	if (await one(`select 1 from upload_batches where org_id=$1 and status in ('queued','processing') and deleted_at is null`, [orgId])) return { skipped: 'waiting for uploads to finish' };
	const queued = await q<any>(`select id, trigger from analytics_runs where org_id=$1 and status='queued' order by id`, [orgId]);
	if (queued.length) {
		const last = queued[queued.length - 1];
		await q(`delete from analytics_runs where id = any($1::bigint[])`, [queued.slice(0, -1).map((r) => r.id)]);
		return runAnalytics(orgId, last.trigger, last.id);
	}
	const s = await analyticsSchedule(orgId);
	const slot = lastSlot(s);
	const done = await one<any>(`select max(requested_at) as t from analytics_runs where org_id=$1 and trigger='schedule'`, [orgId]);
	if (!done?.t || new Date(done.t).getTime() < slot.getTime()) return runAnalytics(orgId, 'schedule');
	return { skipped: 'not due' };
}

export async function analyticsStatus(orgId: number) {
	const s = await analyticsSchedule(orgId);
	const runs = await q<any>(`select id, trigger, status, steps, error, requested_at, started_at, finished_at from analytics_runs where org_id=$1 order by id desc limit 10`, [orgId]);
	const slot = lastSlot(s);
	const step = { daily: 1, twice_weekly: 1, weekly: 1, monthly: 1 }[s.frequency];
	let next = new Date(slot.getTime() + step * 86400_000);
	for (let i = 0; i < 40 && lastSlot(s, next).getTime() === slot.getTime(); i++) next = new Date(next.getTime() + 86400_000);
	return { schedule: s, frequencies: FREQUENCY_LABEL, runs, next: lastSlot(s, next) };
}
