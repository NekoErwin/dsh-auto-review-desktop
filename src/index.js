import Schema from '@deepseek-ai/schemastery';
import { createReviewGate } from './gate.js';
import { DEFAULTS, normalizeConfig, ReviewStats } from './runtime.js';
import { createAuditJournal } from './audit.js';
import { createReviewHistory } from './history.js';
import { registerDesktopPreset } from './preset.js';
import { createDelegationPolicy } from './delegation.js';
import { createHumanApprovalGuard } from './human-approval.js';
import { registerCoordinationContext } from './coordination.js';
import { registerEscalationContext } from './escalation-context.js';

export const name='auto-review-desktop';
export const inject=['approval','llm','permissionPresets','sessions','tools','workingDirectory','commands','settings','connection','webServer','sandboxPolicy','fs','shell','agents','systemPrompt'];
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
  workspaceReads:Schema.union(['allow','approve']).default(DEFAULTS.workspaceReads),
  failurePolicy:Schema.union(['deny','ask']).default(DEFAULTS.failurePolicy),
  denialPolicy:Schema.union(['deny','ask']).default(DEFAULTS.denialPolicy),
  subagentApproval:Schema.union(['inherit','deny']).default(DEFAULTS.subagentApproval),
}).volatile();

export function apply(ctx,config) {
  const readConfig=()=>normalizeConfig(config.get());
  readConfig();
  const journal=createAuditJournal(ctx.get('profileContext')?.dir,ctx.logger);
  const stats=new ReviewStats(event=>journal.write(event));
  const history=createReviewHistory(ctx.get('profileContext')?.dir,ctx.logger);
  const runtime=createReviewGate(ctx,readConfig,{stats,history});
  const delegation=createDelegationPolicy(ctx,readConfig);
  const human=createHumanApprovalGuard(ctx,readConfig);
  ctx.provide('autoReviewDesktop',runtime);
  ctx.effect(()=>ctx.settings.configure({auto:false}),'auto-review-desktop settings');
  const statusHandler=async(endpoint,_payload,_signal,peer)=>{
    if(peer?.principal?.kind!=='owner')return {ok:false,error:{code:'FORBIDDEN',message:'Owner access required'}};
    if(endpoint==='history' || endpoint==='watch-history') {
      const {sessionId,revision}=_payload??{};
      if(typeof sessionId!=='string' || !sessionId || sessionId.length>256 || (endpoint==='watch-history' && (!Number.isSafeInteger(revision) || revision<0)))
        return {ok:false,error:{code:'INVALID_INPUT',message:'Invalid history request'}};
      const value=endpoint==='history'?await history.read(sessionId):await history.watch(sessionId,revision,_signal);
      return {ok:true,value};
    }
    if(endpoint!=='status')return {ok:false,error:{code:'NOT_FOUND',message:'Unknown review endpoint'}};
    return {ok:true,value:{totals:stats.view().totals,usageCoverage:stats.view().usageCoverage,running:runtime.accepting,scope:'process',audit:journal.available?'available':'unavailable'}};
  };
  // Explicit caller ownership is required by Desktop 0.2.2-rc.1: its rpc
  // getter can retain the service context without the caller's webServer inject.
  ctx.effect(()=>ctx.connection.register(ctx,'/auto-review-desktop',statusHandler),'auto-review-desktop status RPC');
  ctx.commands.register({
    name:'auto-review-status',description:'Show review configuration, session attempt budget and actual reported usage',
    handler:invocation=>({kind:'success',text:JSON.stringify({config:readConfig(),
      ...(invocation.agent?.session?{turn:runtime.budget.state(invocation.agent.session)}:{}),
      ...stats.view()},null,2)}),
  });
  ctx.effect(function*(){
    yield registerCoordinationContext(ctx);
    yield registerEscalationContext(ctx,readConfig);
    yield ctx.on('agent/created',payload=>delegation.created(payload));
    yield ctx.on('tools/pre-execute',(exec,next)=>human.prepare(exec,()=>runtime.gate(exec,next)),{prepend:true});
    yield ctx.on('tools/execute',(exec,next)=>delegation.execute(exec,()=>human.execute(exec,()=>runtime.execute(exec,next))));
    yield ctx.on('approval/request',(request,next)=>runtime.approval(request,()=>human.approval(request,next)),{prepend:true});
    yield ctx.on('tools/result',exec=>{runtime.release(exec);human.release(exec);});
    yield registerDesktopPreset(ctx.permissionPresets);
    yield async()=>{
      human.close();delegation.close();
      try {await runtime.close({applicationShutdown:ctx.root.fiber.state!==2});}
      finally {await Promise.all([journal.close(),history.close()]);}
    };
  },'auto-review-desktop lifecycle');
}
