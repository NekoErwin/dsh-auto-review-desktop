import { AsyncLocalStorage } from 'node:async_hooks';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval';
import { desktopMode, DESKTOP_PRESET, WORKSPACE_PRESET } from './preset.js';

const ENHANCED=new Set([DESKTOP_PRESET,WORKSPACE_PRESET]);
const delegated=session=>session.header?.origin==='subagent' && typeof session.header.parentSession==='string';
const policyOf=(ctx,session)=>ctx.approval?.overrideOf(session)??ctx.approval?.config?.policy??'ask';

/** Human fallback is separate from the model reviewer: disabling it must not set
 * native `never`, which would reject native escalation before automatic review.
 */
export function canAskHuman(ctx,readConfig,session) {
  return policyOf(ctx,session)!=='never'
    && !(delegated(session) && readConfig()?.subagentApproval==='deny');
}

/** Capture at tools/execute entry, not at the host's private startLocal boundary.
 * The immutable snapshot follows this exact asynchronous call until it settles.
 * agent/created is awaited after setup and before any child input is released.
 */
export function createDelegationPolicy(ctx,readConfig) {
  const executing=new AsyncLocalStorage();
  let accepting=true;
  const ownEvents=session=>typeof session.ownEvents==='function'
    ?session.ownEvents():session.snapshotEvents().slice(session.inheritedEventCount??0);
  const liveParent=parent=>ctx.agents?.get(parent.id)===parent;
  const owned=(agent,parent)=>ctx.agents?.isOwnedBy(agent.id,parent)===true;
  function quarantine(session,reason) {
    // Use only canonical native permission facts, including for an orphaned log
    // left behind by a rolled-back creation transaction.
    setApprovalPolicy(session,'never');
    setSandboxMode(session,'workspace-write');
    session.append('permission/preset',{preset:'workspace-write'});
    throw new Error(`auto-review-desktop: child authorization could not be inherited (${reason}); create a new child through the enhanced parent's tool call`);
  }
  async function execute(exec,next) {
    const parent=exec.agent;
    const parentApproval=parent?.ctx?.get?.('approval')??ctx.approval;
    const snapshot=parent?Object.freeze({
      parent,mode:desktopMode(parent.session),
      policy:policyOf({approval:parentApproval},parent.session),signal:exec.signal,
    }):undefined;
    // Also clear an outer enhanced scope for unrelated/nested agentless calls.
    const lifetime={snapshot,active:true};
    try {return await executing.run(lifetime,next);}
    finally {lifetime.active=false;}
  }
  function created({agent,source}) {
    const session=agent.session;
    if(!delegated(session))return;
    const events=ownEvents(session);
    // The seed can contain an ancestor descriptor; require the child's own one.
    const hasDescriptor=events.some(event=>event.type==='subagent/descriptor');
    const enrolled=events.some(event=>event.type==='permission/preset' && ENHANCED.has(event.data.preset));
    const parent=ctx.agents?.get(session.header.parentSession);
    const historical=events.some(event=>event.type==='tool/call' || event.type==='turn/end');
    if(source!=='startup' || historical) {
      // Never reconstruct old authorization from the parent's present settings.
      // Keep later independent user switches as well as the original inherited
      // policy, including a persisted never policy.
      if(enrolled)return;
      if(parent && desktopMode(parent.session)!==undefined && hasDescriptor)
        quarantine(session,'legacy child has no durable enhanced identity');
      return;
    }
    const lifetime=executing.getStore();
    const captured=lifetime?.snapshot;
    const sameParent=captured?.parent.id===session.header.parentSession;
    const related=parent && owned(agent,parent) && hasDescriptor;
    if(accepting && lifetime?.active && sameParent && parent===captured.parent && liveParent(parent) && related && !captured.signal?.aborted) {
      if(captured.mode===undefined) {
        if(desktopMode(parent.session)!==undefined)quarantine(session,'permission mode changed across delegation');
        return;
      }
      const sandbox=captured.mode==='full'?'danger-full-access':'workspace-write';
      const preset=captured.mode==='full'?DESKTOP_PRESET:WORKSPACE_PRESET;
      // No await: every fact is committed before the creation listener returns.
      // Do not use permissionPresets.current(), whose never fallback loses the
      // custom identity, or set(), which would replace the captured approval.
      setSandboxMode(session,sandbox);
      setApprovalPolicy(session,captured.policy);
      session.append('permission/preset',{preset});
      return;
    }
    // Origin/lineage alone are not authority. A real owned child of an enhanced
    // parent without a live call snapshot must fail closed, never inherit full
    // access by reading a late parent snapshot. Unrelated root sessions stay out.
    const enhancedSnapshot=sameParent && captured.mode!==undefined;
    if(related && (enhancedSnapshot || desktopMode(parent.session)!==undefined))
      quarantine(session,'missing, expired, cancelled, or mismatched creation snapshot');
  }
  return {execute,created,canAskHuman:session=>canAskHuman(ctx,readConfig,session),close(){accepting=false;}};
}
