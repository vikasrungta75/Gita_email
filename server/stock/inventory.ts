/**
 * Inventory and sales analysis from every uploaded Tally stock summary.
 *
 * Estimated sales = outwards from branch shops ('store' godowns) and from Gorakhpur Retail Dispatch. Outwards from
 * Gorakhpur Main Stock and from branch godowns are transfers (supply), not sales. Each upload is filed under the
 * month its period ends in; when uploads for a location overlap, the longer period is used so nothing is counted twice.
 */
import { one, q } from '../db';
import { BY_KEY, DIRECTORY, HQ_KEY, locationLabel, nearestBranch } from '../directory';
import { currentStock, inventorySettings, type InventorySettings } from './stock';
import { PURPOSE_LABELS, type Purpose } from '../ai/purposes';

const SALES_KINDS = ['retail', 'store'];
/** Recommendations need at least about a month of sales; a few days of data would exaggerate one-off sales. */
export const MIN_DAYS = 28;
const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
const monthOf = (d: string) => d.slice(0, 7);

interface Pair { upload_id: number; location: string; from: string; to: string; days: number; month: string }
interface Fact { sales: number; value: number; inq: number; outq: number }
export interface Facts {
	key: string;
	pairs: Pair[];
	/** location → month → code → movement */
	byLoc: Map<string, Map<string, Map<string, Fact>>>;
	/** location → month → days covered */
	coverage: Map<string, Map<string, number>>;
	/** location → month → closing stock (copies, value) at the month's last upload */
	closing: Map<string, Map<string, { qty: number; value: number; to: string }>>;
	months: string[];
}

const cache = new Map<number, Facts>();

/** Non-overlapping uploads per location (longest period first). */
async function pairsFor(orgId: number): Promise<{ pairs: Pair[]; key: string }> {
	const ups = await q<any>(`select id, locations, period_from::text as f, period_to::text as t, uploaded_at from stock_uploads where org_id=$1 and deleted_at is null`, [orgId]);
	const key = ups.map((u) => `${u.id}:${u.locations.join(',')}`).sort().join('|');
	const byLoc = new Map<string, { id: number; f: string; t: string; d: number; at: number }[]>();
	for (const u of ups) for (const l of u.locations) {
		const list = byLoc.get(l) || [];
		list.push({ id: u.id, f: u.f, t: u.t, d: days(u.f, u.t), at: new Date(u.uploaded_at).getTime() });
		byLoc.set(l, list);
	}
	const pairs: Pair[] = [];
	for (const [loc, list] of byLoc) {
		const kept: typeof list = [];
		for (const u of list.sort((a, b) => b.d - a.d || b.at - a.at)) {
			if (kept.some((k) => !(u.t < k.f || u.f > k.t))) continue;
			kept.push(u);
			pairs.push({ upload_id: u.id, location: loc, from: u.f, to: u.t, days: u.d, month: monthOf(u.t) });
		}
	}
	return { pairs, key };
}

export async function facts(orgId: number): Promise<Facts> {
	const { pairs, key } = await pairsFor(orgId);
	const c = cache.get(orgId);
	if (c && c.key === key) return c;
	const args = [orgId, pairs.map((p) => p.upload_id), pairs.map((p) => p.location), pairs.map((p) => p.month)];
	const rows = pairs.length
		? await q<any>(
			`select r.location, l.month, r.code,
			        coalesce(sum(r.out_qty) filter (where r.godown_kind = any($5::text[])), 0)::float as sales,
			        coalesce(sum(case when r.out_value <> 0 then r.out_value else r.out_qty * coalesce(r.price, 0) end) filter (where r.godown_kind = any($5::text[])), 0)::float as value,
			        coalesce(sum(r.in_qty) filter (where r.godown_kind <> 'semi'), 0)::float as inq,
			        coalesce(sum(r.out_qty) filter (where r.godown_kind <> 'semi'), 0)::float as outq
			   from stock_rows r join unnest($2::bigint[], $3::text[], $4::text[]) as l(upload_id, location, month) on l.upload_id=r.upload_id and l.location=r.location
			  where r.org_id=$1 and (r.out_qty <> 0 or r.in_qty <> 0)
			  group by 1,2,3`,
			[...args, SALES_KINDS],
		)
		: [];
	const totals = pairs.length
		? await q<any>(
			`select r.upload_id, r.location, sum(greatest(r.closing_qty,0)) filter (where r.godown_kind <> 'semi')::float as qty,
			        sum(greatest(r.closing_qty,0) * coalesce(r.price,0)) filter (where r.godown_kind <> 'semi')::float as value
			   from stock_rows r join unnest($2::bigint[], $3::text[]) as l(upload_id, location) on l.upload_id=r.upload_id and l.location=r.location
			  where r.org_id=$1 group by 1,2`,
			args.slice(0, 3),
		)
		: [];
	const byLoc: Facts['byLoc'] = new Map();
	for (const r of rows) {
		const m = byLoc.get(r.location) || new Map();
		byLoc.set(r.location, m);
		const cm = m.get(r.month) || new Map();
		m.set(r.month, cm);
		cm.set(r.code, { sales: r.sales, value: r.value, inq: r.inq, outq: r.outq });
	}
	const coverage: Facts['coverage'] = new Map();
	const closing: Facts['closing'] = new Map();
	for (const p of pairs) {
		const cv = coverage.get(p.location) || new Map();
		coverage.set(p.location, cv);
		cv.set(p.month, (cv.get(p.month) || 0) + p.days);
		const t = totals.find((x) => x.upload_id === p.upload_id && x.location === p.location);
		const cl = closing.get(p.location) || new Map();
		closing.set(p.location, cl);
		if (t && (!cl.get(p.month) || cl.get(p.month)!.to < p.to)) cl.set(p.month, { qty: t.qty || 0, value: t.value || 0, to: p.to });
	}
	const months = [...new Set(pairs.map((p) => p.month))].sort();
	const f: Facts = { key, pairs, byLoc, coverage, closing, months };
	cache.set(orgId, f);
	return f;
}
export const forgetFacts = (orgId: number) => cache.delete(orgId);

