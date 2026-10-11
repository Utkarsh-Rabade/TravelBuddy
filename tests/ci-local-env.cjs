// CI-only: use the ephemeral LOCAL stack, never organization/project secrets.
const { execFileSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
if (!process.env.CI || !process.env.GITHUB_ENV) throw new Error('This helper is for GitHub CI only.');
const status = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status','-o','json'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }));
const url = new URL(status.API_URL);
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.port !== '54321') throw new Error('Refusing non-local CI Supabase.');
const values = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_URL: status.API_URL,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  ENCRYPTION_KEY: randomBytes(48).toString('base64url'),
};
for (const [name,value] of Object.entries(values)) {
  if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) throw new Error('Missing local CI configuration.');
  if (name.includes('KEY')) process.stdout.write(`::add-mask::${value}\n`);
  appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
}
