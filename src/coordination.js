import { desktopMode } from './preset.js';
import { nativeCompatible } from './native-compatibility.js';

export const DELEGATIONS=new Set(['subagent','subagent_fork']);
export const COORDINATION=new Set([...DELEGATIONS,'list_subagent_models','list_agents','send_message','interrupt_agent']);

// Reject malformed route placeholders before asking a human to authorize a call
// that the native tool cannot execute. Never rewrite the requested route.
export function delegationArgumentError(exec) {
  if(!DELEGATIONS.has(exec.name) && exec.name!=='list_subagent_models')return undefined;
  const args=exec.arguments??{};
  for(const key of ['provider','model','reasoning_effort']) {
    if(args[key]!==undefined && (typeof args[key]!=='string' || args[key].trim().length===0))
      return `Child LLM ${key} must be a non-empty registered id when supplied. Omit optional selection fields to inherit child defaults; empty strings and spaces do not mean inheritance. Use list_subagent_models before explicitly selecting a route.`;
  }
  if(DELEGATIONS.has(exec.name) && (args.provider===undefined)!==(args.model===undefined))
    return 'Supply child LLM provider and model together, or omit both to inherit child defaults. Discover allowed ids with list_subagent_models.';
  return undefined;
}

export function coordinationContext(ctx,context) {
  const agent=context.agent;
  if(!agent || !desktopMode(agent.session))return '';
  const tools=[...DELEGATIONS].map(name=>ctx.tools.get?.(name,agent,context.toolSet)).filter(definition=>nativeCompatible(definition));
  if(tools.length===0)return '';
  const selectable=tools.filter(tool=>tool.parameters?.properties?.provider).map(tool=>tool.name);
  const rules='For supported native in-process delegation, workspace child creation does not approve the child task. Children inherit enhanced review before their first input, and their actual actions are checked independently. External working directories and unsupported backends follow outside-workspace policy.';
  if(selectable.length===0)return rules;
  const config=agent.session.requestHeader()?.config??agent.options??{};
  const route=typeof config.provider==='string' && typeof config.model==='string'
    ?JSON.stringify({provider:config.provider,model:config.model,...config.reasoningEffort===undefined?{}:{reasoning_effort:config.reasoningEffort}}):undefined;
  return `${rules}\nFor ${selectable.map(name=>'`'+name+'`').join(', ')}, provider is a registered LLM provider id, not a delegation backend (spawn/fork). Omit provider, model and reasoning_effort to inherit child defaults. Empty strings, spaces and the word default are not omission. Before explicit selection use list_subagent_models and copy its exact allowed ids; never infer a provider from the model name.${route?' Parent LLM values from the latest accepted request (creation defaults before the first request; not other allowed routes): '+route+'.':''}`;
}

export function registerCoordinationContext(ctx) {
  return ctx.systemPrompt.context({name:'auto-review-desktop:delegation',order:ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION')+1,
    text:context=>coordinationContext(ctx,context)});
}
