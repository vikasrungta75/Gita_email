/**
 * Gita Mail, local edition: one process that serves the web app, the API and the background worker
 * on your own computer. Replaces Netlify Functions (api, scheduler, worker-background).
 *
 *   npm run local:start      build the web app, then start (http://localhost:8888)
 *   npm run local            start without rebuilding
 *
 * Settings come from .env in this folder (or the file named in ENV_FILE), or from the environment
 * (Docker passes them in). See docs/LOCAL_SETUP.md.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// 1. Load settings from .env before anything reads process.env
const envFile = process.env.ENV_FILE || path.resolve('.env');
if (fs.existsSync(envFile)) {
	try {
		(process as any).loadEnvFile(envFile);
		console.log(`[local] settings loaded from ${envFile}`);
	} catch (e: any) {
		console.error(`[local] could not read ${envFile}: ${e.message}`);
	}
}
const port = Number(process.env.PORT || 8888);
const host = process.env.HOST || '127.0.0.1';
process.env.LOCAL_MODE = '1';
// Netlify-only switches must be off locally, otherwise "Sync now" tries to call a Netlify background function
delete process.env.NETLIFY;
if (!process.env.APP_URL || /netlify\.app/.test(process.env.APP_URL)) process.env.APP_URL = `http://localhost:${port}`;
delete process.env.URL;

const { handle } = await import('../server/api');
const { runTick } = await import('../server/worker');
const { ensureSchema } = await import('../server/db');

// 2. Database: create or upgrade tables on start
try {
	await ensureSchema();
	console.log('[local] database ready');
} catch (e: any) {
	console.error(`[local] database not reachable: ${e.message}`);
	console.error('[local] check DATABASE_URL in your .env (see docs/LOCAL_SETUP.md)');
	process.exit(1);
}

// 3. Web app (built files in dist/) and API on one port
const dist = path.resolve('dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) console.warn('[local] dist/ not found: run "npm run local:start" to build the web app first');
const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
	'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json',
	'.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain', '.map': 'application/json',
};
function serveStatic(urlPath: string, res: http.ServerResponse) {
	const clean = decodeURIComponent(urlPath.split('?')[0]);
	let file = path.normalize(path.join(dist, clean));
	if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
	if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html'); // single-page app routes
	if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Web app not built. Run: npm run local:start'); return; }
	const ext = path.extname(file).toLowerCase();
	res.writeHead(200, {
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
		const headers: Record<string, string | string[]> = {};
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
server.listen(port, host, () => {
	console.log(`[local] Gita Mail running at ${process.env.APP_URL}  (listening on ${host}:${port})`);
	console.log('[local] mail is read every 5 minutes while this window is open and the computer is awake');
});

// 4. Background worker: stand-in for the Netlify scheduler (every 5 minutes, never two at once)
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
if (process.env.LOCAL_WORKER !== 'false') {
	setTimeout(tick, 15_000);
	setInterval(tick, 5 * 60_000);
}

function stop() {
	console.log('[local] stopping');
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
