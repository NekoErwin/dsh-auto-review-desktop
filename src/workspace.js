import { AsyncLocalStorage } from 'node:async_hooks';
import { parsePatch } from '@deepseek-ai/dsh-fs-patch';
import { desktopMode } from './preset.js';
import { configKey, normalizeConfig, actionKey, authorizationKey } from './runtime.js';
import { snapshotReview } from './authorization.js';
import { canAskHuman } from './delegation.js';
import { nativeCompatible } from './native-compatibility.js';
import { DELEGATIONS, COORDINATION, delegationArgumentError } from './coordination.js';

const MUTATIONS=new Set(['write','edit','apply_patch']);
const SHELLS=new Set(['pwsh','bash']);
const READS=new Set(['read','read_image','glob','grep']);
const NATIVE_NAMES=[...MUTATIONS,...SHELLS,...READS,'working_directory',...COORDINATION];
const deny=reason=>({kind:'deny',reason:`[auto-review-desktop] ${reason}`});

/** Compatibility is pinned to the shipped native schemas and the first matching
 * definition in each agent scope. This does not sandbox trusted Host plugins.
 */
export function createWorkspaceRouter(ctx,readConfig,review,isAccepting) {
  const native=new WeakMap();
  const executing=new AsyncLocalStorage();
  const admitted=new Map();
  function trusted(exec) {
    if(!NATIVE_NAMES.includes(exec.name))return false;
    if(DELEGATIONS.has(exec.name)) {
      const backend=ctx.get?.('subagents')?.getProvider(exec.name==='subagent_fork'?'fork':'spawn');
      if(!backend || typeof backend.prepareContinuable!=='function' || backend.agentRouteDefaults!==undefined
        || backend.inheritsParentContext!==(exec.name==='subagent_fork'))return false;
    }
    const definition=ctx.tools?.get?.(exec.name,exec.agent,exec.toolSet);
    if(!definition || ctx.tools.get(exec.name,exec.agent)!==definition || !nativeCompatible(definition))return false;
    let pinned=native.get(exec.agent);
    if(!pinned){pinned=new Map();native.set(exec.agent,pinned);}
    if(!pinned.has(exec.name))pinned.set(exec.name,definition);
    return pinned.get(exec.name)===definition;
  }
  function enforcing(exec) {
    if(!trusted(exec))return false;
    const provider=SHELLS.has(exec.name)?ctx.shell:MUTATIONS.has(exec.name)?ctx.fs:undefined;
    return provider?.sandboxMode!==undefined
      && ctx.sandboxPolicy?.resolve({session:exec.agent.session}).mode==='workspace-write';
  }
  function explicitEscalation(exec) {
    return enforcing(exec) && exec.arguments?.sandbox_permissions==='danger-full-access';
  }
  async function contained(exec,path) {
    if(typeof path!=='string' || !path)return false;
    const cwd=await ctx.workingDirectory.ensure(exec.agent,exec.signal);
    const policy=ctx.sandboxPolicy.resolve({session:exec.agent.session});
    const root=await ctx.fs.resolve(policy.workspaceRoot,{signal:exec.signal});
    const target=await ctx.fs.resolve(path,{cwd,signal:exec.signal});
    return ctx.fs.contains(root,target);
  }
  function messageTarget(exec) {
    const target=ctx.agents?.get(exec.arguments?.agent_id);
    if(!target || !desktopMode(target.session))return undefined;
    const child=target.session.header?.parentSession===exec.agent.id && ctx.agents.isOwnedBy(target.id,exec.agent)===true;
    const parent=exec.agent.session.header?.parentSession===target.id && ctx.agents.isOwnedBy(exec.agent.id,target)===true;
    return child || parent?{agent:target,mode:desktopMode(target.session)}:undefined;
  }
  function remember(exec,config,frozen,checks,fastPath,recipient) {
    if(exec.token!==undefined)admitted.set(exec.token,{mode:desktopMode(exec.agent.session),config:configKey(config),action:actionKey(exec),authority:authorizationKey(frozen),checks,fastPath,recipient});
  }
  async function gate(exec,next) {
    let config;
    try {
      config=normalizeConfig(readConfig());
      if(exec.signal.aborted || !isAccepting())return {kind:'cancel'};
      // Integrity is required even when no model is called.
      const cwd=await ctx.workingDirectory.ensure(exec.agent,exec.signal);
      const frozen=snapshotReview(ctx,exec.agent,exec,cwd,new Map());
      const args=exec.arguments??{};
      let bypass=false;
      let checks=[];
      let recipient;
      if(trusted(exec) && COORDINATION.has(exec.name)) {
        const invalid=delegationArgumentError(exec);
        if(invalid)return deny(invalid);
        if(DELEGATIONS.has(exec.name)) {
          // A new child's cwd may become its writable workspace root. Keep that
          // root inside the parent's root unless the outside policy approves it.
          const path=args.cwd??cwd;bypass=await contained(exec,path);if(bypass)checks=[path];
        } else if(exec.name==='send_message') {
          recipient=messageTarget(exec);bypass=recipient!==undefined;
        } else bypass=true; // Read-only discovery, or native ownership-checked stop.
      } else if(enforcing(exec)) {
        // Wider requests are decided inside the native audited approval boundary.
        if(args.sandbox_permissions==='danger-full-access')bypass=true;
        else if(SHELLS.has(exec.name)) {
          const path=args.workdir??cwd;bypass=await contained(exec,path);if(bypass)checks=[path];
        }
        else {
          const paths=exec.name==='apply_patch'
            ?parsePatch(args.input).flatMap(operation=>[operation.path,...operation.moveTo?[operation.moveTo]:[]])
            :[args.file_path];
          bypass=(await Promise.all(paths.map(path=>contained(exec,path)))).every(Boolean);
          if(bypass)checks=paths;
          if(!bypass)return deny('This file operation targets outside the workspace. Retry this exact operation once with sandbox_permissions="danger-full-access" and a justification; the configured outside-workspace policy decides that request.');
        }
      } else if(trusted(exec) && READS.has(exec.name)) {
        // Native readers cannot mutate files or spawn commands. Workspace-write
        // constrains writes; do not add a separate read boundary by default.
        // This never bypasses native OS permissions or downstream tool guards.
        const path=(exec.name==='glob'||exec.name==='grep')?(args.path??cwd):args.file_path;
        bypass=config.workspaceReads==='allow' || await contained(exec,path);
        if(bypass && config.workspaceReads==='approve')checks=[path];
      } else if(trusted(exec) && exec.name==='working_directory') {
        bypass=args.cd===undefined || await contained(exec,args.cd);if(bypass && args.cd!==undefined)checks=[args.cd];
      }
      if(exec.signal.aborted || !isAccepting() || desktopMode(exec.agent.session)!=='workspace')return {kind:'cancel'};
      if(configKey(normalizeConfig(readConfig()))!==configKey(config))return deny('Workspace settings changed before dispatch; retry the exact action.');
      let decision;
      if(bypass)decision=await next();
      else if(config.workspaceEscalation==='review')decision=await review(exec,next);
      else {
        const downstream=await next();
        decision=downstream.kind!=='allow'?downstream:!canAskHuman(ctx,readConfig,exec.agent.session)
          ?deny('Outside-workspace or unsupported action requires human approval, but this session or subagent policy forbids it.')
          :{kind:'ask',reason:'Approve this exact outside-workspace or unsupported action once. The workspace sandbox remains in force unless this tool separately requests escalation.',displayReason:{en:'Approve this outside-workspace or unsupported action once.',zh:'仅批准本次工作区外或不受工作区沙箱约束的操作。'}};
      }
      if(decision.kind==='allow' || decision.kind==='ask')remember(exec,config,frozen,checks,bypass,recipient);
      return decision;
    } catch {
      return exec.signal.aborted?{kind:'cancel'}:deny('Workspace action integrity or boundary could not be verified.');
    }
  }
  async function execute(exec,next) {
    const ticket=admitted.get(exec.token);
    admitted.delete(exec.token);
    if(!ticket && (!exec.agent || desktopMode(exec.agent.session)!=='workspace'))return next();
    if(ticket) {
      const pathsUnchanged=ticket.checks.length===0 || (await Promise.all(ticket.checks.map(path=>contained(exec,path)))).every(Boolean);
      const cwd=await ctx.workingDirectory.ensure(exec.agent,exec.signal);
      const current=snapshotReview(ctx,exec.agent,exec,cwd,new Map());
      const recipient=ticket.recipient?messageTarget(exec):undefined;
      // Finish all owned awaits before the final synchronous admission check.
      if(ticket.recipient && (recipient?.agent!==ticket.recipient.agent || recipient?.mode!==ticket.recipient.mode)
        || !pathsUnchanged || !isAccepting() || exec.signal.aborted || desktopMode(exec.agent.session)!==ticket.mode
        || configKey(normalizeConfig(readConfig()))!==ticket.config || actionKey(exec)!==ticket.action
        || authorizationKey(current)!==ticket.authority || (ticket.fastPath && !trusted(exec))) {
        throw new Error('auto-review-desktop: workspace admission changed before execution; no operation was authorized');
      }
    }
    const state={exec,used:false,active:true,mode:exec.agent?desktopMode(exec.agent.session):undefined,config:configKey(normalizeConfig(readConfig()))};
    try {return await executing.run(state,next);}
    finally {state.active=false;}
  }
  async function approval(req,next) {
    const state=executing.getStore();
    const exec=state?.exec;
    if(!exec?.agent || state.mode!=='workspace' || desktopMode(exec.agent.session)!=='workspace' || !explicitEscalation(exec))return next();
    // Bind automatic answering to the native tool's exact in-process invocation.
    if(req.agent!==exec.agent || req.toolName!==exec.name || req.callId!==exec.callId
      || req.reason!==`escalate sandbox to danger-full-access: ${exec.arguments.justification}`)return next();
    if(state.used || !state.active || !isAccepting() || req.signal?.aborted || exec.signal.aborted
      || configKey(normalizeConfig(readConfig()))!==state.config)return 'rejected';
    state.used=true;
    const config=normalizeConfig(readConfig());
    const signal=AbortSignal.any([exec.signal,...req.signal?[req.signal]:[]]);
    const cwd=await ctx.workingDirectory.ensure(exec.agent,signal);
    const authority=authorizationKey(snapshotReview(ctx,exec.agent,exec,cwd,new Map()));
    const never=()=> (ctx.approval.effectivePolicy?.(exec.agent.session)??ctx.approval.overrideOf(exec.agent.session))==='never';
    const fresh=async()=> {
      if(signal.aborted || !state.active || !isAccepting() || never()
        || desktopMode(exec.agent.session)!=='workspace' || configKey(normalizeConfig(readConfig()))!==state.config)return false;
      const cwd=await ctx.workingDirectory.ensure(exec.agent,signal);
      const unchanged=authorizationKey(snapshotReview(ctx,exec.agent,exec,cwd,new Map()))===authority;
      return unchanged && !signal.aborted && state.active && isAccepting() && !never()
        && desktopMode(exec.agent.session)==='workspace' && configKey(normalizeConfig(readConfig()))===state.config;
    };
    const human=async()=> {
      if(!canAskHuman(ctx,readConfig,exec.agent.session))return 'rejected';
      const outcome=await next();
      return outcome==='allowed-once' && (!canAskHuman(ctx,readConfig,exec.agent.session) || !await fresh())?'rejected':outcome;
    };
    if(!await fresh())return signal.aborted?'cancelled':'rejected';
    if(config.workspaceEscalation==='ask')return human();
    const decision=await review({...exec,signal},async()=>({kind:'allow'}));
    if(signal.aborted || !isAccepting() || decision.kind==='cancel')return 'cancelled';
    if(!await fresh())return 'rejected';
    if(decision.kind==='allow')return 'allowed-once';
    // Preserve the existing explicit human fallback for reviewer denials/failures.
    if(decision.kind==='ask')return human();
    return decision.kind==='cancel'?'cancelled':'rejected';
  }
  return {gate,execute,approval,release:exec=>admitted.delete(exec.token),close:()=>admitted.clear()};
}
