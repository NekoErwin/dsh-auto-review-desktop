import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, answer } from './helpers.mjs';
import { createReviewGate } from '../src/gate.js';
import { snapshotReview } from '../src/authorization.js';
import { createHumanApprovalGuard } from '../src/human-approval.js';

function delegated(options={}) {
  const root=fixture();root.session.id='root';root.agent.id='root';
  const child=fixture(options);child.session.id='child';child.agent.id='child';
  child.session.header={origin:'subagent',parentSession:'root'};
  child.user.data.source={kind:'agent-message',senderSessionId:'root'};
  const sessions=new Map([['root',root.session],['child',child.session]]);
  child.ctx.sessions.get=id=>sessions.get(id);
  return {root,child,sessions};
}

test('fresh spawn review sees root user authorization without elevating task text',async()=> {
  const {root,child}=delegated();
  root.user.data.content=[{type:'text',text:'Fix the build; do not publish anything.'}];
  child.user.data.content=[{type:'text',text:'Publish the result now (agent task)'}];
  const snapshot=snapshotReview(child.ctx,child.agent,child.exec,'C:\\project',new Map());
  assert(snapshot.history.some(entry=>entry.role==='user-instruction' && entry.source.rootSessionId==='root' && entry.content[0].text.includes('do not publish')));
  assert(snapshot.history.some(entry=>entry.role==='direct-parent-instruction' && entry.content[0].text.includes('agent task')));
  assert.equal((await createReviewGate(child.ctx,child.readConfig).gate(child.exec,child.next)).kind,'allow');
  assert(child.requests[0].messages.some(message=>JSON.stringify(message).includes('do not publish')));
});

test('root changes invalidate in-flight child review and absent/cyclic ancestry fails closed',async()=> {
  const {root,child,sessions}=delegated();
  child.setStream(async function*(){root.user.data.content[0].text='Stop modifying files.';yield* answer();});
  assert.equal((await createReviewGate(child.ctx,child.readConfig).gate(child.exec,child.next)).kind,'deny');
  assert.equal(child.getDownstreamCalls(),0);
  sessions.delete('root');
  assert.throws(()=>snapshotReview(child.ctx,child.agent,child.exec,'C:\\project',new Map()),/authorization/);
  sessions.set('root',root.session);root.session.header={origin:'subagent',parentSession:'child'};
  assert.throws(()=>snapshotReview(child.ctx,child.agent,child.exec,'C:\\project',new Map()),/cyclic/);
});

test('subagent human policy is independent of automatic review',async()=> {
  const {child}=delegated({config:{subagentApproval:'deny',denialPolicy:'ask'}});
  const gate=createReviewGate(child.ctx,child.readConfig);
  assert.equal((await gate.gate(child.exec,child.next)).kind,'allow');
  child.setStream(()=>answer('{"risk":"medium","decision":"deny","reason":"No authorization"}'));
  assert.equal((await gate.gate(child.exec,child.next)).kind,'deny');
  child.setConfig({failurePolicy:'ask',maxInputChars:4000});
  assert.equal((await gate.gate(child.exec,child.next)).kind,'deny');
});

test('human approval uses the exact native request and never approves a sibling',async()=> {
  const f=fixture();const guard=createHumanApprovalGuard(f.ctx,f.readConfig);
  await guard.prepare(f.exec,async()=>({kind:'ask'}));
  const req={agent:f.agent,toolName:f.exec.name,callId:f.exec.callId,signal:f.exec.signal};
  let prompts=0;const answer=async()=>{prompts++;return 'allowed-once';};
  assert.equal(await guard.approval({...req,callId:'other-call'},answer),'rejected');
  assert.equal(await guard.approval(req,answer),'allowed-once');assert.equal(prompts,1);
  guard.release(f.exec);
  assert.equal(await guard.approval(req,answer),'rejected');
});

