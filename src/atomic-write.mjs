import fs from 'node:fs';
import path from 'node:path';

let counter = 0;
// Timeout-based staleness: a lock is stale if it's held for longer than
// DEFAULT_LOCK_WAIT_MS. Simpler and portable, appropriate for file-mutation
// exclusion where contention is short-lived. Contrast with acquireIdLock in
// new.mjs, which uses PID liveness — better for id-collision prevention across
// processes where a lock might outlive a slow but still-running agent.
const DEFAULT_LOCK_WAIT_MS = 5_000;
const DEFAULT_LOCK_RETRY_MS = 10;

export function writeFileAtomic(file, data, options = {}) {
  const { encoding = 'utf8', fsImpl = fs } =
    typeof options === 'string' ? { encoding: options } : options;
  const dir = path.dirname(file);
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${counter++}.tmp`,
  );
  let fd = null;

  try {
    fd = fsImpl.openSync(tmp, 'wx');
    fsImpl.writeFileSync(fd, data, { encoding });
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = null;
    fsImpl.renameSync(tmp, file);
    fsyncDir(dir, fsImpl);
  } catch (e) {
    if (fd !== null) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        // best effort cleanup below
      }
    }
    try {
      fsImpl.rmSync(tmp, { force: true });
    } catch {
      // preserve the original error
    }
    throw e;
  }
}

export function mutateFileAtomic(file, mutate, options = {}) {
  const { encoding = 'utf8', fsImpl = fs } = options;
  return withFileLock(
    file,
    () => {
      const before = fsImpl.readFileSync(file, encoding);
      const after = mutate(before);
      if (after === undefined) return undefined;
      writeFileAtomic(file, after, { encoding, fsImpl });
      return after;
    },
    options,
  );
}

export function withFileLock(file, fn, options = {}) {
  const { fsImpl = fs, waitMs = DEFAULT_LOCK_WAIT_MS, retryMs = DEFAULT_LOCK_RETRY_MS } = options;
  const lock = lockPath(file);
  const start = Date.now();
  let fd = null;

  while (fd === null) {
    try {
      fd = fsImpl.openSync(lock, 'wx');
      try {
        fsImpl.writeFileSync(
          fd,
          JSON.stringify({ pid: process.pid, created: new Date().toISOString() }),
        );
      } catch (e) {
        cleanupLock(lock, fd, fsImpl);
        fd = null;
        throw e;
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - start > waitMs) {
        throw new Error(`timed out waiting for lock ${lock}`);
      }
      sleepSync(retryMs);
    }
  }

  try {
    return fn();
  } finally {
    cleanupLock(lock, fd, fsImpl);
  }
}

function lockPath(file) {
  return path.join(path.dirname(file), `.${path.basename(file)}.lock`);
}

function cleanupLock(lock, fd, fsImpl) {
  try {
    fsImpl.closeSync(fd);
  } finally {
    try {
      fsImpl.rmSync(lock, { force: true });
    } catch {
      // preserve the original result/error
    }
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fsyncDir(dir, fsImpl) {
  let fd = null;
  try {
    fd = fsImpl.openSync(dir, 'r');
    fsImpl.fsyncSync(fd);
  } catch {
    // Some platforms/filesystems do not support directory fsync.
  } finally {
    if (fd !== null) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        // best effort
      }
    }
  }
}
