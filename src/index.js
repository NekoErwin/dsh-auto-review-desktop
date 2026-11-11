import Schema from '@deepseek-ai/schemastery';
import { createReviewGate } from './gate.js';
import { DEFAULTS, normalizeConfig, ReviewStats } from './runtime.js';
import { createAuditJournal } from './audit.js';
import { registerDesktopPreset } from './preset.js';

export const name='auto-review-desktop';
export const inject=['approval','llm','permissionPresets','sessions','tools','workingDirectory','commands','settings','connection','webServer','sandboxPolicy','fs','shell'];
// One atomic volatile object: model/provider and policy changes never leave mixed live settings.
export const Config=Schema.object({
  routeMode:Schema.union(['follow','specific']).default(DEFAULTS.routeMode),
  provider:Schema.string().default(''), model:Schema.string().default(''),
  reasoningMode:Schema.union(['low','default','specific']).default(DEFAULTS.reasoningMode),
  reasoningEffort:Schema.string().default(''),
  timeoutMs:Schema.number().min(1000).max(180000).step(1).default(DEFAULTS.timeoutMs),
  maxOutputTokens:Schema.number().min(256).max(16384).step(1).default(DEFAULTS.maxOutputTokens),
  maxInputChars:Schema.number().min(4000).max(1000000).step(1).default(DEFAULTS.maxInputChars),
  maxReviewsPerTurn:Schema.number().min(1).max(1000).step(1).default(DEFAULTS.maxReviewsPerTurn),
  maxRetries:Schema.union([0,1]).default(DEFAULTS.maxRetries),
  preciseDeletion:Schema.boolean().default(DEFAULTS.preciseDeletion),
  workspaceEscalation:Schema.union(['ask','review']).default(DEFAULTS.workspaceEscalation),
  failurePolicy:Schema.union(['deny','ask']).default(DEFAULTS.failurePolicy),
}).volatile();

export function apply(ctx,config) {
  const readConfig=()=>normalizeConfig(config.get());
  readConfig();
  const journal=createAuditJournal(ctx.get('profileContext')?.dir,ctx.logger);
  const stats=new ReviewStats(event=>journal.write(event));
  const runtime=createReviewGate(ctx,readConfig,{stats});
  ctx.provide('autoReviewDesktop',runtime);
  ctx.effect(()=>ctx.settings.configure({auto:false}),'auto-review-desktop settings');
  ctx.effect(()=>ctx.connection.register(ctx,'/auto-review-desktop',async(endpoint,_payload,_signal,peer)=>{
    if(peer?.principal?.kind!=='owner')return {ok:false,error:{code:'FORBIDDEN',message:'Owner access required'}};
    if(endpoint!=='status')return {ok:false,error:{code:'NOT_FOUND',message:'Unknown review endpoint'}};
    return {ok:true,value:{totals:stats.view().totals,usageCoverage:stats.view().usageCoverage,running:runtime.accepting,scope:'process',audit:journal.available?'available':'unavailable'}};
  }),'auto-review-desktop status RPC');
  ctx.commands.register({
    name:'auto-review-status',description:'Show review configuration, session attempt budget and actual reported usage',
    handler:invocation=>({kind:'success',text:JSON.stringify({config:readConfig(),
      ...(invocation.agent?.session?{turn:runtime.budget.state(invocation.agent.session)}:{}),
      ...stats.view()},null,2)}),
  });
  ctx.effect(function*(){
    yield ctx.on('tools/pre-execute',(exec,next)=>runtime.gate(exec,next),{prepend:true});
    yield ctx.on('tools/execute',(exec,next)=>runtime.execute(exec,next),{prepend:true});
    yield ctx.on('approval/request',(request,next)=>runtime.approval(request,next),{prepend:true});
    yield ctx.on('tools/result',exec=>{runtime.release(exec);});
    yield registerDesktopPreset(ctx.permissionPresets);
    yield async()=>{
      try {await runtime.close({applicationShutdown:ctx.root.fiber.state!==2});}
      finally {await journal.close();}
    };
  },'auto-review-desktop lifecycle');
}
