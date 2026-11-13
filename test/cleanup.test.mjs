import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, access, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDataCleanup } from '../src/cleanup.js';
import { createReviewHistory } from '../src/history.js';
import { createAuditJournal } from '../src/audit.js';
import { createReviewGate } from '../src/gate.js';
import { fixture } from './helpers.mjs';

async function setup(t) {
  const root = join(process.cwd(), 'tmp', `cleanup-test-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  t.after(async () => { assert(root.startsWith(join(process.cwd(), 'tmp', 'cleanup-test-'))); await rm(root, { recursive: true, force: true }); });
  const data = join(root, '.plugin-data', 'dsh-auto-review-desktop');
  await mkdir(join(data, 'history'), { recursive: true });
  await writeFile(join(data, 'history', 'old.jsonl'), 'private old history');
  const journal = createAuditJournal(root), history = createReviewHistory(root);
  let stops = 0;
  const cleanup = createDataCleanup({ profileHome: root, journal, history, stop: async () => { stops++; } });
  return { root, data, journal, history, cleanup, stops: () => stops };
}

test('cleanup preview is read-only; confirmation removes only plugin data, drains writers and clears cold/in-memory reads', async t => {
  const f = await setup(t);
  await mkdir(join(f.root, '.plugin-data', 'other-plugin')); await writeFile(join(f.root, '.plugin-data', 'other-plugin', 'keep'), 'other');
  for (const name of ['cordis.patch.yml', 'credentials.json', 'session.jsonl']) await writeFile(join(f.root, name), 'keep');
  const exec = fixture().exec; const record = f.history.start(exec);
  f.journal.write({ outcome: 'allow' });
  const first = await f.history.read(String(exec.agent.session.id)); assert.equal(first.records.length, 1);
  const watcher = f.history.watch(String(exec.agent.session.id), first.revision);
  const scope = await f.cleanup.prepare('browser');
  assert.equal(scope.target, f.data); assert(scope.files >= 2); assert.equal(f.stops(), 0);
  const result = await f.cleanup.clean('browser', { token: scope.token, confirmation: 'DELETE', path: f.root });
  assert(result.cleaned); assert.equal(f.stops(), 1);
  await assert.rejects(access(f.data), { code: 'ENOENT' });
  for (const name of ['cordis.patch.yml', 'credentials.json', 'session.jsonl']) assert.equal(await readFile(join(f.root, name), 'utf8'), 'keep');
  assert.equal(await readFile(join(f.root, '.plugin-data', 'other-plugin', 'keep'), 'utf8'), 'other');
  assert.equal((await watcher).records.length, 0);
  const empty = await f.history.read(String(exec.agent.session.id)); assert(empty.closed); assert.equal(empty.records.length, 0);
  assert.equal((await f.history.read('cold-session')).records.length, 0);
  record.attempt({ outcome: 'allow' }); record.finish('allow'); f.journal.write({ outcome: 'late' });
  assert.equal(f.history.start(exec), undefined); await f.history.close(); await f.journal.close();
  await assert.rejects(access(f.data), { code: 'ENOENT' });
  await assert.rejects(f.cleanup.clean('browser', { token: scope.token, confirmation: 'DELETE' }), { code: 'CONFIRMATION_REQUIRED' });
});

test('cleanup rejects wrong confirmation, peer, expiry and cancellation without stopping or deleting', async t => {
  const f = await setup(t); const scope = await f.cleanup.prepare('browser');
  for (const [peer, input] of [['browser', { token: scope.token, confirmation: 'delete' }], ['api', { token: scope.token, confirmation: 'DELETE' }], ['browser', { token: 'wrong', confirmation: 'DELETE' }]])
    await assert.rejects(f.cleanup.clean(peer, input), { code: 'CONFIRMATION_REQUIRED' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.cleanup.clean('browser', { token: scope.token, confirmation: 'DELETE' }, controller.signal), { code: 'CANCELLED' });
  let clock = 0;
  const expired = createDataCleanup({ profileHome: f.root, history: f.history, journal: f.journal, stop: () => { throw Error('must not stop'); }, now: () => clock });
  const old = await expired.prepare('browser'); clock = 60000;
  await assert.rejects(expired.clean('browser', { token: old.token, confirmation: 'DELETE' }), { code: 'CONFIRMATION_REQUIRED' });
  assert.equal(f.stops(), 0); await access(f.data);
});

test('cleanup rechecks scope after shutdown and refuses a replaced directory without touching linked data', async t => {
  const f = await setup(t), outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep'), 'private');
  // Junction creation on Windows does not require symlink privilege.
  let supported = true;
  const cleaner = createDataCleanup({ profileHome: f.root, history: f.history, journal: f.journal, stop: async () => {
    await rm(f.data, { recursive: true });
    try { await symlink(outside, f.data, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (error.code === 'EPERM') { supported = false; return; } throw error; }
  } });
  const scope = await cleaner.prepare('browser');
  const run = cleaner.clean('browser', { token: scope.token, confirmation: 'DELETE' });
  if (supported) await assert.rejects(run, { code: 'UNSAFE_PATH' }); else await run;
  assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'private');
});

test('cleanup reports absent profile, serializes destructive work, and leaves review stopped after failure', async t => {
  const f = await setup(t);
  await assert.rejects(createDataCleanup({ stop() {} }).prepare('browser'), { code: 'NO_PROFILE' });
  const blocker = Promise.withResolvers(); let called = 0;
  const cleanup = createDataCleanup({ profileHome: f.root, journal: f.journal, history: f.history, stop: async () => { called++; await blocker.promise; throw Error('shutdown failed'); } });
  const preview = await cleanup.prepare('browser');
  const operation = cleanup.clean('browser', { token: preview.token, confirmation: 'DELETE' });
  await assert.rejects(cleanup.prepare('browser'), { code: 'BUSY' });
  blocker.resolve(); await assert.rejects(operation, /shutdown failed/);
  assert(cleanup.stopped); assert(!cleanup.cleaned); assert.equal(called, 1); await access(f.data);
});

test('interrupted staging is included in preview and removed on a fresh confirmed cleanup', async t => {
  const f = await setup(t); const staging = join(f.root, '.auto-review-desktop-cleanup');
  await mkdir(staging); await writeFile(join(staging, 'leftover.jsonl'), 'interrupted');
  const preview = await f.cleanup.prepare('browser');
  assert.deepEqual(preview.targets, [f.data, staging]);
  const result = await f.cleanup.clean('browser', { token: preview.token, confirmation: 'DELETE' });
  assert(result.cleaned); await assert.rejects(access(staging), { code: 'ENOENT' }); await assert.rejects(access(f.data), { code: 'ENOENT' });
  const empty = await f.cleanup.prepare('browser'); assert.equal(empty.files, 0); assert(!empty.exists);
  assert((await f.cleanup.clean('browser', { token: empty.token, confirmation: 'DELETE' })).cleaned);
});

test('a linked plugin-data ancestor refuses preview and preserves the external target', async t => {
  const f = await setup(t), outside = join(f.root, 'outside-data');
  await mkdir(outside); await writeFile(join(outside, 'keep'), 'outside');
  const parent = join(f.root, '.plugin-data'); await rm(parent, { recursive: true });
  await symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.cleanup.prepare('browser'), { code: 'UNSAFE_PATH' });
  assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'outside'); assert.equal(f.stops(), 0);
});

test('cancellation failure still downgrades sessions and prevents cleanup success', async t => {
  const f = await setup(t), review = fixture();
  let cancellations = 0;
  review.ctx.agents = { get() { return { cancel() { if (++cancellations === 1) throw Error('cancel failed'); } }; } };
  const gate = createReviewGate(review.ctx, review.readConfig);
  const cleanup = createDataCleanup({ profileHome: f.root, journal: f.journal, history: f.history, stop: () => gate.close({ strict: true }) });
  const preview = await cleanup.prepare('browser');
  await assert.rejects(cleanup.clean('browser', { token: preview.token, confirmation: 'DELETE' }), { code: 'STOP_FAILED' });
  assert(review.events.some(e => e.type === 'sandbox/mode' && e.data.mode === 'workspace-write'));
  assert(review.events.some(e => e.type === 'approval/policy' && e.data.policy === 'ask'));
  assert(!cleanup.cleaned); await access(f.data);
  const retry = await cleanup.prepare('browser');
  assert((await cleanup.clean('browser', { token: retry.token, confirmation: 'DELETE' })).cleaned);
  assert.equal(cancellations, 2);
});

test('concurrent ordinary close and purge publish empty final history to pending readers', async t => {
  const f = await setup(t), exec = fixture().exec; f.history.start(exec);
  const first = await f.history.read(String(exec.agent.session.id));
  const pending = f.history.watch(String(exec.agent.session.id), first.revision);
  const purged = f.history.purge(); const closed = f.history.close();
  await Promise.all([purged, closed]); const last = await pending;
  assert.equal(last.records.length, 0); assert(last.closed);
});

test('unresponsive shutdown times out without deleting files or allowing late persistence', async t => {
  const f = await setup(t); const blocked = Promise.withResolvers();
  const cleanup = createDataCleanup({ profileHome: f.root, journal: f.journal, history: f.history, stopTimeoutMs: 10, stop: () => blocked.promise });
  const preview = await cleanup.prepare('browser');
  await assert.rejects(cleanup.clean('browser', { token: preview.token, confirmation: 'DELETE' }), { code: 'STOP_TIMEOUT' });
  assert(cleanup.stopped); assert(!cleanup.cleaned); await access(f.data);
  f.journal.write({ late: true }); assert.equal(f.history.start(fixture().exec), undefined);
  blocked.resolve();
  const retry = await cleanup.prepare('browser'); await cleanup.clean('browser', { token: retry.token, confirmation: 'DELETE' });
  await assert.rejects(access(f.data), { code: 'ENOENT' });
});

test('a stopped review gate does not resume after enhanced mode is selected again', async () => {
  const f = fixture(); const gate = createReviewGate(f.ctx, f.readConfig); await gate.close();
  f.setPreset('auto-review-desktop'); f.add('sandbox/mode', { mode: 'danger-full-access' });
  assert.equal((await gate.gate(f.exec, f.next)).kind, 'deny'); assert.equal(f.requests.length, 0);
});
