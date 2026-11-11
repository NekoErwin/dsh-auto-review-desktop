import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {mkdir,mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {Context} from '@deepseek-ai/cordis';
import {SandboxedFileSystem} from '@deepseek-ai/dsh-fs-sandbox';
import {ApprovalService} from '@deepseek-ai/dsh-user-approval';
import {createReviewGate} from '../src/gate.js';
import {desktopMode,WORKSPACE_PRESET} from '../src/preset.js';
import {fixture,answer} from './helpers.mjs';
import {nativeTools} from './native-tools.mjs';

const schema=definition=>({name:definition.name,description:definition.description,parameters:definition.parameters});
function loggedCall(f,name,args,callId) {
  const raw=JSON.stringify(args);
  f.add('assistant/message',{turn:1,step:1,message:{role:'assistant',content:[{type:'tool-call',id:callId,name,arguments:raw}]}},true);
  f.add('tool/call',{turn:1,step:1,callId,name,arguments:raw});
  return {...f.exec,name,arguments:Object.freeze(args),callId,rootCallId:callId,token:Symbol(callId)};
}

// Real native tool closures, SandboxedFileSystem and ApprovalService. The model
// stream and retained Session fixtures are deterministic test doubles; no paid
// model, shell command, human click, or filesystem service patch is involved.
for(const delegated of [false,true])test(`first explicit outside write request from ${delegated?'enhanced child':'root'} is reviewed once without a prior failed call`,async t=>{
  const tool='write';
  const testRoot=join(process.cwd(),'tmp');await mkdir(testRoot,{recursive:true});
  const base=await mkdtemp(join(testRoot,'dsh-first-escalation-'));
  assert.equal(resolve(base),base);assert(base.startsWith(join(testRoot,'dsh-first-escalation-')));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const workspace=join(base,'workspace');await mkdir(workspace);
  const outside=join(base,'outside.txt');
  const operation={file_path:outside,content:'approved once\n'};
  const args=Object.freeze({...operation,sandbox_permissions:'danger-full-access',justification:'Perform this exact authorized outside test operation once.'});
  const raw=JSON.stringify(args);const f=fixture({tool,arguments:args,config:{workspaceEscalation:'review'}});
  f.setPreset(WORKSPACE_PRESET);f.add('sandbox/mode',{mode:'workspace-write'});f.session.header.cwd=workspace;
  const authorization=`Perform exactly the requested ${tool} operation on ${outside}; a single wider request may be reviewed. Do not change the session mode.`;
  let rootSession=f.session;
  if(delegated) {
    const root=fixture();root.session.id='first-escalation-root';root.agent.id=root.session.id;
    root.user.data.content=[{type:'text',text:authorization}];rootSession=root.session;
    f.session.id='first-escalation-child';f.agent.id=f.session.id;
    f.session.header={origin:'subagent',parentSession:root.session.id,cwd:workspace};
    f.user.data.source={kind:'user'}; // A native source:user child creation task is parent-authored, not human authority.
    f.user.data.content=[{type:'text',text:'Perform only the narrow operation authorized by the parent.'}];
  } else f.user.data.content=[{type:'text',text:authorization}];
  f.ctx.sessions.get=id=>id===f.session.id?f.session:id===rootSession.id?rootSession:undefined;
  f.ctx.workingDirectory.ensure=async()=>workspace;
  const policy={defaultMode:'workspace-write',resolve:({session=f.session,mode}={})=>({
    mode:mode??session.snapshotEvents().findLast(event=>event.type==='sandbox/mode').data.mode,workspaceRoot:workspace})};
  f.ctx.sandboxPolicy=policy;
  const fsContext=new Context();fsContext.provide('sandboxPolicy',policy);
  t.after(()=>fsContext.fiber.dispose());const fsFiber=fsContext.plugin(SandboxedFileSystem,{});await fsFiber;
  assert.equal(fsFiber.state,2);f.ctx.fs=fsContext.fs;
  const approvalContext=new Context();t.after(()=>approvalContext.fiber.dispose());
  const approval=Object.create(ApprovalService.prototype);
  Object.assign(approval,{ctx:approvalContext,config:{policy:'ask'},approvalProjectionHandle:{stateOf:session=>({turnOpen:true,
    policy:session.snapshotEvents().findLast(event=>event.type==='approval/policy').data.policy})}});
  f.ctx.approval=approval;
  const native=await nativeTools({fs:f.ctx.fs,sandboxPolicy:policy,workingDirectory:f.ctx.workingDirectory,approval});
  t.after(()=>native.close());f.ctx.tools=native.tools;
  f.header.tools=[...native.definitions.values()].map(schema);
  const definition=native.definitions.get(tool);const runtime=createReviewGate(f.ctx,f.readConfig);
  approvalContext.on('approval/request',(request,next)=>runtime.approval(request,next),{prepend:true});
  let human=0;approvalContext.on('approval/request',async()=>{human++;return 'allowed-once';});
  const modesBefore=f.events.filter(event=>event.type==='sandbox/mode').map(event=>event.data.mode);
  const policiesBefore=f.events.filter(event=>event.type==='approval/policy').map(event=>event.data.policy);
  assert.equal(f.events.filter(event=>event.type==='tool/call').length,1,'The explicit request must be the first operation, with no prior denied call');
  assert.equal(f.events.filter(event=>event.type==='approval/asked').length,0);assert.equal(f.requests.length,0);
  assert.equal((await runtime.gate(f.exec,f.next)).kind,'allow');assert.equal(f.getDownstreamCalls(),1);
  await runtime.execute(f.exec,()=>definition.execute(f.exec.arguments,f.exec));
  assert.equal(await readFile(outside,'utf8'),'approved once\n');assert.equal(f.requests.length,1);assert.equal(human,0);
  assert.equal(JSON.stringify(f.exec.arguments),raw);assert.equal(f.events.find(event=>event.type==='tool/call').data.arguments,raw);
  assert.equal(f.events.filter(event=>event.type==='approval/asked').length,1);
  assert.equal(f.events.filter(event=>event.type==='approval/decided').length,1);
  assert.equal(f.events.findLast(event=>event.type==='approval/asked').data.callId,f.exec.callId);
  assert.equal(f.events.findLast(event=>event.type==='approval/decided').data.outcome,'allowed-once');
  assert.equal(desktopMode(f.session),'workspace');assert.equal(policy.resolve().mode,'workspace-write');
  assert.deepEqual(f.events.filter(event=>event.type==='sandbox/mode').map(event=>event.data.mode),modesBefore);
  assert.deepEqual(f.events.filter(event=>event.type==='approval/policy').map(event=>event.data.policy),policiesBefore);
  if(delegated)assert(JSON.stringify(f.requests[0].messages).includes('Perform exactly the requested write operation on'),'The retained root instruction must reach the child reviewer');

  // A later write without a grant remains fenced by the actual native provider.
  const write=native.definitions.get('write');
  await assert.rejects(write.execute({file_path:outside,content:'unapproved second write'},f.exec),/sandbox|denied/i);
  assert.equal(await readFile(outside,'utf8'),'approved once\n');assert.equal(f.requests.length,1);

  // An explicit new request denied by the reviewer does not write or ask a human.
  const deniedTarget=join(base,'reviewer-denied.txt');
  const deniedArgs={file_path:deniedTarget,content:'must not appear',sandbox_permissions:'danger-full-access',justification:'Review this exact additional outside test file.'};
  const deniedRaw=JSON.stringify(deniedArgs);const deniedExec=loggedCall(f,'write',deniedArgs,'denied-first-escalation');
  f.setStream(()=>answer('{"risk":"high","decision":"deny"}'));
  assert.equal((await runtime.gate(deniedExec,f.next)).kind,'allow');
  await assert.rejects(runtime.execute(deniedExec,()=>write.execute(deniedExec.arguments,deniedExec)),/rejected|denied/i);
  await assert.rejects(access(deniedTarget),error=>error.code==='ENOENT');
  assert.equal(f.requests.length,2);assert.equal(human,0);assert.equal(JSON.stringify(deniedExec.arguments),deniedRaw);
  assert.equal(f.events.filter(event=>event.type==='approval/asked').length,2);
  assert.equal(f.events.filter(event=>event.type==='approval/decided').length,2);
  assert.equal(f.events.findLast(event=>event.type==='approval/decided').data.outcome,'rejected');
  assert.equal(desktopMode(f.session),'workspace');assert.equal(policy.resolve().mode,'workspace-write');
  assert.deepEqual(f.events.filter(event=>event.type==='sandbox/mode').map(event=>event.data.mode),modesBefore);
});
