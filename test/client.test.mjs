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
    cloneElement(node, props, ...children) { return { ...node, props: { ...node.props, ...props, ...(children.length ? { children: children.flat(Infinity) } : {}) } }; },
    isValidElement: node => Boolean(node && typeof node === 'object' && 'type' in node && node.props),
    Children: { map(children, fn) { return (Array.isArray(children) ? children : [children]).flat(Infinity).map(fn); } },
    useRef(initial) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
  };
  const primitives = { Menu: 'native-menu', PermissionIconAutoReviewRegular: 'native-review-icon' };
  vm.runInNewContext(source, { AbortController, window: { __ModuleLoader__: { load(value) { definition = value; plugin = value.factory(id => { if (id === 'react') return React; assert.equal(id, '@deepseek-ai/dsh-client-ui-primitives'); return primitives; }); } } } });
  return { plugin, definition, React, primitives, render(props, component = plugin.SettingsSection) { cursor = 0; const node = component(props); while (effects.length) effects.shift()(); return node; } };
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
  const contextSource = source.replace('ctx.effect(() => installStyles(),', 'ctx.effect(() => (() => {}),')
    .replace('ctx.effect(() => registerPermissionPresentation(ctx),', 'ctx.effect(() => (() => {}),');
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

test('precise deletion checkbox defaults on, labels its help, and saves only its boolean change', async () => {
  const harness = boot(), io = propsOf(harness.plugin);
  assert.equal(harness.plugin.draftOf().preciseDeletion, true);
  harness.render(io.props);
  let page = harness.render(io.props);
  const checkbox = byId(page, 'ar-preciseDeletion');
  assert.equal(checkbox.type, 'input');
  assert.equal(checkbox.props.type, 'checkbox');
  assert.equal(checkbox.props.checked, true);
  assert.equal(checkbox.props.disabled, false);
  assert.ok(nodes(page).some(node => node.type === 'label' && node.props.htmlFor === checkbox.props.id && node.props.children.includes('preciseDeletion')));
  assert.equal(checkbox.props['aria-describedby'], 'ar-preciseDeletion-help');
  assert.ok(byId(page, checkbox.props['aria-describedby']).props.children.includes('preciseDeletionHelp'));
  checkbox.props.onChange({ target: { checked: false, value: 'on' } });
  page = harness.render(io.props);
  assert.equal(byId(page, 'ar-preciseDeletion').props.checked, false);
  assert.ok(nodes(page).some(node => node.props?.children?.includes('unsaved')));
  await page.props.onSubmit({ preventDefault() {} });
  assert.equal(io.operations.length, 1);
  assert.equal(io.operations[0].revision, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(io.operations[0].ops)), [{ op: 'set', path: ['preciseDeletion'], value: false }]);
  assert.equal(typeof io.operations[0].ops[0].value, 'boolean');
  page = harness.render(io.props);
  assert.equal(byId(page, 'ar-preciseDeletion').props.checked, false);
  assert.ok(nodes(page).some(node => node.props?.children?.includes('saved')));
});

test('saved false deletion protection is retained on initial load and unrelated saves', async () => {
  const harness = boot(), io = propsOf(harness.plugin);
  io.change({ value: { ...harness.plugin.draftOf(), preciseDeletion: false } });
  harness.render(io.props);
  let page = harness.render(io.props);
  assert.equal(byId(page, 'ar-preciseDeletion').props.checked, false);
  byId(page, 'ar-timeoutMs').props.onChange({ target: { value: '12000' } });
  page = harness.render(io.props);
  await page.props.onSubmit({ preventDefault() {} });
  assert.equal(io.operations.length, 1);
  assert.deepEqual(Array.from(io.operations[0].ops, op => op.path[0]), ['timeoutMs']);
  page = harness.render(io.props);
  assert.equal(byId(page, 'ar-preciseDeletion').props.checked, false);
});

