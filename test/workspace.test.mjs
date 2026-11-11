import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { win32, join, resolve } from 'node:path';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox';
import { Context } from '@deepseek-ai/cordis';
import { ApprovalService } from '@deepseek-ai/dsh-user-approval';
import { approveEscalation } from '@deepseek-ai/dsh-sandbox';
import { createReviewGate } from '../src/gate.js';
import { WORKSPACE_PRESET, DESKTOP_PRESET, desktopMode, registerDesktopPreset } from '../src/preset.js';
import { nativeCompatible } from '../src/native-compatibility.js';
import { normalizeConfig } from '../src/runtime.js';
import { fixture, answer } from './helpers.mjs';
import { nativeTools } from './native-tools.mjs';

const captured=await nativeTools();after(()=>captured.close());
const schema=def=>({name:def.name,description:def.description,parameters:def.parameters,...def.deferLoading?{deferLoading:true}:{}});
function workspaceFixture({tool='write',arguments:args={file_path:'app.js',content:'hello'},config={}}={}) {
  const f=fixture({tool,arguments:args,config});
  f.setPreset(WORKSPACE_PRESET);f.add('sandbox/mode',{mode:'workspace-write'});
  f.session.header.cwd='C:\\project';
  f.ctx.tools={get:name=>captured.definitions.get(name)};
  f.ctx.fs={sandboxMode:'workspace-write',resolve:async(path,{cwd='C:\\project'}={})=>({displayPath:win32.resolve(cwd,path),targetKey:win32.resolve(cwd,path).toLowerCase()}),
    contains:(root,target)=>target.targetKey===root.targetKey || target.targetKey.startsWith(root.targetKey+'\\')};
  const definition=captured.definitions.get(tool);
  if(definition)f.header.tools=[schema(definition)];
  return f;
}
function request(f,overrides={}) {
  return {agent:f.agent,toolName:f.exec.name,callId:f.exec.callId,reason:`escalate sandbox to danger-full-access: ${f.exec.arguments.justification}`,signal:f.exec.signal,...overrides};
}
function escalationFixture(config={}) {
  return workspaceFixture({tool:'pwsh',arguments:{command:'Write-Output okay',description:'Test exact escalation',sandbox_permissions:'danger-full-access',justification:'Test this single outside operation.'},config});
}

test('execution wrapper leaves unrelated permission modes independent of plugin settings',async()=>{
  const f=workspaceFixture();f.setPreset('auto');
  const runtime=createReviewGate(f.ctx,()=>{throw Error('Do not read unrelated plugin configuration');});
  let calls=0;assert.equal(await runtime.execute(f.exec,async()=>{calls++;return 'untouched';}),'untouched');assert.equal(calls,1);
});

test('both presets are independent and legacy full-access identity is retained',()=>{
  const f=workspaceFixture();const service={presets:{},emitCatalogChanged(){}};const stop=registerDesktopPreset(service);
  assert.equal(service.presets[WORKSPACE_PRESET].sandbox,'workspace-write');assert.equal(service.presets[DESKTOP_PRESET].sandbox,'danger-full-access');
  assert.equal(desktopMode(f.session),'workspace');f.setPolicy('never');assert.equal(desktopMode(f.session),'workspace');
  stop();assert.deepEqual(service.presets,{});
  assert.equal(normalizeConfig().workspaceEscalation,'ask');assert.throws(()=>normalizeConfig({workspaceEscalation:'allow'}));
});

test('native compatibility uses real built-in schemas and rejects name-only substitutes',()=>{
  for(const definition of captured.definitions.values())assert(nativeCompatible(definition),definition.name);
  assert(!nativeCompatible({name:'write',description:'Unrelated custom write',parameters:{type:'object'}}));
  assert(!nativeCompatible({...captured.definitions.get('write'),parameters:{type:'object'}}));
});

