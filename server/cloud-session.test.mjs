import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function fixture(expired = false, behavior = {}) {
  const files = new Map(); const calls = []; const output = {}; const timeouts = [];
  let configFailures = behavior.configFailures || 0;
  const session = { access_token: 'user-access', refresh_token: 'user-refresh', expires_in: expired ? 0 : 3600, user: { email: 'person@example.test' } };
  const code = ts.transpileModule(readFileSync(new URL('../src/main/cloudAi.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  runInNewContext(code, { exports: output, Buffer, URL, AbortSignal: { timeout: ms => { timeouts.push(ms); return AbortSignal.timeout(ms) } }, process: { env: {} }, require: name => {
    if (name === 'electron') return { app: { getPath: () => '/settings', isPackaged: true }, safeStorage: { isEncryptionAvailable: () => true, encryptString: text => Buffer.from('sealed:' + text), decryptString: data => data.toString().slice(7) } };
    if (name === 'node:fs') return { existsSync: file => files.has(file), readFileSync: file => { if (!files.has(file)) throw Error('Missing'); return files.get(file) }, writeFileSync: (file, data) => files.set(file, data), unlinkSync: file => files.delete(file) };
    if (name.includes('cloudConfig')) return { gatewayUrl: 'https://scobe.example.test' };
    return require(name);
  }, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/config')) {
      if (configFailures-- > 0) throw Object.assign(Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      return Response.json({ supabaseUrl: 'https://auth.example.test', supabaseAnonKey: 'public-anon' });
    }
    if (url.endsWith('/otp')) return Response.json({});
    if (url.endsWith('/verify')) return Response.json(session);
    if (url.includes('grant_type=refresh_token')) {
      if (behavior.refreshTimeout) throw Object.assign(Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      return Response.json({ ...session, access_token: 'refreshed-access', expires_in: 3600 });
    }
    return Response.json({ ok: true });
  } });
  return { api: output, calls, files, timeouts };
}
test('email-code login stores only an encrypted session and signs out cleanly', async () => {
  const f = fixture(); await f.api.sendSignInCode('person@example.test'); const status = await f.api.verifySignInCode('person@example.test', '123456');
  assert.equal(status.signedIn, true); assert.equal(status.email, 'person@example.test'); assert.equal(status.access_token, undefined);
  assert.ok([...f.files.values()][0].toString().startsWith('sealed:'));
  await f.api.cloudFetch('/speech/voices'); assert.equal(f.calls.at(-1).options.headers.Authorization, 'Bearer user-access');
  assert.equal(f.api.signOutCloud().signedIn, false); assert.equal(f.files.size, 0); await assert.rejects(() => f.api.cloudToken(), /Sign in/);
});
test('refreshes expired sessions once for concurrent requests', async () => {
  const f = fixture(true); await f.api.verifySignInCode('person@example.test', '123456');
  const tokens = await Promise.all([f.api.cloudToken(), f.api.cloudToken()]); assert.deepEqual(tokens, ['refreshed-access', 'refreshed-access']);
  assert.equal(f.calls.filter(call => call.url.includes('grant_type=refresh_token')).length, 1);
});
test('validates email and code before calling authentication', async () => {
  const f = fixture(); await assert.rejects(() => f.api.sendSignInCode('invalid')); await assert.rejects(() => f.api.verifySignInCode('person@example.test', 'wrong')); assert.equal(f.calls.length, 0);
});

test('cold-start discovery waits 90 seconds and safely retries a timeout once', async () => {
  const f = fixture(true, { configFailures: 1 });
  await f.api.verifySignInCode('person@example.test', '123456');
  assert.equal(await f.api.cloudToken(), 'refreshed-access');
  assert.equal(f.calls.filter(c => c.url.endsWith('/config')).length, 2);
  assert.deepEqual(f.timeouts.slice(0, 2), [90000, 90000]);
  assert.equal(f.calls.filter(c => c.url.includes('/verify')).length, 1);
  assert.equal(f.calls.filter(c => c.url.includes('grant_type=refresh_token')).length, 1);
});

test('concurrent sign-in requests share configuration discovery and cache only public config', async () => {
  const f = fixture();
  await Promise.all([f.api.sendSignInCode('a@example.test'), f.api.sendSignInCode('b@example.test')]);
  await f.api.sendSignInCode('c@example.test');
  assert.equal(f.calls.filter(c => c.url.endsWith('/config')).length, 1);
  assert.equal(f.calls.filter(c => c.url.endsWith('/otp')).length, 3);
  assert.equal(f.files.size, 0);
});

test('repeated discovery timeout gives a readable error before any credential submission', async () => {
  const f = fixture(false, { configFailures: 10 });
  await assert.rejects(() => f.api.verifySignInCode('person@example.test', '123456'), /could not connect/);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(c => c.url.endsWith('/config')));
});

test('refresh timeouts never automatically replay the rotating refresh token', async () => {
  const f = fixture(true, { refreshTimeout: true });
  await f.api.verifySignInCode('person@example.test', '123456');
  await assert.rejects(() => f.api.cloudToken(), /timeout/);
  assert.equal(f.calls.filter(c => c.url.includes('grant_type=refresh_token')).length, 1);
});
