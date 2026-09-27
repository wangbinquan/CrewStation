import { posix } from 'node:path';
import { validation } from '@crewstation/kernel';
export interface SourceTreeEntry { readonly path: string; readonly mode: string; readonly type: 'tree' | 'blob' | 'commit' }

/** 词法边界与 Git tree 模式一起检查；实际 checkout 还需 realpath 复核。 */
export function inspectSourceTree(tree: readonly SourceTreeEntry[], context: string, dockerfile: string): { dockerfilePath: string; links: readonly SourceTreeEntry[]; attributes: readonly SourceTreeEntry[] } {
  const root = posix.normalize(context), file = posix.join(root, dockerfile);
  const inside = (path: string): boolean => root === '.' || path === root || path.startsWith(`${root}/`);
  const fileEntry = tree.find((entry) => entry.path === file);
  if (!fileEntry || !['100644', '100755'].includes(fileEntry.mode)) throw validation('Dockerfile 必须是上下文中的常规文件，不能是符号链接');
  const relevant = tree.filter((entry) => inside(entry.path));
  if (relevant.some((entry) => entry.type === 'commit' || entry.mode === '160000' || posix.basename(entry.path) === '.gitmodules')) throw validation('首版运行镜像构建不支持 Git 子模块，请将所需文件纳入源码');
  if (tree.some((entry) => entry.mode === '120000' && root.startsWith(`${entry.path}/`))) throw validation('构建上下文不能穿过符号链接');
  return { dockerfilePath: file, links: relevant.filter((entry) => entry.mode === '120000'), attributes: tree.filter((entry) => entry.path.endsWith('.gitattributes') && (inside(entry.path) || root.startsWith(`${posix.dirname(entry.path)}/`) || entry.path === '.gitattributes')) };
}

export function inspectSourceLink(link: string, target: string, context: string): void {
  if (!target || target.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(target)) throw validation(`符号链接 ${link} 指向构建上下文之外`);
  const resolved = posix.normalize(posix.join(posix.dirname(link), target)), root = posix.normalize(context);
  if (resolved === '..' || resolved.startsWith('../') || (root !== '.' && resolved !== root && !resolved.startsWith(`${root}/`))) throw validation(`符号链接 ${link} 指向构建上下文之外`);
}
