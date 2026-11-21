/**
 * India by state, shaded by a value (Leaflet, no map tiles: it works offline and shows only the state outlines).
 * Outlines: DataMeet (datameet.org), CC BY 2.5 India, following the Survey of India boundary. Jammu & Kashmir and
 * Ladakh are one shape in that file; the hover shows each separately.
 *
 * Sequential values use one blue ramp, light to dark (6 classes, rounded breaks). Change values (a growth %) use a
 * diverging red–grey–blue scale centred on zero. Select a state to pick it; select it again to clear.
 */
import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import geo from '../assets/india-states.json';

const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const DIV_NEG = ['#b42625', '#e34948', '#f2a3a2'];
const DIV_POS = ['#9ec5f4', '#3987e5', '#184f95'];
const NONE = '#f0efec';
const MID = '#e4e2dd';

/** Rounded class breaks from the values (quantiles, then rounded to two significant digits). */
function breaksFor(vals: number[], n = 6): number[] {
	const v = vals.filter((x) => x > 0).sort((a, b) => a - b);
	if (!v.length) return [];
	const round = (x: number) => { if (x < 10) return Math.ceil(x); const p = 10 ** (Math.floor(Math.log10(x)) - 1); return Math.ceil(x / p) * p; };
	const out: number[] = [];
	for (let i = 1; i < n; i++) { const b = round(v[Math.min(v.length - 1, Math.floor((i * v.length) / n))]); if (!out.length || b > out[out.length - 1]) out.push(b); }
	return out;
}

export interface MapProps {
	/** value per state name (as the app writes it: "Uttar Pradesh", "Ladakh", …) */
	values: Record<string, number | null | undefined>;
	/** what the value is, for the legend and hover ("Customers", "Growth on 2025") */
	label: string;
	format?: (v: number) => string;
	diverging?: boolean;
	/** extra lines in the hover, per state */
	detail?: (state: string) => string[];
	selected?: string | null;
	onSelect?: (state: string | null) => void;
	height?: number;
}

export default function IndiaMap({ values, label, format = (v) => v.toLocaleString('en-IN'), diverging, detail, selected, onSelect, height = 460 }: MapProps) {
	const box = useRef<HTMLDivElement>(null);
	const map = useRef<L.Map | null>(null);
	const layer = useRef<L.GeoJSON | null>(null);
	const props = useRef({ values, label, format, diverging, detail, selected, onSelect });
	props.current = { values, label, format, diverging, detail, selected, onSelect };

	const featureValue = (f: any, vals = props.current.values) => {
		const parts: number[] = (f.properties.states as string[]).map((s) => vals[s]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
		if (!parts.length) return null;
		return props.current.diverging ? parts[0] : parts.reduce((a, b) => a + b, 0);
	};
	const scale = useMemo(() => {
		const vals = (geo as any).features.map((f: any) => featureValue(f, values)).filter((x: any) => x !== null) as number[];
		if (diverging) {
			const m = Math.max(1, ...vals.map((x) => Math.abs(x)));
			const round = (x: number) => Math.round(x * 10) / 10;
			const st = [m / 3, (2 * m) / 3];
			return {
				color: (v: number | null) => (v === null ? NONE : v === 0 ? MID : v < 0 ? DIV_NEG[-v > st[1] ? 0 : -v > st[0] ? 1 : 2] : DIV_POS[v > st[1] ? 2 : v > st[0] ? 1 : 0]),
				legend: [[DIV_NEG[0], `below ${format(-round(st[1]))}`], [DIV_NEG[1], `${format(-round(st[1]))} to ${format(-round(st[0]))}`], [DIV_NEG[2], `${format(-round(st[0]))} to 0`], [MID, 'no change'],
					[DIV_POS[0], `0 to ${format(round(st[0]))}`], [DIV_POS[1], `${format(round(st[0]))} to ${format(round(st[1]))}`], [DIV_POS[2], `above ${format(round(st[1]))}`]] as [string, string][],
			};
		}
		const b = breaksFor(vals);
		const ramp = b.length >= 6 ? SEQ.slice(1) : SEQ.slice(1, b.length + 2);
		return {
			color: (v: number | null) => { if (v === null || v <= 0) return NONE; let i = 0; while (i < b.length && v > b[i]) i++; return ramp[Math.min(i, ramp.length - 1)]; },
			legend: [[NONE, 'None'] as [string, string], ...ramp.map((c, i) => [c, i === 0 ? `up to ${format(b[0] ?? 0)}` : i < b.length ? `${format(b[i - 1] + 1)}–${format(b[i])}` : `over ${format(b[b.length - 1] ?? 0)}`] as [string, string])],
		};
	}, [values, diverging, format]); // eslint-disable-line react-hooks/exhaustive-deps

	const style = (f: any): L.PathOptions => {
		const sel = props.current.selected && f.properties.states.includes(props.current.selected);
		return { fillColor: scale.color(featureValue(f)), fillOpacity: 1, color: sel ? '#0F172A' : '#ffffff', weight: sel ? 2.5 : 1, opacity: 1 };
	};
	const tip = (f: any) => {
		const p = props.current;
		const lines = (f.properties.states as string[]).map((s) => {
			const v = p.values[s];
			return `<div><b>${s}</b>: ${typeof v === 'number' ? p.format(v) : 'none'} ${p.label.toLowerCase()}</div>${(p.detail?.(s) || []).map((x) => `<div class="xs">${x}</div>`).join('')}`;
		});
		return lines.join('<hr style="margin:4px 0;border:0;border-top:1px solid #e2e8f0">');
	};

	useEffect(() => {
		if (!box.current || map.current) return;
		const m = L.map(box.current, { zoomSnap: 0.25, attributionControl: true, scrollWheelZoom: false, zoomControl: true, minZoom: 3.5, maxZoom: 8 });
		m.attributionControl.setPrefix(false).addAttribution('State outlines: <a href="https://datameet.org" target="_blank" rel="noopener noreferrer">DataMeet</a> (CC BY 2.5 India)');
		const g = L.geoJSON(geo as any, {
			style,
			onEachFeature: (f, lyr) => {
				lyr.bindTooltip(() => tip(f), { sticky: true, direction: 'top', className: 'map-tip' });
				lyr.on({
					mouseover: (e: any) => e.target.setStyle({ weight: 2.5, color: '#475569' }),
					mouseout: (e: any) => g.resetStyle(e.target),
					click: () => { const p = props.current; const s = f.properties.states.includes('Jammu and Kashmir') && (p.values.Ladakh ?? 0) > (p.values['Jammu and Kashmir'] ?? 0) ? 'Ladakh' : f.properties.states[0]; p.onSelect?.(p.selected && f.properties.states.includes(p.selected) ? null : s); },
				});
			},
		}).addTo(m);
		m.fitBounds(g.getBounds(), { padding: [8, 8] });
		m.setMaxBounds(g.getBounds().pad(0.4));
		map.current = m;
		layer.current = g;
		const ro = new ResizeObserver(() => { m.invalidateSize(); });
		ro.observe(box.current);
		return () => { ro.disconnect(); m.remove(); map.current = null; layer.current = null; };
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => { layer.current?.setStyle(style as any); }, [scale, selected]); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<div>
			<div ref={box} className="india-map" style={{ height }} role="img" aria-label={`Map of India by state: ${label}`} />
			<div className="map-legend" aria-label="Legend">
				<span className="xs faint">{label}</span>
				{scale.legend.map(([c, t]) => <span key={t + c} className="xs row gap-4"><i style={{ background: c }} />{t}</span>)}
			</div>
		</div>
	);
}
