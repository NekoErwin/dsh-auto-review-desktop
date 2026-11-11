import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveChildAgentOptions } from '@deepseek-ai/dsh-subagent';
import { nativeCompatible } from '../src/native-compatibility.js';
import { nativeSubagents } from './native-subagents.mjs';

const CREATION=['subagent','subagent_fork'];
const CONTROL=['list_subagent_models','list_agents','send_message','interrupt_agent'];
function parent() {
  const events=[{seq:0,type:'turn/start',data:{turn:1}},{seq:1,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}];
  return {id:'native-parent',options:{provider:'old-provider',model:'old-model',reasoningEffort:'high',maxTokens:4096},
    session:{id:'native-parent',header:{origin:'user'},snapshotEvents:()=>events.slice(),
      requestHeader:()=>({config:{provider:'parent-provider',model:'parent-model',reasoningEffort:'low'}})}};
}
function execution(agent=parent()) {return {agent,signal:new AbortController().signal,callId:'native-subagent-call'};}
const args={description:'Test native delegation',prompt:'Perform one narrow local task.'};

test('native subagent fingerprints cover only the local spawn/fork model-selection variants and controls',async t=>{
  for(const modelSelection of [false,true]) {
    const native=await nativeSubagents({modelSelection});t.after(()=>native.close());
    assert.deepEqual([...native.definitions.keys()].sort(),[...CREATION,...CONTROL].sort());
    for(const name of [...CREATION,...CONTROL])assert.equal(nativeCompatible(native.definitions.get(name)),true,`${name}: ${modelSelection}`);
    for(const name of CREATION) {
      const definition=native.definitions.get(name);
      assert.equal(typeof definition.execute,'function');
      assert.equal(definition.parameters.properties.agent_preset,undefined);
      assert.equal(Boolean(definition.parameters.properties.provider),modelSelection);
    }
    assert.equal(typeof native.providers.get('spawn').prepareContinuable,'function');
    assert.equal(typeof native.providers.get('fork').prepareContinuable,'function');
    assert.equal(native.providers.get('spawn').inheritsParentContext,false);
    assert.equal(native.providers.get('fork').inheritsParentContext,true);
  }
});

test('native schema fingerprints reject lookalikes and changes to the complete model-facing contract',async t=>{
  const native=await nativeSubagents();t.after(()=>native.close());
  for(const name of [...CREATION,...CONTROL]) {
    const definition=native.definitions.get(name);
    assert.equal(nativeCompatible({name,description:'Custom implementation',parameters:{}}),false,name);
    assert.equal(nativeCompatible({...definition,name:`custom_${name}`}),false,name);
    assert.equal(nativeCompatible({...definition,description:definition.description+' changed'}),false,name);
    assert.equal(nativeCompatible({...definition,deferLoading:true}),false,name);
    const parameters=structuredClone(definition.parameters);
    parameters.custom={type:'string',description:'Unreviewed capability'};
    assert.equal(nativeCompatible({...definition,parameters}),false,name);
  }
});

test('custom preset choices and external backend descriptions do not match native local creation',async t=>{
  const custom=await nativeSubagents({spawnConfig:{allowedAgentPresets:['custom-preset']}});t.after(()=>custom.close());
  assert.equal(nativeCompatible(custom.definitions.get('subagent')),false);
  for(const modelSelection of [false,true]) {
    const external=await nativeSubagents({modelSelection,providerOverrides:{
      spawn:{prepareContinuable:undefined},fork:{prepareContinuable:undefined},
    }});t.after(()=>external.close());
    for(const name of CREATION)assert.equal(nativeCompatible(external.definitions.get(name)),false,name);
  }
  const routeDefaults=await nativeSubagents({modelSelection:true,providerOverrides:{
    spawn:{agentRouteDefaults:{provider:'external',model:'external-model'}},
    fork:{agentRouteDefaults:{provider:'external',model:'external-model'}},
  }});t.after(()=>routeDefaults.close());
  for(const name of CREATION)assert.equal(nativeCompatible(routeDefaults.definitions.get(name)),false,name);
});

test('real local providers retain their prepare closures and fork only completed parent turns',async t=>{
  const native=await nativeSubagents();t.after(()=>native.close());
  const agent=parent();
  assert.deepEqual(await native.providers.get('spawn').prepareContinuable({parent:agent}),{});
  assert.deepEqual((await native.providers.get('fork').prepareContinuable({parent:agent})).seed,agent.session.snapshotEvents());
});

