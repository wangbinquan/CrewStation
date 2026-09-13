import { lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { ProcessHost } from '../contract/processHost';

const pending = new Map<string, Promise<void>>();

/** OpenCode 1.18.29 检查 npm lock 根依赖。仅 node_modules 或 bun.lock 仍会触发联网安装。 */
export async function seedOpencodePluginDependencies(source: string, target: string, host: ProcessHost): Promise<void> {
  const existing = pending.get(target);
  if (existing) return existing;
  const work = seed(source, target, host);
  pending.set(target, work);
  try { await work; } finally { pending.delete(target); }
}

async function seed(source: string, target: string, host: ProcessHost): Promise<void> {
  const names = ['package.json', 'package-lock.json', 'node_modules'];
  // 用户已有的依赖集合完整保留，让 CLI 按它原来的规则安装／更新。
  for (const name of names) if (await lstat(join(target, name)).then(() => true, () => false)) return;
  const manifest = await readFile(join(source, 'package.json'), 'utf8');
  const lock = await readFile(join(source, 'package-lock.json'), 'utf8');
  if (JSON.parse(manifest).dependencies?.['@opencode-ai/plugin'] !== '1.18.29') throw new Error('OpenCode observer SDK version mismatch');
  const created = await mkdir(target, { recursive: true, mode: 0o700 });
  // recursive mkdir 会把新父目录一起建成 root 0700；只把本次新建部分交给 worker。
  if (created) {
    let path = target;
    while (!relative(created, path).startsWith('..')) {
      await host.chownToWorker(path);
      if (path === created) break;
      path = dirname(path);
    }
  }
  await host.chownToWorker(target);
  for (const [name, content] of [['package.json', manifest], ['package-lock.json', lock]] as const) {
    await writeFile(join(target, name), content, { mode: 0o600, flag: 'wx' });
    await host.chownToWorker(join(target, name));
  }
  await symlink(join(source, 'node_modules'), join(target, 'node_modules'), 'dir');
}
