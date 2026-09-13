import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readlink } from 'node:fs/promises';
import type { WorkspaceFile } from '@crewstation/contracts';
import type { WorkdirPaths } from '../files/workdirPath';

/** 版本指纹包含 index blob 与实际 dirty／untracked 内容，同样行数的编辑也会失效。 */
export async function workspaceFingerprint(paths: WorkdirPaths, status: string, files: WorkspaceFile[]): Promise<string> {
  const hash = createHash('sha256').update(status);
  for (const file of files) {
    hash.update(JSON.stringify(file));
    const absolute = `${paths.root}/${file.path}`;
    const info = await lstat(absolute).catch((error: unknown) => {
      if ((error as { code?: string }).code === 'ENOENT') return undefined;
      throw error;
    });
    if (!info) { hash.update('deleted'); continue; }
    if (info.isSymbolicLink()) { hash.update(await readlink(absolute)); continue; }
    if (!info.isFile()) { hash.update(`directory:${info.mtimeMs}`); continue; }
    // resolveRelative 拦截父目录经符号链接离开 workdir；只读且流式，不把大文件搬进内存。
    await paths.resolveRelative(file.path);
    for await (const chunk of createReadStream(absolute)) hash.update(chunk);
  }
  return hash.digest('hex');
}
