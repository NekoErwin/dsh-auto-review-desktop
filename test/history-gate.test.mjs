import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createReviewHistory } from '../src/history.js';
import { createReviewGate } from '../src/gate.js';
import { fixture, answer } from './helpers.mjs';

async function setup(t, options = {}) {
  const directory = await mkdtemp(fileURLToPath(new URL('../.tmp-review-gate-', import.meta.url)));
  const history = createReviewHistory(directory);
  const f = fixture(options);
  const gate = createReviewGate(f.ctx, f.readConfig, { history });
  t.after(async () => {
    await gate.close({ applicationShutdown: true });
    await history.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { f, gate, history, directory };
}
async function onlyRecord(history, sessionId = 'test-session') {
  const snapshot = await history.read(sessionId);
  assert.equal(snapshot.records.length, 1);
  return snapshot.records[0];
}
const nextTick = () => new Promise(resolve => setImmediate(resolve));

test('gate history persists allow verdict, usage and configured reviewer route', async t => {
  const { f, gate, history, directory } = await setup(t, {
    config: { routeMode: 'specific', provider: 'review', model: 'cheap' },
    stream: () => answer('{"risk":"low","decision":"allow"}', { inputTokens: 11, outputTokens: 7 }),
  });
  assert.equal((await gate.gate(f.exec, f.next)).kind, 'allow');
  const row = await onlyRecord(history);
  assert.equal(row.status, 'completed');
  assert.equal(row.gate, 'allow');
  assert.equal(row.callId, 'call-1');
  assert.equal(row.rootCallId, 'call-1');
  assert.equal(row.callSeq, f.events.find(event => event.type === 'tool/call').seq);
  assert.equal(row.attempts.length, 1);
  assert.equal(row.attempts[0].provider, 'review');
  assert.equal(row.attempts[0].model, 'cheap');
  assert.deepEqual(row.attempts[0].verdict, { risk: 'low', decision: 'allow' });
  assert.equal(row.attempts[0].verdict.reason, undefined);
  assert.equal(row.attempts[0].usage.inputTokens, 11);
  const cold = createReviewHistory(directory);
  t.after(() => cold.close());
  assert.deepEqual((await cold.read(f.session.id)).records, [row]);
});

test('gate history keeps deny reason and records no downstream authorization', async t => {
  const reason = 'No user instruction authorizes this destination.';
  const { f, gate, history } = await setup(t, { stream: () => answer(JSON.stringify({ risk: 'medium', decision: 'deny', reason })) });
  assert.equal((await gate.gate(f.exec, f.next)).kind, 'deny');
  assert.equal(f.getDownstreamCalls(), 0);
  const row = await onlyRecord(history);
  assert.equal(row.status, 'completed');
  assert.equal(row.gate, 'deny');
  assert.equal(row.attempts[0].outcome, 'deny');
  assert.equal(row.attempts[0].verdict.reason, reason);
});

test('stale allow remains visible as a failed attempt and never as a final authorization', async t => {
  const { f, gate, history } = await setup(t);
  f.setStream(async function* () {
    f.setConfig({ maxOutputTokens: 4096 });
    yield* answer('{"risk":"low","decision":"allow"}');
  });
  assert.equal((await gate.gate(f.exec, f.next)).kind, 'deny');
  assert.equal(f.getDownstreamCalls(), 0);
  const row = await onlyRecord(history);
  assert.equal(row.status, 'failed');
  assert.equal(row.gate, 'deny');
  assert.equal(row.code, 'STALE');
  assert.equal(row.attempts.length, 1);
  assert.equal(row.attempts[0].outcome, 'failed');
  assert.equal(row.attempts[0].code, 'STALE');
  assert.equal(row.attempts[0].verdict.decision, 'allow');
  assert.equal(row.attempts[0].verdict.reason, undefined);
});

test('retry retains the failed attempt and final verdict in one ordered history record', async t => {
  const { f, gate, history } = await setup(t, {
    config: { maxRetries: 1 },
    stream: async function* (_request, number) {
      if (number === 1) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT', message: 'connection reset' } } };
        return;
      }
      yield* answer('{"risk":"low","decision":"allow"}');
    },
  });
  assert.equal((await gate.gate(f.exec, f.next)).kind, 'allow');
  assert.equal(f.getDownstreamCalls(), 1);
  const row = await onlyRecord(history);
  assert.equal(row.status, 'completed');
  assert.deepEqual(row.attempts.map(attempt => [attempt.attempt, attempt.outcome]), [[1, 'failed'], [2, 'allow']]);
  assert(row.attempts[0].code);
  assert.equal(row.attempts[0].verdict, undefined);
  assert.deepEqual(row.attempts[1].verdict, { risk: 'low', decision: 'allow' });
  assert.deepEqual(f.requests[0].messages, f.requests[1].messages);
});

test('invalid reviewer output records a terminal failure without inventing a verdict', async t => {
  const { f, gate, history } = await setup(t, { stream: () => answer('not a review verdict') });
  assert.equal((await gate.gate(f.exec, f.next)).kind, 'deny');
  const row = await onlyRecord(history);
  assert.equal(row.status, 'failed');
  assert.equal(row.gate, 'deny');
  assert.equal(row.code, 'INVALID_REVIEW');
  assert.equal(row.attempts.length, 1);
  assert.equal(row.attempts[0].outcome, 'failed');
  assert.equal(row.attempts[0].verdict, undefined);
});

test('cancelled review persists cancelled state and ignores a late provider allow', async t => {
  const release = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const { f, gate, history } = await setup(t, { stream: async function* () { entered.resolve(); await release.promise; yield* answer(); } });
  const pending = gate.gate(f.exec, f.next);
  await entered.promise;
  f.controller.abort();
  assert.equal((await pending).kind, 'cancel');
  release.resolve();
  await nextTick();
  const row = await onlyRecord(history);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.gate, 'cancel');
  assert.equal(row.code, 'CANCELLED');
  assert.equal(row.attempts.length, 1);
  assert.equal(row.attempts[0].outcome, 'cancelled');
  assert.equal(f.getDownstreamCalls(), 0);
});

test('gate history binds each PTC child to its actual root and excludes run_code transport', async t => {
  const { f, gate, history } = await setup(t, { tool: 'run_code', arguments: { code: 'write()' } });
  assert.equal((await gate.gate(f.exec, f.next)).kind, 'allow');
  assert.deepEqual((await history.read(f.session.id)).records, []);
  for (const [callId, content] of [['inner-1', 'first edit'], ['inner-2', 'second edit']]) {
    const args = { file_path: 'app.js', content };
    f.add('tool/ptc-dispatch-start', { parentCallId: 'call-1', subCallId: callId, rootCallId: 'call-1', name: 'write', arguments: args });
    const exec = { ...f.exec, name: 'write', callId, arguments: args, parent: { callId: 'call-1' }, schema: { name: 'write', description: 'Write a project file', parameters: { type: 'object' } } };
    assert.equal((await gate.gate(exec, f.next)).kind, 'allow');
  }
  const rows = (await history.read(f.session.id)).records;
  assert.deepEqual(rows.map(row => [row.callId, row.rootCallId, row.tool]), [
    ['inner-1', 'call-1', 'write'], ['inner-2', 'call-1', 'write'],
  ]);
  assert(rows.every(row => row.status === 'completed' && row.attempts.length === 1));
});
