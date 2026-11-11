import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {SystemPrompt} from '@deepseek-ai/dsh-system-prompt';
import {escalationContext,registerEscalationContext} from '../src/escalation-context.js';
import {fixture} from './helpers.mjs';
import {nativeTools} from './native-tools.mjs';

const native=await nativeTools();after(()=>native.close());
function setup() {
  const f=fixture({config:{workspaceEscalation:'review'}});f.setPreset('auto-review-workspace');f.add('sandbox/mode',{mode:'workspace-write'});
  f.ctx.tools=native.tools;return f;
}

test('enhanced workspace context teaches explicit first-call review without a deliberately failed probe',()=>{
  const f=setup();const text=escalationContext(f.ctx,f.readConfig,{agent:f.agent});
  assert(text.includes('FIRST call'));assert(text.includes('sandbox_permissions="danger-full-access"'));assert(text.includes('non-empty justification'));
  assert(text.includes('configured reviewer'));assert(text.includes('no requirement to deliberately fail'));
  assert(text.includes('current user instructions'));assert(text.includes('obey explicit task restrictions on escalation'));
  assert(text.includes('finally rejected'));assert(text.includes('Do not automatically rerun shell commands after partial execution'));
  assert.equal(escalationContext(f.ctx,f.readConfig,{}),'');
  f.setPreset('workspace-write');assert.equal(escalationContext(f.ctx,f.readConfig,{agent:f.agent}),'');
  f.setPreset('auto-review-desktop');assert.equal(escalationContext(f.ctx,f.readConfig,{agent:f.agent}),'');
});

test('current approval and escalation settings determine guidance without changing standing permission facts',()=>{
  const f=setup();f.session.header.origin='subagent';f.session.header.parentSession='parent';
  const text=escalationContext(f.ctx,f.readConfig,{agent:f.agent});
  assert(text.includes('enhanced child uses its recorded approval policy'));assert(text.includes('does not widen this session or its descendants'));
  const count=f.events.length;
  f.setConfig({workspaceEscalation:'ask'});assert(escalationContext(f.ctx,f.readConfig,{agent:f.agent}).includes('user must approve'));
  f.setPolicy('never');const blocked=escalationContext(f.ctx,f.readConfig,{agent:f.agent});
  assert(blocked.includes('Do not request wider execution'));assert(!blocked.includes('FIRST call'));assert(!blocked.includes('does not prohibit'));
  assert.equal(f.events.length,count+1,'Only the intentional test policy switch appends a permission event');
});

test('disabled child human fallback does not disable configured automatic review or invent a manual path',()=>{
  const f=setup();f.session.header.origin='subagent';f.setConfig({subagentApproval:'deny'});
  const automatic=escalationContext(f.ctx,f.readConfig,{agent:f.agent});assert(automatic.includes('configured reviewer'));assert(automatic.includes('FIRST call'));
  assert(automatic.includes('Human fallback is disabled'));
  f.setConfig({workspaceEscalation:'ask'});const manual=escalationContext(f.ctx,f.readConfig,{agent:f.agent});
  assert(manual.includes('Do not request wider execution'));assert(!manual.includes('FIRST call'));
});

test('guidance is limited to compatible visible native escalation tools',()=>{
  const f=setup();f.ctx.tools={get:()=>undefined};assert.equal(escalationContext(f.ctx,f.readConfig,{agent:f.agent}),'');
  f.ctx.tools={get:name=>({...native.definitions.get(name),description:'Custom replacement'})};assert.equal(escalationContext(f.ctx,f.readConfig,{agent:f.agent}),'');
});

test('real context assembly and refresh keep enhanced guidance after the native warning and dispose it cleanly',async()=>{
  const f=setup();f.session.header.origin='subagent';f.session.header.parentSession='parent';
  const ctx=new Context();ctx.provide('tools',native.tools);ctx.provide('approval',f.ctx.approval);
  const prompt=new SystemPrompt(ctx,{includeHarnessIdentity:false});
  const nativeText='Ordinary delegated scope: operations that require approval are rejected automatically; do not retry the denied operation.';
  prompt.context({name:'subagent:delegation',order:prompt.getContextOrder('SUBAGENT_DELEGATION'),text:nativeText});
  const stop=registerEscalationContext(ctx,f.readConfig);const context={scope:f.agent,agent:f.agent};
  const assembled=await prompt.assemble(context);
  assert.deepEqual(assembled.contexts.map(entry=>entry.name),['subagent:delegation','auto-review-desktop:workspace-requests']);
  assert.equal(assembled.contexts[0].text,nativeText);assert(assembled.contexts[1].text.includes('FIRST call'));
  f.setConfig({workspaceEscalation:'ask'});const refreshed=prompt.refreshContext(assembled,context);
  assert(refreshed.contexts[1].text.includes('user must approve'));assert(!refreshed.contexts[1].text.includes('configured reviewer'));
  f.setPreset('workspace-write');const ordinary=prompt.refreshContext(assembled,context);
  assert.equal(ordinary.contexts[0].text,nativeText);assert.equal(ordinary.contexts[1].text,'');
  stop();assert.equal((await prompt.assemble(context)).contexts.some(entry=>entry.name==='auto-review-desktop:workspace-requests'),false);
  await ctx.fiber.dispose();
});