test('omitted route fields in real creation closures preserve current parent defaults without preflight',async t=>{
  const native=await nativeSubagents();t.after(()=>native.close());
  for(const name of CREATION) {
    const exec=execution();const value=await native.definitions.get(name).execute(args,exec);
    assert.equal(value.kind,'activation');
    const spec=native.starts.at(-1);
    assert.equal(spec.provider,name==='subagent'?'spawn':'fork');
    assert.equal(spec.request.parent,exec.agent);assert.equal(spec.signal,exec.signal);
    assert.equal(spec.request.agentOptions,undefined);assert.equal(spec.request.cwd,undefined);
    assert.deepEqual(resolveChildAgentOptions(exec.agent,spec.request.agentOptions,1),{
      provider:'parent-provider',model:'parent-model',reasoningEffort:'low',maxTokens:4096,subagentDepth:1,
    });
  }
  assert.equal(native.preflights.length,0);
});

test('explicit parent route in real creation closures preflights and starts without mutating the request',async t=>{
  const native=await nativeSubagents();t.after(()=>native.close());
  for(const name of CREATION) {
    const request={...args,cwd:'src',provider:'parent-provider',model:'parent-model',reasoning_effort:'low'};
    const original=structuredClone(request);const exec=execution();
    await native.definitions.get(name).execute(request,exec);
    assert.deepEqual(request,original);
    assert.deepEqual(native.preflights.at(-1),{provider:'parent-provider',model:'parent-model',reasoningEffort:'low'});
    assert.deepEqual(native.starts.at(-1).request.agentOptions,{provider:'parent-provider',model:'parent-model',reasoningEffort:'low'});
    assert.equal(native.starts.at(-1).request.cwd,'src');
  }
});

test('malformed, unauthorized and unavailable explicit routes never start a real native creation closure',async t=>{
  const native=await nativeSubagents();t.after(()=>native.close());
  for(const name of CREATION)for(const invalid of [
    {provider:'',model:'parent-model'},{provider:'parent-provider',model:''},{reasoning_effort:''},
    {provider:'parent-provider'},{model:'parent-model'},
    {provider:'other',model:'other-model'},
  ]) {
    await assert.rejects(native.definitions.get(name).execute({...args,...invalid},execution()),/non-empty|together|not allowed/);
    assert.equal(native.starts.length,0);
  }
  const failing=await nativeSubagents({services:{llm:{resolveCallConfig:async()=>{throw Error('Exact model unavailable');}}}});t.after(()=>failing.close());
  for(const name of CREATION)await assert.rejects(failing.definitions.get(name).execute({...args,provider:'parent-provider',model:'parent-model'},execution()),/Exact model unavailable/);
  assert.equal(failing.starts.length,0);
  const disabled=await nativeSubagents({modelSelection:false});t.after(()=>disabled.close());
  for(const name of CREATION)await assert.rejects(disabled.definitions.get(name).execute({...args,provider:'parent-provider',model:'parent-model'},execution()),/selection is disabled/);
  assert.equal(disabled.starts.length,0);
});

test('real discovery and control closures retain the exact caller and business-service ownership boundary',async t=>{
  const calls=[];
  const native=await nativeSubagents({services:{subagents:{
    listChildren:async(id,signal)=>{calls.push({kind:'list',id,signal});return [];},
    sendMessage:async(...values)=>{calls.push({kind:'send',values});throw Error('Business service denied ownership');},
    interrupt:(...values)=>{calls.push({kind:'interrupt',values});throw Error('Business service denied ownership');},
  }}});t.after(()=>native.close());
  const exec=execution();
  assert.match(await native.definitions.get('list_subagent_models').execute({},exec),/parent-provider/);
  assert.match(await native.definitions.get('list_subagent_models').execute({provider:'parent-provider',model:'parent-model'},exec),/low/);
  assert.deepEqual(await native.definitions.get('list_agents').execute({},exec),[]);
  assert.deepEqual(calls[0],{kind:'list',id:exec.agent.id,signal:exec.signal});
  await assert.rejects(native.definitions.get('send_message').execute({agent_id:'unrelated',message:'hello'},exec),/denied ownership/);
  assert.equal(calls[1].values[0],exec.agent);assert.equal(calls[1].values[1],'unrelated');
  assert.deepEqual(calls[1].values[2],[{type:'text',text:'hello'}]);assert.equal(calls[1].values[3].signal,exec.signal);
  await assert.rejects(native.definitions.get('interrupt_agent').execute({agent_id:'unrelated'},exec),/denied ownership/);
  assert.equal(calls[2].values[0],'unrelated');assert.equal(calls[2].values[1].agent,exec.agent);
  assert.equal(calls[2].values[1].kind,'ancestor');
});
