import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncResource } from 'node:async_hooks';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { captureDelegatedPolicyOverrides, appendDelegatedPolicyOverrides, snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent';
import { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets';
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import * as fork from '@deepseek-ai/dsh-subagent-fork-in-process';
import { createDelegationPolicy, canAskHuman } from '../src/delegation.js';
import { desktopMode, DESKTOP_PRESET, WORKSPACE_PRESET, DESKTOP_PRESET_SPEC, WORKSPACE_PRESET_SPEC } from '../src/preset.js';

function harness() {
  const agents=new Map(),owners=new Map();let config={subagentApproval:'inherit'};
  const approval={config:{policy:'ask'},overrideOf:session=>session.snapshotEvents().findLast(e=>e.type==='approval/policy')?.data.policy};
  const ctx={approval,agents:{get:id=>agents.get(id),isOwnedBy:(id,parent)=>owners.get(id)===parent}};
  const policy=createDelegationPolicy(ctx,()=>config);
  let id=0;
  function agent(mode='full',approvalPolicy='ask',parent,seed=[]) {
    const events=[...seed];const inheritedEventCount=seed.length;
    const session={id:`delegation-${++id}`,header:parent?{origin:'subagent',parentSession:parent.id}:{origin:'user'},inheritedEventCount,
      snapshotEvents:()=>events.slice(),ownEvents:()=>events.slice(inheritedEventCount),append(type,data){events.push({type,data,seq:events.length,time:Date.now()});}};
    const value={id:session.id,session,ctx:{get:name=>name==='approval'?approval:name==='sandboxPolicy'?{overrideOf:s=>s.snapshotEvents().findLast(e=>e.type==='sandbox/mode')?.data.mode}:name==='permissionPresets'?presetService:undefined}};
    const presetService=Object.create(PermissionPresetService.prototype);
    Object.assign(presetService,{ctx:{shell:{sandboxMode:'workspace-write'},approval},presets:{
      'workspace-write':{sandbox:'workspace-write',approval:'ask'},'danger-full-access':{sandbox:'danger-full-access',approval:'never'},
      [DESKTOP_PRESET]:DESKTOP_PRESET_SPEC,[WORKSPACE_PRESET]:WORKSPACE_PRESET_SPEC},
      permissionState(s){const all=s.snapshotEvents();return {preset:all.findLast(e=>e.type==='permission/preset')?.data.preset??null,sandbox:all.findLast(e=>e.type==='sandbox/mode')?.data.mode??null,approval:all.findLast(e=>e.type==='approval/policy')?.data.policy??null};}});
    agents.set(value.id,value);if(parent)owners.set(value.id,parent);
    if(mode!=null)select(value,mode,approvalPolicy);
    return value;
  }
  function select(value,mode,approvalPolicy='ask') {
    value.session.append('permission/preset',{preset:mode==='full'?DESKTOP_PRESET:mode==='workspace'?WORKSPACE_PRESET:mode});
    value.session.append('sandbox/mode',{mode:mode==='full'?'danger-full-access':'workspace-write'});
    value.session.append('approval/policy',{policy:approvalPolicy});
  }
  function child(parent,seed=[]) {
    const value=agent(null,'ask',parent,seed);
    value.session.append('subagent/descriptor',snapshotSubagentDescriptor({mode:'continuable',provider:'spawn',label:'test'}));
    appendDelegatedPolicyOverrides(value.session,captureDelegatedPolicyOverrides(parent));
    return value;
  }
  function exec(parent) {return {agent:parent,signal:new AbortController().signal,name:'subagent',callId:`call-${id}`};}
  return {ctx,policy,agent,child,select,exec,agents,owners,setConfig:value=>{config={...config,...value};},approval};
}

test('native spawn and fork policy loss is repaired before returning from created, across generations',async()=>{
  const providers=new Map();const registration={subagents:{registerProvider:p=>providers.set(p.name,p)}};
  spawn.apply(registration,spawn.Config({}));fork.apply(registration,fork.Config({}));
  for(const mode of ['full','workspace'])for(const kind of ['spawn','fork']) {
    const h=harness();let parent=h.agent(mode);
    parent.session.append('turn/end',{turn:1,reason:{kind:'completed'}});
    for(let generation=0;generation<3;generation++) {
      const capturedParent=parent;
      await h.policy.execute(h.exec(parent),async()=>{
        const prepared=await providers.get(kind).prepareContinuable({parent:capturedParent});
        const child=h.child(capturedParent,prepared.seed??[]);
        h.policy.created({agent:child,source:'startup'});
        assert.equal(desktopMode(child.session),mode);
        assert.equal(h.approval.overrideOf(child.session),'ask');
        child.session.append('turn/end',{turn:generation+1,reason:{kind:'completed'}});
        parent=child;
      });
    }
  }
});

test('creation uses entry snapshot despite parent mode and approval changes across awaits',async()=>{
  const h=harness();const parent=h.agent('workspace','ask');let resume;
  const barrier=new Promise(resolve=>{resume=resolve;});let child;
  const pending=h.policy.execute(h.exec(parent),async()=>{
    await barrier;child=h.child(parent);h.policy.created({agent:child,source:'startup'});
  });
  h.select(parent,'full','never');resume();await pending;
  assert.equal(desktopMode(child.session),'workspace');assert.equal(h.approval.overrideOf(child.session),'ask');
});

test('same parent parallel calls keep independent immutable snapshots',async()=>{
  const h=harness();const parent=h.agent('workspace');let firstResume;
  const firstBarrier=new Promise(resolve=>{firstResume=resolve;});let first,second;
  const pending=h.policy.execute(h.exec(parent),async()=>{await firstBarrier;first=h.child(parent);h.policy.created({agent:first,source:'startup'});});
  h.select(parent,'full','never');
  await h.policy.execute(h.exec(parent),async()=>{second=h.child(parent);h.policy.created({agent:second,source:'startup'});});
  firstResume();await pending;
  assert.equal(desktopMode(first.session),'workspace');assert.equal(h.approval.overrideOf(first.session),'ask');
  assert.equal(desktopMode(second.session),'full');assert.equal(h.approval.overrideOf(second.session),'never');
});

test('resume preserves own identity, native never, and later independent user selection',async()=>{
  const h=harness();const parent=h.agent('full');let child;
  await h.policy.execute(h.exec(parent),async()=>{child=h.child(parent);h.policy.created({agent:child,source:'startup'});});
  child.session.append('approval/policy',{policy:'never'});h.select(parent,'workspace');
  const before=child.session.snapshotEvents().length;
  h.policy.created({agent:child,source:'resume'});
  assert.equal(child.session.snapshotEvents().length,before);assert.equal(desktopMode(child.session),'full');assert.equal(h.approval.overrideOf(child.session),'never');
  h.select(child,'workspace-write','ask');const switched=child.session.snapshotEvents().length;
  h.policy.created({agent:child,source:'resume'});assert.equal(child.session.snapshotEvents().length,switched);assert.equal(desktopMode(child.session),undefined);
});

test('missing and expired snapshots reject actual enhanced children with safe canonical policies',async()=>{
  for(const expired of [false,true]) {
    const h=harness();const parent=h.agent('full');let child,resource;
    if(expired)await h.policy.execute(h.exec(parent),async()=>{resource=new AsyncResource('expired-delegation');});
    child=h.child(parent);
    const initialize=()=>h.policy.created({agent:child,source:'startup'});
    assert.throws(()=>resource?resource.runInAsyncScope(initialize):initialize(),/authorization could not be inherited/);
    assert.equal(h.approval.overrideOf(child.session),'never');assert.equal(desktopMode(child.session),undefined);
    assert.equal(child.session.snapshotEvents().findLast(e=>e.type==='sandbox/mode').data.mode,'workspace-write');
    resource?.emitDestroy();
  }
});

test('legacy resume is quarantined rather than deriving current parent authorization',()=>{
  const h=harness();const parent=h.agent('full');const child=h.agent(null,'never',parent);
  child.session.header.origin='subagent';child.session.header.parentSession=parent.id;
  child.session.append('subagent/descriptor',{version:1,mode:'continuable',provider:'spawn',label:'legacy'});
  assert.throws(()=>h.policy.created({agent:child,source:'resume'}),/legacy child/);
  assert.equal(h.approval.overrideOf(child.session),'never');assert.equal(child.session.snapshotEvents().findLast(e=>e.type==='sandbox/mode').data.mode,'workspace-write');
});

test('ownership and parent identity checks exclude unrelated manual or independent sessions',async()=>{
  const h=harness();const parent=h.agent('full');const outsider=h.agent('workspace');
  await h.policy.execute(h.exec(parent),async()=>{
    const manual=h.child(parent);h.owners.delete(manual.id);const before=manual.session.snapshotEvents().length;
    h.policy.created({agent:manual,source:'startup'});assert.equal(manual.session.snapshotEvents().length,before);
    const independent=h.agent('full');const initial=independent.session.snapshotEvents().length;
    h.policy.created({agent:independent,source:'startup'});assert.equal(independent.session.snapshotEvents().length,initial);
    const wrong=h.child(outsider);assert.throws(()=>h.policy.created({agent:wrong,source:'startup'}),/mismatched/);
  });
});

test('non-enhanced parents stay outside inheritance, but switching into enhanced during dispatch fails closed',async()=>{
  const h=harness();const parent=h.agent('workspace-write');
  await h.policy.execute(h.exec(parent),async()=>{
    const child=h.child(parent);const before=child.session.snapshotEvents().length;
    h.policy.created({agent:child,source:'startup'});assert.equal(child.session.snapshotEvents().length,before);
  });
  await h.policy.execute(h.exec(parent),async()=>{
    h.select(parent,'full');const child=h.child(parent);
    assert.throws(()=>h.policy.created({agent:child,source:'startup'}),/mode changed/);
    assert.equal(h.approval.overrideOf(child.session),'never');
    assert.equal(child.session.snapshotEvents().findLast(e=>e.type==='sandbox/mode').data.mode,'workspace-write');
  });
});

test('cancelled captured execution cannot initialize an enhanced child',async()=>{
  const h=harness();const parent=h.agent('full');const execution=h.exec(parent);const controller=new AbortController();execution.signal=controller.signal;
  await h.policy.execute(execution,async()=>{const child=h.child(parent);controller.abort();assert.throws(()=>h.policy.created({agent:child,source:'startup'}),/cancelled/);assert.equal(h.approval.overrideOf(child.session),'never');});
});

test('deny human fallback does not alter model routing or native child approval policy',async()=>{
  const h=harness();const parent=h.agent('full');let child;
  h.setConfig({subagentApproval:'deny'});
  await h.policy.execute(h.exec(parent),async()=>{child=h.child(parent);h.policy.created({agent:child,source:'startup'});});
  assert.equal(h.approval.overrideOf(child.session),'ask');assert.equal(desktopMode(child.session),'full');
  assert.equal(h.policy.canAskHuman(child.session),false);assert.equal(canAskHuman(h.ctx,()=>({subagentApproval:'deny'}),parent.session),true);
  h.setConfig({subagentApproval:'inherit'});assert.equal(h.policy.canAskHuman(child.session),true);
  child.session.append('approval/policy',{policy:'never'});assert.equal(h.policy.canAskHuman(child.session),false);
});

test('close rejects late enhanced initialization and startup of historical children preserves their own policy',async()=>{
  const h=harness();const parent=h.agent('full');let child;
  await h.policy.execute(h.exec(parent),async()=>{child=h.child(parent);h.policy.created({agent:child,source:'startup'});});
  child.session.append('turn/end',{turn:1,reason:{kind:'completed'}});
  child.session.append('approval/policy',{policy:'never'});h.select(parent,'workspace');
  const before=child.session.snapshotEvents().length;
  await h.policy.execute(h.exec(parent),async()=>h.policy.created({agent:child,source:'startup'}));
  assert.equal(child.session.snapshotEvents().length,before);assert.equal(desktopMode(child.session),'full');
  await h.policy.execute(h.exec(parent),async()=>{
    const late=h.child(parent);h.policy.close();
    assert.throws(()=>h.policy.created({agent:late,source:'startup'}),/snapshot/);
    assert.equal(h.approval.overrideOf(late.session),'never');
  });
});

test('native registry awaits created listeners, sees explicit owner, and canonical appends survive pinInitial',async()=>{
  const ctx=new Context();const agents=new AgentRegistry(ctx);const h=harness();const parent=h.agent('full');
  h.ctx.agents=agents;const parentDetach=agents.enter(parent,undefined);const child=h.child(parent);
  const childDetach=agents.enter(child,parent);let beforeResume;
  const barrier=new Promise(resolve=>{beforeResume=resolve;});let initialized=false;
  ctx.on('agent/created',({agent})=>{if(agent===child){
    assert.equal(agents.isOwnedBy(child.id,parent),true);
    parent.ctx.get('permissionPresets').pinInitialPermission(agent.session);
    assert.equal(agent.session.snapshotEvents().findLast(e=>e.type==='permission/preset').data.preset,'danger-full-access');
  }},{prepend:true});
  ctx.on('agent/created',async payload=>{await barrier;h.policy.created(payload);initialized=true;});
  let settled=false;
  const pending=h.policy.execute(h.exec(parent),()=>agents.announce(child,'startup').then(()=>{settled=true;}));
  await Promise.resolve();assert.equal(settled,false);assert.equal(initialized,false);
  beforeResume();await pending;assert.equal(initialized,true);assert.equal(desktopMode(child.session),'full');assert.equal(h.approval.overrideOf(child.session),'ask');
  childDetach();parentDetach();await ctx.fiber.dispose();
});