// ── per-title sales rates ──────────────────────────────────────────────────

interface Rate { qty: number; value: number; days: number; daily: number }
/** Sales over the latest months of data for a location, up to about `window` days. */
function rates(f: Facts, loc: string, window = 90): { byCode: Map<string, Rate>; days: number; months: string[] } {
	const cov = f.coverage.get(loc);
	const out = new Map<string, Rate>();
	if (!cov) return { byCode: out, days: 0, months: [] };
	const months = [...cov.keys()].sort().reverse();
	const used: string[] = [];
	let d = 0;
	for (const m of months) { if (d >= window) break; used.push(m); d += cov.get(m)!; }
	const mm = f.byLoc.get(loc);
	for (const m of used) for (const [code, x] of mm?.get(m) || []) {
		const r = out.get(code) || { qty: 0, value: 0, days: d, daily: 0 };
		r.qty += x.sales;
		r.value += x.value;
		out.set(code, r);
	}
	for (const r of out.values()) r.daily = d ? r.qty / d : 0;
	return { byCode: out, days: d, months: used };
}

/** Month-of-year sales index for a location from up to 12 months of data (1 = average), else 1. */
function seasonality(f: Facts, loc: string): (from: Date, dayCount: number) => number {
	const cov = f.coverage.get(loc);
	const mm = f.byLoc.get(loc);
	if (!cov || cov.size < 6 || !mm) return () => 1;
	const rateBy = new Map<number, number[]>();
	for (const [m, d] of cov) {
		if (d < 20) continue;
		let s = 0;
		for (const x of mm.get(m)?.values() || []) s += x.sales;
		const k = Number(m.slice(5, 7));
		rateBy.set(k, [...(rateBy.get(k) || []), s / d]);
	}
	const avg = [...rateBy.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
	const mean = avg.reduce((a, b) => a + b, 0) / (avg.length || 1);
	if (!mean || rateBy.size < 6) return () => 1;
	return (from, dayCount) => {
		const idx: number[] = [];
		for (let i = 0; i < dayCount; i += 15) {
			const m = new Date(from.getTime() + i * DAY).getUTCMonth() + 1;
			const v = rateBy.get(m);
			if (v) idx.push(v.reduce((a, b) => a + b, 0) / v.length / mean);
		}
		const fct = idx.length ? idx.reduce((a, b) => a + b, 0) / idx.length : 1;
		return Math.max(0.5, Math.min(2.5, fct));
	};
}

const settingsFor = (s: InventorySettings, loc: string) => ({ coverDays: s.branches[loc]?.coverDays || s.coverDays, leadDays: s.branches[loc]?.leadDays || s.leadDays });
const branchKeys = () => DIRECTORY.filter((d) => !d.head_office && !d.no_stock).map((d) => d.key);

// ── overview ───────────────────────────────────────────────────────────────

export async function overview(orgId: number) {
	const [f, cur, s] = await Promise.all([facts(orgId), currentStock(orgId), inventorySettings(orgId)]);
	const uploads = await one<any>(`select count(*)::int as n, count(*) filter (where scope='hq')::int as hq, count(*) filter (where scope='branch')::int as branch, min(period_from)::text as first, max(period_to)::text as last from stock_uploads where org_id=$1 and deleted_at is null`, [orgId]);
	const locs = [HQ_KEY, ...branchKeys()];
	const branches = locs.map((loc) => {
		let qty = 0;
		let value = 0;
		let titles = 0;
		for (const b of cur.books.values()) {
			const l = b.locs.get(loc);
			if (!l || l.qty <= 0) continue;
			qty += l.qty;
			value += l.qty * (l.price || 0);
			titles++;
		}
		const r = rates(f, loc);
		const { leadDays, coverDays } = settingsFor(s, loc);
		let low: number | null = r.days >= MIN_DAYS ? 0 : null;
		let out: number | null = r.days >= MIN_DAYS ? 0 : null;
		if (r.days >= MIN_DAYS) for (const [code, x] of r.byCode) {
			if (x.daily <= 0) continue;
			const st = cur.books.get(code)?.locs.get(loc)?.qty || 0;
			if (st <= 0) out!++;
			else if (st / x.daily < leadDays) low!++;
		}
		const monthly = f.months.map((m) => {
			let q2 = 0;
			let v = 0;
			for (const x of f.byLoc.get(loc)?.get(m)?.values() || []) { q2 += x.sales; v += x.value; }
			return { month: m, qty: Math.round(q2), value: Math.round(v), days: f.coverage.get(loc)?.get(m) || 0 };
		});
		const salesDaily = r.days ? [...r.byCode.values()].reduce((a, b) => a + b.qty, 0) / r.days : 0;
		return {
			key: loc, label: locationLabel(loc), asOf: cur.asOf[loc] || null, qty: Math.round(qty), value: Math.round(value), titles,
			salesPerDay: Math.round(salesDaily * 10) / 10, salesDays: r.days, cover: salesDaily ? Math.round(qty / salesDaily) : null,
			lowTitles: low, outTitles: out, monthly, coverDays, leadDays,
		};
	});
	const semi = [...cur.books.values()].reduce((a, b) => a + (b.locs.get(HQ_KEY)?.semi || 0), 0);
	const hqOut = [...cur.books.values()].filter((b) => b.locs.has(HQ_KEY) && (b.locs.get(HQ_KEY)!.qty <= 0)).length;
	// monthly totals across locations
	const months = f.months.map((m) => {
		let qty = 0;
		let value = 0;
		let supply = 0;
		for (const loc of locs) for (const x of f.byLoc.get(loc)?.get(m)?.values() || []) { qty += x.sales; value += x.value; }
		for (const x of f.byLoc.get(HQ_KEY)?.get(m)?.values() || []) supply += x.outq - x.sales;
		const cov = Math.max(0, ...locs.map((l) => f.coverage.get(l)?.get(m) || 0));
		const closing = locs.reduce((a, l) => a + (f.closing.get(l)?.get(m)?.qty || 0), 0);
		return { month: m, qty: Math.round(qty), value: Math.round(value), supply: Math.round(supply), days: cov, closing: Math.round(closing) };
	});
	return {
		uploads, settings: s, months, branches, minDays: MIN_DAYS, semi: Math.round(semi), hqOutOfStock: hqOut, titles: cur.books.size,
		totals: { qty: branches.reduce((a, b) => a + b.qty, 0), value: branches.reduce((a, b) => a + b.value, 0) },
	};
}

// ── stock status ──────────────────────────────────────────────────────────

export async function stockStatus(orgId: number, opts: { location?: string; language?: string; status?: string; q?: string; codes?: string[]; limit?: number }) {
	const [f, cur, s] = await Promise.all([facts(orgId), currentStock(orgId), inventorySettings(orgId)]);
	const loc = opts.location || HQ_KEY;
	const r = rates(f, loc);
	const { leadDays, coverDays } = settingsFor(s, loc);
	const search = (opts.q || '').toLowerCase().trim();
	const rows = [];
	for (const b of cur.books.values()) {
		const l = b.locs.get(loc);
		const x = r.byCode.get(b.code);
		// a book picked in the filter is shown even when this location has never had it
		if (!l && !x && !opts.codes?.includes(b.code)) continue;
		if (opts.codes?.length && !opts.codes.includes(b.code)) continue;
		if (opts.language && b.language !== opts.language) continue;
		if (search && !`${b.code} ${b.name} ${b.hindi || ''}`.toLowerCase().includes(search)) continue;
		const qty = l?.qty || 0;
		const daily = x?.daily || 0;
		const cover = daily ? qty / daily : null;
		const enough = r.days >= MIN_DAYS;
		const status = qty <= 0 ? (daily ? 'out_selling' : 'out') : !enough ? 'ok' : !daily ? 'no_sales' : cover! < leadDays ? 'low' : cover! > coverDays * 3 ? 'over' : 'ok';
		if (opts.status && opts.status !== status && !(opts.status === 'out' && status === 'out_selling')) continue;
		rows.push({
			code: b.code, name: b.name, hindi: b.hindi, language: b.language, qty: Math.round(qty), semi: loc === HQ_KEY ? Math.round(l?.semi || 0) : 0, price: l?.price ?? null,
			value: Math.round(qty * (l?.price || 0)), sold: Math.round(x?.qty || 0), perMonth: Math.round(daily * 30 * 10) / 10, cover: cover === null ? null : Math.round(cover), status,
		});
	}
	rows.sort((a, b) => b.sold - a.sold || b.qty - a.qty);
	const counts = rows.reduce((a: any, x) => ((a[x.status] = (a[x.status] || 0) + 1), a), {});
	return { location: loc, label: locationLabel(loc), asOf: cur.asOf[loc] || null, salesDays: r.days, enough: r.days >= MIN_DAYS, minDays: MIN_DAYS, leadDays, coverDays, counts, rows: rows.slice(0, opts.limit || 500), total: rows.length };
}

// ── top sellers ────────────────────────────────────────────────────────────

export async function topSellers(orgId: number, opts: { location?: string; language?: string; months?: number; codes?: string[]; limit?: number }) {
	const [f, cur] = await Promise.all([facts(orgId), currentStock(orgId)]);
	const monthsAll = f.months;
	const use = opts.months ? monthsAll.slice(-opts.months) : monthsAll;
	const locs = opts.location ? [opts.location] : [HQ_KEY, ...branchKeys()];
	const agg = new Map<string, { qty: number; value: number; byLoc: Record<string, number>; byMonth: Record<string, number> }>();
	for (const loc of locs) for (const m of use) for (const [code, x] of f.byLoc.get(loc)?.get(m) || []) {
		if (!x.sales) continue;
		const a = agg.get(code) || { qty: 0, value: 0, byLoc: {}, byMonth: {} };
		a.qty += x.sales;
		a.value += x.value;
		a.byLoc[loc] = (a.byLoc[loc] || 0) + x.sales;
		a.byMonth[m] = (a.byMonth[m] || 0) + x.sales;
		agg.set(code, a);
	}
	const rows = [...agg.entries()]
		.map(([code, a]) => {
			const b = cur.books.get(code);
			return {
				code, name: b?.name || code, hindi: b?.hindi || null, language: b?.language || '', qty: Math.round(a.qty), value: Math.round(a.value),
				branches: Object.entries(a.byLoc).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => ({ key: k, label: locationLabel(k), qty: Math.round(v) })),
				trend: use.map((m) => Math.round(a.byMonth[m] || 0)),
				hqQty: Math.round(b?.locs.get(HQ_KEY)?.qty || 0), price: b?.locs.get(HQ_KEY)?.price ?? null,
			};
		})
		.filter((r) => (!opts.language || r.language === opts.language) && (!opts.codes?.length || opts.codes.includes(r.code)))
		.sort((a, b) => b.qty - a.qty)
		.slice(0, opts.limit || 50);
	const languages = new Map<string, number>();
	for (const [code, a] of agg) { const l = cur.books.get(code)?.language || 'Other'; languages.set(l, (languages.get(l) || 0) + a.qty); }
	return { months: use, rows, languages: [...languages.entries()].sort((a, b) => b[1] - a[1]).map(([language, qty]) => ({ language, qty: Math.round(qty) })) };
}

