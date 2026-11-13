import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as cordis from '@deepseek-ai/cordis';
import { createReviewHistory } from '../src/history.js';
import { fixture } from './helpers.mjs';

// The exact Desktop baseline SlotCore is bundled into the shipped web shell,
// not published as an independently importable Node module. Execute that class
// verbatim; this fixture never renders React or substitutes a Slot registry.
function loadDesktopSlotCore() {
  const code = readFileSync(new URL('../runtime-test/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BgUyXZcc.js', import.meta.url), 'utf8');
  const start = code.indexOf('var OI=class{records=new Map');
  const end = code.indexOf(';const MI=Object.freeze', start);
  assert(start >= 0 && end > start, 'Desktop 0.2.2-rc.1 baseline SlotCore must be available');
  return vm.runInNewContext(`const b1=Object.freeze([]);${code.slice(start, end)};OI`, { queueMicrotask, console });
}
function loadRegistry(SlotCore) {
  let registry;
  const React = { Component: class {}, createContext: value => ({ value }) };
  const modules = {
    react: React, 'react-dom': {}, 'react-dom/client': {}, 'react/jsx-runtime': {},
    '@deepseek-ai/cordis': cordis,
    '@deepseek-ai/dsh-client-ui-slots': { SlotCore, SlotOwnershipError: Error, StaleAuthorizationError: Error },
  };
  vm.runInNewContext(readFileSync(new URL('../runtime-test/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js', import.meta.url), 'utf8'), {
    queueMicrotask, console, window: { __ModuleLoader__: { load(def) { registry = def.factory(name => { assert(name in modules, name); return modules[name]; }).SlotRegistry; } } },
  });
  return registry;
}
function loadPlugin() {
  let plugin;
  vm.runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {
    AbortController, console, window: { __ModuleLoader__: { load(def) { plugin = def.factory(() => ({})); } } },
  });
  return plugin;
}
function loadConversationEventRegistry() {
  const code = readFileSync(new URL('../runtime-test/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js', import.meta.url), 'utf8');
  const start = code.indexOf('var ConversationDefinitionRegistry = class');
  const assertion = code.indexOf('function assertDefinitionTarget(', start);
  const end = code.indexOf('\n\t\t//#endregion', assertion);
  assert(start >= 0 && end > assertion);
  return vm.runInNewContext(`${code.slice(start, end)};ConversationEventRegistry`, {
    _deepseek_ai_cordis: cordis,
    _deepseek_ai_dsh_client_store: { notifySubscribers: listeners => { for (const listener of listeners) listener(); } },
  });
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function mountNative(ctx, Registry) {
  new Registry(ctx);
  ctx.slots.register({ name: 'root', children: {
    'conversation.chat.node': { kind: 'keyed', scope: 'session' },
    'conversation.view': { kind: 'list', scope: 'session' },
    'conversation.composer.dock': { kind: 'list', scope: 'session' },
  } }, () => null);
  ctx.slots.register({ name: 'conversation.chat.node', key: 'tool-call', locale: 'conversation', children: {
    'tool.call.toolview': { kind: 'keyed', scope: 'session' },
  } }, () => null);
  ctx.slots.register({ name: 'conversation.view', id: 'trajectory', order: 10, locale: 'trajectory', children: {
    'conversation.trajectory.images': { kind: 'single', scope: 'session' },
  } }, () => null);
}

test('actual Desktop SlotCore rejects a shadow registration that repeats native child declarations', () => {
  const Core = loadDesktopSlotCore(), core = new Core();
  core.register({ name: 'root', children: { parent: { kind: 'keyed', scope: 'session' } } }, () => null);
  core.register({ name: 'parent', key: 'tool-call', children: { child: { kind: 'keyed', scope: 'session' } } }, () => null);
  const original = core.entries('parent')[0];
  assert.throws(() => core.register({ name: 'parent', key: 'tool-call', priority: -1, children: original.children }, () => null), /slot "child" is already declared/);
  assert.equal(core.entries('parent').length, 1);
  // entries() deliberately includes shadowed registrations; entriesOfSlot()
  // chooses one winner. This rules out the alternative "active-only" theory.
  core.register({ name: 'parent', key: 'tool-call', priority: -1 }, () => null);
  assert.equal(core.entries('parent').length, 2);
  assert.equal(core.entriesOfSlot('parent').length, 1);
});

test('real Cordis, SlotRegistry and ConversationEventRegistry register independent history entries without shadowing native owners', async () => {
  const ctx = new cordis.Context(), Registry = loadRegistry(loadDesktopSlotCore());
  mountNative(ctx, Registry);
  const EventRegistry = loadConversationEventRegistry(), events = new EventRegistry(ctx);
  ctx.provide('connection', {}); ctx.provide('uiConversation', { events }); ctx.provide('sessions', {}); ctx.provide('remote', {});
  const originalTool = ctx.slots.entries('conversation.chat.node').find(entry => entry.options.key === 'tool-call');
  const originalTrajectory = ctx.slots.entries('conversation.view').find(entry => entry.options.id === 'trajectory');
  const originalToolSpec = ctx.slots.spec('tool.call.toolview');
  const originalImageSpec = ctx.slots.spec('conversation.trajectory.images');
  const plugin = loadPlugin();
  const fiber = plugin.registerReviewHistory(ctx);
  await fiber; await settle();
  assert.equal(fiber.state, 2);
  assert(ctx.slots.entries('conversation.composer.dock').some(entry => entry.options.id === 'auto-review-history-status'));
  const usage = ctx.slots.entries('conversation.composer.dock').find(entry => entry.options.id === 'auto-review-usage');
  assert(usage); assert.equal(usage.options.order, 2); assert.equal(usage.children, undefined);
  const ownChat = ctx.slots.entries('conversation.chat.node').find(entry => entry.options.key === 'auto-review-call-status');
  const ownView = ctx.slots.entries('conversation.view').find(entry => entry.options.id === 'auto-review-trajectory');
  assert(ownChat); assert(ownView); assert.equal(ownChat.children, undefined); assert.equal(ownView.children, undefined);
  assert.equal(ctx.slots.entries('conversation.chat.node').find(entry => entry.options.key === 'tool-call'), originalTool);
  assert.equal(ctx.slots.entries('conversation.view').find(entry => entry.options.id === 'trajectory'), originalTrajectory);
  assert.equal(ctx.slots.spec('tool.call.toolview'), originalToolSpec);
  assert.equal(ctx.slots.spec('conversation.trajectory.images'), originalImageSpec);
  assert.equal(originalTrajectory.options.priority ?? 0, 0);
  const route = [...events.forEvent('tool/call')].find(item => item.definition.kind === 'auto-review-call-status');
  assert(route, 'actual event registry must route existing tool/call records to the new owned kind');
  const event = { type: 'tool/call', seq: 7, data: { callId: 'existing-root-call' } };
  const matched = route.match(event), start = { event, location: { kind: 'step', turn: 1, step: 1 } };
  assert.equal(matched.id, '7:existing-root-call'); assert.equal(matched.role, 'start');
  const state = route.definition.start({}, start);
  const node = route.definition.buildViewNode({ state, key: 'review:existing-root-call', id: matched.id, start, matches: [start] });
  assert.equal(node.kind, 'auto-review-call-status'); assert.equal(node.target, 'chat');
  assert.equal(node.data.root.callId, event.data.callId); assert.equal(node.anchorSeq, 7.01);
  await fiber.dispose(); await settle();
  assert(!ctx.slots.entries('conversation.composer.dock').some(entry => ['auto-review-history-status', 'auto-review-usage'].includes(entry.options.id)));
  assert(!ctx.slots.entries('conversation.chat.node').some(entry => entry.options.key === 'auto-review-call-status'));
  assert(!ctx.slots.entries('conversation.view').some(entry => entry.options.id === 'auto-review-trajectory'));
  assert.equal(events.entries().length, 0);
  assert.equal(ctx.slots.entries('conversation.chat.node')[0], originalTool);
  assert.equal(ctx.slots.entries('conversation.view')[0], originalTrajectory);
  assert.equal(ctx.slots.spec('tool.call.toolview'), originalToolSpec);
  assert.equal(ctx.slots.spec('conversation.trajectory.images'), originalImageSpec);
  await ctx.fiber.dispose();
});

test('client history store retrieves three preexisting actual Host history records including model verdicts', async () => {
  const history = createReviewHistory(undefined), f = fixture(), plugin = loadPlugin();
  for (let index = 0; index < 3; index++) {
    const exec = { ...f.exec, callId: `saved-call-${index}`, rootCallId: `saved-call-${index}` };
    const handle = history.start(exec);
    handle.attempt({ attempt: 1, model: 'actual-review-route', outcome: index === 1 ? 'deny' : 'allow', verdict: index === 1 ? { decision: 'deny', risk: 'high', reason: 'Persisted refusal reason' } : { decision: 'allow', risk: 'low' } });
    handle.finish(index === 1 ? 'deny' : 'allow');
  }
  await history.close();
  const calls = [];
  const store = plugin.createHistoryStore({ rpc: { async call(channel, endpoint, payload) {
    calls.push({ channel, endpoint, payload });
    return { ok: true, value: await history.read(payload.sessionId) };
  } } }, String(f.session.id));
  let unsubscribe;
  await new Promise(resolve => { unsubscribe = store.subscribe(resolve); });
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.records.length, 3); assert.equal(snapshot.summary.totals.records, 3); assert.equal(snapshot.summary.recordOutcomes.denied, 1);
  assert.equal(snapshot.records[1].attempts[0].verdict.reason, 'Persisted refusal reason');
  assert.equal(snapshot.loading, false); assert.equal(snapshot.error, null);
  assert.equal(calls.length, 1); assert.equal(calls[0].endpoint, 'history');
  unsubscribe(); store.dispose();
});
