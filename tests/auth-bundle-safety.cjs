// Scan built public JS without printing or storing private credential values.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('@next/env').loadEnvConfig(process.cwd(), true);
const secrets = ['SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY', 'CLERK_SECRET_KEY']
  .map(name => process.env[name]).filter(value => value && value.length >= 16);
assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.ENCRYPTION_KEY, 'Configure server secrets to run the literal leak check.');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : filename.endsWith('.js') ? [filename] : [];
  });
}
const bundles = files('.next/static');
assert.ok(bundles.length, 'Run the production build first.');
for (const filename of bundles) {
  const source = fs.readFileSync(filename, 'utf8');
  assert.ok(secrets.every(value => !source.includes(value)), 'A server secret appeared in public JavaScript.');
  assert.ok(!source.includes('clerk.browser.js') && !source.includes('@clerk/'), 'An authentication SDK reference appeared in public JavaScript.');
}
console.log(`PASS: ${bundles.length} public JS bundles contain no configured server-secret literals or Clerk SDK references.`);
