import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function boot() {
  let plugin;
  const React = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity).filter(x => x != null) } }), useState: initial => [initial, () => {}] };
  vm.runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {
    AbortController, WeakSet, window: { __ModuleLoader__: { load(def) { plugin = def.factory(name => name === 'react' ? React : {}); } } },
  });
  return plugin;
}
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children ?? []).flatMap(nodes)];
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const row = (overrides = {}) => ({ id: 'review-1', callId: 'inner', rootCallId: 'outer', tool: 'pwsh', status: 'completed', gate: 'deny', attempts: [{ verdict: { decision: 'deny', risk: 'medium', reason: '<script>missing authority</script>' } }], ...overrides });

test('denial is a persistent error row with verbatim reason and inspect action, including human fallback', () => {
  const p = boot(); let inspected;
  const element = p.ReviewNotice({ row: row({ gate: 'ask' }), t: key => key, inspectCall: id => { inspected = id; } });
  assert.equal(element.props.role, 'alert');
  assert.equal(element.props['data-review-state'], 'denied');
  assert.match(element.props.className, /ar-review-error/);
  const tree = nodes(element);
  assert(tree.some(node => node.props.children.includes('<script>missing authority</script>')));
  assert(tree.some(node => node.props.children.includes('AUTO_REVIEW_DENIED')));
  assert(tree.some(node => node.props.children.includes('reviewHumanFallback')));
  assert(!tree.some(node => node.props.dangerouslySetInnerHTML));
  tree.find(node => node.type === 'button').props.onClick(); assert.equal(inspected, 'inner');
});

test('status presentation never describes a stale allow or failed attempt as approval', () => {
  const p = boot();
  assert.equal(p.reviewPresentation(row({ status: 'reviewing', attempts: [] })).state, 'reviewing');
  assert.equal(p.reviewPresentation(row({ status: 'failed', code: 'STALE', attempts: [{ verdict: { decision: 'allow', risk: 'low' } }] })).state, 'failed');
  assert.equal(p.reviewPresentation(row({ status: 'interrupted', attempts: [] })).state, 'interrupted');
  assert.equal(p.reviewPresentation(row({ status: 'completed', gate: 'allow', attempts: [{ verdict: { decision: 'allow', risk: 'low' } }] })).state, 'allowed');
  let inspected;
  const display = p.ReviewNotice({ row: row({ status: 'completed', gate: 'allow', attempts: [{ verdict: { decision: 'allow', risk: 'low' } }] }), t: key => key, inspectCall: id => { inspected = id; } });
  assert.equal(display.props.role, 'status'); assert(!display.props.className.includes('ar-review-error'));
  assert.match(display.props.className, /ar-review-approved/);
  assert.match(display.props.title, /reviewAllowNote/);
  assert.match(display.props['aria-label'], /reviewAllowNote/);
  const children = display.props.children;
  assert.equal(children.length, 3);
  assert.equal(children[0].props.className, 'ar-review-dot');
  assert.deepEqual(children[1].props.children, ['reviewPassed']);
  assert.equal(children[2].type, 'button');
  assert.deepEqual(children[2].props.children, ['reviewInspect']);
  assert(!nodes(display).some(node => node.props.children.includes('reviewAllowNote')));
  children[2].props.onClick(); assert.equal(inspected, 'inner');
});

test('PTC review notices attach only to the original root call and retain individual child IDs', () => {
  const p = boot(), snapshot = { records: [row(), row({ id: 'other', rootCallId: 'another-root' }), row({ id: 'second', callId: 'inner-2' })] };
  const matches = p.ToolReviewRows({ snapshot, root: { callId: 'outer', seq: 999 }, t: x => x });
  assert.deepEqual(Array.from(matches, item => item.props.row.callId), ['inner', 'inner-2']);
  assert.equal(p.ToolReviewRows({ snapshot, root: null }), null);
});

test('trajectory contains complete structured verdicts and explicitly separates final gate outcomes', () => {
  const p = boot(), record = row({ gate: 'ask', attempts: [{ verdict: { risk: 'high', decision: 'deny', reason: 'denied reason' }, model: 'reviewer', durationMs: 42, usage: { inputTokens: 17 } }] });
  const rendered = p.ReviewTrajectory({ snapshot: { records: [record], available: true }, store: {}, t: key => key });
  const tree = nodes(rendered), data = JSON.parse(tree.find(node => node.type === 'pre').props.children[0]);
  assert.deepEqual(data, record);
  assert(tree.some(node => node.props.children.includes('reviewGate_ask')));
  assert.equal(tree.find(node => node.type === 'input').props['aria-label'], 'reviewFilter');
});

test('history store shares one cancellable long-poll, keeps late responses out, and reconnects after failure', async () => {
  const p = boot(), calls = [], pending = [];
  const connection = { rpc: { call(channel, endpoint, payload, signal) { calls.push({ channel, endpoint, payload, signal }); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } } };
  const store = p.createHistoryStore(connection, 'session-A'); let changes = 0;
  const stop = store.subscribe(() => changes++), stop2 = store.subscribe(() => {});
  assert.equal(calls.length, 1); assert.equal(calls[0].endpoint, 'history');
  pending[0].resolve({ ok: true, value: { revision: 1, available: true, records: [row()] } }); await tick();
  assert.equal(calls[1].endpoint, 'watch-history'); assert.equal(calls[1].payload.revision, 1);
  assert.equal(store.getSnapshot().records.length, 1); assert.equal(changes, 1);
  stop(); assert.equal(calls[1].signal.aborted, false); stop2(); assert.equal(calls[1].signal.aborted, true);
  pending[1].resolve({ ok: true, value: { revision: 2, records: [] } }); await tick(); assert.equal(changes, 1);
  const stop3 = store.subscribe(() => changes++);
  pending[2].reject(Error('offline')); await tick(); assert.equal(store.getSnapshot().error, true);
  store.retry(); pending[3].resolve({ ok: true, value: { revision: 3, available: true, closed: true, records: [] } }); await tick();
  assert.equal(store.getSnapshot().error, null); assert.equal(store.getSnapshot().records.length, 0);
  stop3(); store.dispose();
});

test('review status projects an existing call into its own Chat key without modifying the session event', () => {
  const p = boot(), def = p.reviewCallDefinition;
  const event = { type: 'tool/call', seq: 594, time: 10, data: { callId: 'root', name: 'write', turn: 11, step: 1 } };
  const before = plain(event), match = def.match['tool/call'](event);
  assert.equal(match.id, 'root'); assert.equal(match.role, 'start');
  const state = def.start({}, { event }), location = { kind: 'step', turn: { turn: 11 }, step: { step: 1 } };
  const context = { key: 'review-context', kind: def.kind, id: 'root', state, start: { event, location }, matches: [{ event, location }] };
  const node = def.buildViewNode(context);
  assert.equal(node.kind, 'auto-review-call-status'); assert.equal(node.target, 'chat');
  assert.equal(node.anchorSeq, 594.01); assert.equal(node.location, location);
  assert.equal(node.data.root.callId, 'root'); assert.equal(def.update(context), state);
  assert.equal(def.buildViewNode({ state: undefined }), null);
  assert.deepEqual(plain(event), before);
});

test('new review labels have Chinese and English translations with matching keys', () => {
  const p = boot(), { en, zh } = p.permissionDictionaries;
  const keys = Object.keys(en).filter(key => key.startsWith('review'));
  assert(keys.length > 20);
  for (const key of keys) { assert.equal(typeof zh[key], 'string', key); assert(zh[key]); }
});
