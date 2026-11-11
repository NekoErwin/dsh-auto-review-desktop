import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { createVolatile } from '@deepseek-ai/cosmokit';
import * as plugin from '../src/index.js';
import { DEFAULTS, ReviewBudget } from '../src/runtime.js';
import { createReviewGate } from '../src/gate.js';
import { fixture, answer } from './helpers.mjs';

test('real Cordis mounts and disposes native settings, RPC and an independent gate',async()=>{
  const ctx=new Context();const registered=new Map();let settings=0;let rpc;let promptContext;
  const f=fixture();
  const presets=f.ctx.permissionPresets.presets;
  for(const [key,value] of Object.entries({...f.ctx,
    settings:{configure(){assert.equal(settings,0);settings++;return()=>settings--;}},
    commands:{register(def){registered.set(def.name,def);return()=>registered.delete(def.name);}},
    connection:{register(owner,channel,handler){assert.equal(typeof owner.webServer.register,'function');assert.equal(channel,'/auto-review-desktop');rpc=handler;return()=>{rpc=undefined;};}},
    webServer:{register(){return()=>{};}},
    systemPrompt:{getContextOrder:()=>0,context(def){assert(['auto-review-desktop:delegation','auto-review-desktop:workspace-requests'].includes(def.name));if(def.name==='auto-review-desktop:delegation')promptContext=def;return()=>{if(def.name==='auto-review-desktop:delegation')promptContext=undefined;};}},
    tools:{},agents:{get(){},isOwnedBy(){return false;}},permissionPresets:{...f.ctx.permissionPresets,registerAuto(){throw Error('Official Auto must remain independent');}}
  }))ctx.provide(key,value);
  const fiber=ctx.plugin(plugin,{});await fiber;
  assert.equal(fiber.state,2);assert(presets['auto-review-desktop']);assert.equal(settings,1);assert.equal(typeof rpc,'function');assert(promptContext);assert.equal(promptContext.text({agent:f.agent}), '');
  assert.equal((await rpc('status',{},null,{principal:{kind:'guest'}})).ok,false);
  const view=await rpc('status',{},null,{principal:{kind:'owner'}});assert(view.ok);assert(!('recent'in view.value));assert(!('sessionId'in view.value));
  const result=await ctx.waterfall('tools/pre-execute',f.exec,async()=>({kind:'allow'}));assert.equal(result.kind,'allow');
  await fiber.restart();assert.equal(fiber.state,2);assert(presets['auto-review-desktop']);assert.equal(settings,1);
  await fiber.dispose();assert.equal(presets['auto-review-desktop'],undefined);assert.equal(settings,0);assert.equal(rpc,undefined);assert.equal(promptContext,undefined);
  await ctx.fiber.dispose();
});
test('real Schema materializes a single volatile configuration reference',()=>{
  const cfg=plugin.Config({routeMode:'specific',provider:'review',model:'cheap'});
  assert.equal(typeof cfg.get,'function');assert.equal(cfg.get().maxRetries,0);assert.equal(cfg.get().provider,'review');
  assert.equal(cfg.get().preciseDeletion,true);
  assert.equal(plugin.Config({preciseDeletion:false}).get().preciseDeletion,false);
  assert.throws(()=>plugin.Config({preciseDeletion:'false'}));
});
test('integrity mismatch cannot become an approval prompt even with ask policy',async()=>{
  const f=fixture({config:{failurePolicy:'ask'}});f.exec.arguments={content:'different action'};
  const result=await createReviewGate(f.ctx,f.readConfig).gate(f.exec,f.next);
  assert.equal(result.kind,'deny');assert.equal(f.getDownstreamCalls(),0);
});
test('old budget tickets cannot alter a later turn circuit state',()=>{
  const f=fixture();const b=new ReviewBudget();const old=b.take(f.session,100);
  f.add('turn/start',{turn:2});const next=b.take(f.session,100);b.failure(old);
  assert.equal(next.failures,0);b.failure(next);b.success(old);assert.equal(next.failures,1);
});
test('pre-dispatch blocking is audited without pretending a model attempt occurred',async()=>{
  const f=fixture({config:{maxInputChars:4000}});const gate=createReviewGate(f.ctx,f.readConfig);
  await gate.gate(f.exec,f.next);const totals=gate.stats.view().totals;
  assert.equal(totals.attempts,0);assert.equal(totals.gates,1);assert.equal(totals.blockedBeforeDispatch,1);
});
test('hot unload sets canonical sandbox policy rather than a redefined preset',async()=>{
  const f=fixture();f.ctx.permissionPresets.set=()=>{throw Error('Unsafe preset setter must not be called');};
  await createReviewGate(f.ctx,f.readConfig).close();
  assert(f.events.some(e=>e.type==='sandbox/mode'&&e.data.mode==='workspace-write'));
  assert(f.events.some(e=>e.type==='approval/policy'&&e.data.policy==='ask'));
});
