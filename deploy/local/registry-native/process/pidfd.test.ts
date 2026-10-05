import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFile, readlink, stat } from 'node:fs/promises';
import { jsonHash } from '../../../../packages/kernel';
import { openRegistryPidfd } from './pidfd';
import { processStat } from './identity';

test.skipIf(process.platform !== 'linux')('actual Linux pidfd signals only its held validation child and remains dead after that original process exits', async () => {
  const child = Bun.spawn([process.execPath, '-e', 'await new Promise(() => { setInterval(() => {}, 1000); });'], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' });
  let fd: Awaited<ReturnType<typeof openRegistryPidfd>> | undefined;
  try {
    const directory = '/proc/' + child.pid, file = await stat(directory + '/exe', { bigint: true });
    const original = { pid: child.pid, startTicks: processStat(await readFile(directory + '/stat', 'utf8'), String(child.pid)).startTicks, containerId: 'containerd://' + 'a'.repeat(64), podUid: randomUUID(),
      bootId: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), namespace: await readlink('/proc/self/ns/pid'), cgroup: jsonHash(await readFile(directory + '/cgroup', 'utf8')),
      executable: '/bin/registry' as const, executableIdentity: jsonHash([String(file.dev), String(file.ino), String(file.birthtimeNs)]) };
    // This is a separate, disposable validation child for the pidfd primitive;
    // the deployment Registry is never selected or signalled by this test.
    fd = await openRegistryPidfd(original); await fd.assertAlive(); await fd.signal('stop');
    const deadline = Date.now() + 1000;
    while (processStat(await readFile(directory + '/stat', 'utf8'), String(child.pid)).state !== 'T') { if (Date.now() > deadline) throw Error('Validation child never actually stopped'); await Bun.sleep(5); }
    await fd.signal('continue'); child.kill('SIGTERM'); await child.exited;
    await expect(fd.assertAlive()).rejects.toThrow('exited'); await expect(fd.signal('stop')).rejects.toThrow('exited');
    fd.close(); await expect(fd.assertAlive()).rejects.toThrow('exited');
  } finally { fd?.close(); if (child.exitCode === null) { child.kill('SIGKILL'); await child.exited; } }
});
