import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, posix, sep } from 'node:path';
import { RunnerCommandError, fsErrorCode, notFound, pathDenied } from '../commandError';

export interface ResolvedPath {
  /** realpath 化后的绝对路径（目标尚不存在时，是其最深存在祖先的 realpath 加上缺失尾段）。 */
  absolute: string;
  /** 规范化后的相对路径，回给调用方。 */
  relative: string;
  exists: boolean;
}

export interface WorkdirPaths {
  /** 工作目录的 realpath。 */
  readonly root: string;
  /** 文件命令用：只接受相对路径，规范化后拒绝 `..`，realpath 后必须仍在工作目录内（符号链接逃逸也被拒）。 */
  resolveRelative(path: string): Promise<ResolvedPath>;
  /** 子进程 cwd：缺省为工作目录；接受工作目录内的绝对路径；必须是已存在的目录。 */
  resolveCwd(path?: string): Promise<string>;
}

export async function createWorkdirPaths(workdir: string): Promise<WorkdirPaths> {
  const root = await realpath(workdir);
  return {
    root,
    resolveRelative: (path) => resolveRelative(root, path),
    resolveCwd: (path) => resolveCwd(root, path),
  };
}

export function normalizeRelative(path: string): string {
  if (path.includes('\0') || isAbsolute(path) || path.startsWith('\\') || path.startsWith('~')) throw pathDenied(path);
  const normalized = posix.normalize(path === '' ? '.' : path);
  if (normalized === '..' || normalized.startsWith('../')) throw pathDenied(path);
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

export function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep);
}

async function resolveRelative(root: string, path: string): Promise<ResolvedPath> {
  const relative = normalizeRelative(path);
  const candidate = relative === '.' ? root : join(root, relative);
  const { real, exists } = await realpathOfDeepestExisting(candidate);
  if (!isInside(root, real)) throw pathDenied(path);
  return { absolute: real, relative, exists };
}

/** 逐级向上找到第一个存在的祖先并取其 realpath，再拼回缺失尾段：对尚不存在的写入目标也能识别经符号链接的逃逸。 */
async function realpathOfDeepestExisting(candidate: string): Promise<{ real: string; exists: boolean }> {
  const missing: string[] = [];
  let probe = candidate;
  for (;;) {
    try {
      const real = await realpath(probe);
      return { real: missing.length === 0 ? real : join(real, ...missing.reverse()), exists: missing.length === 0 };
    } catch (error) {
      const code = fsErrorCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const parent = dirname(probe);
      if (parent === probe) throw error;
      missing.push(basename(probe));
      probe = parent;
    }
  }
}

async function resolveCwd(root: string, path?: string): Promise<string> {
  if (path === undefined || path === '') return root;
  let real: string;
  if (isAbsolute(path)) {
    if (!isInside(root, posix.normalize(path))) throw pathDenied(path);
    real = await realpath(path).catch(() => {
      throw notFound(`目录 ${path}`);
    });
  } else {
    const resolved = await resolveRelative(root, path);
    if (!resolved.exists) throw notFound(`目录 ${path}`);
    real = resolved.absolute;
  }
  if (!isInside(root, real)) throw pathDenied(path);
  const info = await stat(real);
  if (!info.isDirectory()) throw new RunnerCommandError('not_a_directory', `${path} 不是目录`);
  return real;
}
