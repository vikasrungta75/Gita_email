/**
 * Gita Mail server: one Node.js process that serves the web app, the API, the background worker
 * (mail sync, analysis, uploads) and the send queue (undo-send and send-later).
 *
 * The same program runs on a Windows desktop (local PostgreSQL) and on a Google Cloud VM
 * (self-managed PostgreSQL behind nginx). See docs/INSTALL_LOCAL_WINDOWS.md and docs/INSTALL_CLOUD_GCP.md.
 *
 *   npm run build      build the web app into dist/
 *   npm start          start the server (http://localhost:8888 by default)
 *
 * Settings come from .env in the app folder (or the file named in ENV_FILE), or from the environment.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// 1. Settings from .env before anything reads process.env
const envFile = process.env.ENV_FILE || path.resolve('.env');
if (fs.existsSync(envFile)) {
	try {
		(process as any).loadEnvFile(envFile);
		console.log(`[server] settings loaded from ${envFile}`);
	} catch (e: any) {
		console.error(`[server] could not read ${envFile}: ${e.message}`);
	}
}
const port = Number(process.env.PORT || 8888);
// local: only this computer can open it; cloud: nginx on the same machine forwards to 127.0.0.1
const host = process.env.HOST || '127.0.0.1';
process.env.APP_ROLE = process.env.APP_ROLE === 'cloud' ? 'cloud' : 'local';
if (!process.env.APP_URL) process.env.APP_URL = `http://localhost:${port}`;

const { handle } = await import('./api');
const { runTick } = await import('./worker');
const { ensureSchema } = await import('./db');
const { runSendQueue } = await import('./email/sendQueue');
const { syncIntervalMinutes } = await import('./email/config');

// 2. Database: create or upgrade tables on start
try {
	await ensureSchema();
	console.log('[server] database ready');
} catch (e: any) {
	console.error(`[server] database not reachable: ${e.message}`);
	console.error('[server] check DATABASE_URL in your .env (see the install guide)');
	process.exit(1);
}

// 3. Web app (built files in dist/) and API on one port
const dist = path.resolve('dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) console.warn('[server] dist/ not found: run "npm run build" first');
const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
	'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json',
	'.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain', '.map': 'application/json', '.pdf': 'application/pdf',
};
const SECURITY_HEADERS = {
	'x-frame-options': 'DENY',
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
function serveStatic(urlPath: string, res: http.ServerResponse) {
	let clean: string;
	try { clean = decodeURIComponent(urlPath.split('?')[0]); } catch { res.writeHead(400).end(); return; }
	let file = path.normalize(path.join(dist, clean));
	if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
	if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html'); // single-page app routes
	if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Web app not built. Run: npm run build'); return; }
	const ext = path.extname(file).toLowerCase();
	res.writeHead(200, {
		...SECURITY_HEADERS,
		'content-type': TYPES[ext] || 'application/octet-stream',
		'cache-control': clean.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
	});
	fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
	const url = req.url || '/';
	if (!url.startsWith('/api/')) return serveStatic(url, res);
	try {
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		const body = Buffer.concat(chunks);
		const request = new Request(`http://localhost:${port}${url}`, {
			method: req.method,
			headers: req.headers as any,
			body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : body,
		});
		const response = await handle(request);
		const headers: Record<string, string | string[]> = { ...SECURITY_HEADERS };
		response.headers.forEach((v, k) => {
			if (k === 'set-cookie') headers[k] = [...((headers[k] as string[]) || []), v];
			else headers[k] = v;
		});
		res.writeHead(response.status, headers);
		res.end(Buffer.from(await response.arrayBuffer()));
	} catch (e: any) {
		console.error('[api]', e.message);
		if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: 'Internal error' }));
	}
});
server.requestTimeout = 15 * 60_000; // large uploads
server.listen(port, host, () => {
	console.log(`[server] Gita Mail (${process.env.APP_ROLE}) running at ${process.env.APP_URL}  (listening on ${host}:${port})`);
});

// 4. Background worker: mail sync, analysis, uploads (never two at once)
let running = false;
async function tick() {
	if (running) return;
	running = true;
	const t = Date.now();
	try {
		await runTick({ budgetMs: 4 * 60_000 });
		console.log(`[worker] tick done in ${Math.round((Date.now() - t) / 1000)}s`);
	} catch (e: any) {
		console.error('[worker]', e.message);
	} finally {
		running = false;
	}
}
let nextTick: NodeJS.Timeout | null = null;
async function schedule() {
	const mins = await syncIntervalMinutes().catch(() => 5);
	nextTick = setTimeout(async () => { await tick(); schedule(); }, Math.max(1, mins) * 60_000);
}
if (process.env.WORKER !== 'false') {
	setTimeout(tick, 15_000);
	schedule();
	// 5. Send queue: replies whose 30-second undo window or "send later" time has passed. Only a
	//    staff member pressing Send puts a reply in this queue; nothing is ever sent automatically.
	setInterval(() => { runSendQueue().catch((e) => console.error('[send-queue]', e.message)); }, 10_000);
}

function stop() {
	console.log('[server] stopping');
	if (nextTick) clearTimeout(nextTick);
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
