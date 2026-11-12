import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/** Display-only, profile-owned records. Never consulted to authorize an action. */
export function createReviewHistory(profileHome, logger) {
  const cells = new Map();
  let closed = false, available = Boolean(profileHome);
  const directory = profileHome && join(profileHome, '.plugin-data', 'dsh-auto-review-desktop', 'history');
  const filename = id => join(directory, `${createHash('sha256').update(id).digest('hex')}.jsonl`);
  const warn = () => { available = false; logger?.warn('auto-review-desktop: review display history is unavailable'); };
  function cellFor(id) {
    let cell = cells.get(id);
    if (!cell) {
      cell = { rows: new Map(), revision: 0, listeners: new Set(), pending: Promise.resolve() };
      cell.loaded = directory ? readFile(filename(id), 'utf8').then(text => {
        for (const line of text.split('\n')) {
          if (!line) continue;
          try {
            const row = JSON.parse(line);
            if (row.version === 1 && row.sessionId === id && typeof row.id === 'string') {
              // A Host crash/unload must not leave a historical review spinning forever.
              cell.rows.set(row.id, row.status === 'reviewing' ? { ...row, status: 'interrupted' } : row);
            }
          } catch { warn(); }
        }
      }, error => { if (error.code !== 'ENOENT') warn(); }) : Promise.resolve();
      cells.set(id, cell);
    }
    return cell;
  }
  function publish(cell) { cell.revision++; for (const notify of [...cell.listeners]) notify(); }
  function save(cell, row) {
    const copy = structuredClone(row);
    cell.pending = cell.pending.then(() => cell.loaded).then(async () => {
      cell.rows.set(copy.id, copy); publish(cell);
      if (directory) {
        await mkdir(directory, { recursive: true });
        await appendFile(filename(copy.sessionId), `${JSON.stringify(copy)}\n`, { encoding: 'utf8', mode: 0o600 });
      }
    }).catch(warn);
  }
  return {
    start(exec) {
      if (closed) return undefined;
      const sessionId = String(exec.agent.session.id), cell = cellFor(sessionId);
      const call = exec.agent.session.snapshotEvents().findLast(event => event.type === 'tool/call' && event.data.callId === exec.rootCallId);
      const row = { version: 1, id: randomUUID(), sessionId, callId: String(exec.callId), rootCallId: String(exec.rootCallId ?? exec.callId),
        tool: exec.name, ...(call ? { callSeq: call.seq } : {}), startedAt: Date.now(), status: 'reviewing', attempts: [] };
      save(cell, row);
      return {
        attempt(attempt) { row.attempts.push(structuredClone(attempt)); save(cell, row); },
        finish(outcome, code) { row.status = code === 'CANCELLED' ? 'cancelled' : code ? 'failed' : 'completed'; row.gate = outcome; if (code) row.code = code; row.finishedAt = Date.now(); save(cell, row); },
      };
    },
    async read(sessionId) {
      const cell = cellFor(sessionId); await cell.pending; await cell.loaded;
      return { revision: cell.revision, available, closed, records: [...cell.rows.values()] };
    },
    async watch(sessionId, revision, signal) {
      const cell = cellFor(sessionId); await cell.pending; await cell.loaded;
      if (!closed && !signal?.aborted && cell.revision === revision) await new Promise(resolve => {
        let timer;
        const done = () => { clearTimeout(timer); cell.listeners.delete(done); signal?.removeEventListener('abort', done); resolve(); };
        cell.listeners.add(done); signal?.addEventListener('abort', done, { once: true });
        timer = setTimeout(done, 25000);
        if (closed || signal?.aborted || cell.revision !== revision) done();
      });
      return this.read(sessionId);
    },
    async close() { closed = true; for (const cell of cells.values()) publish(cell); await Promise.all([...cells.values()].map(cell => cell.pending)); },
  };
}
