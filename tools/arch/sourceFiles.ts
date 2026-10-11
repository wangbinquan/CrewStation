import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { LayerDir, SourceFile, Unit } from './archModel';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build']);
// Text belongs to this newly collected file object, never a path or a later workspace scan.
const sourceTexts = new WeakMap<SourceFile, string>();

export function collectSourceFiles(unit: Unit): SourceFile[] {
  const out: SourceFile[] = [];
  walk(unit.dir, (path) => {
    if (!/\.(ts|tsx)$/.test(path) || path.endsWith('.d.ts')) return;
    const rel = relative(unit.dir, path);
    const text = readText(path);
    const file: SourceFile = {
      path,
      rel,
      unit,
      lines: countLines(text),
      isTest: isTestPath(rel),
      isGenerated: rel.split('/').includes('generated'),
      layerDir: layerDirOf(unit, rel),
      imports: [],
    };
    sourceTexts.set(file, text);
    out.push(file);
  });
  unit.files = out;
  return out;
}

export function walk(dir: string, visit: (path: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    // Keep following directory symlinks and reporting broken symlinks as the original walk did.
    const directory = entry.isDirectory() || entry.isSymbolicLink() && statSync(full).isDirectory();
    if (directory) walk(full, visit);
    else visit(full);
  }
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

export function readSourceText(file: SourceFile): string {
  return sourceTexts.get(file) ?? readText(file.path);
}

function countLines(text: string): number {
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
