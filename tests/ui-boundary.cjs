// Presentation-only redesign guard. Baseline lives outside the repository and
// contains file hashes, not private environment/credential contents.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const destination = process.env.TRAVELBUDDY_UI_BASELINE;
assert.ok(destination, 'Set TRAVELBUDDY_UI_BASELINE to the external baseline path.');
const protectedPaths = ['src/actions','src/lib','src/app/api','src/proxy.ts',
  'src/app/page.tsx','src/app/layout.tsx','supabase/migrations','supabase/config.toml',
  'package.json','package-lock.json'];
function entries(filename) {
  return fs.statSync(filename).isDirectory()
    ? fs.readdirSync(filename).flatMap(name => entries(path.join(filename,name))) : [filename];
}
const current = Object.fromEntries(protectedPaths.flatMap(entries).map(filename => [filename,
  createHash('sha256').update(fs.readFileSync(filename)).digest('hex')]));
if (process.argv.includes('--record')) {
  assert.ok(!fs.existsSync(destination), 'Do not overwrite a prior baseline.');
  fs.writeFileSync(destination, JSON.stringify(current, null, 2));
  console.log(`Recorded ${Object.keys(current).length} protected file hashes.`);
} else {
  const baseline = JSON.parse(fs.readFileSync(destination,'utf8'));
  assert.deepEqual(current, baseline, 'A protected auth/data/API/action/business/dependency file changed.');
  console.log(`PASS: ${Object.keys(current).length} protected files are byte-for-byte unchanged.`);
}
