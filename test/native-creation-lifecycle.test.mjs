import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import { SubagentRuntime, SUBAGENT_DESCRIPTOR_VERSION, foldSubagentDescriptor, snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent';
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import * as fork from '@deepseek-ai/dsh-subagent-fork-in-process';
import { nativeSubagents } from './native-subagents.mjs';
import { createDelegationPolicy } from '../src/delegation.js';
import { desktopMode, WORKSPACE_PRESET } from '../src/preset.js';

// Real: SubagentRuntime.startActivation -> startLocal -> materialize -> setup,
// real built-in providers, descriptors, Session logs, AgentRegistry ownership,
// serial agent/created dispatch, and the enhanced inheritance policy.
// Replaced: AgentFactory/AgentLoop (no LLM), in-memory persistence/projection
// adapters, prompt registration, and cwd storage. No runtime methods are patched.
async function lifecycleHarness() {
  const ctx=new Context(),sessions=new Map(),created=[],submitted=[];
  const approval={config:{policy:'ask'},overrideOf:session=>session.snapshotEvents().findLast(event=>event.type==='approval/policy')?.data.policy};
  const sandboxPolicy={overrideOf:session=>session.snapshotEvents().findLast(event=>event.type==='sandbox/mode')?.data.mode};
  const cwd=new Map();
  for(const [key,value] of Object.entries({approval,sandboxPolicy,
    permissionPresets:{current:session=>session.snapshotEvents().findLast(event=>event.type==='permission/preset')?.data.preset},
    sessions:{get:id=>sessions.get(id),flush:async()=>{}},sessionPersistence:{stat:async()=>undefined},
    sessionProjections:{register:async()=>({stateOf:()=>undefined})},
    workingDirectory:{ensure:async agent=>cwd.get(agent.id)??process.cwd(),set:async(agent,value)=>{cwd.set(agent.id,value);}},
    systemPrompt:{context:()=>()=>{},getContextOrder:()=>0},
    tools:{get:()=>undefined},
  }))ctx.provide(key,value);
  const agents=new AgentRegistry(ctx);
  const policy=createDelegationPolicy(ctx,()=>({subagentApproval:'inherit'}));
  const barrier=Promise.withResolvers(),entered=Promise.withResolvers();let initialized=false;
  ctx.on('agent/created',async payload=>{
    if(payload.agent.session.header.origin!=='subagent')return;
    entered.resolve(payload.agent);
    await barrier.promise;
    policy.created(payload);
    initialized=true;
  });
  const createAgent=async(ownerCtx,options)=>{
    const scope=ownerCtx.plugin(function noModelAgent(){});await scope;
    const agentCtx=scope.ctx;
    const session=Session.create(options.sessionId,options.seed,{version:SESSION_FORMAT_VERSION,id:options.sessionId,
      createdAt:Date.now(),isSeeded:options.seed!==undefined,...options.meta},options.inheritedEventCount);
    sessions.set(session.id,session);
    const idle=Promise.withResolvers();let disposed=false;
    const agent={id:session.id,session,ctx:agentCtx,options:options.agentOptions??{},status:'running',
      inbox:{nextTurn:[],nextStep:[]},whenIdle:()=>idle.promise,
      cancel(){agent.status='idle';idle.resolve();},
      followup(message){
        assert(initialized,'The native runtime must not submit child input before the serial created barrier completes');
        assert.equal(desktopMode(session),'workspace');
        assert.equal(approval.overrideOf(session),'ask');assert.equal(sandboxPolicy.overrideOf(session),'workspace-write');
        submitted.push({agent,message});agent.inbox.nextTurn.push(message);
      },steer(){throw Error('Initial native creation must queue a turn');},
    };
    let detach;
    try {
      await options.setup?.(agentCtx,agent);
      detach=agents.enter(agent,options.parentAgent);
      await agents.announce(agent,'startup',options.signal);
      created.push(agent);
    } catch(error) {detach?.();sessions.delete(session.id);await scope.dispose();throw error;}
    return {agent,async dispose(){if(disposed)return;disposed=true;agent.cancel();detach();sessions.delete(session.id);await scope.dispose();}};
  };
  const factoryStop=agents.setFactory({createAgent,resume:async()=>{throw Error('This focused test never resumes a persisted child');}});
  const runtimeFiber=ctx.plugin(SubagentRuntime,{maxDepth:3,maxActiveSubagents:4});await runtimeFiber;
  assert.equal(runtimeFiber.state,2,'The real subagent runtime must be active');
  const runtime=ctx.subagents;
  spawn.apply(ctx,spawn.Config({}));fork.apply(ctx,fork.Config({}));
  const native=await nativeSubagents();
  // Use native schemas at the enhanced execute boundary so expectedProvider is
  // captured: a fake name-only tool would miss the descriptor-version regression.
  ctx.tools.get=name=>native.definitions.get(name);
  const parentSession=Session.create('native-lifecycle-parent');
  parentSession.append('permission/preset',{preset:WORKSPACE_PRESET});
  parentSession.append('sandbox/mode',{mode:'workspace-write'});parentSession.append('approval/policy',{policy:'ask'});
  parentSession.append('turn/start',{turn:1});parentSession.append('turn/end',{turn:1,reason:{kind:'completed'}});
  const parent={id:parentSession.id,session:parentSession,ctx,options:{provider:'parent-provider',model:'parent-model'},status:'idle',
    inbox:{nextTurn:[],nextStep:[]},inject(){},followup(){},steer(){}};
  sessions.set(parent.id,parentSession);const detachParent=agents.enter(parent,undefined);
  return {ctx,agents,runtime,policy,parent,created,submitted,barrier,entered,
    async close(){barrier.resolve();policy.close();await runtimeFiber.dispose();factoryStop();detachParent();await native.close();await ctx.fiber.dispose();}};
}

for(const provider of ['spawn','fork'])test(`real ${provider} materialization accepts native descriptor and waits for enhanced creation before input`,async t=>{
  const h=await lifecycleHarness();t.after(()=>h.close());
  const signal=new AbortController().signal;
  const name=provider==='spawn'?'subagent':'subagent_fork';
  let accepted=false;
  const pending=h.policy.execute({agent:h.parent,name,signal},()=>h.runtime.startActivation({provider,label:`Native ${provider}`,
    request:{parent:h.parent,prompt:[{type:'text',text:'No model request: inspect lifecycle admission only.'}],maxDepth:3},signal,delivery:'caller'})).then(receipt=>{accepted=true;return receipt;});
  // Attach a rejection handler before inspecting the held barrier.
  pending.catch(()=>{});
  const child=await h.entered.promise;
  assert.equal(accepted,false);assert.equal(h.created.length,0);assert.equal(h.submitted.length,0);
  assert.equal(h.agents.isOwnedBy(child.id,h.parent),true);
  const descriptor=foldSubagentDescriptor(child.session.ownEvents());
  assert(descriptor);assert.equal(descriptor.version,SUBAGENT_DESCRIPTOR_VERSION);
  assert.deepEqual(descriptor,snapshotSubagentDescriptor({mode:'continuable',provider,label:`Native ${provider}`,agentProvider:'parent-provider',agentModel:'parent-model'}));
  assert.equal(descriptor.provider,provider);
  assert.equal(child.session.inheritedEventCount,provider==='fork'?h.parent.session.seq:0);
  assert.equal(h.submitted.length,0,'prepare/setup/announcement must not release input');
  h.barrier.resolve();
  const receipt=await pending;
  assert.equal(receipt.childId,child.id);assert.equal(typeof receipt.messageId,'string');
  assert.equal(accepted,true);assert.equal(h.submitted.length,1);assert.equal(h.submitted[0].agent,child);
  assert.equal(desktopMode(child.session),'workspace');
  assert.equal(child.session.ownEvents().findLast(event=>event.type==='approval/policy').data.policy,'ask');
  assert.equal(child.session.ownEvents().findLast(event=>event.type==='sandbox/mode').data.mode,'workspace-write');
  assert.equal(h.parent.session.snapshotEvents().findLast(event=>event.type==='subagent/catalog').data.childId,child.id);
  await receipt.dispose();
});
