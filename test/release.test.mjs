import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { localFiles, languageChain, readPackageDocument } from '@deepseek-ai/dsh-plugin-detail';
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index';
import { createMarketIndex } from '../scripts/create-market-index.mjs';

const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

test('real DSH detail reader finds packaged Chinese, English and fallback documents', async () => {
  const pkg = await json('package.json');
  const files = localFiles(fileURLToPath(root), pkg.version);
  for (const [language, expected] of [['en', 'README.md'], ['en-US', 'README.md'], ['zh', 'README.zh.md'], ['zh-CN', 'README.zh.md'], ['fr', 'README.md']]) {
    const detail = await readPackageDocument(files, '', languageChain(language), 1024 * 1024);
    assert.equal(detail?.origin, 'locale');
    assert.equal(detail.path, expected);
    assert(pkg.files.includes(expected));
    assert(detail.markdown.includes(pkg.version));
  }
});

test('release metadata generates format-1 indexes accepted by the actual DSH validator', async () => {
  const [pkg, en, zh, icon] = await Promise.all([json('package.json'), json('locale/en.json'), json('locale/zh.json'), readFile(new URL('icon.svg', root), 'utf8')]);
  const commit = '1234567890abcdef1234567890abcdef12345678';
  for (const source of [{ type: 'npm' }, { type: 'git', url: pkg.repository.url.replace(/^git\+/, ''), commit }]) {
    const index = createMarketIndex({ pkg, en, zh, icon, source, publishTimestamp: 1794528000 });
    const parsed = parseMarketIndex(index, 'https://example.com/plugins/index.json');
    const entry = parsed.plugins[0], version = entry.versions[0];
    assert.equal(entry.name, pkg.name); assert.equal(version.version, pkg.version);
    assert.equal(version.engines.dsh, '>=0.2.0');
    assert.equal(entry.title.zh, zh.meta.title); assert.equal(entry.title.en, en.meta.title);
    const target = marketInstallTarget(entry.name, version);
    assert.equal(target.spec, source.type === 'npm' ? `${pkg.name}@${pkg.version}` : `git+https://github.com/NekoErwin/dsh-auto-review-desktop.git#${commit}`);
  }
  assert.throws(() => createMarketIndex({ pkg, en, zh, icon, source: { type: 'npm' } }), /actual publication time/);
  assert.throws(() => createMarketIndex({ pkg, en, zh, icon, source: { type: 'git', commit: 'main' }, publishTimestamp: 1794528000 }), /40-character/);
});
