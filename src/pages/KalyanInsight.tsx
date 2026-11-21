/**
 * Customer database → Dashboard and Geo spread, each for All customers or Current year customers.
 *
 * Dashboard: headline figures with the change on the year before, the yearly flow (new, renewed, came back, lost),
 * retention, subscription mix, payments by month against the year before, registrations, length of membership,
 * dispatch mode and why customers became inactive. Every figure opens the list behind it.
 *
 * Geo spread: India by state for the chosen measure and year, with a year slider that can play through the years,
 * the state ranking with its change on the year before, and for the whole country or a chosen state: the state's
 * trend, the top cities, the top PIN areas and the customers in other countries.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MdGroups, MdPause, MdPersonAdd, MdPersonOff, MdPlayArrow, MdPublic, MdRefresh, MdStars, MdTrendingUp } from 'react-icons/md';
import { api, qs } from '../api/client';
import { Card, Empty, Kpi, Loader, Segmented } from '../components/ui';
import Chart from '../components/Chart';
import IndiaMap from '../components/IndiaMap';
import { BarList, KpiRow, pct, short } from '../components/dash';
import { num } from '../lib/purposes';
import { COLORS, fmtDate } from '../lib/format';

type OnList = (tab: 'all' | 'current', p: Record<string, string>) => void;
const TYPE: Record<string, string> = { '1Y': '1 year', FY: '5 years', LM: 'Life member', '?': 'Not stated' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SCOPES = [{ v: 'all', l: 'All customers' }, { v: 'current', l: 'Current year customers' }];
const change = (a?: number | null, b?: number | null) => (a === null || a === undefined || !b ? null : Math.round((1000 * (a - b)) / b) / 10);

function Controls({ scope, setScope, year, years, setYear, note }: { scope: string; setScope: (v: any) => void; year: number; years: number[]; setYear: (v: number) => void; note?: string }) {
	const opts = [...new Set([year, ...years])].sort((a, b) => b - a);
	return (
		<div className="row-between wrap gap-8">
			<div className="row gap-12 wrap">
				<span className="small faint">Showing</span>
				<Segmented value={scope} options={SCOPES} onChange={setScope} />
				<label className="small row gap-4">Year <select className="input sm" style={{ width: 96 }} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">{opts.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
			</div>
			{note && <div className="xs faint">{note}</div>}
		</div>
	);
}

// ── Dashboard ───────────────────────────────────────────────────────────────
export function Dashboard({ onList }: { onList: OnList }) {
	const [scope, setScope] = useState<'all' | 'current'>('current');
	const [year, setYear] = useState<number | null>(null);
	const { data, isLoading } = useQuery({ queryKey: ['kalyan-insight', scope, year], queryFn: () => api(`/kalyan/insight${qs({ scope, year })}`) });
	if (isLoading || !data) return <Loader />;
	const y = data.year;
	const years: number[] = data.years.map((r: any) => r.year);
	const ctl = <Controls scope={scope} setScope={setScope} year={y} years={[...years, ...data.registered.map((r: any) => r.year).slice(-8)]} setYear={setYear} note="Select a figure or a row to open the customers behind it." />;
	if (!data.all.total && !years.length) return <div className="col gap-16">{ctl}<Card><Empty text="Upload the complete customer file or a current-year file to see the dashboard." /></Card></div>;
	return <div className="col gap-16">{ctl}{scope === 'current' ? <CurrentDash d={data} onList={onList} /> : <AllDash d={data} onList={onList} />}</div>;
}

function CurrentDash({ d, onList }: { d: any; onList: OnList }) {
	const y = d.year;
	const c = d.current;
	const p = d.previous;
	const x = d.currentExtra;
	const list = (seg: string, extra: Record<string, string> = {}) => onList(seg === 'lost' ? 'all' : 'current', { year: String(y), ...(seg ? { segment: seg, segmentYear: String(y) } : {}), ...extra });
	const yrs = d.years.map((r: any) => String(r.year));
	const typeKeys = [...new Set(d.subYears.map((r: any) => r.k))] as string[];
	const payYears = [y - 1, y];
	if (!c.active && !d.years.length) return <Card><Empty text="No current-year file uploaded yet. Upload it in the Current year customers tab." /></Card>;
	return (
		<>
			<KpiRow>
				<Kpi label={`Active in ${y}`} value={num(c.active)} icon={<MdGroups />} accent={COLORS.blue} delta={c.growth} deltaUnit="%" foot={p ? `${num(p.active)} in ${y - 1}${x.last_payment && x.last_payment.slice(0, 4) === String(y) ? ` · ${y} so far` : ''}` : 'paid this year'} onClick={() => list('')} />
				<Kpi label="New" value={num(c.new)} icon={<MdPersonAdd />} accent={COLORS.teal} delta={change(c.new, p?.new)} deltaUnit="%" foot="first year ever" onClick={() => list('new')} />
				<Kpi label="Renewed" value={num(c.renewed)} icon={<MdRefresh />} accent={COLORS.green} delta={change(c.renewed, p?.renewed)} deltaUnit="%" foot={`also active in ${y - 1}`} onClick={() => list('repeat')} />
				<Kpi label="Came back" value={num(c.came_back)} accent={COLORS.purple} foot={`not in ${y - 1}, active earlier`} />
				<Kpi label={`Lost since ${y - 1}`} value={num(c.lost)} icon={<MdPersonOff />} accent={COLORS.red} invert delta={change(c.lost, p?.lost)} deltaUnit="%" foot={`active in ${y - 1}, not yet in ${y}`} onClick={() => list('lost')} />
				<Kpi label="Retention" value={c.retention === null ? '–' : `${c.retention}%`} icon={<MdTrendingUp />} accent={COLORS.amber} delta={c.retention !== null && p?.retention ? Math.round((c.retention - p.retention) * 10) / 10 : null} deltaUnit=" pts" foot={`of ${y - 1}'s readers renewed`} />
				<Kpi label="Payments in the last month" value={num(x.last_month)} accent={COLORS.general} foot={x.last_payment ? `latest ${fmtDate(x.last_payment)}` : 'no payment dates'} />
				<Kpi label="States" value={num(x.states)} icon={<MdPublic />} accent={COLORS.teal} foot={`${num(x.not_in_master)} not in the complete file`} />
			</KpiRow>
			<div className="grid g-2">
				<Card title="Readers each year" sub={`Active = new + renewed + came back; lost readers are shown below the line.${yrs.length ? ` ${yrs[0]} is the first year in the files, so all its readers count as new.` : ''}`}>
					{!yrs.length ? <Empty text="Upload a current-year file to see the years." /> : <Chart type="bar" height={300}
						options={{ chart: { stacked: true }, xaxis: { categories: yrs }, colors: [COLORS.teal, COLORS.green, COLORS.purple, COLORS.red], plotOptions: { bar: { columnWidth: '55%', borderRadius: 3 } }, yaxis: { labels: { formatter: (v: number) => short(Math.abs(v)) } }, tooltip: { y: { formatter: (v: number) => num(Math.abs(v)) } } }}
						series={[{ name: 'New', data: d.years.map((r: any) => r.new) }, { name: 'Renewed', data: d.years.map((r: any) => r.renewed) }, { name: 'Came back', data: d.years.map((r: any) => r.came_back) }, { name: 'Lost', data: d.years.map((r: any) => -r.lost) }]} />}
				</Card>
				<Card title="Retention by year" sub="Share of the year before's readers who renewed">
					{d.years.filter((r: any) => r.retention !== null).length < 1 ? <Empty text="Needs two years of current-year files." /> : <Chart type="line" height={300}
						options={{ xaxis: { categories: yrs }, colors: [COLORS.amber], stroke: { width: 2 }, markers: { size: 5 }, yaxis: { min: 0, max: 100, labels: { formatter: (v: number) => `${Math.round(v)}%` } }, dataLabels: { enabled: true, formatter: (v: any) => (v === null ? '' : `${v}%`) } }}
						series={[{ name: 'Retention', data: d.years.map((r: any) => r.retention) }]} />}
				</Card>
			</div>
			<div className="grid g-2">
				<Card title={`Payments by month: ${y} and ${y - 1}`} sub={`When readers pay, against the same month a year earlier.${x.last_payment && x.last_payment.slice(0, 4) === String(y) ? ` ${MONTHS[Number(x.last_payment.slice(5, 7)) - 1]} ${y} is counted up to ${fmtDate(x.last_payment)}.` : ''}`}>
					{!d.payments.length ? <Empty text="No payment dates for these years." /> : <Chart type="line" height={280}
						options={{ xaxis: { categories: MONTHS }, colors: [COLORS.grey, COLORS.blue], stroke: { width: [2, 2], dashArray: [4, 0] }, markers: { size: 4 } }}
						series={payYears.map((yy) => ({ name: String(yy), data: MONTHS.map((_, m) => d.payments.find((r: any) => r.year === yy && r.m === m + 1)?.n ?? null) }))} />}
				</Card>
				<Card title="Subscription mix by year">
					{!d.subYears.length ? <Empty text="No subscriptions yet." /> : <Chart type="bar" height={280}
						options={{ chart: { stacked: true }, xaxis: { categories: yrs }, colors: [COLORS.blue, COLORS.purple, COLORS.amber, COLORS.grey], plotOptions: { bar: { columnWidth: '55%' } }, yaxis: { labels: { formatter: (v: number) => short(v) } } }}
						series={typeKeys.map((t) => ({ name: TYPE[t] || t, data: d.years.map((r: any) => d.subYears.find((s: any) => s.year === r.year && s.k === t)?.n || 0) }))} />}
				</Card>
			</div>
			<div className="grid g-2">
				<Card title={`${y} by subscription`} flush><BarList head="Readers" rows={d.subYears.filter((r: any) => r.year === y).map((r: any) => ({ k: TYPE[r.k] || r.k, n: r.n, on: () => onList('current', { year: String(y), type: r.k }) }))} height={220} empty={`No readers in ${y} yet.`} /></Card>
				<Card title={`${y} by dispatch mode`} flush><BarList head="Readers" rows={d.byMode.map((r: any) => ({ k: r.k, n: r.n, on: () => onList('current', { year: String(y), mode: r.k.toUpperCase() }) }))} height={220} /></Card>
			</div>
		</>
	);
}

function AllDash({ d, onList }: { d: any; onList: OnList }) {
	const a = d.all;
	const y = d.year;
	const reg = d.registered.filter((r: any) => r.year >= 1950);
	return (
		<>
			<KpiRow>
				<Kpi label="All customers" value={num(a.total)} icon={<MdGroups />} accent={COLORS.blue} foot={`${num(a.live)} live · ${num(a.inactive)} inactive`} onClick={() => onList('all', {})} />
				<Kpi label={`Active in ${y}`} value={num(d.current.active)} accent={COLORS.green} foot={pct(d.current.active, a.live) + ' of live customers paid'} onClick={() => onList('current', { year: String(y) })} />
				<Kpi label="Life members" value={num(a.life)} icon={<MdStars />} accent={COLORS.amber} foot={pct(a.life, a.total)} onClick={() => onList('all', { type: 'LM' })} />
				<Kpi label="5-year" value={num(a.five)} accent={COLORS.purple} foot={pct(a.five, a.total)} onClick={() => onList('all', { type: 'FY' })} />
				<Kpi label="1-year" value={num(a.one)} accent={COLORS.teal} foot={pct(a.one, a.total)} onClick={() => onList('all', { type: '1Y' })} />
				<Kpi label={`Registered in ${y}`} value={num(a.registered)} icon={<MdPersonAdd />} accent={COLORS.green} delta={change(a.registered, a.registered_prev)} deltaUnit="%" foot={`${num(a.registered_prev)} in ${y - 1}`} onClick={() => onList('all', { segment: 'registered', segmentYear: String(y) })} />
				<Kpi label="Inactive" value={num(a.inactive)} icon={<MdPersonOff />} accent={COLORS.red} foot={pct(a.inactive, a.total)} onClick={() => onList('all', { dead: '1' })} />
				<Kpi label="Outside India" value={num(a.abroad)} icon={<MdPublic />} accent={COLORS.general} foot={`${num(a.states)} states in India`} />
				{a.with_dues > 0 && <Kpi label="Balance due" value={`₹${short(a.dues)}`} accent={COLORS.amber} foot={`${num(a.with_dues)} customers`} />}
			</KpiRow>
			<Card title="Registrations by year" sub="From the registration date in the complete customer file">
				{!reg.length ? <Empty text="No registration dates." /> : <Chart type="bar" height={260}
					options={{ xaxis: { categories: reg.map((r: any) => String(r.year)), labels: { rotate: -45, hideOverlappingLabels: true } }, colors: [COLORS.teal, COLORS.grey], chart: { stacked: true }, plotOptions: { bar: { columnWidth: '75%' } }, yaxis: { labels: { formatter: (v: number) => short(v) } } }}
					series={[{ name: 'Still live', data: reg.map((r: any) => r.n - r.inactive) }, { name: 'Now inactive', data: reg.map((r: any) => r.inactive) }]} />}
			</Card>
			<div className="grid g-3">
				<Card title="By subscription" flush><BarList head="Customers" extraHeads={['Inactive']} rows={d.subAll.map((r: any) => ({ k: TYPE[r.k] || r.k, n: r.n, extra: [pct(r.inactive, r.n)], on: () => onList('all', { type: r.k === '?' ? '' : r.k }) }))} height={240} /></Card>
				<Card title="Length of membership" sub="Live customers, years since registering" flush><BarList head="Customers" rows={d.tenure.map((r: any) => ({ k: r.k, n: r.n }))} height={240} /></Card>
				<Card title="Dispatch mode" flush><BarList head="Customers" rows={d.byMode.map((r: any) => ({ k: r.k, n: r.n, on: () => onList('all', { mode: r.k.toUpperCase() }) }))} height={240} /></Card>
			</div>
			<div className="grid g-2">
				<Card title="Active by year" sub="From the current-year files">
					{!d.years.length ? <Empty text="Upload a current-year file to see the years." /> : <Chart type="bar" height={240} options={{ xaxis: { categories: d.years.map((r: any) => String(r.year)) }, colors: [COLORS.blue], plotOptions: { bar: { columnWidth: '45%', borderRadius: 3 } } }} series={[{ name: 'Active', data: d.years.map((r: any) => r.active) }]} />}
				</Card>
				<Card title="Why customers are inactive" flush><BarList head="Customers" rows={d.inactiveReasons.map((r: any) => ({ k: r.k, n: r.n }))} height={240} empty="No inactive customers." /></Card>
			</div>
		</>
	);
}

// ── Geo spread ──────────────────────────────────────────────────────────────
const MEASURES: Record<'all' | 'current', { v: string; l: string; byYear?: boolean; diverging?: boolean; pct?: boolean }[]> = {
	all: [{ v: 'total', l: 'Customers' }, { v: 'registered', l: 'Registered in the year', byYear: true }, { v: 'life', l: 'Life members' }, { v: 'inactive_pct', l: 'Inactive %', pct: true }],
	current: [{ v: 'active', l: 'Active', byYear: true }, { v: 'new', l: 'New', byYear: true }, { v: 'renewed', l: 'Renewed', byYear: true }, { v: 'lost', l: 'Lost', byYear: true },
		{ v: 'growth', l: 'Growth on the year before', byYear: true, diverging: true, pct: true }, { v: 'retention', l: 'Retention', byYear: true, pct: true }],
};

function valueOf(s: any, m: string, y: number): number | null {
	switch (m) {
		case 'total': return s.total || null;
		case 'life': return s.life || null;
		case 'inactive_pct': return s.total >= 20 ? Math.round((1000 * s.inactive) / s.total) / 10 : null;
		case 'registered': return s.registered[y] ?? null;
		case 'active': case 'new': case 'renewed': case 'lost': return s[m][y] ?? null;
		case 'growth': { const a = s.active[y], b = s.active[y - 1]; return a !== undefined && b >= 20 ? Math.round((1000 * (a - b)) / b) / 10 : null; }
		case 'retention': { const b = s.active[y - 1]; return b >= 20 ? Math.round((1000 * (s.renewed[y] || 0)) / b) / 10 : null; }
		default: return null;
	}
}

export function Geo({ onList }: { onList: OnList }) {
	const [scope, setScope] = useState<'all' | 'current'>('all');
	const [measure, setMeasure] = useState('total');
	const [year, setYear] = useState<number | null>(null);
	const [state, setState] = useState<string | null>(null);
	const [playing, setPlaying] = useState(false);
	const geo = useQuery({ queryKey: ['kalyan-geo', scope, year, state], queryFn: () => api(`/kalyan/geo${qs({ scope, year, state })}`), placeholderData: (p: any) => p });
	const d = geo.data;
	const m = MEASURES[scope].find((x) => x.v === measure) || MEASURES[scope][0];
	useEffect(() => { if (!MEASURES[scope].some((x) => x.v === measure)) setMeasure(MEASURES[scope][0].v); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
	const years: number[] = useMemo(() => {
		if (!d) return [];
		if (scope === 'current') return d.years.filter((yy: number) => d.states.some((s: any) => s.active[yy]));
		return d.years.filter((yy: number) => yy >= 1950);
	}, [d, scope]);
	const y = year ?? d?.year ?? new Date().getFullYear();
	const shownYears = m.v === 'growth' || m.v === 'retention' ? years.filter((yy) => years.includes(yy - 1)) : years;
	useEffect(() => {
		if (!playing || !shownYears.length) return;
		const t = setInterval(() => {
			setYear((cur) => { const i = shownYears.indexOf(cur ?? shownYears[0]); if (i >= shownYears.length - 1) { setPlaying(false); return cur; } return shownYears[i + 1]; });
		}, 1100);
		return () => clearInterval(t);
	}, [playing, shownYears.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

	if (geo.isLoading || !d) return <Loader />;
	if (!d.states.length) return <Card><Empty text="Upload the customer files to see where customers are." /></Card>;
	const values = Object.fromEntries(d.states.map((s: any) => [s.k, valueOf(s, m.v, y)]));
	const fmt = (v: number) => (m.pct ? `${v > 0 && m.diverging ? '+' : ''}${v}%` : short(v));
	const prevVal = (s: any) => (m.byYear && !m.pct ? valueOf(s, m.v, y - 1) : null);
	const ranked = d.states.map((s: any) => ({ s, v: values[s.k] as number | null, p: prevVal(s) })).filter((r: any) => r.v !== null && r.v !== undefined).sort((a: any, b: any) => b.v - a.v);
	const total = ranked.reduce((a: number, r: any) => a + (m.pct ? 0 : r.v), 0);
	const unmapped = d.states.filter((s: any) => ['Not known', 'Nepal', 'North East'].includes(s.k) || !s.k);
	const sel = state ? d.states.find((s: any) => s.k === state) : null;
	const trendYears = scope === 'current' ? years : years.filter((yy) => yy >= (years[years.length - 1] || 0) - 30);
	const trendKey = scope === 'current' ? (['new', 'renewed', 'lost'].includes(m.v) ? m.v : 'active') : 'registered';
	const trendOf = (s: any) => trendYears.map((yy) => s[trendKey][yy] || 0);
	const countryTrend = trendYears.map((yy) => d.states.reduce((a: number, s: any) => a + (s[trendKey][yy] || 0), 0));
	const listFor = (st: string) => onList(scope, scope === 'current' ? { year: String(y), state: st } : { state: st });
	return (
		<div className="col gap-16">
			<div className="row-between wrap gap-8">
				<div className="row gap-12 wrap">
					<span className="small faint">Showing</span>
					<Segmented value={scope} options={SCOPES} onChange={(v) => { setScope(v as any); setState(null); setYear(null); }} />
					<label className="small row gap-4">Show <select className="input sm" value={m.v} onChange={(e) => setMeasure(e.target.value)} aria-label="Measure">{MEASURES[scope].map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></label>
				</div>
				<div className="xs faint">Select a state on the map or in the list to see its cities, PIN areas and trend; select it again to clear.</div>
			</div>
			{m.byYear && shownYears.length > 0 && (
				<Card>
					<div className="row gap-12">
						<button className="btn sm" onClick={() => { if (!playing && y === shownYears[shownYears.length - 1]) setYear(shownYears[0]); setPlaying(!playing); }} aria-label={playing ? 'Pause' : 'Play through the years'}>{playing ? <MdPause /> : <MdPlayArrow />} {playing ? 'Pause' : 'Play'}</button>
						<b className="small" style={{ minWidth: 44 }}>{y}</b>
						<input type="range" className="grow" min={0} max={shownYears.length - 1} value={Math.max(0, shownYears.indexOf(y))} onChange={(e) => { setPlaying(false); setYear(shownYears[Number(e.target.value)]); }} aria-label="Year" list="geo-years" />
						<span className="xs faint nowrap">{shownYears[0]}–{shownYears[shownYears.length - 1]}</span>
					</div>
				</Card>
			)}
			<div className="grid g-2-1">
				<Card title={`${m.l}${m.byYear ? `, ${y}` : ''}`} sub={`${scope === 'current' ? 'From the current-year files' : 'From the complete customer file'}; state from the PIN code where there is one.${m.byYear && y === d.year ? ` ${y} is still in progress, so it is compared with a full year.` : ''}`}>
					<IndiaMap values={values} label={m.l} format={fmt} diverging={m.diverging} selected={state} onSelect={setState} height={520}
						detail={(s) => { const r = d.states.find((x: any) => x.k === s); if (!r) return []; return scope === 'current' ? [`${num(r.active[y] || 0)} active · ${num(r.new[y] || 0)} new · ${num(r.lost[y] || 0)} lost in ${y}`] : [`${num(r.total)} customers · ${num(r.life)} life members · ${num(r.inactive)} inactive`]; }} />
					{unmapped.length > 0 && <div className="xs faint mt-8">Not on the map: {unmapped.map((s: any) => `${s.k || 'Not known'} ${num(scope === 'current' ? s.active[y] || 0 : s.total)}`).join(' · ')}</div>}
				</Card>
				<Card title="States" sub={m.byYear && !m.pct ? `Change on ${y - 1}` : undefined} flush>
					<div className="table-wrap" style={{ maxHeight: 560, overflow: 'auto' }}><table className="table">
						<thead><tr><th>#</th><th>State</th><th className="num">{m.pct ? m.l : 'Value'}</th>{!m.pct && <th className="num">Share</th>}{m.byYear && !m.pct && <th className="num">Change</th>}</tr></thead>
						<tbody>{ranked.map((r: any, i: number) => {
							const ch = r.p ? change(r.v, r.p) : null;
							return (
								<tr key={r.s.k} className={`click ${state === r.s.k ? 'selected' : ''}`} onClick={() => setState(state === r.s.k ? null : r.s.k)}>
									<td className="xs faint">{i + 1}</td><td className="small">{r.s.k}</td><td className="num small">{m.pct ? fmt(r.v) : num(r.v)}</td>
									{!m.pct && <td className="num xs faint">{pct(r.v, total)}</td>}
									{m.byYear && !m.pct && <td className={`num xs ${ch === null ? 'faint' : ch >= 0 ? 'up-good' : 'up-bad'}`}>{ch === null ? '–' : `${ch > 0 ? '+' : ''}${ch}%`}</td>}
								</tr>
							);
						})}</tbody>
					</table></div>
				</Card>
			</div>
			<Card title={sel ? `${sel.k}: ${scope === 'current' ? `${trendKey} readers` : 'registrations'} by year` : `India: ${scope === 'current' ? `${trendKey} readers` : 'registrations'} by year`}
				actions={sel ? <div className="row gap-8"><button className="btn sm" onClick={() => listFor(sel.k)}>Open the customers</button><button className="btn ghost sm" onClick={() => setState(null)}>All India</button></div> : undefined}>
				{!trendYears.length ? <Empty text="No years yet." /> : <Chart type={trendYears.length > 12 ? 'area' : 'bar'} height={220}
					options={{ xaxis: { categories: trendYears.map(String), labels: { rotate: -45, hideOverlappingLabels: true } }, colors: [COLORS.blue], stroke: { width: trendYears.length > 12 ? 2 : 0 }, fill: { type: 'solid', opacity: trendYears.length > 12 ? 0.15 : 1 }, plotOptions: { bar: { columnWidth: '45%', borderRadius: 3 } }, yaxis: { labels: { formatter: (v: number) => short(v) } } }}
					series={[{ name: sel ? sel.k : 'India', data: sel ? trendOf(sel) : countryTrend }]} />}
			</Card>
			<div className="grid g-3">
				<Card title={`Top cities${sel ? ` in ${sel.k}` : ''}`} sub={scope === 'current' ? `Active in ${y}` : 'All customers'} flush>
					<BarList head="Customers" share={false} rows={d.cities.map((r: any) => ({ k: r.k, sub: sel ? undefined : r.state, n: r.n }))} height={380} />
				</Card>
				<Card title={`Top PIN areas${sel ? ` in ${sel.k}` : ''}`} sub="First three digits of the PIN code: one sorting district" flush>
					<BarList head="Customers" share={false} rows={d.pins.map((r: any) => ({ k: `${r.k}xxx · ${r.city || ''}`, sub: sel ? undefined : r.state, n: r.n }))} height={380} />
				</Card>
				<Card title="Outside India" sub="By country as written in the file" flush>
					<BarList head="Customers" share={false} rows={d.countries.map((r: any) => ({ k: r.k, n: r.n }))} height={380} empty="No customers outside India." />
				</Card>
			</div>
		</div>
	);
}
