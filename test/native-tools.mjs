import { Context } from '@deepseek-ai/cordis';
import * as fsTools from '@deepseek-ai/dsh-tool-fs';
import * as pwsh from '@deepseek-ai/dsh-tool-pwsh';
import * as bash from '@deepseek-ai/dsh-tool-bash';
import * as search from '@deepseek-ai/dsh-tool-fs-search';
import * as cwd from '@deepseek-ai/dsh-tool-working-directory';

// Capture the real native definitions and their closures, never mock their schemas.
export async function nativeTools(services={}) {
  const definitions=new Map();const ctx=new Context();
  const tools={register(def){definitions.set(def.name,def);return()=>definitions.delete(def.name);},get:name=>definitions.get(name)};
  for(const [key,value] of Object.entries({tools,
    fs:{sandboxMode:'workspace-write'},shell:{sandboxMode:'workspace-write'},
    sandboxPolicy:{resolve(){throw Error('No test policy supplied');}},attachments:{},
    systemPrompt:{section:()=>()=>{},getSectionOrder:()=>0},workingDirectory:{},
    subprocess:{spawn(){throw Error('Unexpected subprocess');}},jobs:{},...services}))ctx.provide(key,value);
  ctx.inject=(deps,callback)=>{if(deps.every(name=>ctx.get(name)!==undefined))callback(ctx);return()=>{};};
  fsTools.apply(ctx,fsTools.Config({applyPatch:true}));pwsh.apply(ctx);bash.apply(ctx);
  await search.apply(ctx,search.Config({sampleOverCapGlobResults:false}));cwd.apply(ctx);
  return {definitions,tools,ctx,close:()=>ctx.fiber.dispose()};
}
