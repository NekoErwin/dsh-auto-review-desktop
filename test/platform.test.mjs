import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { createReviewGate } from '../src/gate.js';
import { nativeCompatible } from '../src/native-compatibility.js';
import { deletionActivityKey, deletionEvidenceMessage } from '../src/deletion-policy.js';
import { desktopMode, WORKSPACE_PRESET } from '../src/preset.js';
import { fixture } from './helpers.mjs';
import { nativeTools } from './native-tools.mjs';

const native = await nativeTools();
after(() => native.close());
const schema = definition => ({ name: definition.name, description: definition.description,
  parameters: definition.parameters, ...(definition.deferLoading ? { deferLoading: true } : {}) });

// These are filesystem-provider contract tests, not Linux/macOS kernel sandbox tests.
// Case policy belongs to the provider: macOS volumes can use either convention.
const platforms = [
  { label: 'POSIX sensitive (Linux)', path: posix, root: '/workspace/Project space', sensitive: true },
  { label: 'POSIX sensitive (macOS volume)', path: posix, root: '/Users/test/Project space', sensitive: true },
  { label: 'POSIX insensitive (macOS volume)', path: posix, root: '/Users/test/Project space', sensitive: false },
  { label: 'Windows drive', path: win32, root: 'C:\\workspace\\Project space', sensitive: false },
  { label: 'Windows UNC', path: win32, root: '\\\\server\\share\\Project space', sensitive: false },
];

function setup(platform, { tool = 'write', args = { file_path: 'app.js', content: 'hello' }, config = {} } = {}) {
  const f = fixture({ tool, arguments: args, config });
  f.setPreset(WORKSPACE_PRESET); f.add('sandbox/mode', { mode: 'workspace-write' });
  f.session.header.cwd = platform.root;
  let cwd = platform.root;
  f.ctx.workingDirectory.ensure = async () => cwd;
  f.ctx.sandboxPolicy.resolve = () => ({ mode: 'workspace-write', workspaceRoot: platform.root });
  const definitions = new Map(native.definitions);
  if (!definitions.has(tool)) definitions.set(tool, { name: tool, description: 'Unknown shell executor', parameters: { type: 'object' } });
  f.ctx.tools = { get: name => definitions.get(name) };
  f.header.tools = [schema(definitions.get(tool))];
  const normalize = value => platform.sensitive ? value : value.toLowerCase();
  const aliases = new Map(), paths = new Map(), targets = new Map(), resolutions = [];
  let containmentChecks = 0;
  f.ctx.fs = {
    sandboxMode: 'workspace-write',
    async resolve(input, options = {}) {
      let absolute = normalize(platform.path.resolve(options.cwd ?? cwd, input));
      for (const [alias, destination] of aliases) {
        if (absolute === alias || absolute.startsWith(alias + platform.path.sep)) {
          absolute = destination + absolute.slice(alias.length);
          break;
        }
      }
      if (!targets.has(absolute)) {
        // Keys are deliberately opaque: the router must delegate containment.
        const key = `opaque-target-${targets.size}`;
        targets.set(absolute, key); paths.set(key, absolute);
      }
      const target = { displayPath: absolute, targetKey: targets.get(absolute) };
      resolutions.push({ input, cwd: options.cwd, target });
      return target;
    },
    contains(parent, child) {
      containmentChecks++;
      const relative = platform.path.relative(paths.get(parent.targetKey), paths.get(child.targetKey));
      return relative === '' || (!platform.path.isAbsolute(relative)
        && relative !== '..' && !relative.startsWith('..' + platform.path.sep));
    },
  };
  return { ...f, definitions, resolutions, getContainmentChecks: () => containmentChecks,
    setCwd: value => { cwd = value; },
    alias: (from, to) => aliases.set(normalize(platform.path.resolve(platform.root, from)), normalize(to)),
  };
}

const bashArgs = extra => ({ command: 'pwd', description: 'Inspect this command working directory', ...extra });

test('platform route tests use actual compatible native bash and file schemas', () => {
  for (const name of ['bash', 'write', 'read', 'apply_patch']) assert(nativeCompatible(native.definitions.get(name)), name);
});

test('deletion observations are loaded for common POSIX, PowerShell and patch deletion spellings without executing them', () => {
  for (const [tool, args] of [
    ['bash', { command: "rm -rf -- '/workspace/Project space/generated'" }],
    ['bash', { command: "find '/workspace/Project space/generated' -type f -delete" }],
    ['pwsh', { command: "Remove-Item -LiteralPath 'C:\\workspace\\Project space\\generated' -Recurse -Force" }],
    ['apply_patch', { input: '*** Begin Patch\n*** Delete File: generated.js\n*** End Patch' }],
  ]) {
    const f = fixture({ tool, arguments: args });
    const message = deletionEvidenceMessage(f.session, f.exec);
    assert(message?.content[0].text.startsWith('DELETION_INSPECTION_EVIDENCE'), tool);
    const before = deletionActivityKey(f.session, f.exec);
    f.add('tool/call', { turn: 1, step: 1, callId: 'later', name: 'write', arguments: '{}' });
    assert.notEqual(deletionActivityKey(f.session, f.exec), before, tool);
  }
});

