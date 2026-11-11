import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include';
import YAML from 'yaml';

test('real Loader bundle patch disables official gate and inserts a single enhanced entry',async()=>{
  const patch=YAML.parse(await readFile(new URL('../cordis.patch.yml',import.meta.url),'utf8'));
  const base=[{id:'auto-review',name:'@deepseek-ai/dsh-experimental-auto-review'}];
  const warnings=[];const rows=applyEntryPatches(base,patch,(...args)=>warnings.push(args));
  assert.equal(warnings.length,0);assert.equal(rows.length,2);
  assert.equal(rows.find(row=>row.id==='auto-review').disabled,true);
  assert.equal(rows.filter(row=>!row.disabled).length,1);
  assert.equal(rows.find(row=>row.id==='auto-review-desktop').name,'dsh-auto-review-desktop');
  const restored=applyEntryPatches(base,[],()=>{});assert.equal(restored[0].disabled,undefined);
});