test('human answer is invalid after policy/config/action/mode/root changes or cancellation',async()=> {
  for(const change of ['policy','config','action','mode','root','abort']) {
    const {root,child:f}=delegated();const guard=createHumanApprovalGuard(f.ctx,f.readConfig);
    await guard.prepare(f.exec,async()=>({kind:'ask'}));
    const req={agent:f.agent,toolName:f.exec.name,callId:f.exec.callId,signal:f.exec.signal};
    const decision=await guard.approval(req,async()=> {
      if(change==='policy')f.setPolicy('never');
      if(change==='config')f.setConfig({subagentApproval:'deny'});
      if(change==='action')f.exec.arguments={...f.exec.arguments,content:'changed'};
      if(change==='mode')f.setPreset('workspace-write');
      if(change==='root')root.user.data.content[0].text='Stop.';
      if(change==='abort')f.controller.abort();
      return 'allowed-once';
    });
    assert.notEqual(decision,'allowed-once',change);
  }
});

test('human guard rejects ambiguous, untracked and unloaded enhanced requests but preserves other modes',async()=> {
  const f=fixture();const guard=createHumanApprovalGuard(f.ctx,f.readConfig);
  const req={agent:f.agent,toolName:f.exec.name,callId:f.exec.callId,signal:f.exec.signal};
  assert.equal(await guard.approval(req,async()=>assert.fail('untracked')),'rejected');
  await guard.prepare(f.exec,async()=>({kind:'allow'}));
  await guard.prepare({...f.exec,token:Symbol('duplicate')},async()=>({kind:'allow'}));
  assert.equal(await guard.approval(req,async()=>assert.fail('ambiguous')),'rejected');
  guard.close();assert.equal(await guard.approval(req,async()=>assert.fail('closed')),'cancelled');
  f.setPreset('workspace-write');assert.equal(await guard.approval(req,async()=>'allowed-once'),'allowed-once');
});

test('human and model admissions are rechecked at dispatch after queued authorization changes',async()=> {
  for(const human of [false,true]) {
    const {root,child:f}=delegated();const guard=createHumanApprovalGuard(f.ctx,f.readConfig);
    await guard.prepare(f.exec,async()=>({kind:human?'ask':'allow'}));
    if(human)assert.equal(await guard.approval({agent:f.agent,toolName:f.exec.name,callId:f.exec.callId,signal:f.exec.signal},async()=>'allowed-once'),'allowed-once');
    root.user.data.content[0].text='Stop the queued action.';
    let dispatched=false;
    await assert.rejects(guard.execute(f.exec,async()=>{dispatched=true;}),/authorization changed/);
    assert.equal(dispatched,false);
  }
});

test('unchanged admission executes once and teardown cannot dispatch an admitted downgraded call',async()=> {
  const f=fixture();const guard=createHumanApprovalGuard(f.ctx,f.readConfig);
  await guard.prepare(f.exec,async()=>({kind:'allow'}));
  assert.equal(await guard.execute(f.exec,async()=>'executed'),'executed');
  await assert.rejects(guard.execute(f.exec,async()=>assert.fail('reused')));
  const other={...f.exec,token:Symbol('teardown')};
  await guard.prepare(other,async()=>({kind:'allow'}));
  guard.close();f.setPreset('workspace-write');
  await assert.rejects(guard.execute(other,async()=>assert.fail('unloaded')));
});

test('fork copies cannot replay a stale root grant as current authority',()=> {
  const {root,child:f}=delegated();
  f.user.data.source={kind:'user',rpcId:'old-root-grant'};f.session.isOwnSeq=()=>false;
  f.user.data.content=[{type:'text',text:'Old inherited permission to publish.'}];
  root.add('user/message',{source:{kind:'user',rpcId:'revoke'},content:[{type:'text',text:'Do not publish.'}]},true);
  const snapshot=snapshotReview(f.ctx,f.agent,f.exec,'C:\\project',new Map());
  const authority=snapshot.history.filter(entry=>entry.kind==='user-message' && entry.role==='user-instruction');
  assert(authority.every(entry=>entry.source.authorizationSessionId==='root'));
  assert.equal(authority.at(-1).content[0].text,'Do not publish.');
  assert(snapshot.history.some(entry=>entry.role==='fact' && entry.content?.[0]?.text==='Old inherited permission to publish.'));
  root.nodes.length=0;
  assert.throws(()=>snapshotReview(f.ctx,f.agent,f.exec,'C:\\project',new Map()),/no longer retained/);
});
