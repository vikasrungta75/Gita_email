/** Loads .env (or the file in ENV_FILE) into process.env. Import first in command-line scripts. */
import fs from 'node:fs';
import path from 'node:path';

const envFile = process.env.ENV_FILE || path.resolve('.env');
if (fs.existsSync(envFile)) {
	try {
		(process as any).loadEnvFile(envFile);
	} catch (e: any) {
		console.error(`could not read ${envFile}: ${e.message}`);
	}
}
