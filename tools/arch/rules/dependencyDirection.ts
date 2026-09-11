import { LEAF_PACKAGES, OTHER_MODULE_IMPORT_ALLOWED_FROM, RESTRICTED_PACKAGES, UNIT_WHITELISTS } from '../policy';
import type { LayerDir, Unit, Violation, Workspace } from '../archModel';

/** apps → modules → packages 单向；模块 layer 严格递减；单元白名单；受限包。 */
export function dependencyDirection(ws: Workspace): Violation[] {
  const out: Violation[] = [];
  for (const file of ws.files) {
    for (const imp of file.imports) {
      const target = imp.targetUnit;
      if (!target || target === file.unit) continue;
      const problem = checkEdge(file.unit, target, file.layerDir);
      if (problem) out.push({ rule: 'dependency-direction', file: file.path, message: `${problem}（${imp.spec}，第 ${imp.line} 行）` });
    }
  }
  return out;
}

function checkEdge(from: Unit, to: Unit, layerDir: LayerDir): string | undefined {
  const whitelist = UNIT_WHITELISTS[from.relDir];
  if (whitelist && !(to.kind === 'package' && whitelist.includes(to.shortName))) {
    return `${from.relDir} 只允许依赖技术包 ${whitelist.join('、')}`;
  }
  const restricted = RESTRICTED_PACKAGES[to.shortName];
  if (to.kind === 'package' && restricted && !restricted.includes(from.relDir)) {
    return `技术包 ${to.shortName} 只允许 ${restricted.join('、')} 使用`;
  }
  switch (from.kind) {
    case 'package':
      if (to.kind !== 'package') return '技术包不能依赖模块、应用、运行时或工具';
      if (LEAF_PACKAGES.includes(from.shortName)) return `叶子包 ${from.shortName} 不依赖其他工作区包`;
      return undefined;
    case 'module':
      return checkModuleEdge(from, to, layerDir);
    case 'app':
      if (to.kind === 'app') return '应用不能依赖其他应用';
      if (to.kind === 'runtime' || to.kind === 'tool') return '应用不能依赖运行时或工具';
      return undefined;
    case 'runtime':
      return to.kind === 'package' ? undefined : '运行时只能依赖技术包';
    case 'tool':
      return to.kind === 'package' ? undefined : '工具只能依赖技术包';
  }
}

function checkModuleEdge(from: Unit, to: Unit, layerDir: LayerDir): string | undefined {
  if (to.kind !== 'module') {
    return to.kind === 'package' ? undefined : '模块不能依赖应用、运行时或工具';
  }
  if (from.layer === undefined || to.layer === undefined) return '模块必须在 package.json 声明 crewstation.layer';
  if (!(to.layer < from.layer)) {
    return `模块只能依赖 layer 更小的模块（${from.shortName}=L${from.layer} → ${to.shortName}=L${to.layer}）`;
  }
  if (!OTHER_MODULE_IMPORT_ALLOWED_FROM.includes(layerDir)) {
    return '其他模块只能在 wiring.ts 或 tests/ 中 import；用例层需要的能力经 ports/ 声明后由 wiring 注入';
  }
  return undefined;
}