test('workspace native file shell read search and cwd operations bypass model with downstream intact',async()=>{
  for(const [tool,args] of [
    ['write',{file_path:'app.js',content:'okay'}],['edit',{file_path:'app.js',old_string:'a',new_string:'b'}],
    ['read',{file_path:'app.js'}],['read_image',{file_path:'image.png'}],['glob',{pattern:'*.js'}],['grep',{pattern:'hello'}],
    ['working_directory',{}],['working_directory',{cd:'src'}],
    ['pwsh',{command:'Get-Date',description:'Read clock'}],['bash',{command:'pwd',description:'Read cwd'}],
    ['apply_patch',{input:'*** Begin Patch\n*** Add File: a.js\n+hello\n*** End Patch'}],
    ['apply_patch',{input:'*** Begin Patch\n*** Delete File: generated.js\n*** End Patch'}],
  ]) {
    const f=workspaceFixture({tool,arguments:args});const runtime=createReviewGate(f.ctx,f.readConfig);
    assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow',tool);assert.equal(f.requests.length,0,tool);assert.equal(f.getDownstreamCalls(),1);
    assert.equal((await runtime.gate(f.exec,async()=>({kind:'deny',reason:'other guard'}))).kind,'deny');
  }
});

test('outward reads searches and cwd changes obey ask or review and keep the original workspace root',async()=>{
  for(const [tool,args] of [['read',{file_path:'..\\private.txt'}],['read_image',{file_path:'C:\\outside\\image.png'}],
    ['glob',{path:'C:\\outside',pattern:'*'}],['grep',{path:'C:\\outside',pattern:'x'}],['working_directory',{cd:'C:\\outside'}],
    ['pwsh',{workdir:'C:\\outside',command:'Get-Date',description:'Test outside cwd'}]]) {
    const f=workspaceFixture({tool,arguments:args});const runtime=createReviewGate(f.ctx,f.readConfig);
    assert.equal((await runtime.gate(f.exec,f.next)).kind,'ask',tool);assert.equal(f.requests.length,0);
    f.setConfig({workspaceEscalation:'review'});assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow',tool);assert.equal(f.requests.length,1);
    f.setPolicy('never');f.setConfig({workspaceEscalation:'ask'});assert.equal((await runtime.gate(f.exec,f.next)).kind,'deny');
  }
  const f=workspaceFixture({tool:'read',arguments:{file_path:'private.txt'}});f.ctx.workingDirectory.ensure=async()=>'C:\\outside';
  assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'ask');
});

test('external writes and patch move destinations require explicit single-call escalation',async()=>{
  for(const [tool,args] of [['write',{file_path:'..\\outside.txt',content:'x'}],['edit',{file_path:'..\\outside.txt',old_string:'x',new_string:'y'}],
    ['apply_patch',{input:'*** Begin Patch\n*** Update File: app.js\n*** Move to: ..\\outside.js\n@@\n-a\n+b\n*** End Patch'}]]) {
    const f=workspaceFixture({tool,arguments:args});const result=await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next);
    assert.equal(result.kind,'deny');assert(result.reason.includes('sandbox_permissions'));assert.equal(f.requests.length,0);assert.equal(f.getDownstreamCalls(),0);
  }
});

test('unknown tools, schema mismatches and replaced definitions never inherit the fast path',async()=>{
  const f=workspaceFixture({tool:'custom',arguments:{file_path:'app.js'}});assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'ask');
  const g=workspaceFixture();let definition=captured.definitions.get('write');g.ctx.tools.get=()=>definition;
  const runtime=createReviewGate(g.ctx,g.readConfig);assert.equal((await runtime.gate(g.exec,g.next)).kind,'allow');
  definition={...definition};assert.equal((await runtime.gate(g.exec,g.next)).kind,'ask');
  const h=workspaceFixture();h.ctx.tools.get=()=>({...captured.definitions.get('write'),description:'custom'});
  assert.equal((await createReviewGate(h.ctx,h.readConfig).gate(h.exec,h.next)).kind,'ask');
});

test('missing sandbox capabilities and inconsistent logged actions do not silently bypass',async()=>{
  const f=workspaceFixture();f.ctx.fs.sandboxMode=undefined;
  assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'ask');
  const g=workspaceFixture();g.exec.arguments={file_path:'changed.js',content:'surprise'};
  assert.equal((await createReviewGate(g.ctx,g.readConfig).gate(g.exec,g.next)).kind,'deny');assert.equal(g.getDownstreamCalls(),0);
});

test('canonical aliases that resolve outside do not bypass path approval',async()=>{
  const f=workspaceFixture({tool:'read',arguments:{file_path:'link\\private.txt'}});const resolve=f.ctx.fs.resolve;
  f.ctx.fs.resolve=(path,options)=>resolve(path==='link\\private.txt'?'C:\\outside\\private.txt':path,options);
  assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'ask');
});

