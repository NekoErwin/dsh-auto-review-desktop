import {desktopMode} from './preset.js';
import {nativeCompatible} from './native-compatibility.js';
import {normalizeConfig} from './runtime.js';

const ESCALATABLE=['write','edit','apply_patch','pwsh','bash'];

export function escalationContext(ctx,readConfig,{agent,toolSet}={}) {
  if(!agent || desktopMode(agent.session)!=='workspace')return '';
  const tools=ESCALATABLE.filter(name=>nativeCompatible(ctx.tools?.get?.(name,agent,toolSet)));
  if(tools.length===0)return '';
  const config=normalizeConfig(readConfig());
  const approval=ctx.approval.overrideOf(agent.session)??ctx.approval.config.policy;
  const inherited=agent.session.header.origin==='subagent'
    ?' This enhanced child uses its recorded approval policy; the generic fixed-scope delegation warning describes ordinary children and does not prohibit the single-call requests described here. A one-call grant does not widen this session or its descendants.' :'';
  if(approval==='never')return 'Enhanced workspace review: the current approval policy is never. Do not request wider execution.';
  const humanAllowed=!(agent.session.header.origin==='subagent' && config.subagentApproval==='deny');
  if(config.workspaceEscalation==='ask' && !humanAllowed)return 'Enhanced workspace review: human approval is disabled for this child and outside-workspace actions are configured for human approval. Do not request wider execution.';
  const route=config.workspaceEscalation==='review'
    ?`The configured reviewer evaluates each wider request; it may deny it. ${humanAllowed?'Human fallback is available only if enabled for this session.':'Human fallback is disabled for this child.'}`
    :'The user must approve each wider request; no review model approves it automatically.';
  return `Enhanced workspace permission requests for ${tools.join(', ')}:${inherited} If current user instructions and the delegated task authorize an operation already known to need access outside this workspace, include sandbox_permissions="danger-full-access" and a non-empty justification in its FIRST call. There is no requirement to deliberately fail an ordinary call first. ${route} Preserve the exact intended action and obey explicit task restrictions on escalation. A clearly identified pre-execution workspace-boundary refusal caused only by missing permission fields may be corrected once for the exact authorized operation. If the call is finally rejected by review, a human, policy, or failed authorization, stop; never retry it with another tool, path, or command. Keep ordinary workspace actions confined. Do not automatically rerun shell commands after partial execution.`;
}

export function registerEscalationContext(ctx,readConfig) {
  return ctx.systemPrompt.context({name:'auto-review-desktop:workspace-requests',order:ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION')+2,
    text:context=>escalationContext(ctx,readConfig,context)});
}
