const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
// Exercise the server codec in isolation; no credential or DB is used here.
(async () => {
  const swc = require('next/dist/build/swc');
  await swc.loadBindings();
  const { code } = await swc.transform(fs.readFileSync('src/lib/traveler-sensitive-fields.ts', 'utf8'), {
    filename: 'traveler-sensitive-fields.ts', jsc: { parser: { syntax: 'typescript' }, target: 'es2020' }, module: { type: 'commonjs' },
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => id === 'server-only' ? {} : require(id), mod, mod.exports);
  const codec = mod.exports;
  const original = process.env.ENCRYPTION_KEY;
  try {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(48).toString('base64url');
    const a = codec.encryptTravelerMedicalConditions(['synthetic']);
    const b = codec.encryptTravelerMedicalConditions(['synthetic']);
    assert.notEqual(a, b);
    assert.deepEqual(codec.decryptTravelerMedicalConditions(a), ['synthetic']);
    const envelope = JSON.parse(Buffer.from(a.slice(2), 'hex').toString());
    envelope.tag = Buffer.alloc(16).toString('base64url');
    assert.throws(() => codec.decryptTravelerMedicalConditions('\\x' + Buffer.from(JSON.stringify(envelope)).toString('hex')));
    assert.throws(() => codec.decryptTravelerMedicalConditions('\\x00'));
    process.env.ENCRYPTION_KEY = crypto.randomBytes(48).toString('base64url');
    assert.throws(() => codec.decryptTravelerMedicalConditions(a));
    delete process.env.ENCRYPTION_KEY;
    assert.throws(() => codec.assertTravelerEncryptionConfigured());
    console.log('PASS: codec round-trip, random nonce, tampering, incompatible payload, wrong key, missing key.');
  } finally { if (original === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = original; }
})().catch(() => { console.error('Crypto test failed.'); process.exitCode = 1; });
