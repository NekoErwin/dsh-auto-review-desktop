import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {win32} from 'node:path';
import {readFile} from 'node:fs/promises';
import {captureDelegatedPolicyOverrides,appendDelegatedPolicyOverrides,snapshotSubagentDescriptor,SUBAGENT_DESCRIPTOR_VERSION} from '@deepseek-ai/dsh-subagent';
import {createReviewGate} from '../src/gate.js';
import {createHumanApprovalGuard} from '../src/human-approval.js';
import {createDelegationPolicy} from '../src/delegation.js';
import {coordinationContext} from '../src/coordination.js';
import {desktopMode} from '../src/preset.js';
import {fixture} from './helpers.mjs';
import {nativeSubagents} from './native-subagents.mjs';
import {nativeTools} from './native-tools.mjs';

const native=await nativeSubagents();const files=await nativeTools();
after(async()=>{await native.close();await files.close();});
const schemas=definition=>({name:definition.name,description:definition.description,parameters:definition.parameters});
function setup(name='subagent',args={description:'Test native creation',prompt:'Perform the delegated task.'}) {
  const f=fixture({tool:name,arguments:args});f.setPreset('auto-review-workspace');f.add('sandbox/mode',{mode:'workspace-write'});
  f.session.header.cwd='C:\\project';f.agent.options={provider:'stale',model:'stale',reasoningEffort:'old'};
  const definitions=new Map([...native.definitions,...files.definitions]);
  f.ctx.tools={get:name=>definitions.get(name)};f.header.tools=[...definitions.values()].map(schemas);
  const subagents={getProvider:name=>native.providers.get(name)};f.ctx.get=name=>name==='subagents'?subagents:undefined;
  f.ctx.fs={sandboxMode:'workspace-write',resolve:async(path,{cwd='C:\\project'}={})=>({targetKey:win32.resolve(cwd,path).toLowerCase()}),
    contains:(root,target)=>target.targetKey===root.targetKey||target.targetKey.startsWith(root.targetKey+'\\')};
  const agents=new Map([[f.agent.id,f.agent]]),owners=new Map();
  f.ctx.agents={get:id=>agents.get(id),isOwnedBy:(id,parent)=>owners.get(id)===parent};
  f.ctx.sessions.get=id=>agents.get(id)?.session;
  f.agent.ctx={get:key=>key==='approval'?f.ctx.approval:key==='sandboxPolicy'?{overrideOf:()=> 'workspace-write'}:undefined};
  return {...f,definitions,subagents,agents,owners};
}
function newCall(f,name,args) {
  const callId='coordination-'+f.events.length;const raw=JSON.stringify(args);
  f.add('assistant/message',{turn:1,step:1,message:{role:'assistant',content:[{type:'tool-call',id:callId,name,arguments:raw}]}},true);
  f.add('tool/call',{turn:1,step:1,callId,name,arguments:raw});
  return {...f.exec,name,callId,rootCallId:callId,arguments:args,token:Symbol(callId)};
}

test('compatible workspace creation and discovery do not prompt but preserve downstream gates',async()=>{
  for(const [name,args] of [['subagent',{description:'Spawn',prompt:'Task'}],['subagent_fork',{cwd:'src',description:'Fork',prompt:'Task'}],
    ['list_subagent_models',{}],['list_agents',{scope:'children'}],['interrupt_agent',{agent_id:'child'}]]) {
    const f=setup(name,args);const runtime=createReviewGate(f.ctx,f.readConfig);
    assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow',name);assert.equal(f.requests.length,0);assert.equal(f.getDownstreamCalls(),1);
    assert.equal((await runtime.gate(f.exec,async()=>({kind:'deny',reason:'another policy'}))).kind,'deny');
    assert.equal((await runtime.gate(f.exec,async()=>({kind:'ask',reason:'another answerer'}))).kind,'ask');
  }
});

test('creation outside the parent workspace, unsupported backends and definitions retain outside policy',async()=>{
  for(const change of ['outside-cwd','external','route-defaults','schema','no-registry']) {
    const f=setup('subagent',change==='outside-cwd'?{cwd:'C:\\outside',description:'Spawn',prompt:'Task'}:undefined);
    if(change==='external')f.subagents.getProvider=()=>({prepareContinuable:undefined,inheritsParentContext:false});
    if(change==='route-defaults')f.subagents.getProvider=()=>({prepareContinuable(){},inheritsParentContext:false,agentRouteDefaults:{provider:'other',model:'other'}});
    if(change==='schema')f.definitions.set('subagent',{...f.definitions.get('subagent'),description:'Unrecognized creator'});
    if(change==='no-registry')f.ctx.get=()=>undefined;
    const runtime=createReviewGate(f.ctx,f.readConfig);
    assert.equal((await runtime.gate(f.exec,f.next)).kind,'ask',change);
    f.setConfig({workspaceEscalation:'review'});assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow',change);assert.equal(f.requests.length,1);
  }
  const f=setup();const runtime=createReviewGate(f.ctx,f.readConfig);
  assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow');
  f.subagents.getProvider=()=>({prepareContinuable:undefined,inheritsParentContext:false});
  let body=0;await assert.rejects(runtime.execute(f.exec,async()=>{body++;}));assert.equal(body,0);
});

