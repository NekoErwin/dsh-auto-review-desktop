import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
function boot() {
  let plugin, definition;
  const state = [], effects = [], deps = [];
  let cursor = 0;
  const React = {
    Fragment: 'fragment',
    createElement(type, props, ...children) { return { type, props: { ...(props ?? {}), children: children.flat(Infinity).filter(value => value !== null && value !== undefined) } }; },
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useEffect(effect, next) { const i = cursor++; if (!deps[i] || next.some((value, at) => value !== deps[i][at])) { deps[i] = next; effects.push(effect); } },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
    useRef(initial) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
  };
  vm.runInNewContext(source, { AbortController, window: { __ModuleLoader__: { load(value) { definition = value; plugin = value.factory(id => { assert.equal(id, 'react'); return React; }); } } } });
  return { plugin, definition, render(props, component = plugin.SettingsSection) { cursor = 0; const node = component(props); while (effects.length) effects.shift()(); return node; } };
}
function nodes(root) { if (!root || typeof root !== 'object') return []; return [root, ...(root.props?.children ?? []).flatMap(nodes)]; }
function byId(root, id) { return nodes(root).find(node => node.props?.id === id); }
function propsOf(plugin) {
  let snapshot = { status: 'ready', value: plugin.draftOf(), revision: 7, writable: true };
  let mirrorSnapshot = { status: 'ready', view: {}, error: null };
  const operations = [];
  const form = {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    async mutate(ops, revision) { operations.push({ ops, revision }); assert.equal(revision, snapshot.revision); snapshot = { ...snapshot, revision: revision + 1, value: { ...snapshot.value, ...Object.fromEntries(ops.map(op => [op.path[0], op.value])) } }; return true; },
  };
  const catalog = { store: { getSnapshot: () => ({ status: 'ready', value: { groups: [{ id: 'configured', name: 'Configured provider', models: [{ id: 'reviewer', name: 'Reviewer', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }] }], failures: [] }, error: null }), subscribe: () => () => {} }, load: () => Promise.resolve(), refresh() {} };
  return { props: { form, mirror: { getSnapshot: () => mirrorSnapshot, subscribe: () => () => {}, load: () => Promise.resolve() }, catalog, t: (key, values) => values ? `${key}:${JSON.stringify(values)}` : key }, operations, change(value) { snapshot = { ...snapshot, ...value }; }, mirrorError(error) { mirrorSnapshot = { ...mirrorSnapshot, error }; } };
}

test('native bundle uses only host React and registers a settings menu contribution', () => {
  const { plugin, definition } = boot();
  assert.equal(definition.id, 'dsh-auto-review-desktop');
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale', 'configForms', 'modelDirectories', 'connection']);
  let registered;
  const context = { effect: fn => fn(), locale: { register: () => () => {}, bind: () => key => key },
    configForms: { whileServed(names, fn) { assert.deepEqual(Array.from(names), ['auto-review-desktop']); return fn(); } },
    slots: { inject(name, fn) { assert.equal(name, 'settings.section'); return fn(); }, register(spec, component) { registered = { spec, component }; return () => {}; } },
  };
  // Styles are the only DOM dependency during registration.
  const contextSource = source.replace('ctx.effect(() => installStyles(),', 'ctx.effect(() => (() => {}),');
  let registrationPlugin;
  vm.runInNewContext(contextSource, { window: { __ModuleLoader__: { load(value) { registrationPlugin = value.factory(() => ({})); } } } });
  registrationPlugin.apply(context);
  assert.equal(registered.spec.name, 'settings.section');
  assert.equal(registered.spec.id, 'auto-review-desktop');
  assert.equal(registered.spec.locale, 'autoReviewDesktop');
});