for (const platform of platforms) {
  test(`${platform.label}: writes use provider case policy and reject sibling-prefix and parent escapes`, async () => {
    for (const [file_path, allowed] of [
      ['src/../app.js', true],
      [platform.path.join(platform.root + '-backup', 'app.js'), false],
      [platform.path.join('..', 'outside.txt'), false],
      [platform.path.join(platform.root.replace('Project', 'PROJECT'), 'app.js'), !platform.sensitive],
      ...(platform.path === win32 ? [['D:\\outside\\app.js', false]] : [['..\\outside.txt', true]]),
    ]) {
      const f = setup(platform, { args: { file_path, content: 'hello' } });
      const gate = createReviewGate(f.ctx, f.readConfig);
      assert.equal((await gate.gate(f.exec, f.next)).kind, allowed ? 'allow' : 'deny', file_path);
      assert.equal(f.requests.length, 0); assert(f.getContainmentChecks() > 0);
      assert(f.resolutions.some(record => record.input === platform.root), 'The standing root must be resolved by the provider');
      assert(f.resolutions.some(record => record.input === file_path && record.cwd === platform.root));
      if (allowed) {
        let executions = 0;
        await gate.execute(f.exec, async () => { executions++; });
        assert.equal(executions, 1);
      } else assert.equal(f.getDownstreamCalls(), 0);
    }
  });

  test(`${platform.label}: linked paths are delegated and rechecked before dispatch`, async () => {
    const f = setup(platform, { args: { file_path: platform.path.join('linked', 'app.js'), content: 'hello' } });
    const gate = createReviewGate(f.ctx, f.readConfig);
    assert.equal((await gate.gate(f.exec, f.next)).kind, 'allow');
    const checks = f.getContainmentChecks();
    f.alias('linked', platform.path.join(platform.path.dirname(platform.root), 'private'));
    let executions = 0;
    await assert.rejects(gate.execute(f.exec, async () => { executions++; }), /workspace admission changed/);
    assert.equal(executions, 0); assert(f.getContainmentChecks() > checks);
    assert.equal((await gate.gate(f.exec, f.next)).kind, 'deny');
  });

  test(`${platform.label}: bash workdir root, relative inside, outside and symlink routes preserve the sandbox`, async () => {
    const outside = platform.path.join(platform.root + '-other', 'subdir');
    for (const [extra, expected] of [
      [{}, 'allow'], [{ workdir: platform.root }, 'allow'], [{ workdir: 'src' }, 'allow'],
      [{ workdir: outside }, 'ask'], [{ workdir: '..' }, 'ask'],
    ]) {
      const f = setup(platform, { tool: 'bash', args: bashArgs(extra) });
      assert.equal((await createReviewGate(f.ctx, f.readConfig).gate(f.exec, f.next)).kind, expected);
      assert.equal(f.requests.length, 0); assert.equal(f.getDownstreamCalls(), 1);
      assert.equal((await createReviewGate(f.ctx, f.readConfig).gate(f.exec, async () => ({ kind: 'deny', reason: 'Downstream sandbox guard' }))).kind, 'deny');
      assert.equal(desktopMode(f.session), 'workspace');
    }
    const linked = setup(platform, { tool: 'bash', args: bashArgs({ workdir: 'linked' }) });
    linked.alias('linked', outside);
    assert.equal((await createReviewGate(linked.ctx, linked.readConfig).gate(linked.exec, linked.next)).kind, 'ask');
    const moved = setup(platform, { tool: 'bash', args: bashArgs({}) });
    moved.setCwd(outside);
    assert.equal((await createReviewGate(moved.ctx, moved.readConfig).gate(moved.exec, moved.next)).kind, 'ask', 'Changing cwd does not expand the standing workspace root');
  });

  test(`${platform.label}: an external bash workdir can be reviewed and an explicit wider request is decided only at approval`, async () => {
    const workdir = platform.path.dirname(platform.root);
    const ordinary = setup(platform, { tool: 'bash', args: bashArgs({ workdir }), config: { workspaceEscalation: 'review' } });
    assert.equal((await createReviewGate(ordinary.ctx, ordinary.readConfig).gate(ordinary.exec, ordinary.next)).kind, 'allow');
    assert.equal(ordinary.requests.length, 1);
    const args = bashArgs({ workdir, sandbox_permissions: 'danger-full-access', justification: 'Inspect this exact authorized outside working directory once.' });
    const f = setup(platform, { tool: 'bash', args, config: { workspaceEscalation: 'review' } });
    const gate = createReviewGate(f.ctx, f.readConfig);
    assert.equal((await gate.gate(f.exec, f.next)).kind, 'allow'); assert.equal(f.requests.length, 0);
    let human = 0;
    const request = { agent: f.agent, toolName: 'bash', callId: f.exec.callId, signal: f.exec.signal,
      reason: `escalate sandbox to danger-full-access: ${args.justification}` };
    await gate.execute(f.exec, async () => {
      assert.equal(await gate.approval(request, async () => { human++; return 'rejected'; }), 'allowed-once');
      assert.equal(await gate.approval(request, async () => { human++; return 'allowed-once'; }), 'rejected');
    });
    assert.equal(human, 0); assert.equal(f.requests.length, 1);
    assert.equal(desktopMode(f.session), 'workspace');
    assert.equal(f.ctx.sandboxPolicy.resolve().mode, 'workspace-write');
    assert.deepEqual(f.exec.arguments, args);
  });

  test(`${platform.label}: unknown or incompatible shells and missing sandbox capabilities fall back conservatively`, async () => {
    for (const variant of ['unknown-shell', 'changed-schema', 'no-sandbox']) {
      const f = setup(platform, { tool: variant === 'unknown-shell' ? 'zsh' : 'bash', args: bashArgs({}) });
      if (variant === 'changed-schema') f.definitions.set('bash', { ...f.definitions.get('bash'), description: 'Changed native shell contract' });
      if (variant === 'no-sandbox') f.ctx.shell.sandboxMode = undefined;
      const gate = createReviewGate(f.ctx, f.readConfig);
      assert.equal((await gate.gate(f.exec, f.next)).kind, 'ask', variant); assert.equal(f.requests.length, 0);
      f.setPolicy('never');
      assert.equal((await gate.gate(f.exec, f.next)).kind, 'deny', variant);
    }
  });
}
