import { readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { readFile, readdir, readlink, stat } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';

/** Native proc metadata is kernel supplied. Avoid a worker dispatch for every
 * descriptor, but yield regularly so cancellation and HTTP deadlines run.
 * Controlled filesystem fixtures retain asynchronous I/O, including FIFOs. */
export function consumerMetadata(root: string) {
  const native = process.platform === 'linux' && root === '/proc';
  let lastYield = performance.now();
  return {
    read: (path: string, signal?: AbortSignal) => native ? readFileSync(path, 'utf8') : readFile(path, { encoding: 'utf8', signal }),
    entries: (path: string) => native ? readdirSync(path) : readdir(path),
    link: (path: string) => native ? readlinkSync(path) : readlink(path),
    identity: (path: string) => native ? statSync(path, { bigint: true }) : stat(path, { bigint: true }),
    checkpoint: async (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (native && performance.now() - lastYield >= 10) {
        await setImmediate(undefined, { signal }); lastYield = performance.now();
      }
      signal?.throwIfAborted();
    },
  };
}
