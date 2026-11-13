import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
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
  ] } }, callId, rootCallId, name: 'write', arguments: { file_path: 'app.js', content: 'actual execution' } };
}
test('history snapshots full actual execution arguments independently of root call and caller mutation', async t => {
  const { history, directory } = await historyFor(t);
  const exec = execution('session-a', 'ptc-inner', 'ptc-root');
  const content = 'full argument content\n'.repeat(12000);
  exec.arguments = { file_path: 'nested/project.js', content, options: { enabled: false, count: 0, values: [null, 'actual child arguments'] } };
  exec.agent.session.snapshotEvents = () => [{ type: 'tool/call', seq: 21,
    data: { callId: 'ptc-root', arguments: JSON.stringify({ code: 'root transport, not child arguments' }) } }];
  const expected = structuredClone(exec.arguments);
  const record = history.start(exec);
  exec.arguments.content = 'caller changed after start';
  exec.arguments.options.values.push('mutated');
  record.finish('deny');
  const live = await history.read('session-a');
  assert.deepEqual(live.records[0].arguments, expected);
  assert.equal(live.records[0].arguments.content.length, content.length);
  assert.equal(live.records[0].callSeq, 21);
  assert.equal(live.records[0].callId, 'ptc-inner');
  const cold = createReviewHistory(directory);
  t.after(() => cold.close());
  assert.deepEqual((await cold.read('session-a')).records[0].arguments, expected);
  assert.deepEqual(exec.arguments.content, 'caller changed after start');
});

test('session summary counts latest snapshots and all attempts with per-field usage coverage on cold reads', async t => {
  const { history, directory } = await historyFor(t);
  const allowed = history.start(execution('session-a', 'allowed'));
  allowed.attempt({ outcome: 'failed', code: 'TRANSPORT', usage: { inputTokens: 2, cacheReadTokens: 0 } });
  allowed.attempt({ outcome: 'allow', verdict: { decision: 'allow' },
    usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13, cacheReadTokens: 4, cacheWriteTokens: 0, reasoningTokens: 2 } });
  allowed.finish('allow');
  const denied = history.start(execution('session-a', 'denied'));
  denied.attempt({ outcome: 'deny', verdict: { decision: 'deny', reason: 'User did not authorize this.' } });
  // A denial remains the displayed conclusion when a later gate failure occurs.
  denied.finish('deny', 'DOWNSTREAM');
  const failed = history.start(execution('session-a', 'stale'));
  failed.attempt({ outcome: 'failed', verdict: { decision: 'allow' }, code: 'STALE',
    usage: { inputTokens: 7, outputTokens: NaN, totalTokens: -1, reasoningTokens: '4' } });
  failed.finish('deny', 'STALE');
  const cancelled = history.start(execution('session-a', 'cancelled'));
  cancelled.attempt({ outcome: 'cancelled', usage: {} });
  cancelled.finish('cancel', 'CANCELLED');
  const unfinished = history.start(execution('session-a', 'unfinished'));
  unfinished.attempt({ outcome: 'failed', code: 'TRANSPORT' });
  const live = await history.read('session-a');
  const expectedTotals = { records: 5, attempts: 6, allows: 1, denies: 1, failures: 3, cancelled: 1, usageReported: 3,
    inputTokens: 19, outputTokens: 3, totalTokens: 13, cacheReadTokens: 4, cacheWriteTokens: 0, reasoningTokens: 2 };
  assert.deepEqual(live.summary, { totals: expectedTotals,
    usageCoverage: { inputTokens: 3, outputTokens: 1, totalTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 1 },
    recordOutcomes: { allowed: 1, denied: 1, failed: 1, cancelled: 1, interrupted: 0, reviewing: 1 } });
  const historyDirectory = join(directory, '.plugin-data', 'dsh-auto-review-desktop', 'history');
  const [filename] = await readdir(historyDirectory);
  const lines = (await readFile(join(historyDirectory, filename), 'utf8')).trim().split('\n');
  assert(lines.length > live.records.length, 'the fixture must persist multiple row snapshots');
  await history.close();
  const cold = createReviewHistory(directory);
  t.after(() => cold.close());
  const saved = await cold.read('session-a');
  assert.deepEqual(saved.summary, { ...live.summary,
    recordOutcomes: { ...live.summary.recordOutcomes, interrupted: 1, reviewing: 0 } });
  assert.deepEqual((await cold.read('session-a')).summary, saved.summary);
  const empty = await cold.read('other-session');
  assert.equal(empty.summary.totals.records, 0);
  assert.equal(empty.summary.totals.attempts, 0);
  assert.equal(empty.summary.totals.usageReported, 0);
  assert(Object.values(empty.summary.totals).every(value => value === 0));
  assert(Object.values(empty.summary.usageCoverage).every(value => value === 0));
  assert(Object.values(empty.summary.recordOutcomes).every(value => value === 0));
});

test('cold reads accept legacy records without arguments and count only their latest persisted snapshot', async t => {
  const { history, directory } = await historyFor(t);
  const record = history.start(execution());
  record.finish('allow');
  await history.read('session-a');
  await history.close();
  const historyDirectory = join(directory, '.plugin-data', 'dsh-auto-review-desktop', 'history');
  const [filename] = await readdir(historyDirectory);
  const legacy = { version: 1, id: 'legacy-review', sessionId: 'session-a', callId: 'legacy-call', rootCallId: 'legacy-call',
    tool: 'write', status: 'reviewing', attempts: [] };
  const completed = { ...legacy, status: 'completed', gate: 'allow',
    attempts: [{ outcome: 'failed', usage: { inputTokens: 5 } }, { outcome: 'allow', verdict: { decision: 'allow' } }] };
  const noAttempts = { ...legacy, id: 'legacy-without-attempts', status: 'interrupted' };
  delete noAttempts.attempts;
  await appendFile(join(historyDirectory, filename), [legacy, completed, noAttempts].map(row => JSON.stringify(row)).join('\n') + '\n');
  const cold = createReviewHistory(directory);
  t.after(() => cold.close());
  const saved = await cold.read('session-a');
  assert.equal(saved.records.length, 3);
  const row = saved.records.find(row => row.id === legacy.id);
  assert.deepEqual(row, completed);
  assert(!Object.hasOwn(row, 'arguments'), 'old records must not invent missing execution arguments');
  assert.equal(saved.summary.totals.records, 3);
  assert.equal(saved.summary.totals.attempts, 2);
  assert.equal(saved.summary.totals.inputTokens, 5);
  assert.equal(saved.summary.usageCoverage.inputTokens, 1);
  assert.equal(saved.summary.totals.usageReported, 1);
  assert.equal(saved.summary.recordOutcomes.interrupted, 1);
});

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