// ── replenishment ─────────────────────────────────────────────────────────

export async function replenishment(orgId: number, opts: { location?: string } = {}) {
	const [f, cur, s] = await Promise.all([facts(orgId), currentStock(orgId), inventorySettings(orgId)]);
	const out = [];
	const short: string[] = [];
	const locs = opts.location ? [opts.location] : branchKeys();
	for (const loc of locs) {
		if (loc === HQ_KEY) continue;
		const r = rates(f, loc);
		if (r.days < MIN_DAYS) { if (BY_KEY.has(loc)) short.push(locationLabel(loc)); continue; }
		const { leadDays, coverDays } = settingsFor(s, loc);
		const season = seasonality(f, loc)(new Date(), coverDays);
		for (const [code, x] of r.byCode) {
			if (x.daily <= 0) continue;
			const b = cur.books.get(code);
			const qty = b?.locs.get(loc)?.qty || 0;
			const daily = x.daily * season;
			const cover = qty / daily;
			if (cover >= leadDays) continue;
			const need = Math.ceil(daily * coverDays - qty);
			if (need <= 0) continue;
			const hq = b?.locs.get(HQ_KEY)?.qty || 0;
			out.push({
				location: loc, label: locationLabel(loc), code, name: b?.name || code, language: b?.language || '', qty: Math.round(qty),
				perMonth: Math.round(daily * 30 * 10) / 10, cover: Math.round(cover), send: need, hqQty: Math.round(hq), canSend: Math.min(need, Math.round(hq)),
				price: b?.locs.get(loc)?.price ?? b?.locs.get(HQ_KEY)?.price ?? null, season: Math.round(season * 100) / 100,
				urgency: qty <= 0 ? 'out' : cover < leadDays / 2 ? 'urgent' : 'soon',
			});
		}
	}
	out.sort((a, b) => a.cover - b.cover || b.perMonth - a.perMonth);
	const byLoc = Object.entries(out.reduce((a: Record<string, { titles: number; copies: number; value: number }>, x) => {
		const e = (a[x.location] ||= { titles: 0, copies: 0, value: 0 });
		e.titles++; e.copies += x.send; e.value += x.send * (x.price || 0);
		return a;
	}, {})).map(([k, v]) => ({ key: k, label: locationLabel(k), ...v, value: Math.round(v.value) })).sort((a, b) => b.copies - a.copies);
	return { rows: out.slice(0, 1000), total: out.length, byLocation: byLoc, settings: s, short, minDays: MIN_DAYS };
}

