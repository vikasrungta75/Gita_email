/**
 * Data sections: full-data tables (stock, tracking, book list, book links) and their dashboards, and the
 * customer database dashboards and map.
 */
import { HttpError, type Router } from '../http';
import { one } from '../db';
import { audit } from '../audit';
import { requireRole } from '../auth';
import { writeXlsx } from '../xlsx';
import { DATASETS, dataset, describe, rows, facet, exportRows } from '../tables/datasets';
import { stockInsight, ordersInsight, dispatchInsight, suchiInsight, linksInsight } from '../tables/insights';
import { customerInsight, customerGeo } from '../kalyan/insights';
import { emailConfig } from '../email/config';
import { kalyanYearOf } from '../kalyan/year';

const stamp = () => new Date().toISOString().slice(0, 10);
const xlsx = (bytes: Uint8Array, name: string) => new Response(bytes as any, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${name}"` } });
const csv = (header: string[], list: unknown[][], name: string) => {
	const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
	return new Response(`﻿${[header, ...list].map((r) => r.map(cell).join(',')).join('\r\n')}`, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` } });
};
/** Short-lived cache for dashboards over large tables (the data only changes on upload). */
const cache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, fn: () => Promise<T>, ms = 600_000): Promise<T> {
	// any new upload, confirmation or removal changes the version, so a dashboard is never older than the data
	const v0 = await one<any>(`select concat_ws('|', (select max(coalesce(finished_at, uploaded_at))::text from upload_batches), (select count(*) from upload_batches where status = 'done'),
	  (select max(coalesce(deleted_at, uploaded_at))::text from stock_uploads), (select max(uploaded_at)::text from master_uploads)) as v`);
	key = `${key}:${v0?.v}`;
	const c = cache.get(key);
	if (c && Date.now() - c.at < ms) return c.v as T;
	const v = await fn();
	if (cache.size > 200) cache.clear();
	cache.set(key, { at: Date.now(), v });
	return v;
}

export function registerData(r: Router) {
	r.get('/api/datasets', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		return Object.values(DATASETS).map(describe);
	});
	r.get('/api/datasets/:name', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		return describe(dataset(ctx.params.name));
	});
	r.get('/api/datasets/:name/rows', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const d = dataset(ctx.params.name);
		const format = ctx.query.get('format');
		if (format === 'xlsx' || format === 'csv') {
			const res = await rows(ctx.user!.orgId, d, ctx.query, true);
			const { header, rows: out } = exportRows(d, res.rows);
			await audit(ctx, 'export.dataset', null, null, { dataset: d.name, rows: out.length, filters: Object.fromEntries(ctx.query.entries()) });
			const name = `${d.name.replace(/_/g, '-')}-${stamp()}`;
			return format === 'csv' ? csv(header, out, `${name}.csv`) : xlsx(writeXlsx([{ name: d.label.slice(0, 31), header, rows: out }]), `${name}.xlsx`);
		}
		return rows(ctx.user!.orgId, d, ctx.query);
	});
	r.get('/api/datasets/:name/facet/:key', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		return facet(ctx.user!.orgId, dataset(ctx.params.name), ctx.params.key, ctx.query);
	});

	r.get('/api/insight/stock', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const scope = ctx.query.get('scope') === 'hq' ? 'hq' : 'branch';
		return cached(`stock:${ctx.user!.orgId}:${scope}`, () => stockInsight(ctx.user!.orgId, scope));
	});
	r.get('/api/insight/orders', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const days = Number(ctx.query.get('days')) || null;
		return cached(`orders:${ctx.user!.orgId}:${days}`, () => ordersInsight(ctx.user!.orgId, days));
	});
	r.get('/api/insight/kalyan-dispatch', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		return cached(`dispatch:${ctx.user!.orgId}`, () => dispatchInsight(ctx.user!.orgId));
	});
	r.get('/api/insight/suchi', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		return suchiInsight(ctx.user!.orgId);
	});
	r.get('/api/insight/links', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		return linksInsight(ctx.user!.orgId);
	});

	const yearFor = async (orgId: number, v: string | null) => Number(v) || kalyanYearOf(await emailConfig(orgId), new Date());
	r.get('/api/kalyan/insight', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const orgId = ctx.user!.orgId;
		const scope = ctx.query.get('scope') === 'current' ? 'current' : 'all';
		const year = await yearFor(orgId, ctx.query.get('year'));
		return cached(`cust:${orgId}:${scope}:${year}`, () => customerInsight(orgId, scope, year));
	});
	r.get('/api/kalyan/geo', async (ctx) => {
		requireRole(ctx.user, 'analyst');
		const orgId = ctx.user!.orgId;
		const scope = ctx.query.get('scope') === 'current' ? 'current' : 'all';
		const year = await yearFor(orgId, ctx.query.get('year'));
		const state = ctx.query.get('state');
		if (state && state.length > 80) throw new HttpError(400, 'State name too long');
		return cached(`geo:${orgId}:${scope}:${year}:${state || ''}`, () => customerGeo(orgId, scope, year, state));
	});
}
