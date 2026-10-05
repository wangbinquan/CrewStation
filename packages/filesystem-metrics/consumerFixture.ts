import { mkdtemp, mkdir, writeFile, symlink, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function consumerFixture(run: (f: { root: string; file: string; identity: { device: string; inode: string }; process: (id: string, tick?: string) => Promise<string>; thread: (pid: string, tid: string) => Promise<string> }) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'cs-file-consumers-')), root = join(directory, 'proc'), file = join(directory, 'original-file');
  try {
    await mkdir(join(root, 'sys/kernel/random'), { recursive: true }); await mkdir(join(root, 'self/ns'), { recursive: true });
    await writeFile(join(root, 'sys/kernel/random/boot_id'), '12345678-1234-1234-1234-123456789abc\n'); await symlink('pid:[701]', join(root, 'self/ns/pid'));
    await writeFile(file, 'private body must never appear in source output'); const source = await stat(file, { bigint: true });
    const process = async (id: string, tick = '311') => {
      const path = join(root, id); await mkdir(join(path, 'fd'), { recursive: true });
      await writeFile(join(path, 'stat'), `${id} (private process ) name) ${['S', ...Array(18).fill('0'), tick, '0'].join(' ')}\n`);
      await writeFile(join(path, 'maps'), ''); await mkdir(join(path, 'task')); await symlink(path, join(path, 'task', id)); return path;
    };
    const thread = async (pid: string, tid: string) => {
      const path = join(root, pid, 'task', tid); await mkdir(join(path, 'fd'), { recursive: true });
      await writeFile(join(path, 'stat'), `${tid} (thread) ${['S', ...Array(18).fill('0'), '811', '0'].join(' ')}\n`); await writeFile(join(path, 'maps'), ''); return path;
    };
    await run({ root, file, identity: { device: String(source.dev), inode: String(source.ino) }, process, thread });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