// ── which books should be in which branch ─────────────────────────────────

export async function rangeGaps(orgId: number, opts: { location?: string; limit?: number } = {}) {
	const [f, cur] = await Promise.all([facts(orgId), currentStock(orgId)]);
	const keys = branchKeys();
	const rateBy = new Map(keys.map((k) => [k, rates(f, k)]));
	// language mix of each branch: sales, or stock when there are no sales yet
	const mix = new Map<string, Map<string, number>>();
	for (const k of keys) {
		const m = new Map<string, number>();
		const r = rateBy.get(k)!;
		const add = (code: string, v: number) => { const l = cur.books.get(code)?.language || 'Other'; m.set(l, (m.get(l) || 0) + v); };
		if (r.byCode.size) for (const [code, x] of r.byCode) add(code, x.qty);
		else for (const b of cur.books.values()) add(b.code, b.locs.get(k)?.qty || 0);
		mix.set(k, m);
	}
	const cos = (a: Map<string, number>, b: Map<string, number>) => {
		let d = 0, na = 0, nb = 0;
		for (const [k, v] of a) { d += v * (b.get(k) || 0); na += v * v; }
		for (const v of b.values()) nb += v * v;
		return na && nb ? d / Math.sqrt(na * nb) : 0;
	};
	const out = [];
	for (const k of opts.location ? [opts.location] : keys) {
		if (!mix.has(k)) continue;
		const mine = mix.get(k)!;
		const total = [...mine.values()].reduce((a, b) => a + b, 0) || 1;
		const langs = new Set([...mine.entries()].filter(([, v]) => v / total >= 0.03).map(([l]) => l));
		const similar = keys.filter((x) => x !== k && rateBy.get(x)!.days >= MIN_DAYS).map((x) => ({ x, s: cos(mine, mix.get(x)!) })).sort((a, b) => b.s - a.s).slice(0, 4).filter((x) => x.s > 0.5);
		const cand = new Map<string, { daily: number; at: string[] }>();
		for (const { x } of similar) for (const [code, r] of rateBy.get(x)!.byCode) {
			if (r.daily <= 0) continue;
			const c = cand.get(code) || { daily: 0, at: [] };
			c.daily += r.daily / similar.length;
			c.at.push(locationLabel(x));
			cand.set(code, c);
		}
		const mineRates = rateBy.get(k)!.byCode;
		for (const [code, c] of cand) {
			const b = cur.books.get(code);
			if (!b || !langs.has(b.language || 'Other')) continue;
			if ((b.locs.get(k)?.qty || 0) > 0 || (mineRates.get(code)?.qty || 0) > 0) continue;
			out.push({
				location: k, label: locationLabel(k), code, name: b.name, language: b.language, expectedPerMonth: Math.round(c.daily * 30 * 10) / 10,
				sellsAt: c.at, hqQty: Math.round(b.locs.get(HQ_KEY)?.qty || 0), price: b.locs.get(HQ_KEY)?.price ?? null,
			});
		}
	}
	out.sort((a, b) => b.expectedPerMonth - a.expectedPerMonth);
	const short = keys.filter((k) => rateBy.get(k)!.days < MIN_DAYS).map(locationLabel);
	return { rows: out.slice(0, opts.limit || 400), total: out.length, short, minDays: MIN_DAYS };
}