test('invalid deletion protection values are rejected, shown, and cannot be saved', async () => {
  const harness = boot(), io = propsOf(harness.plugin), draft = harness.plugin.draftOf();
  for (const value of ['false', 'true', 0, 1, null, undefined, {}, []]) {
    assert.equal(harness.plugin.validateDraft({ ...draft, preciseDeletion: value }, []).preciseDeletion, 'invalidBoolean');
  }
  for (const value of [true, false]) {
    assert.equal(harness.plugin.validateDraft({ ...draft, preciseDeletion: value }, []).preciseDeletion, undefined);
  }
  io.change({ value: { ...draft, preciseDeletion: 'false' } });
  harness.render(io.props);
  let page = harness.render(io.props);
  const checkbox = byId(page, 'ar-preciseDeletion');
  assert.equal(checkbox.props['aria-invalid'], true);
  assert.equal(checkbox.props['aria-describedby'], 'ar-preciseDeletion-help ar-preciseDeletion-error');
  assert.ok(byId(page, 'ar-preciseDeletion-error').props.children.includes('invalidBoolean'));
  byId(page, 'ar-timeoutMs').props.onChange({ target: { value: '12000' } });
  page = harness.render(io.props);
  assert.equal(nodes(page).find(node => node.props?.type === 'submit').props.disabled, true);
  await page.props.onSubmit({ preventDefault() {} });
  assert.equal(io.operations.length, 0);
  for (const language of ['zh', 'en']) {
    assert.equal(typeof harness.plugin.permissionDictionaries[language].invalidBoolean, 'string');
    assert.ok(harness.plugin.permissionDictionaries[language].invalidBoolean.length > 0);
  }
  assert.equal(harness.plugin.permissionDictionaries.zh.preciseDeletion, '精确删除保护');
  assert.equal(harness.plugin.permissionDictionaries.en.preciseDeletion, 'Precise deletion protection');
});

test('workspace escalation defaults to human approval and saves only the outside-action policy', async () => {
  const harness = boot(), io = propsOf(harness.plugin);
  assert.equal(harness.plugin.draftOf().workspaceEscalation, 'ask');
  harness.render(io.props);
  let page = harness.render(io.props);
  const control = byId(page, 'ar-workspaceEscalation');
  assert.equal(control.type, 'select'); assert.equal(control.props.value, 'ask');
  assert.deepEqual(control.props.children.map(option => option.props.value), ['ask', 'review']);
  assert.equal(control.props['aria-describedby'], 'ar-workspaceEscalation-help');
  assert.equal(byId(page, 'ar-mode'), undefined);
  assert.equal(byId(page, 'ar-preset'), undefined);
  control.props.onChange({ target: { value: 'review' } });
  page = harness.render(io.props);
  await page.props.onSubmit({ preventDefault() {} });
  assert.equal(io.operations.length, 1); assert.equal(io.operations[0].revision, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(io.operations[0].ops)), [{ op: 'set', path: ['workspaceEscalation'], value: 'review' }]);
  page = harness.render(io.props); assert.equal(byId(page, 'ar-workspaceEscalation').props.value, 'review');
});

test('workspace escalation rejects unsupported values and retains a saved review preference', async () => {
  const harness = boot(), io = propsOf(harness.plugin), draft = harness.plugin.draftOf();
  for (const value of ['allow', 'deny', '', false, null, undefined, {}]) {
    assert.equal(harness.plugin.validateDraft({ ...draft, workspaceEscalation: value }, []).workspaceEscalation, 'invalidWorkspaceEscalation');
  }
  io.change({ value: { ...draft, workspaceEscalation: 'review' } });
  harness.render(io.props); let page = harness.render(io.props);
  assert.equal(byId(page, 'ar-workspaceEscalation').props.value, 'review');
  byId(page, 'ar-workspaceEscalation').props.onChange({ target: { value: 'allow' } });
  page = harness.render(io.props);
  assert.equal(byId(page, 'ar-workspaceEscalation').props['aria-invalid'], true);
  assert.ok(byId(page, 'ar-workspaceEscalation-error').props.children.includes('invalidWorkspaceEscalation'));
  assert.equal(nodes(page).find(node => node.props?.type === 'submit').props.disabled, true);
  await page.props.onSubmit({ preventDefault() {} }); assert.equal(io.operations.length, 0);
});

