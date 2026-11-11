import { createHash, randomUUID } from 'node:crypto';

export const DEFAULTS = Object.freeze({
  routeMode: 'follow', provider: '', model: '', reasoningMode: 'low', reasoningEffort: '',
  timeoutMs: 60000, maxOutputTokens: 2048, maxInputChars: 120000,
  maxReviewsPerTurn: 100, maxRetries: 0, failurePolicy: 'deny', denialPolicy: 'deny', subagentApproval: 'inherit', preciseDeletion: true, workspaceEscalation: 'ask', workspaceReads: 'allow',
});

export class ReviewError extends Error {
  constructor(code, message) { super(message); this.name = 'ReviewError'; this.code = code; }
}
export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULTS, ...raw };
  const members = Object.keys(DEFAULTS);
  if (Object.keys(raw).some(key => !members.includes(key))) throw new ReviewError('CONFIG', 'Unknown review setting');
  for (const [key, choices] of Object.entries({routeMode:['follow','specific'], reasoningMode:['low','default','specific'], failurePolicy:['deny','ask'], denialPolicy:['deny','ask'], subagentApproval:['inherit','deny'], workspaceEscalation:['ask','review'], workspaceReads:['allow','approve']})) {
    if (!choices.includes(c[key])) throw new ReviewError('CONFIG', `Invalid ${key}`);
  }
  for (const [key,min,max] of [['timeoutMs',1000,180000],['maxOutputTokens',256,16384],['maxInputChars',4000,1000000],['maxReviewsPerTurn',1,1000],['maxRetries',0,1]]) {
    if (!Number.isSafeInteger(c[key]) || c[key] < min || c[key] > max) throw new ReviewError('CONFIG', `Invalid ${key}`);
  }
  for (const key of ['provider','model','reasoningEffort']) if (typeof c[key] !== 'string' || c[key].length > 256) throw new ReviewError('CONFIG', `Invalid ${key}`);
  if (typeof c.preciseDeletion !== 'boolean') throw new ReviewError('CONFIG', 'Invalid preciseDeletion');
  // An incomplete draft may be saved; it never dispatches or falls back to the main route.
  return Object.freeze(c);
}
export function configKey(c) { return JSON.stringify(c); }
export function actionKey(exec) {
  return JSON.stringify([exec.name,exec.arguments,exec.callId,exec.rootCallId,exec.parent?.callId]);
}
export function authorizationKey(snapshot) {
  return createHash('sha256').update(JSON.stringify({cwd:snapshot.cwd, pending:snapshot.pending,
    authority:snapshot.history.filter(entry => entry.kind === 'user-message' && entry.role !== 'fact')})).digest('hex');
}
export function promptSize(system,messages) {
  // A character guard, not a tokenizer or a promise about provider token billing.
  return system.length + JSON.stringify(messages).length;
}
export function routeFor(c,snapshot) {
  if (c.routeMode === 'follow') return {provider:snapshot.provider,model:snapshot.model};
  if (!c.provider.trim() || !c.model.trim()) throw new ReviewError('CONFIG','Choose a configured review model');
  return {provider:c.provider,model:c.model};
}
export async function prepareReviewCall(llm,c,snapshot,signal) {
  const route=routeFor(c,snapshot);
  if (c.routeMode === 'specific') {
    if (!llm.listProviders().some(provider=>provider.id === route.provider)) throw new ReviewError('MODEL_UNAVAILABLE','Review provider is not configured');
    const models=await llm.listModels(route.provider);
    if (!models.some(model=>model.id === route.model)) throw new ReviewError('MODEL_UNAVAILABLE','Review model is no longer in the configured model list');
  }
  return llm.prepareCall({...route,temperature:0,maxTokens:c.maxOutputTokens},signal,(controls,info)=>{
    if(c.reasoningMode === 'specific') {
      if(!c.reasoningEffort || !info.reasoning?.efforts.some(e=>e.id===c.reasoningEffort)) throw new ReviewError('CONFIG','Review reasoning effort is not supported by the selected model');
      return {...controls,reasoningEffort:c.reasoningEffort};
    }
    if(c.reasoningMode === 'low' && info.reasoning?.efforts.some(e=>e.id==='low')) return {...controls,reasoningEffort:'low'};
    return controls;
  });
}