export async function slowMovers(orgId: number, opts: { location?: string; limit?: number } = {}) {
	const [f, cur, s] = await Promise.all([facts(orgId), currentStock(orgId), inventorySettings(orgId)]);
	const keys = branchKeys();
	const rateBy = new Map(keys.map((k) => [k, rates(f, k)]));
	const out = [];
	for (const k of opts.location ? [opts.location] : keys) {
		const r = rateBy.get(k);
		if (!r || r.days < MIN_DAYS) continue;
		const { coverDays } = settingsFor(s, k);
		for (const b of cur.books.values()) {
			const l = b.locs.get(k);
			if (!l || l.qty <= 0) continue;
			const daily = r.byCode.get(b.code)?.daily || 0;
			const cover = daily ? l.qty / daily : Infinity;
			if (cover <= coverDays * 3) continue;
			// where it sells and is short
			const target = keys.filter((x) => x !== k && rateBy.get(x)!.days >= MIN_DAYS).map((x) => {
				const d = rateBy.get(x)!.byCode.get(b.code)?.daily || 0;
				const st = b.locs.get(x)?.qty || 0;
				return { x, d, need: d ? Math.ceil(d * settingsFor(s, x).coverDays - st) : 0 };
			}).filter((t) => t.need > 0).sort((a, z) => z.d - a.d)[0];
			out.push({
				location: k, label: locationLabel(k), code: b.code, name: b.name, language: b.language, qty: Math.round(l.qty), value: Math.round(l.qty * (l.price || 0)),
				perMonth: Math.round(daily * 30 * 10) / 10, cover: Number.isFinite(cover) ? Math.round(cover) : null, noSales: !daily,
				moveTo: target ? { key: target.x, label: locationLabel(target.x), qty: Math.min(target.need, Math.round(l.qty - daily * coverDays)), perMonth: Math.round(target.d * 30 * 10) / 10 } : null,
			});
		}
	}
	out.sort((a, b) => (b.moveTo ? 1 : 0) - (a.moveTo ? 1 : 0) || b.value - a.value);
	const short = keys.filter((k) => (rateBy.get(k)?.days || 0) < MIN_DAYS).map(locationLabel);
	return { rows: out.slice(0, opts.limit || 500), total: out.length, short, minDays: MIN_DAYS };
}