test('workspace settings copy explains both modes and review-only deletion coverage', () => {
  const { plugin } = boot();
  assert.equal(plugin.permissionDictionaries.zh.nav, '自动审查（增强版）');
  assert.equal(plugin.permissionDictionaries.zh.workspaceEscalation, '工作区外操作');
  assert.equal(plugin.permissionDictionaries.en.workspaceEscalation, 'Outside-workspace actions');
  assert.match(plugin.permissionDictionaries.en.workspaceEscalationHelp, /Full access still reviews every action/);
  assert.match(plugin.permissionDictionaries.en.workspaceEscalationHelp, /once.*does not change the session/);
  assert.match(plugin.permissionDictionaries.en.workspaceEscalationHelp, /network access or reads/);
  assert.match(plugin.permissionDictionaries.zh.preciseDeletionHelp, /工作区免审操作不经过删除审查/);
  assert.match(plugin.permissionDictionaries.en.preciseDeletionHelp, /Workspace operations that skip review do not receive deletion review/);
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
  assert.equal(byId(page, 'ar-preciseDeletion').props.disabled, true);
  assert.equal(byId(page, 'ar-preciseDeletion').props.checked, true);
  assert.equal(byId(page, 'ar-workspaceEscalation').props.disabled, true);
  assert.equal(byId(page, 'ar-workspaceEscalation').props.value, 'ask');
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

function permissionHarness(harness) {
  // Load the real pinned native component without changing its installed file.
  // Expose its local function only within this VM for the presentation contract.
  const nativeSource = readFileSync(new URL('../runtime-test/dsh/node_modules/@deepseek-ai/dsh-client-ui-permission-presets/lib/client.js', import.meta.url), 'utf8')
    .replace('exports.apply = apply;', 'exports.PermissionSelect = PermissionSelect; exports.apply = apply;');
  let native;
  const jsx = (type, props) => harness.React.createElement(type, props, props.children);
  vm.runInNewContext(nativeSource, { window: { __ModuleLoader__: { load(def) { native = def.factory(id => {
    if (id === 'react') return harness.React;
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return harness.primitives;
    return {};
  }); } } } });
  let active = 'zh', registered, subscriber, removed = 0;
  const original = { component: native.PermissionSelect, locale: 'permission.access', options: { priority: 0 }, inject: () => ({}) };
  const context = {
    locale: { getSnapshot: () => ({ active }), subscribe: () => () => {},
      bind(namespace) { return (key, vars) => namespace === 'autoReviewDesktop'
        ? harness.plugin.permissionDictionaries[active][key]
        : `${key}${vars ? ':' + vars.name : ''}`; } },
    slots: {
      inject(name, fn) { assert.equal(name, 'conversation.input.permission'); return fn(); },
      entries: () => [original], subscribe(_name, fn) { subscriber = fn; return () => { subscriber = null; }; },
      register(spec, component) { registered = { spec, component }; return () => { removed++; }; },
    },
  };
  const stop = harness.plugin.registerPermissionPresentation(context);
  return { original, context, stop, get registered() { return registered; }, language(value) { active = value; },
    get removed() { return removed; }, get subscribed() { return Boolean(subscriber); } };
}
function textOf(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return node?.props ? textOf(node.props.children) : '';
}

test('native permission menu independently decorates both review modes and follows the UI language', () => {
  for (const selectedId of ['auto-review-desktop', 'auto-review-workspace']) {
    const harness = boot(), adapter = permissionHarness(harness);
    const catalog = { options: [
      { value: 'auto', name: 'auto' },
      { value: 'workspace-write', name: 'workspace-write' },
      { value: 'auto-review-desktop', name: 'Legacy full mode' },
      { value: 'auto-review-workspace', name: 'Workspace mode' },
    ] };
    const props = { locked: false, useProjection: () => ({ currentValue: selectedId }),
      usePermissionCatalog: selector => selector({ value: catalog }), select: async () => true };
    const render = () => { const wrapper = adapter.registered.component(props); return harness.render(wrapper.props, wrapper.type); };
    let menu = nodes(render()).find(node => node.type === 'native-menu');
    assert.equal(menu.props.selectedId, selectedId);
    const full = menu.props.items.find(item => item.id === 'auto-review-desktop');
    const workspace = menu.props.items.find(item => item.id === 'auto-review-workspace');
    assert.equal(full.icon.type, 'native-review-icon'); assert.equal(workspace.icon.type, 'native-review-icon');
    assert(textOf(full.label).includes('自动审查（完全访问）')); assert(textOf(full.label).includes('无沙箱运行'));
    assert(textOf(workspace.label).includes('自动审查（工作区）')); assert(textOf(workspace.label).includes('沙箱约束内的操作免审'));
    assert(!textOf(full.label).includes('Auto review')); assert(!textOf(workspace.label).includes('Auto review'));
    assert.equal(menu.props.items.find(item => item.id === 'auto').label.props['aria-label'], 'auto.label auto.badge');
    assert.equal(menu.props.items.find(item => item.id === 'workspace-write').label, 'preset.workspaceWrite');
    const descriptionKey = selectedId === 'auto-review-desktop' ? 'permissionFullDescription' : 'permissionWorkspaceDescription';
    assert.equal(menu.props.anchor.props.title, harness.plugin.permissionDictionaries.zh[descriptionKey]);
    assert(nodes(menu.props.anchor).some(node => node.type === 'native-review-icon'));
    adapter.language('en'); menu = nodes(render()).find(node => node.type === 'native-menu');
    assert.equal(menu.props.selectedId, selectedId);
    const englishFull = textOf(menu.props.items.find(item => item.id === 'auto-review-desktop').label);
    const englishWorkspace = textOf(menu.props.items.find(item => item.id === 'auto-review-workspace').label);
    assert(englishFull.includes('Auto review (Full access)')); assert(englishWorkspace.includes('Auto review (Workspace)'));
    assert(!/[\u3400-\u9fff]/.test(englishFull + englishWorkspace));
    assert.equal(menu.props.anchor.props.title, harness.plugin.permissionDictionaries.en[descriptionKey]);
    assert.equal(adapter.registered.spec.inject, adapter.original.inject);
    assert.equal(adapter.registered.spec.priority, -1);
    adapter.stop(); assert.equal(adapter.removed, 1); assert.equal(adapter.subscribed, false);
  }
});

test('both review modes retain the native selection callback and original ID', async () => {
  for (const id of ['auto-review-workspace', 'auto-review-desktop']) {
    const harness = boot(), adapter = permissionHarness(harness), selected = [];
    const props = { locked: false, useProjection: () => ({ currentValue: 'workspace-write' }),
      usePermissionCatalog: selector => selector({ value: { options: [
        { value: 'auto', name: 'auto' }, { value: 'workspace-write', name: 'workspace-write' },
        { value: 'auto-review-desktop', name: 'full' }, { value: 'auto-review-workspace', name: 'workspace' },
      ] } }), select: async value => { selected.push(value); return true; } };
    const wrapper = adapter.registered.component(props);
    const tree = harness.render(wrapper.props, wrapper.type);
    const menu = nodes(tree).find(node => node.type === 'native-menu');
    assert.equal(menu.props.selectedId, 'workspace-write');
    assert(!nodes(menu.props.anchor).some(node => node.type === 'native-review-icon'));
    menu.props.onSelect(id); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(selected, [id]); adapter.stop();
  }
});

test('presentation preserves official Auto confirmation and selection behavior', () => {
  const harness = boot(), adapter = permissionHarness(harness);const selected = [];
  const props = { locked: false, useProjection: () => ({ currentValue: 'workspace-write' }),
    usePermissionCatalog: selector => selector({ value: { options: [
      { value: 'auto', name: 'auto' }, { value: 'workspace-write', name: 'workspace-write' },
      { value: 'auto-review-desktop', name: 'Auto review (Desktop)' },
    ] } }), select: async id => { selected.push(id); return true; } };
  const render = () => { const wrapper = adapter.registered.component(props); return harness.render(wrapper.props, wrapper.type); };
  let tree = render();const menu = nodes(tree).find(node => node.type === 'native-menu');
  menu.props.onSelect('auto');tree = render();
  assert.equal(selected.length, 0);
  const confirmation = nodes(tree).find(node => node.props?.title === 'auto.confirm.title');
  assert(confirmation);assert.equal(confirmation.props.description, 'auto.confirm.description');
  confirmation.props.onConfirm();assert.deepEqual(selected, ['auto']);adapter.stop();
});

test('localized catalog keeps host data immutable and returns stable snapshots', () => {
  const { plugin } = boot();
  const official = Object.freeze({ value: 'auto', name: 'auto', description: 'official' });
  const desktop = Object.freeze({ value: 'auto-review-desktop', name: 'Legacy full mode', marker: 1 });
  const workspace = Object.freeze({ value: 'auto-review-workspace', name: 'Workspace mode', marker: 2 });
  const catalog = Object.freeze({ options: Object.freeze([official, desktop, workspace]), defaultOptions: Object.freeze([workspace, desktop]) });
  const t = key => plugin.permissionDictionaries.zh[key];
  const first = plugin.localizePermissionCatalog(catalog, t);
  assert.equal(first, plugin.localizePermissionCatalog(catalog, t)); assert.notEqual(first, catalog);
  assert.equal(first.options[0], official); assert.equal(catalog.options[1].name, 'Legacy full mode');
  assert.equal(first.defaultOptions[0].name, '自动审查（工作区）');
  assert.equal(first.defaultOptions[1].name, '自动审查（完全访问）');
  assert.equal(first.options[1].marker, 1); assert.equal(first.options[2].marker, 2);
  assert.deepEqual(Array.from(first.options, option => option.value), ['auto', 'auto-review-desktop', 'auto-review-workspace']);
  const defaultsOnly = { options: [official], defaultOptions: [workspace] };
  assert.equal(plugin.localizePermissionCatalog(defaultsOnly, t).defaultOptions[0].name, '自动审查（工作区）');
  const other = { options: [official] }; assert.equal(plugin.localizePermissionCatalog(other, t), other);
});
