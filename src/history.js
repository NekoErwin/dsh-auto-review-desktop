import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'];

/** Pure display projection of the latest record snapshots, never an authorization source. */
export function summarizeReviewHistory(records) {
  const totals = { records: records.length, attempts: 0, allows: 0, denies: 0, failures: 0, cancelled: 0, usageReported: 0,
    ...Object.fromEntries(TOKEN_FIELDS.map(key => [key, 0])) };
  const usageCoverage = Object.fromEntries(TOKEN_FIELDS.map(key => [key, 0]));
  const recordOutcomes = { allowed: 0, denied: 0, failed: 0, cancelled: 0, interrupted: 0, reviewing: 0 };
  for (const row of records) {
    const attempts = Array.isArray(row.attempts) ? row.attempts : [];
    // Match reviewPresentation: a reviewer denial stays visible even after a gate failure.
    const state = attempts.some(attempt => attempt?.verdict?.decision === 'deny') ? 'denied'
      : row.status === 'reviewing' ? 'reviewing' : row.status === 'failed' ? 'failed'
      : row.status === 'cancelled' ? 'cancelled' : row.status === 'interrupted' ? 'interrupted'
      : attempts.at(-1)?.verdict?.decision === 'allow' ? 'allowed' : 'failed';
    recordOutcomes[state]++;
    for (const attempt of attempts) {
      totals.attempts++;
      const outcome = attempt?.outcome === 'allow' ? 'allows' : attempt?.outcome === 'deny' ? 'denies'
        : attempt?.outcome === 'cancelled' ? 'cancelled' : 'failures';
      totals[outcome]++;
      let reported = false;
      for (const key of TOKEN_FIELDS) {
        const value = attempt?.usage?.[key];
        if (Number.isFinite(value) && value >= 0) {
          totals[key] += value;
          usageCoverage[key]++;
          reported = true;
        }
      }
      if (reported) totals.usageReported++;
    }
  }
  return { totals, usageCoverage, recordOutcomes };
}

/** Display-only, profile-owned records. Never consulted to authorize an action. */
export function createReviewHistory(profileHome, logger) {
  const cells = new Map();
  let closed = false, purging = false, cleared = false, clearRevision = 0, available = Boolean(profileHome);
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
    if (closed) return;
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
        tool: exec.name, arguments: structuredClone(exec.arguments), ...(call ? { callSeq: call.seq } : {}), startedAt: Date.now(), status: 'reviewing', attempts: [] };
      save(cell, row);
      return {
        attempt(attempt) { row.attempts.push(structuredClone(attempt)); save(cell, row); },
        finish(outcome, code) { row.status = code === 'CANCELLED' ? 'cancelled' : code ? 'failed' : 'completed'; row.gate = outcome; if (code) row.code = code; row.finishedAt = Date.now(); save(cell, row); },
      };
    },
    async read(sessionId) {
      if (cleared) return { revision: clearRevision, available: false, closed: true, records: [], summary: summarizeReviewHistory([]) };
      const cell = cellFor(sessionId); await cell.pending; await cell.loaded;
      if (cleared) return this.read(sessionId);
      const records = [...cell.rows.values()];
      return { revision: cell.revision, available, closed: closed && !purging, records, summary: summarizeReviewHistory(records) };
    },
    async watch(sessionId, revision, signal) {
      if (cleared) return this.read(sessionId);
      const cell = cellFor(sessionId); await cell.pending; await cell.loaded;
      if ((!closed || purging) && !signal?.aborted && cell.revision === revision) await new Promise(resolve => {
        let timer;
        const done = () => { clearTimeout(timer); cell.listeners.delete(done); signal?.removeEventListener('abort', done); resolve(); };
        cell.listeners.add(done); signal?.addEventListener('abort', done, { once: true });
        timer = setTimeout(done, 25000);
        if ((closed && !purging) || signal?.aborted || cell.revision !== revision) done();
      });
      return this.read(sessionId);
    },
    async close({ notify = true } = {}) { closed = true; if (notify && !purging) for (const cell of cells.values()) publish(cell); await Promise.all([...cells.values()].map(cell => cell.pending)); },
    async purge() {
      purging = true;
      await this.close({ notify: false });
      await Promise.all([...cells.values()].map(cell => cell.loaded));
      clearRevision = Math.max(0, ...[...cells.values()].map(cell => cell.revision)) + 1;
      cleared = true; purging = false; available = false;
      for (const cell of cells.values()) { cell.rows.clear(); publish(cell); }
      cells.clear();
    },
  };
}
