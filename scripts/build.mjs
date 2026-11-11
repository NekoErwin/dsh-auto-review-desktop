import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const source = new URL('src/client.js', root);
const target = new URL('lib/client.js', root);
// Parse before publishing; this is already a native ModuleLoader bundle and needs no transpilation.
new vm.Script(await readFile(source, 'utf8'), { filename: fileURLToPath(source) });
await mkdir(new URL('lib/', root), { recursive: true });
await copyFile(source, target);
console.log(`Built ${fileURLToPath(target)}`);
