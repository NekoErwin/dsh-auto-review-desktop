import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewGate } from '../src/gate.js';
import { normalizeConfig } from '../src/runtime.js';
import { REVIEW_POLICY } from '../vendor/official.js';
import { deletionEvidenceMessage } from '../src/deletion-policy.js';
import { fixture, answer } from './helpers.mjs';

function deletionFixture(config={}) {
  return fixture({tool:'pwsh',arguments:{command:"Remove-Item -LiteralPath 'C:\\project\\empty-dir' -Recurse -Force"},config});
}
function inspected(f, {id='inspect-1', content='FullName=C:\\project\\empty-dir; normal directory; empty; no reparse point', error=false, visible=true}={}) {
  const step={turn:1,step:1};
  const args=JSON.stringify({command:"Get-Item -LiteralPath 'C:\\project\\empty-dir'; Get-ChildItem -LiteralPath 'C:\\project\\empty-dir' -Force"});
  f.add('assistant/message',{...step,message:{role:'assistant',content:[{type:'tool-call',id,name:'pwsh',arguments:args}]}},visible);
  f.add('tool/call',{...step,callId:id,name:'pwsh',arguments:args});
  const result=f.add('tool/result',{...step,message:{role:'tool',toolCallId:id,isError:error,content:[{type:'text',text:content}]}},visible);
  return result;
}

test('precise deletion defaults on, preserves false and rejects non-booleans',()=>{
  assert.equal(normalizeConfig().preciseDeletion,true);
  assert.equal(normalizeConfig({preciseDeletion:false}).preciseDeletion,false);
  for(const value of ['false',0,null,{}])assert.throws(()=>normalizeConfig({preciseDeletion:value}),{code:'CONFIG'});
});

test('deletion policy requires evidence but permits checked narrow directory deletion',async()=>{
  const f=deletionFixture();inspected(f);
  assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'allow');
  const request=f.requests[0];
  assert(request.system.startsWith(REVIEW_POLICY));
  assert(request.system.includes('PRECISE_DELETION_PROTECTION'));
  assert(request.system.includes('A planned or previously issued inspection call without its result is not verification'));
  assert(request.system.includes('Do not deny solely because the action deletes a whole directory'));
  assert(request.system.includes('You have no investigation tools'));
  const evidence=JSON.parse(request.messages.at(-2).content[0].text.split('\n').slice(1).join('\n'));
  assert.equal(evidence.role,'fact');assert.equal(evidence.records[0].name,'pwsh');
  assert(evidence.records[0].arguments.includes('Get-Item'));
  assert(evidence.records[0].content[0].text.includes('normal directory'));
  assert(request.messages.at(-1).content[0].text.includes('Remove-Item'));
  assert(!('tools' in request));
});

test('disabling protection restores the exact base policy and omits extra results',async()=>{
  const f=deletionFixture({preciseDeletion:false});inspected(f);
  await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next);
  assert.equal(f.requests[0].system,REVIEW_POLICY);
  assert(!JSON.stringify(f.requests[0].messages).includes('normal directory'));
});

test('ordinary calls do not receive extra tool result context',async()=>{
  const f=fixture();inspected(f);
  await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next);
  assert(f.requests[0].system.includes('PRECISE_DELETION_PROTECTION'));
  assert(!JSON.stringify(f.requests[0].messages).includes('DELETION_INSPECTION_EVIDENCE'));
});

test('unverified deletion has explicit empty evidence and a reviewer denial can require a check',async()=>{
  const f=deletionFixture();f.setStream(()=>answer('{"risk":"medium","decision":"deny","reason":"Read-only inspection of resolved target and contents is missing"}'));
  const evidence=deletionEvidenceMessage(f.session,f.exec);
  assert.equal(JSON.parse(evidence.content[0].text.split('\n').slice(1).join('\n')).records.length,0);
  assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'ask');
  f.setPolicy('never');assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'deny');
});

test('hidden, orphaned, failed and oversized observations cannot masquerade as successful inspection',()=>{
  const f=deletionFixture();
  inspected(f,{id:'hidden',visible:false});
  f.add('tool/result',{turn:1,step:1,message:{role:'tool',toolCallId:'orphan',content:[{type:'text',text:'orphan secret'}]}},true);
  inspected(f,{id:'failed',error:true,content:'access denied'});
  inspected(f,{id:'oversized',content:'x'.repeat(9000)});
  const evidence=JSON.parse(deletionEvidenceMessage(f.session,f.exec).content[0].text.split('\n').slice(1).join('\n'));
  assert.equal(evidence.records.length,2);assert.equal(evidence.records[0].isError,true);
  assert(evidence.records[1].omitted);assert(!JSON.stringify(evidence).includes('orphan secret'));
});

test('inspection evidence changes or disappears during review invalidate a reviewer allow',async()=>{
  for(const change of ['result','surface']) {
    const f=deletionFixture();const result=inspected(f);
    f.setStream(async function*(){
      if(change==='result')result.data.message.content[0].text='nonempty directory with unrelated user files';
      else f.nodes.splice(f.nodes.indexOf(result.seq),1);
      yield* answer();
    });
    assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'deny');
    assert.equal(f.getDownstreamCalls(),0);
  }
});

test('new native or PTC activity without a result invalidates a deletion verdict',async()=>{
  for(const type of ['tool/call','tool/ptc-dispatch-start']) {
    const f=deletionFixture();inspected(f);
    f.setStream(async function*(){
      f.add(type,{turn:1,step:1,callId:'concurrent',parentCallId:'call-1',subCallId:'concurrent',rootCallId:'call-1',name:'write',arguments:{file_path:'empty-dir/user-data',content:'new data'}});
      yield* answer();
    });
    assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'deny');
    assert.equal(f.getDownstreamCalls(),0);
  }
});

test('changing precise deletion while review runs invalidates the old verdict',async()=>{
  const f=deletionFixture();f.setStream(async function*(){f.setConfig({preciseDeletion:false});yield* answer();});
  assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'deny');
  assert.equal(f.getDownstreamCalls(),0);
});