test('queued path aliases are resolved again before an exempt read executes',async()=>{
  const f=workspaceFixture({tool:'read',arguments:{file_path:'link\\private.txt'}});const runtime=createReviewGate(f.ctx,f.readConfig);
  assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow');
  const original=f.ctx.fs.resolve;f.ctx.fs.resolve=(path,options)=>original(path==='link\\private.txt'?'C:\\outside\\private.txt':path,options);
  let body=0;await assert.rejects(runtime.execute(f.exec,async()=>{body++;}));assert.equal(body,0);
});

test('changing to never while the model or human is deciding invalidates escalation',async()=>{
  for(const method of ['review','ask']) {
    const f=escalationFixture({workspaceEscalation:method});const runtime=createReviewGate(f.ctx,f.readConfig);
    f.setStream(async function*(){f.setPolicy('never');yield* answer();});
    const outcome=await runtime.execute(f.exec,()=>runtime.approval(request(f),async()=>{f.setPolicy('never');return 'allowed-once';}));
    assert.equal(outcome,'rejected',method);
  }
});

test('manual escalation uses only the native approval once and no review tokens',async()=>{
  const f=escalationFixture();const runtime=createReviewGate(f.ctx,f.readConfig);let human=0;
  assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow');
  const outcome=await runtime.execute(f.exec,()=>runtime.approval(request(f),async()=>{human++;return 'allowed-once';}));
  assert.equal(outcome,'allowed-once');assert.equal(human,1);assert.equal(f.requests.length,0);assert.equal(desktopMode(f.session),'workspace');
});

test('reviewed escalation is answered at the native approval boundary and is single-use',async()=>{
  const f=escalationFixture({workspaceEscalation:'review'});const runtime=createReviewGate(f.ctx,f.readConfig);let human=0;
  assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow');assert.equal(f.requests.length,0);
  await runtime.execute(f.exec,async()=>{
    assert.equal(await runtime.approval(request(f),async()=>{human++;return 'unavailable';}),'allowed-once');
    assert.equal(await runtime.approval(request(f),async()=>{human++;return 'allowed-once';}),'rejected');
  });
  assert.equal(f.requests.length,1);assert.equal(human,0);assert.equal(desktopMode(f.session),'workspace');
  assert.equal(await runtime.approval(request(f),async()=> 'unavailable'),'unavailable');
});

test('auto-answer cannot be borrowed by a different call agent reason or pre-dispatch ask',async()=>{
  const f=escalationFixture({workspaceEscalation:'review'});const runtime=createReviewGate(f.ctx,f.readConfig);let delegated=0;
  assert.equal(await runtime.approval(request(f),async()=>{delegated++;return 'unavailable';}),'unavailable');
  await runtime.execute(f.exec,async()=>{
    for(const overrides of [{callId:'other'},{agent:{...f.agent}},{toolName:'write'},{reason:'Other approval request'}]) {
      assert.equal(await runtime.approval(request(f,overrides),async()=>{delegated++;return 'unavailable';}),'unavailable');
    }
    assert.equal(await runtime.approval(request(f),async()=> 'unavailable'),'allowed-once');
  });
  assert.equal(delegated,5);assert.equal(f.requests.length,1);
});

test('review denial and configured failure fallback delegate one human approval, never auto-allow',async()=>{
  for(const failure of [false,true]) {
    const f=escalationFixture({workspaceEscalation:'review',failurePolicy:'ask',denialPolicy:'ask'});const runtime=createReviewGate(f.ctx,f.readConfig);let human=0;
    f.setStream(()=>answer(failure?'invalid':'{"risk":"medium","decision":"deny","reason":"Missing exact authority"}'));
    const outcome=await runtime.execute(f.exec,()=>runtime.approval(request(f),async()=>{human++;return 'rejected';}));
    assert.equal(outcome,'rejected');assert.equal(human,1);
  }
});

