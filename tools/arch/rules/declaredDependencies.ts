import type { Unit, Violation, Workspace } from '../archModel';

/** 只 import 本单元 package.json 声明过的依赖（工作区包与 npm 包）。 */
export function declaredDependencies(ws: Workspace): Violation[] {
  const out: Violation[] = [];
  for (const file of ws.files) {
    for (const imp of file.imports) {
      const name = imp.kind === 'workspace' ? imp.targetUnit?.name : imp.kind === 'npm' ? imp.npmName : undefined;
      if (!name || name === file.unit.name || isDeclared(file.unit, name)) continue;
      out.push({ rule: 'declared-dependencies', file: file.path, message: `依赖 ${name} 未在 ${file.unit.relDir}/package.json 声明（第 ${imp.line} 行）` });
    }
  }
  return out;
}

function isDeclared(unit: Unit, name: string): boolean {
  const { dependencies = {}, devDependencies = {}, peerDependencies = {} } = unit.pkg;
  return name in dependencies || name in devDependencies || name in peerDependencies;
}
