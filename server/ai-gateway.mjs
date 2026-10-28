import { pathToFileURL } from 'node:url';
import express from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const models = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-sonnet-4-5']);
const speechModels = new Set(['eleven_v3', 'eleven_multilingual_v2']);
const fail = (status, message) => Object.assign(new Error(message), { status });
const positive = (value, fallback) => { const n = Number(value || fallback); if (!Number.isSafeInteger(n) || n < 1) throw Error('Usage limits must be positive integers.'); return n; };

export function createGateway(env = process.env, fetcher = fetch) {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_IDS'];
  for (const name of required) if (!env[name]?.trim()) throw Error('Missing server setting: ' + name);
  const supabase = env.SUPABASE_URL.replace(/\/$/, '');
  if (!supabase.startsWith('https://')) throw Error('SUPABASE_URL must use HTTPS.');
  const allowedVoices = new Set(env.ELEVENLABS_VOICE_IDS.split(',').map(v => v.trim()).filter(Boolean));
  const limits = {
    chat: [positive(env.USER_DAILY_CHAT_UNITS, 200000), positive(env.GLOBAL_DAILY_CHAT_UNITS, 2000000)],
    speech: [positive(env.USER_DAILY_SPEECH_CHARACTERS, 15000), positive(env.GLOBAL_DAILY_SPEECH_CHARACTERS, 100000)],
    requests: [positive(env.USER_REQUESTS_PER_MINUTE, 30), positive(env.GLOBAL_REQUESTS_PER_MINUTE, 300)]
  };
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/config', (_req, res) => res.json({ supabaseUrl: supabase, supabaseAnonKey: env.SUPABASE_ANON_KEY }));
  app.use(express.json({ limit: '8mb' }));
  const boundedFetch = (url, options = {}) => fetcher(url, { ...options, signal: options.signal || AbortSignal.timeout(120000), redirect: 'error' });
  async function budget(user, bucket, units) {
    const [perUser, global] = limits[bucket];
    const result = await boundedFetch(supabase + '/rest/v1/rpc/consume_ai_budget', {
      method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: user, p_bucket: bucket, p_units: units, p_user_limit: perUser, p_global_limit: global })
    });
    if (!result.ok) {
      const detail = await result.json().catch(() => ({}));
      if (detail.message === 'ai_usage_limit') throw fail(429, 'Scobe AI usage limit reached. Please try again later.');
      throw fail(503, 'Scobe usage tracking is unavailable. Please try again later.');
    }
  }
  app.use(async (req, _res, next) => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer /i, '') || req.headers['x-api-key'];
      if (typeof token !== 'string' || token.length > 12000) throw fail(401, 'Sign in to Scobe to use AI.');
      const result = await boundedFetch(supabase + '/auth/v1/user', { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } });
      if (!result.ok) throw fail(401, 'Your Scobe session expired. Please sign in again.');
      const user = await result.json();
      if (!user.id || !user.email_confirmed_at) throw fail(401, 'Verify your email to use Scobe AI.');
      req.scobeUser = user.id;
      await budget(user.id, 'requests', 1);
      next();
    } catch (error) { next(error); }
  });
  app.post('/claude/v1/messages', async (req, res, next) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const body = req.body;
      if (!body || !models.has(body.model) || body.stream !== true || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 300 || !Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 8000) throw fail(400, 'Unsupported chat request.');
      if (body.tools && (!Array.isArray(body.tools) || body.tools.length > 80)) throw fail(400, 'Too many tools.');
      const payload = { model: body.model, max_tokens: body.max_tokens, messages: body.messages, system: body.system, tools: body.tools, stream: true };
      // Reserve a conservative byte-based upper bound, including tool/image payloads. No refunds on failures.
      const factor = body.model.includes('opus') ? 5 : 1;
      await budget(req.scobeUser, 'chat', (Buffer.byteLength(JSON.stringify(payload)) + body.max_tokens) * factor);
      const upstream = await boundedFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(240000)])
      });
      if (!upstream.ok || !upstream.body) throw fail(upstream.status === 429 ? 429 : 502, upstream.status === 429 ? 'AI is busy. Please try again shortly.' : 'Scobe could not reach the selected AI model.');
      res.status(200).set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (error) { if (!res.headersSent) next(error); else res.destroy(); }
  });
  app.get('/speech/voices', async (_req, res, next) => {
    try {
      const voices = [];
      for (const id of allowedVoices) {
        const result = await boundedFetch('https://api.elevenlabs.io/v1/voices/' + encodeURIComponent(id), { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY } });
        if (!result.ok) throw fail(502, 'Scobe voice service is unavailable.');
        const voice = await result.json(); voices.push({ id, name: voice.name });
      }
      res.json(voices);
    } catch (error) { next(error); }
  });
  app.post('/speech/create', async (req, res, next) => {
    try {
      const { text, voice, model } = req.body || {};
      if (typeof text !== 'string' || !text.trim() || text.length > 3000 || !allowedVoices.has(voice) || !speechModels.has(model)) throw fail(400, 'Choose a supported voice and a response segment under 3,000 characters.');
      await budget(req.scobeUser, 'speech', text.length);
      const result = await boundedFetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voice) + '?output_format=mp3_44100_128', {
        method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, model_id: model })
      });
      if (!result.ok) throw fail(502, 'Scobe could not generate speech. Please try again later.');
      res.type('audio/mpeg').send(Buffer.from(await result.arrayBuffer()));
    } catch (error) { next(error); }
  });
  app.use((_req, _res, next) => next(fail(404, 'Not found.')));
  app.use((error, _req, res, _next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    res.status(status).json({ type: 'error', error: { type: status === 401 ? 'authentication_error' : 'api_error', message: status < 500 ? error.message : 'Scobe AI is temporarily unavailable.' } });
  });
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createGateway().listen(Number(process.env.PORT || 8787), '0.0.0.0', () => console.log('Scobe AI gateway listening.'));
}
