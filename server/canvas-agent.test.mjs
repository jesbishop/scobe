import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const output = {}; cache.set(name, output);
  const code = ts.transpileModule(readFileSync(new URL(`../src/main/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  runInNewContext(code, { exports: output, Buffer, URL, console, process, require: id => {
    if (id === './canvasToolRegistry') return load('canvasToolRegistry');
    if (id === './canvasTools') return { runCanvasTool: async () => ({ content: 'ok' }) };
    if (id === './mcpAuth') return {};
    if (id === './buildBus') return { emitBuild: () => {} };
    if (id === '../shared/designGuide') return { DESIGN_GUIDE: 'Guide', DESIGN_GUIDE_SUMMARY: 'Guide summary' };
    if (id === 'electron') return { app: { getVersion: () => 'test', getAppPath: () => '/not-installed' } };
    return require(id);
  } });
  return output;
}
const registry = load('canvasToolRegistry');
const loop = load('canvasAgentLoop');
const inspect = load('canvasInspection').inspectCanvas;
const text = (value = 'Finished') => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: value }] });
const call = (name, input = {}, id = name) => ({ type: 'tool_use', id, name, input });
const tools = (...calls) => ({ stop_reason: 'tool_use', content: calls });
async function simulate(responses, execute = async () => ({ content: '{}' }), overrides = {}) {
  const requests = [], calls = [], events = [], memories = [];
  await loop.runCanvasAgentLoop({ messages: [{ role: 'user', text: 'Build a landing page' }], emit: event => events.push(event),
    summarize: name => name, request: async thread => { requests.push(structuredClone(thread)); const response = responses.shift(); if (response instanceof Error) throw response; if (!response) throw Error('Unexpected model request'); return response; },
    execute: async (name, input) => { calls.push({ name, input }); return execute(name, input); },
    remember: notes => memories.push([...notes]), ...overrides });
  return { requests, calls, events, memories };
}

test('chat and actual MCP registration expose the same tools and parameter schemas', async () => {
  const mcp = await load('mcpServer').listToolDefinitions({ openBrowser: async () => 'tab' });
  const chat = registry.chatCanvasTools();
  assert.equal(new Set(chat.map(t => t.name)).size, chat.length);
  assert.deepEqual(Array.from(chat, t => t.name).sort(), Array.from(mcp, t => t.name).sort());
  for (const definition of chat) {
    const other = mcp.find(t => t.name === definition.name);
    assert.deepEqual(JSON.parse(JSON.stringify(definition.input_schema.properties)), JSON.parse(JSON.stringify(other.inputSchema.properties)), definition.name);
  }
  for (const name of ['get_basic_info','get_tree_summary','get_node_info','duplicate_nodes','rename_nodes','create_artboard','finish_working_on_nodes','add_design_comment']) assert.ok(chat.some(t => t.name === name));
  assert.throws(() => registry.validateCanvasTool('update_design', { patch: {} }));
  assert.throws(() => registry.validateCanvasTool('unknown', {}));
});

test('large canvas overview excludes every descendant, text payload, and image', () => {
  const nodes = [{ id: 'root', type: 'frame', name: 'Landing', x: 0, y: 0, width: 1440, height: 900 },
    ...Array.from({ length: 1000 }, (_, i) => ({ id: 'text-' + i, type: 'text', parentId: 'root', text: 'large'.repeat(5000), imageDataUrl: 'private-image' }))];
  const result = inspect(nodes, 'get_basic_info', {}, n => ({ x: n.x, y: n.y, width: n.width, height: n.height }));
  assert.ok(result.length < 1000);
  assert.equal(JSON.parse(result).nodeCount, 1001);
  assert.equal(JSON.parse(result).artboards[0].childCount, 1000);
  assert.ok(!result.includes('private-image') && !result.includes('large'));
});

test('paged reads retain all IDs, limit subtree scope, and bound long text', () => {
  const nodes = [{ id: 'root', type: 'frame' }, { id: 'unrelated', type: 'frame' },
    ...Array.from({ length: 112 }, (_, i) => ({ id: 'child-' + i, parentId: 'root', type: 'text', text: 'x'.repeat(10000) }))];
  let offset = 0; const ids = [];
  do {
    const page = JSON.parse(inspect(nodes, 'list_design', { id: 'root', offset }, () => ({})));
    ids.push(...page.nodes.map(n => n.id)); offset = page.nextOffset;
    assert.ok(page.nodes.every(n => !n.text || n.text.length <= 200));
  } while (offset !== null);
  assert.equal(ids.length, 113); assert.equal(new Set(ids).size, 113); assert.ok(!ids.includes('unrelated'));
  const tree = JSON.parse(inspect(nodes, 'get_tree_summary', { id: 'root', limit: 10 }, () => ({})));
  assert.equal(tree.lines.length, 10); assert.equal(tree.nextOffset, 10);
  assert.throws(() => inspect(nodes, 'get_tree_summary', { id: 'missing' }, () => ({})));
});

test('build cannot finish before receiving an image review; fixes require another render', async () => {
  const f = await simulate([
    tools(call('create_artboard', { name: 'Landing' })), text('Built'),
    tools(call('render_node', { id: 'frame' })),
    tools(call('update_design', { id: 'frame', patch: { fill: '#fff' } })), text('Fixed'),
    tools(call('render_node', { id: 'frame' })), text('Reviewed and finished')
  ], async name => name === 'render_node' ? { content: 'frame image', image: 'test-image' } : { content: '{"id":"frame"}' });
  assert.equal(f.requests.length, 7);
  assert.equal(f.events.at(-1).type, 'done');
  assert.equal(f.calls.at(-1).name, 'finish_working_on_nodes');
  assert.ok(f.memories[0].some(note => note.includes('frame')));
  const imageResult = f.requests[3].at(-1).content[0];
  assert.ok(imageResult.content.some(part => part.type === 'image'));
});

test('invalid tool arguments return an error to the model and can be repaired', async () => {
  const f = await simulate([tools(call('resize_design', {})), tools(call('resize_design', { id: 'a', width: 100, height: 100 })), text()],
    async (name, input) => { registry.validateCanvasTool(name, input); return { content: '{"id":"a"}' }; });
  assert.equal(f.requests[1].at(-1).content[0].is_error, true);
  assert.equal(f.events.at(-1).type, 'done');
});

test('a build with multiple artboards must review each artboard', async () => {
  const f = await simulate([
    tools(call('create_artboard', { name: 'first' }, 'first-call'), call('create_artboard', { name: 'second' }, 'second-call')),
    tools(call('render_node', { id: 'first' })), text('Finished'),
    tools(call('render_node', { id: 'second' })), text('Both reviewed')
  ], async (name, input) => name === 'render_node'
    ? { content: 'Reviewed', image: 'test-image', reviewedId: input.id }
    : { content: JSON.stringify({ id: input.name, type: 'frame' }) });
  assert.match(f.requests[3].at(-1).content, /second/);
  assert.equal(f.events.at(-1).type, 'done');
});

test('ordinary conversation does not trigger inspection or review', async () => {
  const f = await simulate([text('Hello')]);
  assert.equal(f.requests.length, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, 'finish_working_on_nodes');
});

test('render failures are recoverable but cannot silently count as a completed review', async () => {
  const f = await simulate([tools(call('create_artboard')), text(), tools(call('render_node')), text(), text(), text()],
    async name => { if (name === 'render_node') throw Error('Renderer unavailable'); return { content: '{"id":"frame"}' }; });
  assert.equal(f.events.at(-1).type, 'error');
  assert.match(f.events.at(-1).message, /visual review/);
  assert.equal(f.calls.at(-1).name, 'finish_working_on_nodes');
});

test('truncated tool arguments are never executed and the model can continue', async () => {
  const f = await simulate([{ stop_reason: 'max_tokens', content: [call('delete_nodes', { ids: ['a'] })] }, text('Continued')]);
  assert.ok(!f.calls.some(c => c.name === 'delete_nodes'));
  assert.ok(f.requests[1].every(message => typeof message.content === 'string' || message.content.length > 0));
});

test('step exhaustion and quota failures never report a completed task and always clean up', async () => {
  const limited = await simulate([tools(call('get_tokens'))], undefined, { maxSteps: 1 });
  assert.equal(limited.events.at(-1).type, 'error'); assert.match(limited.events.at(-1).message, /unfinished/);
  const quota = Object.assign(Error('429 Scobe AI usage limit reached'), { status: 429 });
  const failed = await simulate([quota]);
  assert.equal(failed.events.at(-1).type, 'error'); assert.match(failed.events.at(-1).message, /allowance/);
  assert.equal(failed.calls.at(-1).name, 'finish_working_on_nodes');
});

test('connection timeouts become readable chat errors without replaying AI work', async () => {
  const timeout = Object.assign(Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const f = await simulate([timeout]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.events.at(-1).type, 'error');
  assert.match(f.events.at(-1).message, /hosted service may be waking up/i);
  assert.ok(!f.events.at(-1).message.includes('vanta:runAgent'));
  assert.equal(f.calls.at(-1).name, 'finish_working_on_nodes');
});

test('context compaction preserves tool pair IDs and recent images without repeating old image data', () => {
  const history = [];
  for (let i = 0; i < 20; i++) {
    history.push({ role: 'assistant', content: [call('render_node', {}, 'tool-' + i)] });
    history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-' + i, content: [
      { type: 'text', text: 'x'.repeat(100000) }, { type: 'image', source: { type: 'base64', data: 'old-image-' + i } }
    ] }] });
  }
  const compact = loop.compactAgentThread(history);
  assert.equal(compact.length, history.length);
  assert.equal(compact[1].content[0].tool_use_id, 'tool-0');
  assert.ok(!JSON.stringify(compact[1]).includes('old-image-0'));
  assert.ok(JSON.stringify(compact.at(-1)).includes('old-image-19'));
  assert.ok(JSON.stringify(compact).length < 100000);
  assert.equal(history[1].content[0].content[0].text.length, 100000);
});

test('signed thinking history remains append-only, including earlier tool results and images', () => {
  const history = [];
  for (let i = 0; i < 4; i++) {
    history.push({ role: 'assistant', content: [call('render_node', { svg: 'x'.repeat(5000) }, 'tool-' + i)] });
    history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-' + i, content: [{ type: 'text', text: 'x'.repeat(20000) }, { type: 'image', source: { type: 'base64', data: 'test-image' } }] }] });
  }
  history.push({ role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'bound-to-prefix' }, call('get_basic_info', {}, 'latest')] });
  history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'latest', content: '{}' }] });
  const before = JSON.stringify(history);
  assert.equal(JSON.stringify(loop.compactAgentThread(history)), before);
  history.at(-2).content[0] = { type: 'redacted_thinking', data: 'signed-redacted-block' };
  assert.equal(JSON.stringify(loop.compactAgentThread(history)), JSON.stringify(history));
});