// ── demand from emails and cross-sell ─────────────────────────────────────

export async function demand(orgId: number) {
	const cur = await currentStock(orgId);
	const rows = await q<any>(
		`select br.code, count(*)::int as requests, count(distinct br.customer_id)::int as customers, max(br.requested_at) as last,
		        count(*) filter (where br.hq_qty = 0)::int as out_at_hq, count(*) filter (where br.near_qty = 0)::int as out_near,
		        array_agg(distinct br.nearest) filter (where br.nearest is not null) as nearest
		   from book_requests br where br.org_id=$1 and br.requested_at > now() - interval '365 days' group by 1 order by 2 desc limit 300`,
		[orgId],
	);
	const unmet = rows.map((r) => {
		const b = cur.books.get(r.code);
		return {
			...r, name: b?.name || r.code, language: b?.language || '', hqQty: Math.round(b?.locs.get(HQ_KEY)?.qty || 0),
			nearest: (r.nearest || []).map((k: string) => ({ key: k, label: locationLabel(k), qty: Math.round(b?.locs.get(k)?.qty || 0) })),
		};
	});
	// readers who asked when it was out of stock at Gorakhpur, and it is back now
	const asked = await q<any>(
		`select br.code, br.requested_at, br.conversation_id, cu.id as customer_id, cu.name, (select k.email from contacts k where k.customer_id=cu.id order by k.id limit 1) as email
		   from book_requests br join customers cu on cu.id=br.customer_id
		  where br.org_id=$1 and br.hq_qty = 0 and br.requested_at > now() - interval '365 days' order by br.requested_at desc limit 2000`,
		[orgId],
	);
	const backInStock = asked.map((a) => ({ ...a, bookName: cur.books.get(a.code)?.name || a.code, hqQty: Math.round(cur.books.get(a.code)?.locs.get(HQ_KEY)?.qty || 0) })).filter((a) => a.hqQty > 0);
	return { unmet, backInStock: backInStock.slice(0, 500) };
}

