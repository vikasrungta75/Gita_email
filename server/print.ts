/**
 * "PDF" for any table: a clean page laid out for printing, which opens the browser's print window so it can be
 * saved as a PDF or sent to a printer. Done this way so Hindi (Devanagari) text prints exactly as it reads on
 * screen, with no extra software or cost.
 */
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function printPage(title: string, header: string[], rows: unknown[][], note = ''): Response {
	const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
body { font-family: "Noto Sans", "Noto Sans Devanagari", "Nirmala UI", Mangal, Arial, sans-serif; font-size: 10px; color: #111; margin: 16px; }
h1 { font-size: 16px; margin: 0 0 2px; } p { margin: 0 0 10px; color: #555; }
table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: 3px 5px; text-align: left; vertical-align: top; word-break: break-word; }
th { background: #eee; } thead { display: table-header-group; } tr { page-break-inside: avoid; }
.bar { margin-bottom: 10px; } @media print { .bar { display: none; } body { margin: 0; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save as PDF</button></div>
<h1>${esc(title)}</h1><p>Gita Press, Gorakhpur · ${esc(when)} · ${rows.length.toLocaleString('en-IN')} rows${note ? ` · ${esc(note)}` : ''}</p>
<table><thead><tr>${header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(Array.isArray(c) ? c.join('; ') : c instanceof Date ? c.toISOString().slice(0, 10) : c)}</td>`).join('')}</tr>`).join('\n')}
</tbody></table><script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });</script></body></html>`;
	return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