/** A deadline gates the result even if a provider ignores AbortSignal. Late results cannot authorize. */
export async function withDeadline(task,{signal,timeoutMs}) {
  if(signal?.aborted) throw new ReviewError('CANCELLED','Review cancelled');
  const controller=new AbortController();
  let timer;
  let abortListener;
  const interrupted=new Promise((_,reject)=>{
    abortListener=()=>{controller.abort(signal.reason);reject(new ReviewError('CANCELLED','Review cancelled'));};
    if(signal?.aborted) abortListener(); else signal?.addEventListener('abort',abortListener,{once:true});
    timer=setTimeout(()=>{controller.abort(new ReviewError('TIMEOUT','Review deadline exceeded'));reject(new ReviewError('TIMEOUT','Review deadline exceeded'));},timeoutMs);
  });
  try {
    if(signal?.aborted) throw new ReviewError('CANCELLED','Review cancelled');
    const work=Promise.resolve().then(()=>task(controller.signal));
    const result=await Promise.race([work,interrupted]);
    if(signal?.aborted || controller.signal.aborted) throw new ReviewError(signal?.aborted?'CANCELLED':'TIMEOUT','Review result arrived after cancellation');
    return result;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abortListener);}
}

export function usageView(raw) {
  if(!raw || typeof raw!=='object') return undefined;
  const out={};
  for(const key of ['inputTokens','outputTokens','totalTokens','reasoningTokens','cacheReadTokens','cacheWriteTokens']) {
    const value=raw[key];
    if(Number.isFinite(value) && value>=0) out[key]=value;
  }
  return Object.keys(out).length?out:undefined;
}
/** Keep provider cumulative usage once per attempt; do not sum cumulative chunks. */
export async function* observeUsage(stream,record,signal) {
  const iterator=stream[Symbol.asyncIterator]();
  const close=()=>{Promise.resolve().then(()=>iterator.return?.()).catch(()=>{});};
  signal.addEventListener('abort',close,{once:true});
  try {
    while(true) {
      signal.throwIfAborted();
      const item=await iterator.next();
      signal.throwIfAborted();
      if(item.done) return;
      if(item.value.type==='usage') record.usage=usageView(item.value.usage);
      yield item.value;
    }
  } finally {signal.removeEventListener('abort',close);close();}
}
function currentTurn(session) {
  let turn;
  for(const event of session.snapshotEvents()) if(event.type==='turn/start') turn=event.seq;
  return turn;
}
export class ReviewBudget {
  sessions=new WeakMap();
  state(session) {
    const turn=currentTurn(session);
    let entry=this.sessions.get(session);
    if(!entry || entry.turn!==turn) {entry={turn,attempts:0,failures:0};this.sessions.set(session,entry);}
    return entry;
  }
  take(session,max) {
    const state=this.state(session);
    if(state.attempts>=max) throw new ReviewError('BUDGET','Review attempt budget reached for this turn');
    if(state.failures>=3) throw new ReviewError('CIRCUIT_OPEN','Three consecutive review failures; human review is required');
    state.attempts++;
    return state;
  }
  success(ticket) {ticket.failures=0;}
  failure(ticket) {ticket.failures++;}
}
export function transientFailure(error) {
  // Retry only an explicitly signalled transport/rate/server failure, never deny, schema or budget errors.
  return /\b(?:TRANSPORT|NETWORK|SERVER|RATE_LIMIT|HTTP_5\d\d)\b/.test(String(error?.code??'')) || /ended with error (?:TRANSPORT|NETWORK|SERVER|RATE_LIMIT)\b/.test(String(error?.message??''));
}
export class ReviewStats {
  totals={attempts:0,allows:0,denies:0,failures:0,cancelled:0,usageReported:0,inputTokens:0,outputTokens:0,totalTokens:0,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:0};
  usageCoverage={inputTokens:0,outputTokens:0,totalTokens:0,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:0};
  recent=[];
  constructor(write=()=>{}) {this.write=write;}
  record(entry) {
    const event={id:randomUUID(),at:Date.now(),...entry};
    this.totals.attempts++;
    const key=entry.outcome==='allow'?'allows':entry.outcome==='deny'?'denies':entry.outcome==='cancelled'?'cancelled':'failures';
    this.totals[key]++;
    if(entry.usage) {
      this.totals.usageReported++;
      for(const key of Object.keys(this.usageCoverage)) if(typeof entry.usage[key]==='number') {this.totals[key]+=entry.usage[key];this.usageCoverage[key]++;}
    }
    this.recent.unshift(event);this.recent.length=Math.min(20,this.recent.length);
    this.write(event);
  }
  gateOutcome(entry) {
    this.totals.gates=(this.totals.gates??0)+1;
    if(entry.blockedBeforeDispatch)this.totals.blockedBeforeDispatch=(this.totals.blockedBeforeDispatch??0)+1;
    this.write({id:randomUUID(),at:Date.now(),scope:'gate-outcome',...entry});
  }
  view() {return structuredClone({totals:this.totals,usageCoverage:this.usageCoverage,recent:this.recent});}
}