test('configuration helper rejects missing catalog models and mirrors host numeric ranges', () => {
  const { plugin } = boot();
  const draft = plugin.draftOf();
  assert.equal(Object.keys(plugin.validateDraft(draft, [])).length, 0);
  for (const [field, value] of [['timeoutMs', 180001], ['maxOutputTokens', 255], ['maxOutputTokens', 16385], ['maxRetries', 2]]) {
    assert.ok(plugin.validateDraft({ ...draft, [field]: value }, [])[field]);
  }
  assert.equal(plugin.validateDraft({ ...draft, routeMode: 'specific', provider: 'gone', model: 'gone' }, []).model, 'modelRequired');
  const choices = plugin.modelChoices({ groups: [{ id: 'p', name: 'P', models: [{ id: 'm', reasoning: { efforts: [{ id: 'low' }] } }] }] });
  assert.equal(plugin.validateDraft({ ...draft, routeMode: 'specific', provider: 'p', model: 'm', reasoningMode: 'specific', reasoningEffort: 'invalid' }, choices).reasoningEffort, 'effortMissing');
});

test('profile editor saves only changed fields using the original revision', async () => {
  const harness = boot(), io = propsOf(harness.plugin);
  harness.render(io.props);
  let page = harness.render(io.props);
  byId(page, 'ar-routeMode').props.onChange({ target: { value: 'specific' } });
  page = harness.render(io.props);
  assert.ok(byId(page, 'ar-model'));
  byId(page, 'ar-model').props.onChange({ target: { value: JSON.stringify(['configured', 'reviewer']) } });
  page = harness.render(io.props);
  await page.props.onSubmit({ preventDefault() {} });
  assert.equal(io.operations.length, 1);
  assert.equal(io.operations[0].revision, 7);
  assert.deepEqual(Array.from(io.operations[0].ops, op => op.path[0]), ['routeMode', 'provider', 'model']);
  page = harness.render(io.props);
  assert.ok(nodes(page).some(node => node.props?.children?.includes('saved')));
});

test('concurrent host configuration prevents overwriting and keeps the local draft', async () => {
  const harness = boot(), io = propsOf(harness.plugin);
  harness.render(io.props);
  let page = harness.render(io.props);
  byId(page, 'ar-timeoutMs').props.onChange({ target: { value: '12000' } });
  io.change({ revision: 8 });
  page = harness.render(io.props);
  assert.equal(byId(page, 'ar-timeoutMs').props.value, 12000);
  assert.ok(nodes(page).some(node => node.props?.children?.includes('conflict')));
  await page.props.onSubmit({ preventDefault() {} });
  assert.equal(io.operations.length, 0);
});

test('read-only profile cannot submit, and held mirror errors stay visible', async () => {
  const harness = boot(), io = propsOf(harness.plugin);
  io.change({ writable: false }); io.mirrorError('read failed');
  harness.render(io.props);
  const page = harness.render(io.props);
  assert.ok(nodes(page).some(node => node.props?.children?.includes('readOnly')));
  assert.ok(nodes(page).some(node => node.props?.children?.includes('reloadFailed read failed')));
  assert.equal(byId(page, 'ar-timeoutMs').props.disabled, true);
  await page.props.onSubmit({ preventDefault() {} });
  assert.equal(io.operations.length, 0);
});

