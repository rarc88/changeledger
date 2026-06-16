import fs from 'node:fs';
import path from 'node:path';

let counter = 0;

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
