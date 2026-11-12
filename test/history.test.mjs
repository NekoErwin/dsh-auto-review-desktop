import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createReviewHistory } from '../src/history.js';

async function historyFor(t) {
  const directory = await mkdtemp(fileURLToPath(new URL('../.tmp-review-history-', import.meta.url)));
  const history = createReviewHistory(directory);
  t.after(async () => { await history.close(); await rm(directory, { recursive: true, force: true }); });
  return { history, directory };
}
function execution(sessionId = 'session-a', callId = 'call-a', rootCallId = callId) {
  return { agent: { session: { id: sessionId, snapshotEvents: () => [
    { type: 'tool/call', seq: 17, data: { callId: rootCallId } },
  ] } }, callId, rootCallId, name: 'write' };
}
const nextTick = () => new Promise(resolve => setImmediate(resolve));

test('history cold reads preserve final reasons, attempts, and exact call association', async t => {
  const { history, directory } = await historyFor(t);
  const record = history.start(execution());
  const attempt = { attempt: 1, outcome: 'deny', verdict: { decision: 'deny', risk: 'medium', reason: 'The destination is outside the authorized project.' } };
  record.attempt(attempt);
  attempt.verdict.reason = 'mutated after submission';
  record.finish('deny');
  const live = await history.read('session-a');
  assert.equal(live.records.length, 1);
  assert.equal(live.records[0].status, 'completed');
  assert.equal(live.records[0].gate, 'deny');
  assert.equal(live.records[0].callSeq, 17);
  assert.equal(live.records[0].attempts[0].verdict.reason, 'The destination is outside the authorized project.');
  const cold = createReviewHistory(directory);
  t.after(() => cold.close());
  assert.deepEqual((await cold.read('session-a')).records, live.records);
});

test('unfinished persisted reviews cold read as interrupted instead of spinning forever', async t => {
  const { history, directory } = await historyFor(t);
  const record = history.start(execution());
  record.attempt({ attempt: 1, outcome: 'failed', code: 'TRANSPORT' });
  await history.close();
  assert.equal(history.start(execution()), undefined);
  const cold = createReviewHistory(directory);
  t.after(() => cold.close());
  const [saved] = (await cold.read('session-a')).records;
  assert.equal(saved.status, 'interrupted');
  assert.equal(saved.attempts.length, 1);
  assert.equal(saved.attempts[0].code, 'TRANSPORT');
});

test('history keeps same call ids in different sessions and PTC children separate', async t => {
  const { history, directory } = await historyFor(t);
  history.start(execution('session-a', 'inner-1', 'root-a')).finish('allow');
  history.start(execution('session-a', 'inner-2', 'root-a')).finish('deny');
  history.start(execution('session-b', 'inner-1', 'root-b')).finish('cancel', 'CANCELLED');
  const first = await history.read('session-a');
  const second = await history.read('session-b');
  assert.deepEqual(first.records.map(row => [row.sessionId, row.callId, row.rootCallId, row.gate]), [
    ['session-a', 'inner-1', 'root-a', 'allow'], ['session-a', 'inner-2', 'root-a', 'deny'],
  ]);
  assert.equal(new Set(first.records.map(row => row.id)).size, 2);
  assert.equal(second.records[0].callId, 'inner-1');
  assert.equal(second.records[0].rootCallId, 'root-b');
  assert.equal(second.records[0].status, 'cancelled');
  assert.deepEqual((await history.read('unrelated')).records, []);
  const cold = createReviewHistory(directory);
  t.after(() => cold.close());
  assert.deepEqual((await cold.read('session-b')).records, second.records);
});

test('watch wakes for its session revision and ignores other session writes', async t => {
  const { history } = await historyFor(t);
  const initial = await history.read('session-a');
  let settled = false;
  const pending = history.watch('session-a', initial.revision).then(value => { settled = true; return value; });
  await nextTick();
  history.start(execution('session-b')).finish('allow');
  await history.read('session-b');
  await nextTick();
  assert.equal(settled, false);
  history.start(execution('session-a')).finish('deny');
  const updated = await pending;
  assert(updated.revision > initial.revision);
  assert.equal(updated.records.length, 1);
  assert.equal(updated.records[0].sessionId, 'session-a');
  const stale = await history.watch('session-a', initial.revision);
  assert(stale.revision > initial.revision);
});

test('watch cancellation and history close both release pending readers', async t => {
  const { history } = await historyFor(t);
  const initial = await history.read('session-a');
  const controller = new AbortController();
  const aborted = history.watch('session-a', initial.revision, controller.signal);
  await nextTick();
  controller.abort();
  assert.equal((await aborted).revision, initial.revision);
  assert.deepEqual((await history.watch('session-a', initial.revision, controller.signal)).records, []);
  const closing = history.watch('session-a', initial.revision);
  await nextTick();
  await history.close();
  assert.equal((await closing).closed, true);
});
