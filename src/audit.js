import { mkdir, appendFile, stat, rename } from 'node:fs/promises';
import { join } from 'node:path';

/** Profile-owned audit, separate from core Session logs; no arguments, transcript, raw error or reviewer reason. */
export function createAuditJournal(profileHome, logger) {
  let pending=Promise.resolve();let warned=false;let available=Boolean(profileHome);
  if(!profileHome) {logger?.warn('auto-review-desktop: no profile directory; durable audit is unavailable');return {available:false,write(){},async close(){}};}
  const folder=join(profileHome,'.plugin-data','dsh-auto-review-desktop');
  const file=join(folder,`reviews.${process.pid}.jsonl`);
  return {
    get available(){return available;},
    write(event) {
      const line=JSON.stringify(event)+'\n';
      pending=pending.then(async()=>{
        await mkdir(folder,{recursive:true});
        const size=await stat(file).then(s=>s.size,error=>{if(error.code==='ENOENT')return 0;throw error;});
        if(size>2*1024*1024) await rename(file,join(folder,`reviews.${process.pid}.previous.jsonl`));
        await appendFile(file,line,{encoding:'utf8',mode:0o600});
      }).catch(()=>{available=false;if(!warned){warned=true;logger?.warn('auto-review-desktop: profile audit write failed; review decisions remain fail-closed');}});
    },
    async close(){await pending;},
  };
}
