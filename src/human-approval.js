import { desktopMode } from './preset.js';
import { canAskHuman } from './delegation.js';
import { snapshotReview } from './authorization.js';
import { actionKey, authorizationKey, configKey, normalizeConfig } from './runtime.js';

/** These are execution-bound admission records, never reusable grants. Native
 * ApprovalService still owns every human request, response and audit pair.
 */
export function createHumanApprovalGuard(ctx,readConfig) {
  const actions=new Map();
  let active=true;
  const release=exec=>actions.delete(exec.token);
  const capture=async exec=> {
    const cwd=await ctx.workingDirectory.ensure(exec.agent,exec.signal);
    return authorizationKey(snapshotReview(ctx,exec.agent,exec,cwd,new Map()));
  };
  async function fresh(ticket) {
    const {exec}=ticket;
    const authority=await capture(exec);
    return active && !exec.signal?.aborted && actions.get(exec.token)===ticket
      && desktopMode(exec.agent.session)===ticket.mode
      && configKey(normalizeConfig(readConfig()))===ticket.config
      && (!ticket.human || canAskHuman(ctx,readConfig,exec.agent.session))
      && actionKey(exec)===ticket.action && authority===ticket.authority;
  }
  async function prepare(exec,next) {
    if(!exec.agent || !desktopMode(exec.agent.session))return next();
    if(!active || exec.signal?.aborted)return {kind:'cancel'};
    if(exec.token===undefined || actions.has(exec.token))return {kind:'deny',reason:'Enhanced action execution identity is missing or duplicated.'};
    const ticket={exec,mode:desktopMode(exec.agent.session),config:configKey(normalizeConfig(readConfig())),action:actionKey(exec),admitted:false};
    actions.set(exec.token,ticket);
    try {
      ticket.authority=await capture(exec);
      const decision=await next();
      if(decision.kind!=='allow' && decision.kind!=='ask'){release(exec);return decision;}
      if(!await fresh(ticket)){release(exec);return {kind:'deny',reason:'Enhanced action changed before admission; retry the exact action.'};}
      ticket.admitted=decision.kind==='allow';
      if(decision.kind!=='ask')return decision;
      // Keep the native headline useful before client detail loads, without
      // duplicating potentially large file contents in several UI locations.
      const args=exec.arguments??{};
      const summary=['file_path','path','cd','workdir','command','justification']
        .filter(key=>typeof args[key]==='string').map(key=>`${key}: ${args[key]}`).join('\n');
      const identity=`${exec.name} · ${exec.callId}`;
      const localized=decision.displayReason??{};
      const fallback=decision.reason??'Approve this action once.';
      return {...decision,displayReason:{...localized,
        en:`${localized.en??fallback}\n\nAction summary: ${identity}${summary?'\n'+summary:''}\nSee action details for the complete parameters.`,
        zh:`${localized.zh??localized.en??fallback}\n\n操作摘要：${identity}${summary?'\n'+summary:''}\n完整参数见操作详情。`}};
    } catch(error) {release(exec);throw error;}
  }
  async function execute(exec,next) {
    const ticket=actions.get(exec.token);
    if(!ticket && (!exec.agent || !desktopMode(exec.agent.session)))return next();
    if(!ticket || ticket.exec!==exec || !ticket.admitted || !await fresh(ticket) || ticket.dispatched)
      throw new Error('auto-review-desktop: action authorization changed before dispatch; no operation was authorized');
    ticket.dispatched=true;
    try {return await next();}
    finally {release(exec);}
  }
  async function approval(req,next) {
    const session=req.agent?.session;
    if(!session || !desktopMode(session))return next();
    if(!active || req.signal?.aborted)return 'cancelled';
    if(!canAskHuman(ctx,readConfig,session))return 'rejected';
    const matches=[...actions.values()].filter(({exec})=>exec.agent===req.agent && exec.name===req.toolName && exec.callId===req.callId);
    if(matches.length!==1)return 'rejected';
    const ticket=matches[0];
    const applicable=async()=>!req.signal?.aborted && canAskHuman(ctx,readConfig,session) && await fresh(ticket);
    try {
      if(!await applicable())return 'rejected';
      const outcome=await next();
      if(outcome!=='allowed-once')return outcome;
      if(!await applicable())return 'rejected';
      ticket.human=true;ticket.admitted=true;
      return 'allowed-once';
    } catch {return req.signal?.aborted || ticket.exec.signal?.aborted?'cancelled':'rejected';}
  }
  // Keep records until their result/execute settles: a downgraded session must not
  // bypass this listener while teardown is still unwinding its admitted calls.
  return {prepare,execute,approval,release,close(){active=false;}};
}
