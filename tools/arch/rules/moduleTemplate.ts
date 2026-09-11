import { readdirSync } from 'node:fs';
import { INTRA_MODULE_ALLOWED, MODULE_DIRS, MODULE_ROOT_ENTRIES, PACKAGES_ALLOWED_BY_LAYER_DIR } from '../policy';
import type { ImportRef, SourceFile, Unit, Violation, Workspace } from '../archModel';

const RULE = 'module-template';

/** 模块目录模板、exports 只暴露根入口、层间 import 矩阵、深路径 import 禁令。 */
export function moduleTemplate(ws: Workspace): Violation[] {
  const out: Violation[] = [];
  for (const unit of ws.units.filter((u) => u.kind === 'module')) out.push(...checkModuleShape(unit));
  for (const file of ws.files) {
    if (file.unit.kind === 'module') out.push(...checkLayerImports(file));
    for (const imp of file.imports) {
      const deep = checkDeepImport(imp);
      if (deep) out.push({ rule: RULE, file: file.path, message: `${deep}（${imp.spec}，第 ${imp.line} 行）` });
    }
  }
  return out;
}

function checkModuleShape(unit: Unit): Violation[] {
  const out: Violation[] = [];
  const pkgFile = `${unit.dir}/package.json`;
  if (typeof unit.layer !== 'number') out.push({ rule: RULE, file: pkgFile, message: '缺少 crewstation.layer' });
  if (!exportsOnlyRoot(unit.pkg.exports)) out.push({ rule: RULE, file: pkgFile, message: 'exports 必须且只能是 { ".": "./index.ts" }' });
  for (const entry of readdirSync(unit.dir)) {
    if (MODULE_DIRS.has(entry) || MODULE_ROOT_ENTRIES.has(entry)) continue;
    out.push({ rule: RULE, file: `${unit.dir}/${entry}`, message: `模块根目录不允许出现 ${entry}；只允许 ${[...MODULE_DIRS].join('/')} 与 index.ts、wiring.ts` });
  }
  for (const file of unit.files) {
    if (file.layerDir === 'other') out.push({ rule: RULE, file: file.path, message: '文件不在模板允许的目录中' });
  }
  return out;
}

function exportsOnlyRoot(exports: unknown): boolean {
  if (typeof exports !== 'object' || exports === null) return false;
  const keys = Object.keys(exports as Record<string, unknown>);
  return keys.length === 1 && keys[0] === '.' && (exports as Record<string, unknown>)['.'] === './index.ts';
}

function checkLayerImports(file: SourceFile): Violation[] {
  const out: Violation[] = [];
  const allowedDirs = INTRA_MODULE_ALLOWED[file.layerDir];
  const allowedPackages = PACKAGES_ALLOWED_BY_LAYER_DIR[file.layerDir];
  for (const imp of file.imports) {
    const target = imp.targetUnit;
    if (!target) continue;
    if (target === file.unit && imp.targetFile && !allowedDirs.includes(imp.targetFile.layerDir)) {
      out.push({ rule: RULE, file: file.path, message: `${file.layerDir}/ 不能 import 同模块的 ${imp.targetFile.layerDir}/（${imp.spec}，第 ${imp.line} 行）` });
    }
    if (target !== file.unit && target.kind === 'package' && allowedPackages !== 'any' && !allowedPackages.includes(target.shortName)) {
      out.push({ rule: RULE, file: file.path, message: `${file.layerDir}/ 只能 import 技术包 ${allowedPackages.join('、') || '（无）'}（${imp.spec}，第 ${imp.line} 行）` });
    }
  }
  return out;
}

function checkDeepImport(imp: ImportRef): string | undefined {
  if (!imp.subpath || !imp.targetUnit) return undefined;
  if (imp.targetUnit.kind === 'module') return '模块间只能 import 根入口';
  const exports = imp.targetUnit.pkg.exports;
  if (typeof exports === 'object' && exports !== null && `./${imp.subpath}` in (exports as Record<string, unknown>)) return undefined;
  return `深路径 import 的子路径未在目标包 exports 中声明`;
}