test('blank route selections fail before approval and no requested values are rewritten',async()=>{
  for(const extra of [{provider:'',model:''},{provider:' ',model:' '},{reasoning_effort:''},{provider:'main'},{model:'primary'}]) {
    const args={description:'Test',prompt:'Task',...extra};const original=structuredClone(args);const f=setup('subagent',args);
    const decision=await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next);
    assert.equal(decision.kind,'deny');assert.match(decision.reason,/Omit|omit/);assert.deepEqual(args,original);assert.equal(f.getDownstreamCalls(),0);
  }
  const f=setup('subagent',{description:'Test',prompt:'Task',provider:'default',model:'default'});
  assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'allow','A real id named default is left to native allowlist validation');
});

test('live adjacent enhanced messaging is exempt while unknown or changed recipients are not',async()=>{
  const f=setup('send_message',{agent_id:'child',message:'Continue the narrow task'});
  const child=fixture();child.agent.id='child';child.session.id='child';child.session.header={origin:'subagent',parentSession:f.agent.id};
  child.setPreset('auto-review-workspace');child.add('sandbox/mode',{mode:'workspace-write'});
  f.agents.set('child',child.agent);f.owners.set('child',f.agent);
  const runtime=createReviewGate(f.ctx,f.readConfig);
  assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow');
  child.setPreset('danger-full-access');child.add('sandbox/mode',{mode:'danger-full-access'});
  let body=0;await assert.rejects(runtime.execute(f.exec,async()=>{body++;}));assert.equal(body,0);
  assert.equal((await runtime.gate(f.exec,f.next)).kind,'ask');
  f.agents.delete('child');assert.equal((await runtime.gate(f.exec,f.next)).kind,'ask','Cold recipient cannot inherit the live exemption');
});

test('native creation closure inherits review before child work and only the child action asks',async t=>{
  const f=setup();const human=createHumanApprovalGuard(f.ctx,f.readConfig);const delegation=createDelegationPolicy(f.ctx,f.readConfig);
  const runtime=createReviewGate(f.ctx,f.readConfig);let child;
  const real=await nativeSubagents({services:{subagents:{async startActivation(spec){
    assert.equal(spec.provider,'spawn');assert.equal(spec.request.agentOptions,undefined);
    child=setup('custom',{operation:'outside-action'});child.agent.id='actual-child';child.session.id='actual-child';
    child.events.length=0;child.nodes.length=0;child.session.header={origin:'subagent',parentSession:f.agent.id,cwd:'C:\\project'};
    child.add('subagent/descriptor',snapshotSubagentDescriptor({provider:spec.provider,mode:'continuable',label:'test'}));
    f.agents.set(child.agent.id,child.agent);f.owners.set(child.agent.id,f.agent);
    appendDelegatedPolicyOverrides(child.session,captureDelegatedPolicyOverrides(f.agent));
    delegation.created({agent:child.agent,source:'startup'});
    assert.equal(desktopMode(child.session),'workspace');
    assert.equal(child.events.findLast(event=>event.type==='approval/policy').data.policy,'ask');
    return {childId:child.agent.id};
  }}}});t.after(()=>real.close());
  f.definitions.set('subagent',real.definitions.get('subagent'));
  assert.equal((await human.prepare(f.exec,()=>runtime.gate(f.exec,f.next))).kind,'allow');
  const result=await delegation.execute(f.exec,()=>human.execute(f.exec,()=>runtime.execute(f.exec,()=>real.definitions.get('subagent').execute(f.exec.arguments,f.exec))));
  assert.equal(result.subagentId,'actual-child');assert.equal(f.requests.length,0);
  child.ctx.sessions.get=id=>id===f.session.id?f.session:id===child.session.id?child.session:undefined;
  child.add('turn/start',{turn:1});child.user=child.add('user/message',{source:{kind:'agent-message',senderSessionId:f.session.id},content:[{type:'text',text:'A bounded parent task.'}]},true);
  child.add('step/start',{turn:1,step:1});
  child.header.tools.push({name:'custom',description:'A non-native operation',parameters:{type:'object',properties:{operation:{type:'string'}}}});
  const action=newCall(child,'custom',{operation:'outside-action'});const childRuntime=createReviewGate(child.ctx,child.readConfig);
  assert.equal((await childRuntime.gate(action,child.next)).kind,'ask');
  assert.equal(child.requests.length,0);assert.equal(f.requests.length,0);
  human.close();delegation.close();
});

