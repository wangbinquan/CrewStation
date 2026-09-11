import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { LayerDir, SourceFile, Unit } from './archModel';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build']);

export function collectSourceFiles(unit: Unit): SourceFile[] {
  const out: SourceFile[] = [];
  walk(unit.dir, (path) => {
    if (!/\.(ts|tsx)$/.test(path) || path.endsWith('.d.ts')) return;
    const rel = relative(unit.dir, path);
    out.push({
      path,
      rel,
      unit,
      lines: countLines(path),
      isTest: isTestPath(rel),
      isGenerated: rel.split('/').includes('generated'),
      layerDir: layerDirOf(unit, rel),
      imports: [],
    });
  });
  unit.files = out;
  return out;
}

export function walk(dir: string, visit: (path: string) => void): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, visit);
    else visit(full);
  }
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function countLines(path: string): number {
  const text = readText(path);
  return text.length === 0 ? 0 : text.split('\n').length;
}

export function isTestPath(rel: string): boolean {
  return /\.test\.tsx?$/.test(rel) || rel.split('/').includes('tests');
}

function layerDirOf(unit: Unit, rel: string): LayerDir {
  if (unit.kind !== 'module') return 'other';
  const first = rel.split('/')[0] ?? '';
  if (first === 'index.ts') return 'index';
  if (first === 'wiring.ts') return 'wiring';
  switch (first) {
    case 'api': case 'domain': case 'application': case 'ports':
    case 'adapters': case 'http': case 'workers': case 'tests':
      return first;
    default:
      return 'other';
  }
}
