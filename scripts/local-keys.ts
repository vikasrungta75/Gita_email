/** Prints three new random secrets for a fresh local install (only when NOT copying data from Netlify). */
import crypto from 'node:crypto';
console.log('\nPaste these into .env (only for a fresh install without cloud data):\n');
console.log(`JWT_SECRET=${crypto.randomBytes(32).toString('hex')}`);
console.log(`ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`);
console.log(`INTERNAL_API_SECRET=${crypto.randomBytes(24).toString('hex')}\n`);