test('native creation binding is checked on the actual child descriptor before input can run',async()=>{
  const base=snapshotSubagentDescriptor({provider:'spawn',mode:'continuable',label:'Binding test'});
  for(const descriptor of [{...base,provider:'custom'},{...base,mode:'one-shot'},{...base,version:SUBAGENT_DESCRIPTOR_VERSION+1},
    {...base,version:1},{...base,label:undefined},{...base,unrecognized:true}]) {
    const f=setup();const delegation=createDelegationPolicy(f.ctx,f.readConfig);
    await delegation.execute(f.exec,async()=>{
      const events=[{type:'subagent/descriptor',data:descriptor,seq:0}];
      const session={id:'binding-child',header:{origin:'subagent',parentSession:f.agent.id},snapshotEvents:()=>events.slice(),
        ownEvents:()=>events.slice(),append(type,data){events.push({type,data,seq:events.length});}};
      const child={id:session.id,session};f.agents.set(child.id,child);f.owners.set(child.id,f.agent);
      assert.throws(()=>delegation.created({agent:child,source:'startup'}),/unsupported native delegation backend binding|invalid native delegation descriptor/);
      assert.equal(desktopMode(session),undefined);assert.equal(events.findLast(event=>event.type==='approval/policy').data.policy,'never');
    });
    delegation.close();
  }
});

test('observed failed spawn and fork descriptors now inherit before the child input barrier',async()=>{
  const observed=JSON.parse(await readFile(new URL('./fixtures/observed-subagent-descriptors.json',import.meta.url),'utf8'));
  for(const descriptor of observed.descriptors) {
    const name=descriptor.provider==='fork'?'subagent_fork':'subagent';const f=setup(name);
    const delegation=createDelegationPolicy(f.ctx,f.readConfig);let inputReleased=false;
    await delegation.execute(f.exec,async()=>{
      const seed=descriptor.provider==='fork'?[{seq:0,type:'subagent/descriptor',data:snapshotSubagentDescriptor({mode:'continuable',provider:'ancestor',label:'Historical descriptor'})}]:[];
      const events=[...seed];const session={id:'observed-child',inheritedEventCount:seed.length,header:{origin:'subagent',parentSession:f.agent.id},
        snapshotEvents:()=>events.slice(),ownEvents:()=>events.slice(seed.length),append(type,data){events.push({type,data,seq:events.length});}};
      session.append('subagent/descriptor',structuredClone(descriptor));appendDelegatedPolicyOverrides(session,captureDelegatedPolicyOverrides(f.agent));
      const child={id:session.id,session};f.agents.set(child.id,child);f.owners.set(child.id,f.agent);
      assert.equal(inputReleased,false);delegation.created({agent:child,source:'startup'});
      assert.equal(desktopMode(session),'workspace');assert.equal(events.findLast(e=>e.type==='approval/policy').data.policy,'ask');
      assert.equal(events.findLast(e=>e.type==='sandbox/mode').data.mode,'workspace-write');inputReleased=true;
    });
    assert.equal(inputReleased,true);delegation.close();
  }
});

test('a later descriptor cannot replace an unsupported first own descriptor',async()=>{
  const f=setup();const delegation=createDelegationPolicy(f.ctx,f.readConfig);
  await delegation.execute(f.exec,async()=>{
    const first=snapshotSubagentDescriptor({provider:'custom',mode:'continuable',label:'First own identity'});
    const replacement=snapshotSubagentDescriptor({provider:'spawn',mode:'continuable',label:'Attempted rewrite'});
    const events=[first,replacement].map((data,seq)=>({type:'subagent/descriptor',data,seq}));
    const session={id:'rewritten-child',header:{origin:'subagent',parentSession:f.agent.id},snapshotEvents:()=>events.slice(),ownEvents:()=>events.slice(),
      append(type,data){events.push({type,data,seq:events.length});}};
    const child={id:session.id,session};f.agents.set(child.id,child);f.owners.set(child.id,f.agent);
    assert.throws(()=>delegation.created({agent:child,source:'startup'}),/unsupported native delegation backend binding/);
    assert.equal(desktopMode(session),undefined);assert.equal(events.findLast(e=>e.type==='approval/policy').data.policy,'never');
  });delegation.close();
});

test('full-access mode still reviews native creation and prompt context is conditional and route-accurate',async()=>{
  const f=setup();f.header.config={provider:'fixture-provider',model:'fixture-model',reasoningEffort:'high'};
  const text=coordinationContext(f.ctx,{agent:f.agent});
  assert(text.includes('"provider":"fixture-provider"'));assert(text.includes('"reasoning_effort":"high"'));
  assert(text.includes('Omit provider, model and reasoning_effort'));assert(!text.includes('stale'));
  assert.equal(coordinationContext(f.ctx,{}),'');
  f.setPreset('workspace-write');assert.equal(coordinationContext(f.ctx,{agent:f.agent}),'');
  f.setPreset('auto-review-desktop');f.add('sandbox/mode',{mode:'danger-full-access'});
  assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'allow');assert.equal(f.requests.length,1);
});
