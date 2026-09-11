import type { FileEntry } from '@crewstation/contracts';

/** 文件树的根：TaskRunner 的 listFiles 以工作目录为基准，`.` 即仓库根。 */
export const WORKSPACE_ROOT = '.';

export function joinPath(dir: string, name: string): string {
  return dir === WORKSPACE_ROOT || dir === '' ? name : `${dir}/${name}`;
}

export function parentPath(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? WORKSPACE_ROOT : path.slice(0, cut);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** 目录在前、同类按名称排序：与终端里 ls 的直觉一致。 */
export function sortEntries(entries: readonly FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    const aDir = a.kind === 'dir';
    const bDir = b.kind === 'dir';
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** 编辑器只打开文本文件；目录与符号链接由树自己处理。 */
export function isEditable(entry: FileEntry): boolean {
  return entry.kind === 'file';
}
