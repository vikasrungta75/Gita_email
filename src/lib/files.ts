/** Downloads, authenticated fetches and the browser side of large uploads (read here, sent in parts). */
import { api, getToken } from '../api/client';
import { streamTableRows } from './xlsxStream';

export const saveBlob = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); };
export const authFetch = (path: string) => fetch(`/api${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
export async function download(path: string, name: string) {
	const res = await authFetch(path);
	if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Download failed (${res.status})`);
	saveBlob(await res.blob(), name);
}
/** Opens a file served by the API (PDF, image) in a new tab. */
export async function openFile(path: string) {
	const w = window.open('', '_blank');
	const res = await authFetch(path);
	if (!res.ok) { w?.close(); throw new Error((await res.json().catch(() => ({}))).error || `Could not open (${res.status})`); }
	const url = URL.createObjectURL(await res.blob());
	if (w) w.location.href = url;
}
/** bytes → base64, in pieces small enough for the browser */
export const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

/**
 * Sends a spreadsheet as an upload batch: the rows a few thousand at a time, then the original file. The server
 * checks the rows and waits for the check summary to be confirmed before anything is applied.
 */
export async function sendBatch(kind: string, file: File, onStep: (step: string, pct: number) => void, options: Record<string, unknown> = {}): Promise<number> {
	const data = new Uint8Array(await file.arrayBuffer());
	let id = 0, sent = 0, fraction = 0;
	const r = await streamTableRows(data, file.name, async (rows) => {
		if (!id) {
			const head = rows.shift() || [];
			id = (await api('/uploads/start', { body: { kind, fileName: file.name, fileSize: file.size, header: head, options } })).id;
		}
		for (let i = 0; i < rows.length; i += 3000) {
			const part = rows.slice(i, i + 3000);
			await api(`/uploads/${id}/rows`, { body: { start: sent, rows: part } });
			sent += part.length;
		}
		onStep(`Sending rows: ${sent.toLocaleString('en-IN')} so far`, Math.round(fraction * 80));
	}, { batch: 6000, onProgress: (f) => { fraction = f; } });
	if (!id) throw new Error('The file is empty.');
	const PART = 3_000_000;
	for (let i = 0, seq = 0; i < data.length; i += PART, seq++) {
		onStep('Keeping a copy of the original file', 80 + Math.round((i / data.length) * 15));
		await api(`/uploads/${id}/part`, { body: { seq, data: b64(data.subarray(i, i + PART)) } });
	}
	onStep('Checking the rows', 97);
	await api(`/uploads/${id}/finish`, { body: { rows: r.rows - 1 } });
	return id;
}
