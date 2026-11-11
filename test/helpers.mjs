import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/runtime.js';

export async function* answer(text='{"risk":"low","decision":"allow"}',usage) {
  yield {type:'block-start',index:0,blockType:'text'};
  yield {type:'text-delta',index:0,text};
  yield {type:'block-end',index:0,block:{type:'text',text}};
  if(usage)yield {type:'usage',usage};
  yield {type:'finish',reason:{kind:'stop'}};
}
export function fixture(options={}) {
  const events=[];const nodes=[];
  const add=(type,data,visible=false)=>{const event={type,data,seq:events.length,time:Date.now()};events.push(event);if(visible)nodes.push(event.seq);return event;};
  add('turn/start',{turn:1});
  add('user/message',{source:{kind:'user',rpcId:'human-1'},content:[{type:'text',text:'Update the local project as requested; do not send secrets.'}]},true);
  const user=events.at(-1);
  add('step/start',{turn:1,step:1});
  const args=options.arguments??{file_path:'app.js',content:'hello'};
  const tool=options.tool??'write';const raw=JSON.stringify(args);
  add('assistant/message',{turn:1,step:1,message:{role:'assistant',content:[{type:'tool-call',id:'call-1',name:tool,arguments:raw}]}},true);
  add('tool/call',{turn:1,step:1,callId:'call-1',name:tool,arguments:raw});
  const header={config:{provider:'main',model:'primary'},tools:[{name:tool,description:'Write one project file',parameters:{type:'object',properties:{}}}]};
  const session={id:'test-session',header:{origin:'user'},surface:{nodes},snapshotEvents:()=>events.slice(),requestHeader:()=>header,isOwnSeq:()=>true};
  const agent={session,id:session.id};const controller=new AbortController();
  const exec={agent,name:tool,arguments:args,callId:'call-1',rootCallId:'call-1',token:Symbol('test-execution'),signal:controller.signal};
  let config={...DEFAULTS,...options.config};let preset='auto-review-desktop';let policy='ask';let downstreamCalls=0;
  add('permission/preset',{preset});add('sandbox/mode',{mode:'danger-full-access'});add('approval/policy',{policy});
  session.append=(type,data)=>{add(type,data);if(type==='sandbox/mode')preset=data.mode;if(type==='approval/policy')policy=data.policy;};
  const requests=[];const prepares=[];
  let stream=options.stream??(()=>answer());
  const llm={listProviders:()=>[{id:'main'},{id:'review'}],listModels:async()=>[{id:'cheap',name:'Cheap'}],
    prepareCall:async(route,signal,configure)=>{
      prepares.push(route);const info={reasoning:{efforts:[{id:'low',name:'Low'},{id:'high',name:'High'}],defaultEffort:'high'}};
      const controls=configure({temperature:route.temperature,maxTokens:route.maxTokens},info);
      const prepared={config:{...route,...controls},stream:opts=>{assert(!('tools' in opts));requests.push(opts);return stream(opts,requests.length);}};
      return prepared;
    }};
  const ctx={llm,permissionPresets:{presets:{},emitCatalogChanged(){},current:()=>preset,set:(_session,value)=>{preset=value;add('permission/preset',{preset:value});}},approval:{overrideOf:()=>policy},
    tools:{},fs:{sandboxMode:'workspace-write'},shell:{sandboxMode:'workspace-write'},
    sandboxPolicy:{resolve:()=>({mode:events.findLast(e=>e.type==='sandbox/mode')?.data.mode,workspaceRoot:'C:\\project'})},
    workingDirectory:{ensure:async()=> 'C:\\project'},sessions:{list:()=>[session]}};
  return {ctx,agent,session,exec,events,nodes,user,header,requests,prepares,controller,add,
    readConfig:()=>config,setConfig:next=>{config={...config,...next};},setStream:fn=>{stream=fn;},
    setPolicy:value=>{policy=value;add('approval/policy',{policy:value});},setPreset:value=>{preset=value;add('permission/preset',{preset:value});},getPreset:()=>preset,
    next:async()=>{downstreamCalls++;return {kind:'allow'};},getDownstreamCalls:()=>downstreamCalls};
}
