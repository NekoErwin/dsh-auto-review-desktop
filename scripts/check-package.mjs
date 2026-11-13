import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
for (const name of pkg.files) await stat(new URL(name, root));
for (const name of ['en', 'zh']) {
  const { meta } = JSON.parse(await readFile(new URL(`locale/${name}.json`, root), 'utf8'));
  assert(meta.title?.trim() && meta.description?.trim(), `${name}: missing display metadata`);
  assert(pkg.files.includes(meta.detail), `${name}: detail must be shipped`);
  await stat(new URL(meta.detail, root));
}
const source = await readFile(new URL('src/client.js', root), 'utf8');
const built = await readFile(new URL('lib/client.js', root), 'utf8');
assert.equal(built, source, 'Stale client bundle: run npm run build');
new vm.Script(built, { filename: 'lib/client.js' });
assert(pkg.exports['./client'] === './lib/client.js');
assert(pkg.exports['./locale/*.json'] && pkg.exports['./icon']);
assert((await stat(new URL('icon.svg', root))).size <= 256 * 1024);
assert(pkg.dsh?.bundle?.patch === './cordis.patch.yml');
for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack']) {
  assert(!pkg.scripts?.[lifecycle], `Release must not require lifecycle script: ${lifecycle}`);
}
console.log(`Package resources verified: ${pkg.name}@${pkg.version}`);
