import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { resolveImports } from './imports';
import { collectSourceFiles } from './sourceFiles';
import type { PackageJson, Unit, UnitKind, Workspace } from './archModel';

const KIND_BY_TOP: Record<string, UnitKind> = {
  apps: 'app', modules: 'module', packages: 'package', runtimes: 'runtime', tools: 'tool',
};

export function loadWorkspace(root: string): Workspace {
  const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { workspaces?: string[] };
  const units = (rootPkg.workspaces ?? []).flatMap((pattern) => unitsUnder(root, pattern));
  const files = units.flatMap((unit) => collectSourceFiles(unit));
  const ws: Workspace = { root, units, files, byPath: new Map(files.map((f) => [f.path, f] as const)) };
  for (const file of files) file.imports = resolveImports(file, ws);
  return ws;
}

function unitsUnder(root: string, pattern: string): Unit[] {
  const top = pattern.split('/')[0] ?? '';
  const topDir = join(root, top);
  if (!existsSync(topDir)) return [];
  const units: Unit[] = [];
  for (const entry of readdirSync(topDir)) {
    const dir = join(topDir, entry);
    const pkgPath = join(dir, 'package.json');
    if (!statSync(dir).isDirectory() || !existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson;
    units.push({
      name: pkg.name,
      shortName: basename(dir),
      kind: KIND_BY_TOP[top] ?? 'tool',
      dir,
      relDir: relative(root, dir),
      layer: pkg.crewstation?.layer,
      pkg,
      files: [],
    });
  }
  return units;
}
