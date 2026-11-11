import { Context } from '@deepseek-ai/cordis';
import * as delegation from '@deepseek-ai/dsh-tool-subagent';
import * as control from '@deepseek-ai/dsh-tool-subagent-control';
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import * as fork from '@deepseek-ai/dsh-subagent-fork-in-process';

// Capture complete native definitions and execute closures, not copied schemas.
// Only the surrounding business services are test doubles. Providers are the real
// built-in local plugins unless a test explicitly supplies an external descriptor.
export async function nativeSubagents({modelSelection=true,services={},spawnConfig={},forkConfig={},providerOverrides={},policyRoutes}={}) {
  const definitions=new Map(),providers=new Map(),starts=[],preflights=[];
  const ctx=new Context();
  const tools={register(definition){definitions.set(definition.name,definition);return()=>definitions.delete(definition.name);},get:name=>definitions.get(name)};
  const subagents={
    registerProvider(provider){providers.set(provider.name,provider);return()=>providers.delete(provider.name);},
    getProvider:name=>providers.get(name),resolveMaxDepth:value=>value==='provider-managed'?undefined:value??3,
    async startActivation(spec){starts.push(spec);return {childId:`native-child-${starts.length}`};},
    async listChildren(){return [];},async listDescendants(){return [];},
    async sendMessage(){return 'native-message';},interrupt(){},
    ...services.subagents,
  };
  const llm={listProviders:()=>[{id:'parent-provider',name:'Parent provider'}],
    listModels:async()=>[{id:'parent-model',name:'Parent model'}],
    resolveModelInfo:async(provider,model)=>({id:model,name:model,reasoning:{efforts:[{id:'low',name:'Low'}],defaultEffort:'low'}}),
    async resolveCallConfig(config,signal){signal?.throwIfAborted();preflights.push(config);return config;},
    ...services.llm,
  };
  const projection={stateOf:session=>typeof policyRoutes==='function'?policyRoutes(session):policyRoutes};
  for(const [key,value] of Object.entries({
    tools,subagents,llm,agents:{get(){}},agentPresets:{},
    sessionProjections:{register:async()=>projection},
    systemPrompt:{section:()=>()=>{},context:()=>()=>{},getSectionOrder:()=>0,getContextOrder:()=>0},
    ...services,tools,subagents,llm,
  }))ctx.provide(key,value);
  spawn.apply(ctx,spawn.Config({}));fork.apply(ctx,fork.Config({}));
  for(const [name,override] of Object.entries(providerOverrides))providers.set(name,{...providers.get(name),...override});
  try {
    await delegation.apply(ctx,delegation.Config({provider:'spawn',toolName:'subagent',modelSelection,modelDiscovery:true,...spawnConfig}));
    await delegation.apply(ctx,delegation.Config({provider:'fork',toolName:'subagent_fork',modelSelection,...forkConfig}));
    control.apply(ctx);
  } catch(error) {await ctx.fiber.dispose();throw error;}
  return {definitions,tools,providers,ctx,starts,preflights,close:()=>ctx.fiber.dispose()};
}
