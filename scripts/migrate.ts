import '../server/loadEnv';
import { ensureSchema, getPool } from '../server/db';
import { defaultOrgId } from '../server/auth';

if (!process.env.DATABASE_URL) {
	console.warn('[migrate] No DATABASE_URL in .env or the environment — add it to .env and run again.');
	process.exit(0);
}
try {
	await ensureSchema();
	const org = await defaultOrgId();
	console.log(`[migrate] schema up to date; organisation id ${org}`);
} catch (e: any) {
	console.error('[migrate] failed:', e.message);
	process.exit(1);
} finally {
	await getPool().end().catch(() => {});
}
