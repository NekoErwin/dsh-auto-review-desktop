import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewGate } from '../src/gate.js';
import { DEFAULTS, withDeadline, ReviewStats, normalizeConfig } from '../src/runtime.js';
import { parseDecision, snapshotAutoReview, readDecision } from '../vendor/official.js';
import { fixture, answer } from './helpers.mjs';

const gateFor=f=>createReviewGate(f.ctx,f.readConfig);
test('official policy, exact action, source labels and route controls survive',async()=>{
  const f=fixture({config:{routeMode:'specific',provider:'review',model:'cheap'}});const gate=gateFor(f);
  assert.equal((await gate.gate(f.exec,f.next)).kind,'allow');
  assert.equal(f.getDownstreamCalls(),1);const request=f.requests[0];
  assert.equal(request.provider,'review');assert.equal(request.model,'cheap');assert.equal(request.reasoningEffort,'low');assert.equal(request.maxTokens,2048);assert.equal(request.purpose,'auto-review');
  assert(request.system.includes('High must always be denied'));assert(request.messages.some(m=>m.content[0].text.includes('user-instruction')));
  assert(request.messages.at(-1).content[0].text.includes('hello'));assert(!('tools'in request));
});
test('specific configured model disappearing never silently falls back',async()=>{
  const f=fixture({config:{routeMode:'specific',provider:'review',model:'gone'}});const gate=gateFor(f);
  assert.equal((await gate.gate(f.exec,f.next)).kind,'deny');assert.equal(f.requests.length,0);assert.equal(f.getDownstreamCalls(),0);
});
test('deny asks human; never stays final',async()=>{
  const f=fixture({stream:()=>answer('{"risk":"medium","decision":"deny","reason":"No exact authorization"}')});const gate=gateFor(f);
  assert.equal((await gate.gate(f.exec,f.next)).kind,'ask');f.setPolicy('never');
  assert.equal((await gate.gate(f.exec,f.next)).kind,'deny');assert.equal(f.getDownstreamCalls(),1);
});
test('downstream deny takes precedence over reviewer allow',async()=>{
  const f=fixture();const gate=gateFor(f);assert.equal((await gate.gate(f.exec,async()=>({kind:'deny',reason:'other gate'}))).kind,'deny');
});
test('malformed and high+allow output stay denied without retry',async()=>{
  for(const text of ['{"risk":"high","decision":"allow"}','prefix {"risk":"low","decision":"allow"}','{"risk":"low","decision":"deny","decision":"allow"}']){
    const f=fixture({config:{maxRetries:1},stream:()=>answer(text)});const gate=gateFor(f);
    assert.equal((await gate.gate(f.exec,f.next)).kind,'deny');assert.equal(f.requests.length,1);assert.equal(f.getDownstreamCalls(),0);
  }
});
test('request cancellation defeats a delayed allow',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const f=fixture({stream:async function*(){await pending;yield* answer();}});const gate=gateFor(f);
  const work=gate.gate(f.exec,f.next);await new Promise(resolve=>setImmediate(resolve));f.controller.abort();
  assert.equal((await work).kind,'cancel');assert.equal(f.getDownstreamCalls(),0);release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(gate.stats.view().totals.cancelled,1);assert.equal(gate.stats.view().totals.allows,0);
});
test('deadline returns even if task ignores AbortSignal',async()=>{
  let late;const ignored=new Promise(resolve=>{late=resolve;});
  await assert.rejects(withDeadline(()=>ignored,{timeoutMs:10}),{code:'TIMEOUT'});late('allow');
});
test('pre-cancelled deadline has no detached rejection',async()=>{
  const controller=new AbortController();controller.abort();await assert.rejects(withDeadline(()=>Promise.resolve('allow'),{signal:controller.signal,timeoutMs:20}),{code:'CANCELLED'});
});
test('user authorization changing during review invalidates a successful verdict',async()=>{
  const f=fixture();f.setStream(async function*(){f.user.data.content[0].text='Stop. Do not modify files.';yield* answer();});
  assert.equal((await gateFor(f).gate(f.exec,f.next)).kind,'deny');assert.equal(f.getDownstreamCalls(),0);
});
test('review settings changing during review invalidate the old model result',async()=>{
  const f=fixture();f.setStream(async function*(){f.setConfig({maxOutputTokens:4096});yield* answer();});
  assert.equal((await gateFor(f).gate(f.exec,f.next)).kind,'deny');assert.equal(f.getDownstreamCalls(),0);
});
test('cancellation during downstream enforcement cannot execute',async()=>{
  const f=fixture();const result=await gateFor(f).gate(f.exec,async()=>{f.controller.abort();return {kind:'allow'};});assert.equal(result.kind,'cancel');
});
test('failing downstream is never called a second time by ask fallback',async()=>{
  const f=fixture({config:{failurePolicy:'ask'}});let count=0;const result=await gateFor(f).gate(f.exec,async()=>{count++;throw Error('downstream failed');});
  assert.equal(result.kind,'deny');assert.equal(count,1);
});
test('input guard sends no request and never truncates the action',async()=>{
  const f=fixture({arguments:{content:'x'.repeat(20000)},config:{maxInputChars:4000}});assert.equal((await gateFor(f).gate(f.exec,f.next)).kind,'deny');assert.equal(f.requests.length,0);
});
test('optional failure fallback asks a human, never auto-allows and respects never',async()=>{
  const f=fixture({config:{maxInputChars:4000,failurePolicy:'ask'}});const gate=gateFor(f);
  assert.equal((await gate.gate(f.exec,f.next)).kind,'ask');f.setPolicy('never');assert.equal((await gate.gate(f.exec,f.next)).kind,'deny');
});
test('attempt budget includes failures and resets only on a new turn',async()=>{
  const f=fixture({config:{maxReviewsPerTurn:1},stream:()=>answer('bad')});const gate=gateFor(f);
  await gate.gate(f.exec,f.next);await gate.gate(f.exec,f.next);assert.equal(f.requests.length,1);
  f.add('turn/start',{turn:2});f.add('step/start',{turn:1,step:1});await gate.gate(f.exec,f.next);assert.equal(f.requests.length,2);
});
test('one explicitly transient failure may retry once, using the same evidence',async()=>{
  const f=fixture({config:{maxRetries:1},stream:async function*(_opts,n){if(n===1){yield {type:'finish',reason:{kind:'error',failure:{code:'TRANSPORT',message:'network reset'}}};return;}yield* answer();}});
  const gate=gateFor(f);assert.equal((await gate.gate(f.exec,f.next)).kind,'allow');assert.equal(f.requests.length,2);assert.deepEqual(f.requests[0].messages,f.requests[1].messages);
});
test('usage records cumulative usage once, preserving missing reasoning as unknown',async()=>{
  const f=fixture({stream:async function*(){yield {type:'usage',usage:{inputTokens:5,outputTokens:1}};yield* answer(undefined,{inputTokens:20,outputTokens:3,totalTokens:23,cacheReadTokens:10});}});
  const gate=gateFor(f);await gate.gate(f.exec,f.next);const stats=gate.stats.view();
  assert.equal(stats.totals.inputTokens,20);assert.equal(stats.totals.outputTokens,3);assert.equal(stats.totals.cacheReadTokens,10);assert(!('reasoningTokens'in stats.recent[0].usage));
});
test('hot unload downgrades active Auto sessions and cancels pending work',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});const f=fixture({stream:async function*(){await pending;yield* answer();}});const gate=gateFor(f);
  const work=gate.gate(f.exec,f.next);await new Promise(resolve=>setImmediate(resolve));await gate.close();
  assert.equal((await work).kind,'cancel');assert.equal(f.getPreset(),'workspace-write');assert.equal(f.getDownstreamCalls(),0);release();
});
test('application shutdown preserves persisted selection',async()=>{
  const f=fixture();await gateFor(f).close({applicationShutdown:true});assert.equal(f.getPreset(),'auto');
});
test('non-Auto sessions and the PTC transport retain normal downstream behavior',async()=>{
  const f=fixture();const gate=gateFor(f);f.setPreset('workspace-write');await gate.gate(f.exec,f.next);f.setPreset('auto');await gate.gate({...f.exec,name:'run_code'},f.next);assert.equal(f.requests.length,0);assert.equal(f.getDownstreamCalls(),2);
});
test('official snapshot treats project instructions as constraints',()=>{
  const f=fixture();f.user.data.source={kind:'agent-instructions'};assert.equal(snapshotAutoReview(f.agent,f.exec,'C:\\project',new Map()).history[0].role,'constraint');
});
test('official parser rejects data after terminal finish',async()=>{
  await assert.rejects(readDecision((async function*(){yield* answer();yield {type:'usage',usage:{}};})()),/after its terminal/);
});
test('full gate deadline ignores an uncooperative provider and audits once',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const f=fixture({config:{timeoutMs:1000},stream:async function*(){await pending;yield* answer();}});const gate=gateFor(f);
  const result=await gate.gate(f.exec,f.next);assert.equal(result.kind,'deny');assert.equal(f.getDownstreamCalls(),0);
  assert.equal(gate.stats.view().totals.failures,1);release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(gate.stats.view().totals.attempts,1);assert.equal(gate.stats.view().totals.allows,0);
});
test('PTC inner actions are reviewed against the exact logged binding',async()=>{
  const f=fixture({tool:'run_code',arguments:{code:'write()'}});
  const args={file_path:'app.js',content:'inside PTC'};
  f.add('tool/ptc-dispatch-start',{parentCallId:'call-1',subCallId:'inner-1',rootCallId:'call-1',name:'write',arguments:args});
  const exec={...f.exec,name:'write',callId:'inner-1',arguments:args,parent:{callId:'call-1'},schema:{name:'write',description:'Write a project file',parameters:{type:'object'}}};
  const gate=gateFor(f);assert.equal((await gate.gate(exec,f.next)).kind,'allow');assert.equal(f.requests.length,1);
  assert(f.requests[0].messages.at(-1).content[0].text.includes('inside PTC'));
});
test('configuration has strict bounded controls and no fail-open option',()=>{
  for(const c of [{timeoutMs:0},{maxRetries:2},{failurePolicy:'allow'},{unknown:true}])assert.throws(()=>normalizeConfig(c));
  assert.equal(normalizeConfig().maxRetries,0);
});
