import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
function pluginOf() {
  let plugin;
  const React = { createElement(type, props, ...children) { return { type, props: { ...props, children: children.flat(Infinity).filter(item => item != null) } }; }, useSyncExternalStore(_subscribe, get) { return get(); }, Fragment: 'fragment' };
  vm.runInNewContext(source, { AbortController, window: { __ModuleLoader__: { load(value) { plugin = value.factory(id => id === 'react' ? React : {}); } } } });
  return plugin;
}
// Exercise the shipped native one-shot object, not a permissive answer mock.
function pendingType() {
  const nativeSource = readFileSync(new URL('../runtime-test/dsh/node_modules/@deepseek-ai/dsh-client-ui-approval/lib/client.js', import.meta.url), 'utf8');
  let exports;
  vm.runInNewContext(nativeSource.replace('exports.apply = apply;', 'exports.PendingApproval = PendingApproval; exports.apply = apply;'), { window: { __ModuleLoader__: { load(value) { exports = value.factory(() => ({})); } } } });
  return exports.PendingApproval;
}
const NativePending = pendingType();
function store(value) {
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, set(next) { value = next; for (const listener of listeners) listener(); }, listeners };
}
function fixture(readCall = async entry => ({ arguments: JSON.stringify({ command: `exact ${entry.request.callId}` }) })) {
  const plugin = pluginOf();
  const list = store({ byId: {
    root: { id: 'root', displayTitle: 'Main' }, other: { id: 'other' },
    child: { id: 'child', parentId: 'root', origin: 'subagent', displayTitle: 'Worker', projectionValues: { permissions: { currentValue: 'auto-review-desktop' } } },
    grandchild: { id: 'grandchild', parentId: 'child', origin: 'subagent', projectionValues: { permissions: { currentValue: 'auto-review-workspace' } } },
    ordinary: { id: 'ordinary', parentId: 'root', origin: 'subagent', projectionValues: { permissions: { currentValue: 'workspace-write' } } },
  } });
  const status = store(new Map()), sessions = { list };
  const collector = plugin.createApprovalCollector(sessions, status, readCall);
  const send = (id, callId = 'same-call', signal) => {
    const request = new NativePending(id, { toolName: 'pwsh', callId, signal, reason: 'Exact approval reason' });
    status.set(new Map([...status.getSnapshot(), [id, { pendingInteraction: request }]]));
    return request;
  };
  return { plugin, collector, list, status, sessions, send };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('native collector preserves every newly published same-child request in receipt order', async () => {
  const f = fixture();
  const a = f.send('child', 'a'), b = f.send('grandchild', 'b'), c = f.send('child', 'c');
  await flush();
  assert.deepEqual(Array.from(f.collector.getSnapshot(), entry => [entry.rootId, entry.sessionId, entry.request.callId]), [['root', 'child', 'a'], ['root', 'grandchild', 'b'], ['root', 'child', 'c']]);
  const [first] = f.collector.getSnapshot();
  assert.equal(await f.collector.answer(first, 'allowed-once'), true);
  assert.equal(await a.result, 'allowed-once');
  assert.equal(await f.collector.answer(first, 'allowed-once'), false);
  assert.equal(b.answerable, true); assert.equal(c.answerable, true);
  assert.deepEqual(Array.from(f.collector.getSnapshot(), entry => entry.request.callId), ['b', 'c']);
  b.answer('rejected'); c.answer('rejected'); await flush(); f.collector.dispose();
});

test('native request object identity keeps equal call ids independent and cancels exactly one', async () => {
  const f = fixture(), cancel = new AbortController();
  const a = f.send('child', 'identical', cancel.signal), b = f.send('grandchild', 'identical');
  await flush();
  const aResult = a.result.catch(() => 'cancelled');
  cancel.abort(); await flush();
  assert.equal(await aResult, 'cancelled');
  assert.equal(f.collector.getSnapshot().length, 1);
  assert.equal(f.collector.getSnapshot()[0].request, b);
  assert.equal(b.answerable, true);
  await f.collector.answer(f.collector.getSnapshot()[0], 'rejected');
  assert.equal(await b.result, 'rejected'); f.collector.dispose();
});

test('aggregate grants require complete matching call details and share a single answer lock', async () => {
  let resolveCall;
  const f = fixture(() => new Promise(resolve => { resolveCall = resolve; }));
  const request = f.send('child'), entry = f.collector.getSnapshot()[0];
  assert.equal(await f.collector.answer(entry, 'allowed-once'), false);
  assert.equal(request.answerable, true);
  resolveCall({ arguments: '{"command":"full untrimmed action"}' }); await flush();
  const results = await Promise.all([f.collector.answer(entry, 'allowed-once'), f.collector.answer(entry, 'rejected')]);
  assert.deepEqual(results, [true, false]);
  assert.equal(await request.result, 'allowed-once'); f.collector.dispose();
});

test('collector unload cancels only detail reads and leaves native requests answerable', async () => {
  let signal;
  const f = fixture((_entry, inputSignal) => { signal = inputSignal; return new Promise(() => {}); });
  const request = f.send('child');
  f.collector.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(request.answerable, true);
  assert.equal(f.status.listeners.size, 0); assert.equal(f.list.listeners.size, 0);
  assert.equal(f.collector.getSnapshot().length, 0);
  request.answer('rejected'); assert.equal(await request.result, 'rejected');
});

test('ordinary root and ordinary child approvals stay native and ancestry never crosses roots', async () => {
  const f = fixture();
  const ordinary = f.send('ordinary'), root = f.send('root'), child = f.send('child'); await flush();
  assert.equal(f.collector.getSnapshot().length, 1);
  const props = { collector: f.collector, sessions: f.sessions, t: key => key, resolveReason: reason => reason.en };
  assert.equal(f.plugin.ChildApprovalSummary({ ...props, sessionId: 'other' }), null);
  assert.equal(f.plugin.ChildApprovalSummary({ ...props, sessionId: 'child' }), null);
  assert.equal(f.plugin.ChildApprovalSummary({ ...props, sessionId: 'root' }).type, 'section');
  for (const request of [ordinary, root, child]) request.answer('rejected'); await flush(); f.collector.dispose();
});

test('hidden native request reappears after collector reload and is safely recovered', async () => {
  const f = fixture();
  const earlier = f.send('child', 'earlier'), newest = f.send('child', 'newest'); await flush();
  f.collector.dispose();
  const next = f.plugin.createApprovalCollector(f.sessions, f.status, async () => ({ arguments: '{}' })); await flush();
  assert.deepEqual(Array.from(next.getSnapshot(), entry => entry.request.callId), ['newest']);
  newest.answer('rejected'); await flush();
  // Native ui-session republishes the previously covered request after newest settles.
  f.status.set(new Map([['child', { pendingInteraction: earlier }]])); await flush();
  assert.deepEqual(Array.from(next.getSnapshot(), entry => entry.request.callId), ['earlier']);
  earlier.answer('rejected'); await flush(); next.dispose();
});

test('original call detail reader uses exact child address call id and tool name', async () => {
  const plugin = pluginOf(); let requested;
  const entry = { sessionId: 'child', request: { callId: 'call', toolName: 'pwsh' } };
  const ctx = { sessions: { binding: () => ({ session: { getSnapshot: () => ({ sessionId: 'child', subagent: { address: { parentSessionId: 'root', childSessionId: 'child', mode: 'continuable' } } }) } }) }, remote: { session: { async events(request) { requested = request; return { records: [
    { event: { type: 'step/start', data: { turn: 1, step: 1 } } },
    { event: { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call', name: 'pwsh', arguments: '{"command":"correct"}' } } },
    { event: { type: 'tool/call', data: { turn: 1, step: 1, callId: 'wrong-tool', name: 'other', arguments: 'wrong' } } },
    { event: { type: 'tool/call', data: { turn: 1, step: 1, callId: 'other-call', name: 'pwsh', arguments: 'wrong' } } },
  ] }; } } } };
  const result = await plugin.readApprovalCall(ctx, entry, new AbortController().signal);
  assert.equal(result.arguments, '{"command":"correct"}');
  assert.equal(requested.address.kind, 'subagent'); assert.equal(requested.address.parentSessionId, 'root');
});

test('PTC detail reader binds inner calls to the exact open step parent and root', async () => {
  const plugin = pluginOf();
  const event = (type, data) => ({ event: { type, data } });
  const start = event('step/start', { turn: 4, step: 2 });
  const root = event('tool/call', { turn: 4, step: 2, callId: 'outer', name: 'run_code', arguments: '{"code":"await pwsh()"}' });
  const args = { command: 'complete untrimmed action', sandbox_permissions: 'danger-full-access', justification: 'specific operation' };
  const inner = event('tool/ptc-dispatch-start', { rootCallId: 'outer', parentCallId: 'outer', subCallId: 'outer:ptc:1', name: 'pwsh', arguments: args });
  let records = [start, root, inner];
  const entry = { sessionId: 'child', request: { callId: 'outer:ptc:1', toolName: 'pwsh' } };
  const ctx = { sessions: { binding: () => ({ session: { getSnapshot: () => ({ sessionId: 'child', subagent: { address: { parentSessionId: 'root', childSessionId: 'child', mode: 'continuable' } } }) } }) }, remote: { session: { events: async () => ({ records }) } } };
  const read = () => plugin.readApprovalCall(ctx, entry, new AbortController().signal);
  assert.deepEqual(JSON.parse((await read()).arguments), args);
  records = [start, root, { event: { ...inner.event, data: { ...inner.event.data, parentCallId: 'another-parent' } } }];
  assert.equal(await read(), undefined);
  records = [start, root, { event: { ...inner.event, data: { ...inner.event.data, rootCallId: 'another-root' } } }];
  assert.equal(await read(), undefined);
  records = [start, root, inner, event('step/end', { turn: 4, step: 2 })];
  assert.equal(await read(), undefined);
  records = [start, root, inner, event('step/start', { turn: 4, step: 3 }), inner];
  assert.equal(await read(), undefined);
  records = [start, root, inner, event('tool/ptc-dispatch', { subCallId: 'outer:ptc:1' })];
  assert.equal(await read(), undefined);
  records = [start, root, inner, inner];
  assert.equal(await read(), undefined);
  records = [root, inner];
  assert.equal(await read(), undefined);
});

test('PTC nested transports preserve their chain and reject ordinary-call or step mismatches', async () => {
  const plugin = pluginOf(), ev = (type, data) => ({ event: { type, data } });
  const start = ev('step/start', { turn: 2, step: 1 });
  const outer = ev('tool/call', { turn: 2, step: 1, callId: 'root-call', name: 'run_code', arguments: '{}' });
  const nested = ev('tool/ptc-dispatch-start', { rootCallId: 'root-call', parentCallId: 'root-call', subCallId: 'nested', name: 'run_code', arguments: { code: 'inner()' } });
  const inner = ev('tool/ptc-dispatch-start', { rootCallId: 'root-call', parentCallId: 'nested', subCallId: 'deep', name: 'write', arguments: { file_path: 'exact.txt', content: 'full text' } });
  let records = [start, outer, nested, inner];
  const ctx = { sessions: { binding: () => ({ session: { getSnapshot: () => ({ sessionId: 'child', subagent: { address: { parentSessionId: 'root', childSessionId: 'child', mode: 'continuable' } } }) } }) }, remote: { session: { events: async () => ({ records }) } } };
  const entry = { sessionId: 'child', request: { callId: 'deep', toolName: 'write' } };
  assert.equal(JSON.parse((await plugin.readApprovalCall(ctx, entry)).arguments).content, 'full text');
  records = [start, { event: { ...outer.event, data: { ...outer.event.data, step: 0 } } }, nested, inner];
  assert.equal(await plugin.readApprovalCall(ctx, entry), undefined);
  records = [start, { event: { ...outer.event, data: { ...outer.event.data, name: 'pwsh' } } }, nested, inner];
  assert.equal(await plugin.readApprovalCall(ctx, entry), undefined);
  records = [start, outer, nested, inner];
  assert.equal(await plugin.readApprovalCall(ctx, { ...entry, request: { ...entry.request, toolName: 'pwsh' } }), undefined);
});

test('denial fallback and child human approval settings have independent strict defaults', () => {
  const plugin = pluginOf(), draft = plugin.draftOf();
  assert.equal(draft.denialPolicy, 'deny'); assert.equal(draft.subagentApproval, 'inherit');
  assert.equal(plugin.validateDraft({ ...draft, denialPolicy: 'allow' }, []).denialPolicy, 'invalidDecisionPolicy');
  assert.equal(plugin.validateDraft({ ...draft, subagentApproval: 'ask' }, []).subagentApproval, 'invalidSubagentApproval');
  assert.equal(plugin.validateDraft({ ...draft, denialPolicy: 'ask', subagentApproval: 'deny' }, []).denialPolicy, undefined);
  for (const language of ['zh', 'en']) {
    assert.ok(plugin.permissionDictionaries[language].subagentHelp);
    assert.ok(plugin.permissionDictionaries[language].childApprovalsHelp);
  }
});


test('root approval details use a session address and preserve full native and PTC arguments', async () => {
  const plugin = pluginOf(), ev = (type, data) => ({ event: { type, data } });
  const large = 'complete content\n'.repeat(1000);
  let records = [ev('step/start', { turn: 5, step: 1 }), ev('tool/call', { turn: 5, step: 1, callId: 'write-1', name: 'write', arguments: JSON.stringify({ file_path: 'C:\\outside\\exact.txt', content: large }) })];
  let address;
  const ctx = { sessions: { binding: () => ({ session: { getSnapshot: () => ({ sessionId: 'root', subagent: null }) } }) }, remote: { session: { events: async request => { address = request.address; return { records }; } } } };
  const entry = { sessionId: 'root', request: { callId: 'write-1', toolName: 'write', answerable: true } };
  const result = await plugin.readApprovalCall(ctx, entry);
  assert.equal(address.kind, 'session'); assert.equal(address.sessionId, 'root');
  assert.equal(JSON.parse(result.arguments).content, large);
  records = [ev('step/start', { turn: 5, step: 2 }), ev('tool/call', { turn: 5, step: 2, callId: 'transport', name: 'run_code', arguments: '{}' }), ev('tool/ptc-dispatch-start', { rootCallId: 'transport', parentCallId: 'transport', subCallId: 'inner', name: 'edit', arguments: { file_path: 'exact.txt', old_string: large, new_string: 'replacement' } })];
  const inner = await plugin.readApprovalCall(ctx, { sessionId: 'root', request: { callId: 'inner', toolName: 'edit', answerable: true } });
  assert.equal(JSON.parse(inner.arguments).old_string, large);
  assert.equal(await plugin.readApprovalCall(ctx, { sessionId: 'wrong-root', request: entry.request }), undefined);
});

test('native detail rendering shows complete identity and arguments without repeating the native reason or buttons', () => {
  const plugin = pluginOf();
  const nodes = root => root && typeof root === 'object' ? [root, ...(root.props?.children ?? []).flatMap(nodes)] : [];
  const text = root => typeof root === 'string' ? root : root?.props ? root.props.children.map(text).join(' ') : '';
  for (const reason of ['Outside workspace', 'Reviewer denied exact action', 'Review could not complete', 'Native escalation']) {
    const request = { toolName: 'write', callId: 'exact-call', reason };
    const tree = plugin.ApprovalDetailBody({ request, detail: { status: 'ready', call: { arguments: '{"file_path":"exact.txt","content":"all content"}' } }, t: key => key, resolveReason: value => value.en });
    assert(text(tree).includes('exact-call')); assert(text(tree).includes('write')); assert(!text(tree).includes(reason)); assert(text(tree).includes('all content'));
    assert.equal(nodes(tree).filter(node => node.type === 'button').length, 0);
  }
  const failed = plugin.ApprovalDetailBody({ request: { toolName: 'pwsh', callId: 'missing' }, detail: { status: 'missing' }, t: key => key, resolveReason: () => '', retry() {} });
  assert(text(failed).includes('approvalMissing'));
  assert.deepEqual(nodes(failed).filter(node => node.type === 'button').map(node => text(node)), ['childApprovalRetry']);
});

test('detail request cancellation and unmount reject late results without touching native answers', async () => {
  const plugin = pluginOf();
  for (const end of ['cancel', 'unmount', 'answer']) {
    let finish, seenSignal; const updates = [];
    const controller = new AbortController();
    const request = new NativePending('root', { toolName: 'write', callId: 'call', signal: controller.signal });
    request.result.catch(() => {});
    const ctx = { sessions: { binding: () => ({ session: { getSnapshot: () => ({ sessionId: 'root', subagent: null }) } }) }, remote: { session: { events: async (_request, signal) => { seenSignal = signal; return await new Promise(resolve => { finish = resolve; }); } } } };
    const dispose = plugin.loadApprovalDetail(ctx, { sessionId: 'root', request }, value => updates.push(value));
    await flush();
    if (end === 'cancel') controller.abort();
    if (end === 'unmount') dispose();
    if (end === 'answer') await request.answer('rejected');
    await flush();
    assert(seenSignal.aborted);
    finish({ records: [{ event: { type: 'step/start', data: { turn: 1, step: 1 } } }, { event: { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call', name: 'write', arguments: '{"content":"late-secret"}' } } }] });
    await flush(); await flush();
    assert(!updates.some(value => value.status === 'ready'));
    if (end === 'unmount') { assert(request.answerable); await request.answer('rejected'); }
    else assert.equal(updates.at(-1).status, 'withdrawn');
    dispose();
  }
});

test('detail load failures are explicit and disposed previous requests cannot replace newer details', async () => {
  const plugin = pluginOf(), states = [];
  const make = id => new NativePending('root', { toolName: 'write', callId: id });
  const a = make('a'), b = make('b'); let finishA;
  const ctx = { sessions: { binding: () => ({ session: { getSnapshot: () => ({ sessionId: 'root', subagent: null }) } }) }, remote: { session: { events: async () => await new Promise(resolve => { finishA = resolve; }) } } };
  const removeA = plugin.loadApprovalDetail(ctx, { sessionId: 'root', request: a }, value => states.push(value));
  await flush(); removeA();
  ctx.remote.session.events = async () => { throw new Error('History unavailable'); };
  const removeB = plugin.loadApprovalDetail(ctx, { sessionId: 'root', request: b }, value => states.push(value));
  await flush(); await flush();
  assert.equal(states.at(-1).request, b); assert.equal(states.at(-1).status, 'error'); assert(states.at(-1).error.includes('History unavailable'));
  finishA({ records: [] }); await flush(); await flush();
  assert.equal(states.at(-1).request, b);
  removeB(); await a.answer('rejected'); await b.answer('rejected');
});

test('native read-only settings strictly default to all native paths and retain an outside-approval preference', () => {
  const plugin = pluginOf(), draft = plugin.draftOf();
  assert.equal(draft.workspaceReads, 'allow');
  assert.equal(plugin.draftOf({ workspaceReads: 'approve' }).workspaceReads, 'approve');
  assert.equal(plugin.validateDraft({ ...draft, workspaceReads: 'deny' }, []).workspaceReads, 'invalidWorkspaceReads');
  assert.equal(plugin.validateDraft({ ...draft, workspaceReads: 'approve' }, []).workspaceReads, undefined);
  for (const lang of ['en', 'zh']) {
    const copy = plugin.permissionDictionaries[lang];
    for (const tool of ['read', 'read_image', 'glob', 'grep', 'MCP']) assert(copy.workspaceReadsHelp.includes(tool));
    assert(copy.workspaceReadsAllow); assert(copy.workspaceReadsApprove);
  }
});


test('native detail slot enhances exact selected requests and preserves shipped fallback and disposal', async () => {
  const plugin = pluginOf(), statuses = store(new Map()), list = store({ byId: { root: { projectionValues: { permissions: { currentValue: 'auto-review-workspace' } } } } });
  const native = () => 'shipped command';
  const shipped = { component: native, options: { priority: 0 } };
  const entries = [shipped], listeners = new Set(); let registration, slotDisposed = false;
  const emit = () => { for (const listener of listeners) listener(); };
  const ctx = {
    inject(_names, callback) { return callback(this); },
    sessions: { list, binding: () => ({ session: { getSnapshot: () => ({ sessionId: 'root', subagent: null }) } }) },
    uiSession: { sessionStatus: statuses }, remote: { session: { events: async () => ({ records: [] }) } },
    locale: { bind: () => key => key, resolveText: value => value.en },
    slots: {
      inject(name, callback) { assert.equal(name, 'conversation.approval.detail'); return callback(); },
      entries: () => entries,
      subscribe(_name, callback) { listeners.add(callback); return () => listeners.delete(callback); },
      register(options, component) {
        registration = { options, component }; entries.push(registration); emit();
        return () => { entries.splice(entries.indexOf(registration), 1); slotDisposed = true; emit(); };
      },
    },
  };
  const dispose = plugin.registerApprovalDetails(ctx);
  assert.equal(registration.options.priority, -1);
  const request = new NativePending('root', { toolName: 'write', callId: 'exact', reason: 'outside request' });
  statuses.set(new Map([['root', { pendingInteraction: request }]]));
  const enhanced = registration.component({ sessionId: 'root', callId: 'exact' });
  assert.equal(enhanced.type, plugin.NativeApprovalDetail); assert.equal(enhanced.props.request, request);
  assert.equal(registration.component({ sessionId: 'root', callId: 'other' }).type, native);
  assert.equal(registration.component({ sessionId: 'other', callId: 'exact' }).type, native);
  list.set({ byId: { root: { projectionValues: { permissions: { currentValue: 'workspace-write' } } } } });
  assert.equal(registration.component({ sessionId: 'root', callId: 'exact' }).type, native);
  list.set({ byId: { root: { projectionValues: { permissions: { currentValue: 'auto-review-desktop' } } } } });
  assert.equal(registration.component({ sessionId: 'root', callId: 'exact' }).type, plugin.NativeApprovalDetail);
  dispose(); assert(slotDisposed); assert.equal(entries.length, 1); assert.equal(listeners.size, 0);
  assert(request.answerable); await request.answer('rejected');
});