test('never and cancellation remain final for reviewed escalation',async()=>{
  const f=escalationFixture({workspaceEscalation:'review'});const runtime=createReviewGate(f.ctx,f.readConfig);f.setPolicy('never');
  assert.equal(await runtime.execute(f.exec,()=>runtime.approval(request(f),async()=> 'allowed-once')),'rejected');assert.equal(f.requests.length,0);
  const g=escalationFixture({workspaceEscalation:'review'});const other=createReviewGate(g.ctx,g.readConfig);
  g.setStream(async function*(){g.controller.abort();yield* answer();});
  assert.equal(await other.execute(g.exec,()=>other.approval(request(g),async()=> 'allowed-once')),'cancelled');
});

test('changed authorization settings or mode invalidate workspace admission before effects',async()=>{
  for(const change of ['authorization','settings','mode']) {
    const f=workspaceFixture();const runtime=createReviewGate(f.ctx,f.readConfig);let body=0;
    assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow');
    if(change==='authorization')f.add('user/message',{source:{kind:'user',rpcId:'stop'},content:[{type:'text',text:'Stop writing files'}]},true);
    if(change==='settings')f.setConfig({workspaceEscalation:'review'});
    if(change==='mode'){f.setPreset(DESKTOP_PRESET);f.add('sandbox/mode',{mode:'danger-full-access'});}
    await assert.rejects(runtime.execute(f.exec,async()=>{body++;}));assert.equal(body,0);
  }
});

test('switching modes during a reviewed escalation cancels its automatic grant',async()=>{
  const f=escalationFixture({workspaceEscalation:'review'});const runtime=createReviewGate(f.ctx,f.readConfig);
  f.setStream(async function*(){f.setPreset(DESKTOP_PRESET);f.add('sandbox/mode',{mode:'danger-full-access'});yield* answer();});
  assert.equal(await runtime.execute(f.exec,()=>runtime.approval(request(f),async()=> 'allowed-once')),'cancelled');
});

test('PTC inner native calls use their own token and sandbox approval identity',async()=>{
  const f=workspaceFixture({tool:'run_code',arguments:{code:'write()'},config:{workspaceEscalation:'review'}});
  const args={file_path:'C:\\outside\\one.txt',content:'one',sandbox_permissions:'danger-full-access',justification:'Test one PTC write.'};
  const callId='call-1:ptc:1';
  f.add('tool/ptc-dispatch-start',{parentCallId:'call-1',subCallId:callId,rootCallId:'call-1',name:'write',arguments:args});
  const inner={...f.exec,name:'write',arguments:args,callId,parent:f.exec.token,token:Symbol('inner'),schema:schema(captured.definitions.get('write'))};
  const runtime=createReviewGate(f.ctx,f.readConfig);
  assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow');assert.equal(f.requests.length,0);
  assert.equal((await runtime.gate(inner,f.next)).kind,'allow');assert.equal(f.requests.length,0);
  await runtime.execute(inner,async()=>{
    const req={agent:f.agent,toolName:'write',callId,reason:`escalate sandbox to danger-full-access: ${args.justification}`,signal:f.exec.signal};
    assert.equal(await runtime.approval({...req,callId:'call-1'},async()=> 'unavailable'),'unavailable');
    assert.equal(await runtime.approval(req,async()=> 'unavailable'),'allowed-once');
  });
  assert.equal(f.requests.length,1);assert(f.requests[0].messages.at(-1).content[0].text.includes('PTC write'));
});

