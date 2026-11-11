import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include';
import YAML from 'yaml';

const official={id:'auto-review',name:'@deepseek-ai/dsh-experimental-auto-review',config:{futureOption:true}};
for(const base of [[],[official],[{...official,id:'official-new-id'}]]) {
  test(`bundle contributes independently with ${base[0]?.id??'no official plugin'}`,async()=>{
    const patch=YAML.parse(await readFile(new URL('../cordis.patch.yml',import.meta.url),'utf8'));
    const warnings=[];const rows=applyEntryPatches(base,patch,(...args)=>warnings.push(args));
    assert.equal(warnings.length,0);assert.equal(rows.length,base.length+1);
    assert.deepEqual(rows.filter(row=>row.id!=='auto-review-desktop'),base);
    assert.equal(rows.find(row=>row.id==='auto-review-desktop').name,'dsh-auto-review-desktop');
    assert.equal(rows.filter(row=>row.disabled).length,0);
  });
}
