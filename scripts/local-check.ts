/**
 * Checks that the local edition is ready to run: Node.js version, .env settings, PostgreSQL connection
 * (creates the database if it does not exist), Claude key, Google settings and the built web app.
 *   npm run local:check
 * Exits with code 1 if anything required is wrong, and says how to fix it.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const results: { level: 'ok' | 'warn' | 'fail'; name: string; detail: string }[] = [];
const ok = (name: string, detail = '') => results.push({ level: 'ok', name, detail });
const warn = (name: string, detail: string) => results.push({ level: 'warn', name, detail });
const fail = (name: string, detail: string) => results.push({ level: 'fail', name, detail });

// Node.js
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj > 20 || (maj === 20 && min >= 12)) ok('Node.js', `version ${process.versions.node}`);
else fail('Node.js', `version ${process.versions.node} is too old. Install Node.js 22 LTS from nodejs.org`);

// .env
const envFile = process.env.ENV_FILE || path.resolve('.env');
if (!fs.existsSync(envFile)) {
	fail('.env file', `not found at ${envFile}. Copy local/env.local.template to .env and fill it in`);
} else {
	try {
		(process as any).loadEnvFile(envFile);
		ok('.env file', envFile);
	} catch (e: any) {
		fail('.env file', `could not be read: ${e.message}`);
	}
}
const v = (k: string) => (process.env[k] || '').trim();
const req = (k: string, why: string) => (v(k) ? true : (fail(k, `missing: ${why}`), false));

req('ADMIN_EMAIL', 'the first administrator\'s email');
if (req('ADMIN_PASSWORD', 'the first administrator\'s password') && v('ADMIN_PASSWORD').length < 10) warn('ADMIN_PASSWORD', 'shorter than 10 characters; use a stronger password');
if (v('JWT_SECRET').length >= 32) ok('JWT_SECRET', 'set'); else fail('JWT_SECRET', v('JWT_SECRET') ? 'too short: needs 32+ characters' : 'missing: copy from Netlify, or run npm run local:keys for a fresh install');
if (v('ENCRYPTION_KEY')) ok('ENCRYPTION_KEY', 'set (must match Netlify if you copied the cloud data)'); else fail('ENCRYPTION_KEY', 'missing: copy from Netlify, or run npm run local:keys for a fresh install');
if (!v('INTERNAL_API_SECRET')) warn('INTERNAL_API_SECRET', 'missing; recommended (copy from Netlify)');
if (/netlify\.app/.test(v('APP_URL'))) warn('APP_URL', 'points at Netlify; the local server will use http://localhost:' + (v('PORT') || '8888') + ' instead');
if (v('ORG_NAME')) ok('ORG_NAME', v('ORG_NAME')); else warn('ORG_NAME', 'missing; set to Gita Press, Gorakhpur');
if (/wheel ?king/i.test(v('ORG_NAME') + v('INTERNAL_DOMAINS'))) fail('ORG_NAME / INTERNAL_DOMAINS', 'these are Wheel King values: this is the wrong env file. Use the Gita Mail one');

// Database
async function checkDb() {
	const url = v('DATABASE_URL') || v('NETLIFY_DATABASE_URL') || v('NETLIFY_DB_URL');
	if (!url) return fail('DATABASE_URL', 'missing: e.g. postgres://postgres:YOUR_PASSWORD@localhost:5432/gitamail');
	if (/neon\.tech|netlify|amazonaws|supabase/.test(url)) warn('DATABASE_URL', 'points at a cloud database, not this computer. For a fully local copy use postgres://...@localhost:5432/gitamail');
	let parsed: URL;
	try { parsed = new URL(url); } catch { return fail('DATABASE_URL', 'not a valid connection string. Special characters in the password must be encoded (@ → %40)'); }
	const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres';
	const local = /localhost|127\.0\.0\.1/.test(parsed.hostname);
	const ssl = local || /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: false };
	const tryConnect = async (u: string) => { const c = new pg.Client({ connectionString: u, ssl, connectionTimeoutMillis: 8000 }); await c.connect(); return c; };
	try {
		const c = await tryConnect(url);
		const ver = (await c.query('show server_version')).rows[0].server_version;
		const tables = (await c.query("select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n;
		await c.end();
		ok('PostgreSQL', `connected to "${dbName}" (PostgreSQL ${ver}); ${tables ? tables + ' tables already there' : 'empty, tables are created on first start'}`);
	} catch (e: any) {
		if (/does not exist/.test(e.message)) {
			try {
				const admin = new URL(url); admin.pathname = '/postgres';
				const c = await tryConnect(admin.toString());
				await c.query(`create database "${dbName.replace(/"/g, '')}"`);
				await c.end();
				ok('PostgreSQL', `database "${dbName}" did not exist, so it was created`);
			} catch (e2: any) {
				fail('PostgreSQL', `database "${dbName}" does not exist and could not be created: ${e2.message}. Create it in pgAdmin or psql: CREATE DATABASE ${dbName};`);
			}
		} else if (/password authentication failed/.test(e.message)) fail('PostgreSQL', 'wrong user or password in DATABASE_URL');
		else if (/ECONNREFUSED|connect/.test(e.message)) fail('PostgreSQL', `cannot reach ${parsed.hostname}:${parsed.port || 5432}. Is PostgreSQL running? Is the port right (often 5432)?`);
		else fail('PostgreSQL', e.message);
	}
}

// Claude
async function checkAi() {
	const provider = v('AI_PROVIDER') || (v('ANTHROPIC_API_KEY') ? 'anthropic' : v('GEMINI_API_KEY') ? 'gemini' : 'heuristic');
	if (provider === 'heuristic') return warn('AI', 'no AI key: the basic rules engine is used. Add ANTHROPIC_API_KEY for good summaries and drafts');
	if (provider === 'anthropic') {
		if (!v('ANTHROPIC_API_KEY')) return fail('ANTHROPIC_API_KEY', 'AI_PROVIDER is anthropic but the key is missing');
		try {
			const res = await fetch(`${(v('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/models`, { headers: { 'x-api-key': v('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', ...(v('ANTHROPIC_WORKSPACE_ID') ? { 'anthropic-workspace-id': v('ANTHROPIC_WORKSPACE_ID') } : {}) }, signal: AbortSignal.timeout(10000) });
			if (res.ok) ok('Claude', `key accepted; model ${v('ANTHROPIC_MODEL') || 'default'}`);
			else if (res.status === 401 || res.status === 403) fail('Claude', 'key rejected (401/403). Create a new key at console.anthropic.com and paste it with no spaces or quotes');
			else warn('Claude', `could not confirm the key (HTTP ${res.status}); check your internet connection`);
		} catch (e: any) { warn('Claude', `could not reach Anthropic: ${e.message}`); }
	} else ok('AI', `provider ${provider}`);
}

// Google
function checkGoogle() {
	if (v('GOOGLE_CLIENT_ID') && v('GOOGLE_CLIENT_SECRET')) ok('Google sign-in', 'client ID and secret set. Remember the localhost redirect URI in Google Cloud Console');
	else warn('Google sign-in', 'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing: only email and password sign-in will work, and personal Gmail cannot be connected');
	if (v('GOOGLE_SERVICE_ACCOUNT_JSON')) {
		try { const j = JSON.parse(v('GOOGLE_SERVICE_ACCOUNT_JSON')); ok('Google service account', j.client_email || 'set'); }
		catch { fail('GOOGLE_SERVICE_ACCOUNT_JSON', 'not valid JSON; paste it on one line, or leave it blank and upload the key in Admin → Mailboxes'); }
	} else ok('Google service account', 'not in .env: uses the key stored in the database (Admin → Mailboxes), if uploaded');
}

// Web app build
function checkBuild() {
	if (fs.existsSync(path.resolve('dist/index.html'))) ok('Web app', 'built (dist/)');
	else warn('Web app', 'not built yet: "npm run local:start" builds it');
	if (!fs.existsSync(path.resolve('node_modules/pg'))) fail('Packages', 'not installed: run npm ci');
}

await checkDb();
await checkAi();
checkGoogle();
checkBuild();

const icon = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL' };
console.log('\nGita Mail local check\n');
for (const r of results) console.log(`  ${icon[r.level]}  ${r.name.padEnd(28)} ${r.detail}`);
const fails = results.filter((r) => r.level === 'fail').length;
console.log(fails ? `\n${fails} problem(s) to fix before starting. Fix them in .env, then run npm run local:check again.\n` : '\nReady. Start with:  npm run local:start   then open ' + `http://localhost:${v('PORT') || 8888}\n`);
process.exit(fails ? 1 : 0);