test('real native filesystem confines writes and a reviewed grant changes only one call',async t=>{
  const testRoot=join(process.cwd(),'tmp');await mkdir(testRoot,{recursive:true});
  const base=await mkdtemp(join(testRoot,'dsh-dual-mode-'));
  // Verify the generated absolute cleanup target before installing its disposer.
  assert.equal(resolve(base),base);assert(base.startsWith(join(testRoot,'dsh-dual-mode-')));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const root=join(base,'workspace');await mkdir(root);const outside=join(base,'outside.txt');
  const f=workspaceFixture();f.ctx.workingDirectory.ensure=async()=>root;f.session.header.cwd=root;
  const policy={defaultMode:'workspace-write',resolve:()=>({mode:f.events.findLast(e=>e.type==='sandbox/mode').data.mode,workspaceRoot:root})};
  f.ctx.sandboxPolicy=policy;const fsContext=new Context();fsContext.provide('sandboxPolicy',policy);
  const fsFiber=fsContext.plugin(SandboxedFileSystem,{});await fsFiber;assert.equal(fsFiber.state,2);t.after(()=>fsContext.fiber.dispose());f.ctx.fs=fsContext.fs;
  const approvalContext=new Context();t.after(()=>approvalContext.fiber.dispose());
  const approval=Object.create(ApprovalService.prototype);Object.assign(approval,{ctx:approvalContext,config:{policy:'ask'},approvalProjectionHandle:{stateOf:()=>({turnOpen:true,policy:f.events.findLast(e=>e.type==='approval/policy').data.policy})}});
  f.ctx.approval=approval;
  const real=await nativeTools({fs:f.ctx.fs,sandboxPolicy:policy,workingDirectory:f.ctx.workingDirectory,approval});t.after(()=>real.close());f.ctx.tools=real.tools;
  const definition=real.definitions.get('write');f.header.tools=[schema(definition)];
  const runtime=createReviewGate(f.ctx,f.readConfig);approvalContext.on('approval/request',(req,next)=>runtime.approval(req,next),{prepend:true});
  let human=0;approvalContext.on('approval/request',async()=>{human++;return 'allowed-once';});
  assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow');
  await runtime.execute(f.exec,()=>definition.execute(f.exec.arguments,f.exec));assert.equal(f.requests.length,0);
  assert.equal(await readFile(join(root,'app.js'),'utf8'),'hello');
  // The actual native tool/provider rejects outside mutations without a grant.
  await assert.rejects(definition.execute({file_path:outside,content:'unapproved'},f.exec),/sandbox|denied/i);
  const args={file_path:outside,content:'approved once',sandbox_permissions:'danger-full-access',justification:'Write this one disposable outside test file.'};
  const callId='write-outside';const raw=JSON.stringify(args);
  f.add('assistant/message',{turn:1,step:1,message:{role:'assistant',content:[{type:'tool-call',id:callId,name:'write',arguments:raw}]}},true);
  f.add('tool/call',{turn:1,step:1,callId,name:'write',arguments:raw});
  const exec={...f.exec,callId,rootCallId:callId,arguments:args,token:Symbol('outside')};
  f.setConfig({workspaceEscalation:'review'});
  assert.equal((await runtime.gate(exec,f.next)).kind,'allow');
  await runtime.execute(exec,()=>definition.execute(args,exec));
  assert.equal(await readFile(outside,'utf8'),'approved once');assert.equal(human,0);assert.equal(f.requests.length,1);
  assert.equal(desktopMode(f.session),'workspace');assert.equal(policy.resolve().mode,'workspace-write');
  assert.equal(f.events.findLast(e=>e.type==='approval/decided').data.outcome,'allowed-once');
  await assert.rejects(definition.execute({file_path:outside,content:'second unapproved write'},f.exec),/sandbox|denied/i);
  assert.equal(await readFile(outside,'utf8'),'approved once');
});

test('native ApprovalService keeps audit pairs and enforces never before model routing',async()=>{
  const f=escalationFixture({workspaceEscalation:'review'});const runtime=createReviewGate(f.ctx,f.readConfig);const ctx=new Context();let human=0;
  const approval=Object.create(ApprovalService.prototype);
  Object.assign(approval,{ctx,config:{policy:'ask'},approvalProjectionHandle:{stateOf:()=>({turnOpen:true,policy:f.ctx.approval.overrideOf(f.session)})}});
  ctx.on('approval/request',(req,next)=>runtime.approval(req,next),{prepend:true});ctx.on('approval/request',async()=>{human++;return 'allowed-once';});
  const run=()=>runtime.execute(f.exec,()=>approveEscalation({requestedMode:'danger-full-access',effectiveMode:'workspace-write',justification:f.exec.arguments.justification,subject:'command'},
    {approver:approval,agent:f.agent,callId:f.exec.callId,toolName:f.exec.name,signal:f.exec.signal}));
  assert.equal(await run(),'danger-full-access');assert.equal(human,0);assert.equal(f.requests.length,1);
  assert.equal(f.events.filter(e=>e.type==='approval/asked').length,1);assert.equal(f.events.findLast(e=>e.type==='approval/decided').data.outcome,'allowed-once');
  assert.equal(desktopMode(f.session),'workspace');
  f.setPolicy('never');await assert.rejects(run());assert.equal(f.requests.length,1);assert.equal(human,0);
  assert.equal(f.events.findLast(e=>e.type==='approval/decided').data.outcome,'rejected');await ctx.fiber.dispose();
});
