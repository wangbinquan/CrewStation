import { dirname, resolve } from 'node:path';
import { readText } from './sourceFiles';
import type { ImportRef, SourceFile, Unit, Workspace } from './archModel';

const FROM_RE = /\bfrom\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_RE = /^\s*import\s+['"]([^'"]+)['"]/;
const DYNAMIC_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

export function resolveImports(file: SourceFile, ws: Workspace): ImportRef[] {
  const refs: ImportRef[] = [];
  readText(file.path).split('\n').forEach((line, index) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    for (const spec of specsInLine(line)) refs.push(classify(spec, index + 1, file, ws));
  });
  return refs;
}

function specsInLine(line: string): string[] {
  const specs: string[] = [];
  const side = SIDE_EFFECT_RE.exec(line);
  if (side?.[1]) specs.push(side[1]);
  for (const m of line.matchAll(FROM_RE)) if (m[1]) specs.push(m[1]);
  for (const m of line.matchAll(DYNAMIC_RE)) if (m[1]) specs.push(m[1]);
  return specs;
}

function classify(spec: string, line: number, file: SourceFile, ws: Workspace): ImportRef {
  if (spec.startsWith('node:') || spec.startsWith('bun:') || spec === 'bun') return { spec, line, kind: 'builtin' };
  if (spec.startsWith('.')) {
    const target = resolveRelative(file, spec, ws);
    return target ? { spec, line, kind: 'relative', targetFile: target, targetUnit: target.unit } : { spec, line, kind: 'relative' };
  }
  const hit = matchWorkspace(spec, ws.units);
  if (hit) return hit.subpath ? { spec, line, kind: 'workspace', targetUnit: hit.unit, subpath: hit.subpath } : { spec, line, kind: 'workspace', targetUnit: hit.unit };
  return { spec, line, kind: 'npm', npmName: npmNameOf(spec) };
}

function resolveRelative(file: SourceFile, spec: string, ws: Workspace): SourceFile | undefined {
  const base = resolve(dirname(file.path), spec.replace(/\.js$/, ''));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    const hit = ws.byPath.get(candidate);
    if (hit) return hit;
  }
  return undefined;
}

function matchWorkspace(spec: string, units: Unit[]): { unit: Unit; subpath?: string } | undefined {
  for (const unit of units) {
    if (spec === unit.name) return { unit };
    if (spec.startsWith(`${unit.name}/`)) return { unit, subpath: spec.slice(unit.name.length + 1) };
  }
  return undefined;
}

export function npmNameOf(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
}
