import { isDesktopReview, desktopMode } from './preset.js';
import { createWorkspaceRouter } from './workspace.js';
import { snapshotReview, DELEGATED_AUTHORITY_POLICY } from './authorization.js';
import { canAskHuman } from './delegation.js';
import { reviewPolicy, deletionEvidenceMessage, deletionActivityKey } from './deletion-policy.js';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval';
import { REVIEW_POLICY, snapshotAutoReview, reviewMessages, readDecision, denied, askUser, failed } from '../vendor/official.js';
import { ReviewError, ReviewBudget, ReviewStats, normalizeConfig, configKey, actionKey, authorizationKey, promptSize, prepareReviewCall, withDeadline, observeUsage, transientFailure } from './runtime.js';

/** Factory seam keeps the installed official policy/snapshot/parser in real tests. */
export function createReviewGate(ctx, readConfig, {stats=new ReviewStats(), snapshot=snapshotAutoReview, parse=readDecision, history}={}) {
  const lifecycle=new AbortController();
  const budget=new ReviewBudget();
  const active=new Set();
  const shownBySession=new WeakMap();
  let accepting=true;
  const isAuto=isDesktopReview;
  const cancelled=exec=>!accepting || lifecycle.signal.aborted || exec.signal?.aborted || !isAuto(exec.agent.session);
  async function review(exec,next) {
    if(!exec.agent || (!exec.parent && exec.name==='run_code') || !isAuto(exec.agent.session)) return next();
    const completion=Promise.withResolvers();active.add(completion.promise);
    const session=exec.agent.session;
    const display=history?.start(exec);
    const initialMode=desktopMode(session);
    const signal=AbortSignal.any([lifecycle.signal,...exec.signal?[exec.signal]:[]]);
    let c;
    let expiresAt;
    let auth;
    let exactAction;
    let sourceRoute;
    let deletionEvidence;
    let deletionActivity;
    let currentAttempt;
    let finalRecorded=false;
    let anyDispatch=false;
    const finish=(decision,code)=>{
      if(!finalRecorded){finalRecorded=true;display?.finish(decision.kind,code);stats.gateOutcome({sessionId:String(session.id),tool:exec.name,callId:String(exec.callId),
        outcome:decision.kind,blockedBeforeDispatch:!anyDispatch,...code?{code}:{} });}
      return decision;
    };
    let downstreamPromise;
    const downstreamOnce=()=>downstreamPromise??=Promise.resolve().then(next);
    let shown=shownBySession.get(session);
    if(!shown){shown=new Map();shownBySession.set(session,shown);}
    const recordAttempt=(attemptState,entry)=>{
      if(!attemptState || attemptState.recorded)return;
      attemptState.recorded=true;
      if(entry.outcome==='allow' || entry.outcome==='deny')budget.success(attemptState.ticket);else budget.failure(attemptState.ticket);
      display?.attempt({provider:attemptState.prepared?.config.provider??null,model:attemptState.prepared?.config.model??null,
        reasoningEffort:attemptState.prepared?.config.reasoningEffort??null,attempt:attemptState.index+1,
        durationMs:Date.now()-attemptState.start,...attemptState.measurement.usage?{usage:attemptState.measurement.usage}:{},
        ...attemptState.verdict?{verdict:attemptState.verdict}:{},...entry});
      stats.record({sessionId:String(session.id),tool:exec.name,callId:String(exec.callId),scope:'review-attempt',
        provider:attemptState.prepared?.config.provider??null,model:attemptState.prepared?.config.model??null,
        reasoningEffort:attemptState.prepared?.config.reasoningEffort??null,attempt:attemptState.index+1,
        durationMs:Date.now()-attemptState.start,usage:attemptState.measurement.usage,...entry});
    };
    const capture=(agent,execution,cwd)=>{
      try{return snapshotReview(ctx,agent,execution,cwd,shown,snapshot);}
      catch {throw new ReviewError('INTEGRITY','Pending action and retained evidence are inconsistent');}
    };
    const validateFresh=async reviewSignal=>{
      reviewSignal.throwIfAborted();
      if(cancelled(exec) || desktopMode(session)!==initialMode) throw new ReviewError('CANCELLED','Review no longer applies');
      if(configKey(normalizeConfig(readConfig()))!==configKey(c) || actionKey(exec)!==exactAction) throw new ReviewError('STALE','Review settings or pending action changed');
      if(c.preciseDeletion && (JSON.stringify(deletionEvidenceMessage(session,exec))!==deletionEvidence || deletionActivityKey(session,exec)!==deletionActivity)) throw new ReviewError('STALE','Deletion inspection evidence or tool activity changed during review');
      const current=capture(exec.agent,exec,await ctx.workingDirectory.ensure(exec.agent,reviewSignal));
      reviewSignal.throwIfAborted();
      if(cancelled(exec) || desktopMode(session)!==initialMode)throw new ReviewError('CANCELLED','Review no longer applies');
      if(configKey(normalizeConfig(readConfig()))!==configKey(c) || actionKey(exec)!==exactAction)throw new ReviewError('STALE','Review settings or pending action changed');
      if(authorizationKey(current)!==auth || JSON.stringify([current.provider,current.model])!==sourceRoute) throw new ReviewError('STALE','User authorization or request route changed during review');
    };
    try {
      c=normalizeConfig(readConfig());
      expiresAt=Date.now()+c.timeoutMs;
      exactAction=actionKey(exec);
      const verdict=await withDeadline(async reviewSignal=>{
        const frozen=capture(exec.agent,exec,await ctx.workingDirectory.ensure(exec.agent,reviewSignal));
        shown.set(frozen.pending.key,frozen.pending.schema);
        auth=authorizationKey(frozen);
        sourceRoute=JSON.stringify([frozen.provider,frozen.model]);
        const system=reviewPolicy(REVIEW_POLICY,c)+(session.header.origin==='subagent'?DELEGATED_AUTHORITY_POLICY:'');
        const messages=reviewMessages(frozen);
        const evidence=c.preciseDeletion?deletionEvidenceMessage(session,exec):undefined;
        deletionEvidence=JSON.stringify(evidence);
        deletionActivity=c.preciseDeletion?deletionActivityKey(session,exec):undefined;
        if(evidence)messages.splice(messages.length-1,0,evidence);
        if(promptSize(system,messages)>c.maxInputChars) throw new ReviewError('INPUT_BUDGET','Review evidence exceeds its character budget; evidence was not truncated');
        let decision;
        for(let attempt=0;attempt<=c.maxRetries;attempt++) {
          const ticket=budget.take(session,c.maxReviewsPerTurn);
          const attemptState={ticket,index:attempt,start:Date.now(),measurement:{},prepared:undefined,recorded:false};
          currentAttempt=attemptState;
          try {
            reviewSignal.throwIfAborted();
            const prepared=await prepareReviewCall(ctx.llm,c,frozen,reviewSignal);
            attemptState.prepared=prepared;
            reviewSignal.throwIfAborted();
            anyDispatch=true;
            const stream=prepared.stream(Object.freeze({...prepared.config,system,messages,
              sessionId:session.id,purpose:'auto-review',signal:reviewSignal}));
            decision=await parse(observeUsage(stream,attemptState.measurement,reviewSignal));
            attemptState.verdict=decision;
            await validateFresh(reviewSignal);
            recordAttempt(attemptState,{outcome:decision.decision,risk:decision.risk});
            return decision;
          } catch(error) {
            const code=reviewSignal.aborted?(signal.aborted?'CANCELLED':'TIMEOUT'):error?.code??'INVALID_REVIEW';
            recordAttempt(attemptState,{outcome:code==='CANCELLED'?'cancelled':'failed',code});
            if(attempt>=c.maxRetries || reviewSignal.aborted || !transientFailure(error)) throw error;
            // Rebuild nothing: the complete immutable evidence and exact route are reused, never a previous allow.
            await validateFresh(reviewSignal);
          }
        }
      },{signal,timeoutMs:c.timeoutMs});
      if(cancelled(exec)) return finish({kind:'cancel'});
      if(verdict.decision==='deny' && (c.denialPolicy!=='ask' || !canAskHuman(ctx,readConfig,session))) return finish(denied(exec,verdict.reason));
      const downstream=await downstreamOnce();
      if(cancelled(exec)) return finish({kind:'cancel'});
      if(Date.now()>=expiresAt)throw new ReviewError('TIMEOUT','Review authorization expired');
      await withDeadline(validateFresh,{signal,timeoutMs:Math.max(1,expiresAt-Date.now())});
      if(verdict.decision==='allow' || downstream.kind!=='allow') return finish(downstream);
      return finish(askUser(exec,verdict.reason));
    } catch(error) {
      const code=cancelled(exec)?'CANCELLED':error?.code??'INVALID_REVIEW';
      recordAttempt(currentAttempt,{outcome:code==='CANCELLED'?'cancelled':'failed',code});
      if(code==='CANCELLED') return finish({kind:'cancel'},code);
      const mayAsk=new Set(['TIMEOUT','INPUT_BUDGET','BUDGET','CIRCUIT_OPEN','MODEL_UNAVAILABLE','CONFIG','INVALID_REVIEW']);
      if(c?.failurePolicy==='ask' && !downstreamPromise && mayAsk.has(code) && canAskHuman(ctx,readConfig,session)) {
        const downstream=await downstreamOnce();
        if(cancelled(exec)) return finish({kind:'cancel'});
        if(downstream.kind!=='allow') return finish(downstream,code);
        return finish(askUser(exec,`Review could not complete (${code}); decide this exact action manually.`),code);
      }
      return finish(failed(exec,new ReviewError(code,`Review could not complete (${code}); no action was authorized`)),code);
    } finally {
      if(!finalRecorded)finish({kind:'deny'},'INTERNAL');
      active.delete(completion.promise);completion.resolve();
    }
  }
  async function close({applicationShutdown=false}={}) {
    accepting=false;
    workspace.close();
    lifecycle.abort(new ReviewError('CANCELLED','Review integration disposed'));
    // Downgrade our sessions before removing the preset and gate. Official Auto is untouched.
    try {
      if(!applicationShutdown) for(const session of ctx.sessions.list()) {
        try {
          if(!isAuto(session))continue;
          // Native cancel synchronously aborts the turn (including scheduler
          // queues) and clears pending inbox work. Do not await whenIdle here:
          // a tool may be unloading its own reviewer.
          ctx.agents?.get?.(session.id)?.cancel?.({kind:'hook',reason:'Enhanced review is unloading; retry after selecting a permission mode.'});
          setSandboxMode(session,'workspace-write');
          setApprovalPolicy(session,'ask');
        } catch {
          // A detached/disposed Session cannot execute new tools. Contain cleanup faults so all registrations are removed.
          ctx.logger?.warn('auto-review-desktop: could not downgrade a closing Session');
        }
      }
    } finally {await Promise.allSettled([...active]);}
  }
  const workspace=createWorkspaceRouter(ctx,readConfig,review,()=>accepting);
  async function gate(exec,next) {
    if(!exec.agent || (!exec.parent && exec.name==='run_code'))return next();
    return desktopMode(exec.agent.session)==='workspace'?workspace.gate(exec,next):review(exec,next);
  }
  return {gate,execute:workspace.execute,approval:workspace.approval,release:workspace.release,close,stats,budget,get accepting(){return accepting;}};
}