function statusValue(overrides = {}, coverage = {}) {
  const reported = overrides.usageReported ?? 2;
  return { running: true, scope: 'process', audit: 'available',
    usageCoverage: { inputTokens: reported, outputTokens: reported, totalTokens: reported, cacheReadTokens: reported, cacheWriteTokens: 0, reasoningTokens: reported, ...coverage },
    totals: { attempts: 3, allows: 1, denies: 1, failures: 1, cancelled: 0, usageReported: reported, inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 10, cacheWriteTokens: 0, reasoningTokens: 8, ...overrides } };
}
test('usage card loads once, refreshes manually, and does not add reasoning to output', async () => {
  const harness = boot(); let calls = 0;
  const props = { connection: { rpc: { async call(channel, endpoint, payload, signal) {
    calls++; assert.equal(channel, '/auto-review-desktop'); assert.equal(endpoint, 'status'); assert.equal(Object.keys(payload).length, 0); assert.ok(signal instanceof AbortSignal);
    return { ok: true, value: statusValue() };
  } } }, t: key => key };
  harness.render(props, harness.plugin.UsageCard); await new Promise(resolve => setImmediate(resolve));
  let card = harness.render(props, harness.plugin.UsageCard);
  harness.render(props, harness.plugin.UsageCard);
  assert.equal(calls, 1);
  const output = nodes(card).find(node => node.type === 'dt' && node.props.children.includes('usageOutput'));
  assert.ok(output);
  assert.ok(nodes(card).some(node => node.type === 'dd' && node.props.children.includes('20')));
  assert.ok(!nodes(card).some(node => node.type === 'dt' && node.props.children.includes('reasoningTokens')));
  byId(card, 'ar-usage-refresh').props.onClick(); await new Promise(resolve => setImmediate(resolve));
  card = harness.render(props, harness.plugin.UsageCard);
  assert.equal(calls, 2);
  assert.ok(nodes(card).some(node => node.props?.children?.includes('usageNote')));
});

test('usage missing all provider reports displays unknown tokens', async () => {
  const harness = boot();
  const props = { connection: { rpc: { async call() { return { ok: true, value: statusValue({ usageReported: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }) }; } } }, t: key => key };
  harness.render(props, harness.plugin.UsageCard); await new Promise(resolve => setImmediate(resolve));
  const card = harness.render(props, harness.plugin.UsageCard);
  assert.equal(nodes(card).filter(node => node.type === 'dd' && node.props.children.includes('usageUnknown')).length, 3);
});

test('cache usage is unknown when other token fields were reported but cache was not', async () => {
  const harness = boot();
  const props = { connection: { rpc: { async call() { return { ok: true, value: statusValue({ cacheReadTokens: 0 }, { cacheReadTokens: 0 }) }; } } }, t: key => key };
  harness.render(props, harness.plugin.UsageCard); await new Promise(resolve => setImmediate(resolve));
  const card = harness.render(props, harness.plugin.UsageCard);
  const cacheRow = nodes(card).find(node => node.type === 'div' && node.props.children.some(child => child?.type === 'dt' && child.props.children.includes('usageCache')));
  assert.ok(cacheRow.props.children.some(child => child?.type === 'dd' && child.props.children.includes('usageUnknown')));
  const inputRow = nodes(card).find(node => node.type === 'div' && node.props.children.some(child => child?.type === 'dt' && child.props.children.includes('usageInput')));
  assert.ok(inputRow.props.children.some(child => child?.type === 'dd' && child.props.children.includes('100')));
});

test('a reported zero cache value remains a known zero', async () => {
  const harness = boot();
  const props = { connection: { rpc: { async call() { return { ok: true, value: statusValue({ cacheReadTokens: 0 }, { cacheReadTokens: 1 }) }; } } }, t: key => key };
  harness.render(props, harness.plugin.UsageCard); await new Promise(resolve => setImmediate(resolve));
  const card = harness.render(props, harness.plugin.UsageCard);
  const cacheRow = nodes(card).find(node => node.type === 'div' && node.props.children.some(child => child?.type === 'dt' && child.props.children.includes('usageCache')));
  assert.ok(cacheRow.props.children.some(child => child?.type === 'dd' && child.props.children.includes('0')));
});

test('usage RPC failure is visible and permits manual retry', async () => {
  const harness = boot();
  const props = { connection: { rpc: { async call() { return { ok: false, error: { code: 'FORBIDDEN', message: 'Owner access required' } }; } } }, t: key => key };
  harness.render(props, harness.plugin.UsageCard); await new Promise(resolve => setImmediate(resolve));
  const card = harness.render(props, harness.plugin.UsageCard);
  assert.ok(nodes(card).some(node => node.props?.role === 'alert' && node.props.children.some(text => typeof text === 'string' && text.includes('FORBIDDEN: Owner access required'))));
  assert.equal(byId(card, 'ar-usage-refresh').props.disabled, false);
});
