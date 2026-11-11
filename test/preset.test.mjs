import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { PermissionPresetService } from '@deepseek-ai/dsh-permission-presets';
import * as official from '@deepseek-ai/dsh-experimental-auto-review';
import * as desktop from '../src/index.js';
import { DESKTOP_PRESET, registerDesktopPreset, isDesktopReview } from '../src/preset.js';
import { createReviewGate } from '../src/gate.js';
import { fixture, answer } from './helpers.mjs';

// Use the host's real catalog/selection/derive implementation. Only its projection
// storage is replaced with an event fold over the fixture's durable session log.
function presetService(ctx) {
  const service=Object.create(PermissionPresetService.prototype);
  Object.assign(service,{ctx,presets:{
    'workspace-write':{sandbox:'workspace-write',approval:'ask'},
    'danger-full-access':{sandbox:'danger-full-access',approval:'never'},
  },defaultSettings:()=>({defaultPreset:'workspace-write'}),
  permissionState(session){
    const events=session.snapshotEvents();
    return {preset:events.findLast(e=>e.type==='permission/preset')?.data.preset??null,
      sandbox:events.findLast(e=>e.type==='sandbox/mode')?.data.mode??null,
      approval:events.findLast(e=>e.type==='approval/policy')?.data.policy??null};
  }});
  return service;
}

test('real official and Desktop gates coexist and only the selected reviewer runs',async()=>{
  const ctx=new Context();const f=fixture();let officialCalls=0;
  const service=presetService(ctx);
  f.ctx.llm.stream=()=>{officialCalls++;return answer();};
  for(const [key,value] of Object.entries({...f.ctx,permissionPresets:service,
    shell:{sandboxMode:'workspace-write'},systemPrompt:{context:()=>()=>{},getContextOrder:()=>0},settings:{configure:()=>()=>{}},
    commands:{register:()=>()=>{}},connection:{register:()=>()=>{}},webServer:{},tools:{},agents:{get(){},isOwnedBy(){return false;}},
  }))ctx.provide(key,value);
  const originalRegisterAuto=service.registerAuto;
  const officialFiber=ctx.plugin(official);await officialFiber;
  const desktopFiber=ctx.plugin(desktop,{});await desktopFiber;
  assert.equal(officialFiber.state,2);assert.equal(desktopFiber.state,2);
  assert.equal(service.registerAuto,originalRegisterAuto);
  assert(service.catalog().options.some(o=>o.value==='auto'));
  assert(service.catalog().options.some(o=>o.value===DESKTOP_PRESET));
  const execute=async()=>{try{return await ctx.waterfall('tools/pre-execute',f.exec,f.next);}finally{ctx.emit('tools/result',f.exec);}};
  service.set(f.session,'auto');
  assert.equal(service.current(f.session),'auto');
  assert.equal((await execute()).kind,'allow');assert.equal(officialCalls,1);assert.equal(f.requests.length,0);
  service.set(f.session,DESKTOP_PRESET);
  assert.equal(service.current(f.session),DESKTOP_PRESET);
  assert.equal((await execute()).kind,'allow');assert.equal(officialCalls,1);assert.equal(f.requests.length,1);
  // A delegated child pins never; real host derives full access, but our durable
  // identity must still enforce review and keep a reviewer denial final.
  f.setPolicy('never');assert.equal(service.current(f.session),'danger-full-access');
  f.setStream(()=>answer('{"risk":"high","decision":"deny"}'));
  assert.equal((await execute()).kind,'deny');assert.equal(officialCalls,1);assert.equal(f.requests.length,2);
  service.set(f.session,'auto');
  const before=f.events.length;
  await desktopFiber.dispose();
  assert.equal(f.events.length,before);assert.equal(service.current(f.session),'auto');
  assert(service.catalog().options.some(o=>o.value==='auto'));
  assert(!service.catalog().options.some(o=>o.value===DESKTOP_PRESET));
  assert.equal((await execute()).kind,'allow');assert.equal(officialCalls,2);
  service.set(f.session,'workspace-write');
  await officialFiber.dispose();await ctx.fiber.dispose();
});

test('Desktop operates without the official integration and unregisters only its own key',async()=>{
  const ctx=new Context();ctx.provide('shell',{sandboxMode:'workspace-write'});ctx.provide('approval',{config:{policy:'ask'}});
  const service=presetService(ctx);const stop=registerDesktopPreset(service);const f=fixture();
  assert.equal(service.names.includes('auto'),false);assert.equal(service.current(f.session),DESKTOP_PRESET);
  assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'allow');
  stop();assert.equal(service.names.includes(DESKTOP_PRESET),false);assert(service.presets['workspace-write']);
  await ctx.fiber.dispose();
});

test('unloading Desktop downgrades only its sessions, including delegated never sessions',async()=>{
  const own=fixture(),child=fixture(),officialSession=fixture();
  child.setPolicy('never');officialSession.setPreset('auto');
  own.ctx.sessions.list=()=>[own.session,child.session,officialSession.session];
  const before=officialSession.events.length;
  await createReviewGate(own.ctx,own.readConfig).close();
  assert.equal(own.getPreset(),'workspace-write');assert.equal(child.getPreset(),'workspace-write');
  assert.equal(isDesktopReview(child.session),false);assert.equal(officialSession.events.length,before);
});

test('switching to official Auto during a Desktop review cancels the old result',async()=>{
  const f=fixture();f.setStream(async function*(){f.setPreset('auto');yield* answer();});
  assert.equal((await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next)).kind,'cancel');
  assert.equal(f.getDownstreamCalls(),0);
});

test('duplicate Desktop registration fails without replacing another contribution',()=>{
  const previous={sandbox:'workspace-write',approval:'ask'};
  const service={presets:{[DESKTOP_PRESET]:previous},emitCatalogChanged(){}};
  assert.throws(()=>registerDesktopPreset(service),/already registered/);
  assert.equal(service.presets[DESKTOP_PRESET],previous);
});