const SEGMENTS: { id: string; label: string; pitch: string; has: Purpose[]; not?: Purpose[] }[] = [
	{ id: 'kalyan_no_books', label: 'Kalyan readers who never ordered books', pitch: 'Offer popular books in their language and the Kalyan special-issue titles.', has: ['kalyan'], not: ['book_order', 'availability_price', 'bulk_order'] },
	{ id: 'books_no_kalyan', label: 'Book buyers who do not take Kalyan', pitch: 'Offer a Kalyan (or Kalyana-Kalpataru) subscription.', has: ['book_order'], not: ['kalyan'] },
	{ id: 'enquired_not_ordered', label: 'Asked about availability or price but never ordered', pitch: 'Follow up with stock and the nearest branch.', has: ['availability_price'], not: ['book_order', 'bulk_order'] },
	{ id: 'bulk', label: 'Bulk and institutional buyers', pitch: 'Offer low-price distribution titles (Hanuman Chalisa, Gita, Nitya Stuti) and quantity terms.', has: ['bulk_order'] },
	{ id: 'dealer', label: 'Dealer and bookseller enquiries', pitch: 'Share dealership terms and the best sellers for their region.', has: ['dealer'] },
	{ id: 'international', label: 'International readers', pitch: 'Offer English, Roman and translated editions, sent from Gorakhpur.', has: ['international'] },
	{ id: 'seva', label: 'People who offered seva', pitch: 'Invite them to help with distribution, proof-reading or events.', has: ['seva'] },
];

export async function crossSell(orgId: number) {
	const segs = [];
	for (const s of SEGMENTS) {
		const r = await one<any>(
			`select count(*)::int as n from customers c where c.org_id=$1 and c.purposes @> $2::text[] and not (c.purposes && $3::text[])`,
			[orgId, s.has, s.not || []],
		);
		segs.push({ ...s, n: r?.n || 0, hasLabels: s.has.map((p) => PURPOSE_LABELS[p]), notLabels: (s.not || []).map((p) => PURPOSE_LABELS[p]) });
	}
	const purposeCounts = await q<any>(`select p as purpose, count(*)::int as n from customers c, unnest(c.purposes) p where c.org_id=$1 group by 1 order by 2 desc`, [orgId]);
	const back = await one<any>(
		`select count(distinct br.customer_id)::int as n from book_requests br where br.org_id=$1 and br.hq_qty = 0 and br.customer_id is not null and br.requested_at > now() - interval '365 days'`,
		[orgId],
	);
	return { segments: segs, purposes: purposeCounts.map((p) => ({ ...p, label: (PURPOSE_LABELS as any)[p.purpose] || p.purpose })), askedWhenOut: back?.n || 0 };
}

