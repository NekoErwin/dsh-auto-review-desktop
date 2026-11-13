await import('./build.mjs');
await import('./check-package.mjs');
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

await mkdir(new URL('../deliverables/', import.meta.url), { recursive: true });
if (!process.env.npm_execpath) throw Error('Run this through npm run pack:release');
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--pack-destination', 'deliverables'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
