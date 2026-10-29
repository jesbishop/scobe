import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway, normalizeMessages, validationCategory } from './ai-gateway.mjs';
const env = { SUPABASE_URL: 'https://auth.example.test', SUPABASE_ANON_KEY: 'public-test', SUPABASE_SERVICE_ROLE_KEY: 'server-test', ANTHROPIC_API_KEY: 'claude-test', ELEVENLABS_API_KEY: 'speech-test', ELEVENLABS_VOICE_IDS: 'approved-voice' };
async function fixture(mode = '', overrides = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return Response.json(mode === 'invalid' ? {} : { id: 'user-id', email: 'owner@example.test', email_confirmed_at: '2026-01-01' }, { status: mode === 'invalid' ? 401 : 200 });
    if (url.includes('/rpc/')) return Response.json(mode === 'quota' ? { message: 'ai_usage_limit' } : null, { status: mode === 'quota' ? 400 : 200 });
    if (url.includes('anthropic.com')) {
      if (mode === 'bad-context') return Response.json({ error: { type: 'invalid_request_error', message: 'prompt is too long: private-prompt-content' } }, { status: 400 });
      if (mode === 'bad-image') return Response.json({ error: { type: 'invalid_request_error', message: 'Invalid base64 image: private-image-content' } }, { status: 400 });
      if (mode === 'overloaded') return Response.json({ error: { type: 'overloaded_error', message: 'private-provider-detail' } }, { status: 529 });
      if (mode === 'provider-auth') return Response.json({ error: { type: 'authentication_error', message: 'private-credential-detail' } }, { status: 401 });
      return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (url.includes('/voices/')) return Response.json({ name: 'Approved voice' });
    return new Response(Buffer.from('mock-mp3'));
  };
  const server = createGateway({ ...env, ...overrides }, fetcher).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { calls, base: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}
const request = (body) => ({ method: 'POST', headers: { Authorization: 'Bearer user-session', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const chat = { model: 'claude-opus-5-5', max_tokens: 500, stream: true, messages: [{ role: 'user', content: 'hello' }] };
test('requires verified sign-in before provider access', async () => {
  const f = await fixture(); try { const result = await fetch(f.base + '/speech/voices'); assert.equal(result.status, 401); assert.equal(f.calls.length, 0); } finally { await f.close(); }
});
test('rejects invalid sessions', async () => {
  const f = await fixture('invalid'); try { const result = await fetch(f.base + '/claude/v1/messages', request(chat)); assert.equal(result.status, 401); assert.equal(f.calls.length, 1); } finally { await f.close(); }
});
test('streams chat, replaces user credentials, and reserves usage', async () => {
  const f = await fixture(); try {
    const result = await fetch(f.base + '/claude/v1/messages', request(chat)); assert.equal(result.status, 200); assert.match(await result.text(), /message_stop/);
    const upstream = f.calls.find(call => call.url.includes('anthropic.com')); assert.equal(upstream.options.headers['x-api-key'], env.ANTHROPIC_API_KEY);
    assert.equal(f.calls.filter(call => call.url.includes('/rpc/')).length, 2);
    const publicConfig = await (await fetch(f.base + '/config')).text(); assert.ok(!publicConfig.includes(env.ANTHROPIC_API_KEY)); assert.ok(!publicConfig.includes(env.SUPABASE_SERVICE_ROLE_KEY));
  } finally { await f.close(); }
});
test('blocks requests when shared quota is exhausted', async () => {
  const f = await fixture('quota'); try { const result = await fetch(f.base + '/claude/v1/messages', request(chat)); assert.equal(result.status, 429); assert.ok(!f.calls.some(call => call.url.includes('anthropic.com'))); } finally { await f.close(); }
});
test('rejects unsupported models and excessive output', async () => {
  const f = await fixture(); try { for (const body of [{ ...chat, model: 'unknown' }, { ...chat, max_tokens: 100000 }]) { const result = await fetch(f.base + '/claude/v1/messages', request(body)); assert.equal(result.status, 400); } assert.ok(!f.calls.some(call => call.url.includes('anthropic.com'))); } finally { await f.close(); }
});
test('only exposes approved voices and generates speech with server key', async () => {
  const f = await fixture(); try {
    const list = await (await fetch(f.base + '/speech/voices', { headers: { Authorization: 'Bearer user-session' } })).json(); assert.deepEqual(list, [{ id: 'approved-voice', name: 'Approved voice' }]);
    const denied = await fetch(f.base + '/speech/create', request({ text: 'Hello', model: 'eleven_v3', voice: 'private-voice' })); assert.equal(denied.status, 400);
    const audio = await fetch(f.base + '/speech/create', request({ text: 'Hello', model: 'eleven_v3', voice: 'approved-voice' })); assert.equal(audio.status, 200); assert.equal(await audio.text(), 'mock-mp3');
    const upstream = f.calls.find(call => call.url.includes('/text-to-speech/')); assert.equal(upstream.options.headers['xi-api-key'], env.ELEVENLABS_API_KEY);
  } finally { await f.close(); }
});

test('reports context, image, overload, and provider-connection failures without leaking provider details', async () => {
  for (const [mode, status, message] of [['bad-context', 422, /conversation is too large/], ['bad-image', 422, /preview image/], ['overloaded', 503, /temporarily overloaded/], ['provider-auth', 502, /connection needs attention/]]) {
    const f = await fixture(mode);
    try {
      const response = await fetch(f.base + '/claude/v1/messages', request(chat));
      assert.equal(response.status, status);
      const body = await response.text();
      assert.match(body, message);
      assert.ok(!body.includes('private-'));
      assert.equal(f.calls.filter(c => c.url.includes('anthropic.com')).length, 1);
    } finally { await f.close(); }
  }
});

test('removes empty streamed text while preserving tool calls, matching results, and images', () => {
  const messages = [{ role: 'user', content: 'Build' }, { role: 'assistant', content: [{ type: 'text', text: '' }, { type: 'tool_use', id: 'tool-id', name: 'get_basic_info', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-id', content: [{ type: 'text', text: ' ' }, { type: 'image', source: { data: 'image' } }] }] }];
  const fixed = normalizeMessages(messages);
  assert.equal(fixed[1].content.length, 1);
  assert.equal(fixed[1].content[0].id, fixed[2].content[0].tool_use_id);
  assert.equal(fixed[2].content[0].content[0].type, 'image');
  assert.equal(messages[1].content.length, 2);
  assert.equal(normalizeMessages([{ role: 'assistant', content: [{ type: 'text', text: ' ' }] }]).length, 0);
  assert.equal(normalizeMessages([{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-id', content: '' }] }])[0].content[0].content, '(Tool returned no text.)');
});

test('validation diagnostics report only fixed categories, never provider message values', () => {
  for (const [message, category] of [['private-data text blocks must be non-empty', 'empty_content'], ['Unexpected tool_use_id: secret-id', 'tool_history'], ['credit balance too low', 'billing'], ['tools.0.input_schema properties invalid', 'tool_schema']]) {
    assert.equal(validationCategory({ error: { message } }), category);
  }
});

test('gateway leaves signed conversation prefixes unchanged and enables automatic prompt caching', async () => {
  const signed = [{ role: 'user', content: 'Request' }, { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'signed' }, { type: 'text', text: '' }, { type: 'tool_use', id: 'tool-id', name: 'get_tokens', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-id', content: '{}' }] }];
  assert.deepEqual(normalizeMessages(signed), signed);
  const f = await fixture();
  try {
    const response = await fetch(f.base + '/claude/v1/messages', request({ ...chat, messages: signed }));
    assert.equal(response.status, 200); await response.text();
    const payload = JSON.parse(f.calls.find(c => c.url.includes('anthropic.com')).options.body);
    assert.deepEqual(payload.messages, signed);
    assert.deepEqual(payload.cache_control, { type: 'ephemeral' });
  } finally { await f.close(); }
});


test('development allowance requires both the verified owner account and development marker', async () => {
  for (const [allowed, marker, expected] of [[true, true, 200000000], [true, false, 200000], [false, true, 200000]]) {
    const f = await fixture('', { DEV_AI_EMAILS: allowed ? 'owner@example.test' : 'someone-else@example.test' });
    try {
      const options = request(chat);
      if (marker) options.headers['x-scobe-development'] = '1';
      const response = await fetch(f.base + '/claude/v1/messages', options);
      assert.equal(response.status, 200); await response.text();
      const reservation = f.calls.filter(call => call.url.includes('/rpc/')).map(call => JSON.parse(call.options.body)).find(body => body.p_bucket === 'chat');
      assert.equal(reservation.p_user_limit, expected);
      assert.equal(reservation.p_global_limit, allowed && marker ? 500000000 : 2000000);
      const upstream = f.calls.find(call => call.url.includes('anthropic.com'));
      assert.equal(upstream.options.headers['x-scobe-development'], undefined);
    } finally { await f.close(); }
  }
});