/** Books and offers for one customer, from their purposes, language, place and the books they asked about. */
export async function customerSuggestions(orgId: number, customerId: number) {
	const c = await one<any>('select id, name, purposes, profile, profile_manual from customers where id=$1 and org_id=$2', [customerId, orgId]);
	if (!c) return null;
	const p = { ...(c.profile || {}), ...(c.profile_manual || {}) };
	const purposes: string[] = c.purposes || [];
	const [f, cur] = await Promise.all([facts(orgId), currentStock(orgId)]);
	const asked = (await q<any>('select distinct code from book_requests where customer_id=$1', [customerId])).map((r) => r.code);
	const lang = /english/i.test(p.language || '') ? 'English' : p.language && !/hindi/i.test(p.language) ? p.language : 'Hindi';
	const near = nearestBranch({ city: p.city, state: p.state, pin: p.pin, address: p.address, country: p.country });
	// popularity across all locations over the latest data
	const pop = new Map<string, number>();
	for (const loc of [HQ_KEY, ...branchKeys()]) for (const [code, r] of rates(f, loc, 120).byCode) pop.set(code, (pop.get(code) || 0) + r.daily);
	const inStock = (code: string) => (cur.books.get(code)?.locs.get(HQ_KEY)?.qty || 0) > 0;
	const ranked = [...pop.entries()].filter(([code]) => inStock(code) && !asked.includes(code)).sort((a, b) => b[1] - a[1]).map(([code]) => cur.books.get(code)!).filter(Boolean);
	const words = (s: string) => (s.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !['gita', 'shri', 'shree', 'part', 'size', 'pocket', 'with', 'edition', 'hindi', 'english', 'small'].includes(w));
	const askedWords = new Set(asked.flatMap((code) => words(cur.books.get(code)?.name || '')).concat((p.books || []).flatMap((b: string) => words(b))));
	const pick = (list: typeof ranked, n: number, reason: string, seen: Set<string>) => list.filter((b) => !seen.has(b.code)).slice(0, n).map((b) => { seen.add(b.code); return { code: b.code, name: b.name, language: b.language, price: b.locs.get(HQ_KEY)?.price ?? null, reason }; });
	const seen = new Set<string>();
	const books = [
		...pick(ranked.filter((b) => b.language === lang && words(b.name).some((w) => askedWords.has(w))), 4, 'related to books they asked about', seen),
		...(purposes.includes('bulk_order') ? pick(ranked.filter((b) => b.language === lang && (b.locs.get(HQ_KEY)?.price || 999) <= 30), 4, 'low-price title for distribution', seen) : []),
		...(purposes.includes('dealer') && near ? pick([...rates(f, near.key, 120).byCode.entries()].sort((a, b) => b[1].daily - a[1].daily).map(([code]) => cur.books.get(code)!).filter((b) => b && inStock(b.code)), 6, `best seller at the ${locationLabel(near.key)} branch`, seen) : []),
		...pick(ranked.filter((b) => b.language === lang), 4, `popular in ${lang}`, seen),
	];
	const back = (await q<any>('select code from book_requests where customer_id=$1 and hq_qty = 0', [customerId])).map((r) => r.code).filter(inStock)
		.map((code) => ({ code, name: cur.books.get(code)?.name || code, language: cur.books.get(code)?.language || '', price: cur.books.get(code)?.locs.get(HQ_KEY)?.price ?? null, reason: 'asked when out of stock; back in stock now' }));
	const offers = [
		!purposes.includes('kalyan') && purposes.some((x) => ['book_order', 'availability_price', 'bulk_order', 'scripture_question'].includes(x)) ? 'Offer a Kalyan subscription.' : '',
		purposes.includes('kalyan') && !purposes.some((x) => ['book_order', 'bulk_order'].includes(x)) ? 'Offer books: they read Kalyan but have not ordered books.' : '',
		purposes.includes('dealer') ? 'Share dealership terms and the region\'s best sellers.' : '',
		purposes.includes('seva') ? 'Invite them for seva.' : '',
		near && near.key !== HQ_KEY && !BY_KEY.get(near.key)?.no_stock ? `Nearest branch: ${locationLabel(near.key)} (${near.why}).` : '',
	].filter(Boolean);
	return { language: lang, nearest: near ? { ...near, label: locationLabel(near.key) } : null, offers, books: [...back, ...books], hasStock: Object.keys(cur.asOf).length > 0 };
}

/** Every code in the catalogue, for picking books in filters. */
export async function bookList(orgId: number) {
	const cur = await currentStock(orgId);
	return [...cur.books.values()].map((b) => ({ code: b.code, name: b.name, language: b.language, hindi: b.hindi })).sort((a, b) => a.name.localeCompare(b.name));
}

/** One book everywhere: stock, price, sales rate and days of cover at each location, and monthly sales. */
export async function bookDetail(orgId: number, code: string) {
	const [f, cur, s] = await Promise.all([facts(orgId), currentStock(orgId), inventorySettings(orgId)]);
	const b = cur.books.get(code);
	if (!b) return null;
	const locs = [HQ_KEY, ...branchKeys()];
	const rows = locs.map((loc) => {
		const l = b.locs.get(loc);
		const r = rates(f, loc).byCode.get(code);
		const daily = r?.daily || 0;
		const qty = l?.qty || 0;
		return {
			key: loc, label: locationLabel(loc), asOf: cur.asOf[loc] || null, qty: Math.round(qty), semi: Math.round(l?.semi || 0), price: l?.price ?? null,
			perMonth: Math.round(daily * 30 * 10) / 10, cover: daily ? Math.round(qty / daily) : null, leadDays: settingsFor(s, loc).leadDays,
		};
	}).filter((r) => r.asOf);
	const months = f.months.map((m) => ({ month: m, qty: Math.round(locs.reduce((a, loc) => a + (f.byLoc.get(loc)?.get(m)?.get(code)?.sales || 0), 0)), days: Math.max(0, ...locs.map((l) => f.coverage.get(l)?.get(m) || 0)) }));
	const requests = await one<any>(`select count(*)::int as n, count(distinct customer_id)::int as people, max(requested_at) as last from book_requests where org_id=$1 and code=$2`, [orgId, code]);
	return { code, name: b.name, language: b.language, hindi: b.hindi, rows, months, requests };
}
