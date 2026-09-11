import { basename, dirname } from 'node:path';
import { BANNED_BASENAMES, CAPS, DEFAULT_EXPORT_ALLOWED } from '../policy';
import { readText } from '../sourceFiles';
import type { SourceFile, Violation, Workspace } from '../archModel';

/** 文件行数、目录文件数、禁用文件名、index.ts 位置、默认导出、生成代码头注释。 */
export function sizeAndNaming(ws: Workspace): Violation[] {
  const out: Violation[] = [];
  const perDir = new Map<string, number>();
  for (const file of ws.files) {
    if (file.isGenerated) {
      if (!readText(file.path).split('\n')[0]?.includes('GENERATED')) out.push({ rule: 'generated-header', file: file.path, message: '生成代码首行必须包含 GENERATED 标记' });
      continue;
    }
    const cap = file.isTest ? CAPS.testLines : CAPS.sourceLines;
    if (file.lines > cap) out.push({ rule: 'size-limit', file: file.path, message: `${file.lines} 行，超过上限 ${cap} 行；按概念拆分` });
    if (!file.isTest) perDir.set(dirname(file.path), (perDir.get(dirname(file.path)) ?? 0) + 1);
    out.push(...checkName(file));
    if (file.path.endsWith('.ts') && !DEFAULT_EXPORT_ALLOWED.test(basename(file.path)) && /^export\s+default\b/m.test(readText(file.path))) out.push({ rule: 'no-default-export', file: file.path, message: '禁止默认导出（工具配置文件除外）' });
  }
  for (const [dir, count] of perDir) {
    if (count > CAPS.filesPerDir) out.push({ rule: 'size-limit', file: dir, message: `目录直接包含 ${count} 个源码文件，超过上限 ${CAPS.filesPerDir}；建子目录分组` });
  }
  return out;
}

function checkName(file: SourceFile): Violation[] {
  const name = basename(file.path);
  if (BANNED_BASENAMES.has(name)) return [{ rule: 'banned-name', file: file.path, message: `禁止使用杂物箱文件名 ${name}；以概念命名` }];
  if (name === 'types.ts' && !(file.unit.kind === 'module' && file.layerDir === 'api')) {
    return [{ rule: 'banned-name', file: file.path, message: 'types.ts 只允许出现在模块的 api/ 目录' }];
  }
  if (name === 'index.ts' && !indexAllowed(file)) return [{ rule: 'banned-name', file: file.path, message: '只有模块根、技术包根与 console 的 feature 根允许 index.ts' }];
  return [];
}

function indexAllowed(file: SourceFile): boolean {
  if (file.rel === 'index.ts') return file.unit.kind === 'module' || file.unit.kind === 'package';
  return file.unit.relDir === 'apps/console' && /^src\/features\/[^/]+\/index\.ts$/.test(file.rel);
}
