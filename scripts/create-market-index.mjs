import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export function createMarketIndex({ pkg, en, zh, icon, publishTimestamp, source }) {
  if (!Number.isSafeInteger(publishTimestamp) || publishTimestamp <= 0 || publishTimestamp >= 1e11) throw Error('Supply the actual publication time in Unix seconds');
  if (source?.type !== 'npm' && source?.type !== 'git') throw Error('Source must be npm or git');
  if (source.type === 'git' && !/^[0-9a-f]{40}$/.test(source.commit ?? '')) throw Error('Git source requires the published full 40-character commit SHA');
  return {
    format: 1,
    title: { en: 'Enhanced review releases', zh: '增强审查发布索引' },
    plugins: [{
      name: pkg.name,
      title: { en: en.meta.title, zh: zh.meta.title },
      description: { en: en.meta.description, zh: zh.meta.description },
      icon: `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`,
      author: pkg.author,
      homepage: pkg.homepage,
      repository: { url: pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '') },
      metadata: { keywords: pkg.keywords ?? [] },
      versions: [{ version: pkg.version, publishTimestamp, source, engines: { dsh: pkg.engines.dsh } }],
    }],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    source: { type: 'string', default: 'npm' },
    commit: { type: 'string' },
    'published-at': { type: 'string' },
    out: { type: 'string', default: 'deliverables/market-index.json' },
  } });
  const root = new URL('../', import.meta.url);
  const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
  const [pkg, en, zh, icon] = await Promise.all([json('package.json'), json('locale/en.json'), json('locale/zh.json'), readFile(new URL('icon.svg', root), 'utf8')]);
  const source = values.source === 'git'
    ? { type: 'git', url: pkg.repository.url.replace(/^git\+/, ''), commit: values.commit }
    : values.source === 'npm' ? { type: 'npm' } : undefined;
  const index = createMarketIndex({ pkg, en, zh, icon, source, publishTimestamp: Number(values['published-at']) });
  await writeFile(values.out, JSON.stringify(index, null, 2) + '\n');
  console.log(`Wrote ${values.out}; review and validate it before publishing to an index source.`);
}
