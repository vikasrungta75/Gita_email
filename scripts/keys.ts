/** Prints new random secrets for a fresh install: npm run keys */
import crypto from 'node:crypto';
console.log('\nPaste these into .env:\n');
console.log(`JWT_SECRET=${crypto.randomBytes(32).toString('hex')}`);
console.log(`ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`);
console.log(`INTERNAL_API_SECRET=${crypto.randomBytes(24).toString('hex')}\n`);
