import { lstat, readdir, realpath, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/** User-confirmed cleanup of two fixed plugin-owned locations. The canonical profile root is trusted. */
export function createDataCleanup({ profileHome, stop, history, journal, now = Date.now, stopTimeoutMs = 10000 }) {
  const challenges = new Map();
  let pending, stopped = false, cleaned = false;
  const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
  const sameFile = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
  async function plainDirectory(path) {
    const info = await lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (info && (info.isSymbolicLink() || !info.isDirectory())) fail('UNSAFE_PATH', 'A data directory is a link or is not a directory.');
    if (info && await realpath(path) !== path) fail('UNSAFE_PATH', 'The data directory does not resolve to the expected location.');
    return info;
  }
  async function inspect() {
    if (!profileHome) fail('NO_PROFILE', 'No persistent profile data directory is available.');
    const root = await realpath(resolve(profileHome));
    const parent = join(root, '.plugin-data'), target = join(parent, 'dsh-auto-review-desktop');
    // A direct child of the trusted root avoids following a replaced .plugin-data ancestor during removal.
    const staging = join(root, '.auto-review-desktop-cleanup');
    const parentInfo = await plainDirectory(parent);
    const targetInfo = parentInfo ? await plainDirectory(target) : undefined;
    const stagingInfo = await plainDirectory(staging);
    let files = 0, bytes = 0, entries = 0;
    async function walk(path) {
      for (const name of await readdir(path)) {
        if (++entries > 100000) fail('TOO_MANY_FILES', 'The data directory is too large to inspect safely.');
        const child = join(path, name), info = await lstat(child);
        if (info.isSymbolicLink()) fail('UNSAFE_PATH', 'A link was found in the data directory.');
        if (info.isDirectory()) { await plainDirectory(child); await walk(child); }
        else if (info.isFile()) { files++; bytes += info.size; }
        else fail('UNSAFE_PATH', 'An unsupported file was found in the data directory.');
      }
    }
    if (targetInfo) await walk(target);
    if (stagingInfo) await walk(staging);
    return { root, target, staging, targetInfo, stagingInfo, files, bytes, exists: Boolean(targetInfo || stagingInfo),
      targets: [target, ...(stagingInfo ? [staging] : [])] };
  }
  return {
    get stopped() { return stopped; },
    get cleaned() { return cleaned; },
    async prepare(peerId) {
      if (pending) fail('BUSY', 'Cleanup is already running.');
      const scope = await inspect(), token = randomUUID();
      challenges.clear(); challenges.set(peerId, { token, expires: now() + 60000, target: scope.target, staging: Boolean(scope.stagingInfo) });
      return { target: scope.target, targets: scope.targets, files: scope.files, bytes: scope.bytes, exists: scope.exists,
        token, expiresInMs: 60000, stopped, cleaned };
    },
    async clean(peerId, input, signal) {
      const challenge = challenges.get(peerId);
      if (!challenge || input?.token !== challenge.token || input?.confirmation !== 'DELETE' || now() >= challenge.expires)
        fail('CONFIRMATION_REQUIRED', 'Preview the cleanup and type DELETE to confirm within one minute.');
      if (signal?.aborted) fail('CANCELLED', 'Cleanup was cancelled before it started.');
      if (pending) fail('BUSY', 'Cleanup is already running.');
      challenges.clear();
      pending = (async () => {
        const before = await inspect();
        if (before.target !== challenge.target || (before.stagingInfo && !challenge.staging)) fail('UNSAFE_PATH', 'The profile data location changed.');
        // Finish an admitted cleanup even after a browser disconnect. Never reopen writers after a partial failure.
        stopped = true;
        let timer;
        const shutdown = Promise.resolve().then(stop);
        const storage = Promise.all([journal.close(), history.purge()]);
        try {
          await Promise.race([Promise.all([shutdown, storage]), new Promise((_, reject) => {
            timer = setTimeout(() => { const error = new Error('Review shutdown did not complete. Data was not deleted.'); error.code = 'STOP_TIMEOUT'; reject(error); }, stopTimeoutMs);
          })]);
        } finally { clearTimeout(timer); }
        const scope = await inspect();
        if (scope.target !== challenge.target || (scope.stagingInfo && !challenge.staging)) fail('UNSAFE_PATH', 'The profile data location changed.');
        if (scope.stagingInfo) {
          if (!sameFile(scope.stagingInfo, await plainDirectory(scope.staging))) fail('UNSAFE_PATH', 'The staged directory changed.');
          await rm(scope.staging, { recursive: true, force: false });
        }
        if (scope.targetInfo) {
          await rename(scope.target, scope.staging);
          // Do not delete a different directory if an ancestor was replaced between inspection and rename.
          if (!sameFile(scope.targetInfo, await plainDirectory(scope.staging))) fail('UNSAFE_PATH', 'The moved directory identity changed. No staged data was deleted.');
          await rm(scope.staging, { recursive: true, force: false });
        }
        cleaned = true;
        return { cleaned: true, stopped: true, target: scope.target, files: scope.files, bytes: scope.bytes };
      })();
      try { return await pending; } finally { pending = undefined; }
    },
  };
}
