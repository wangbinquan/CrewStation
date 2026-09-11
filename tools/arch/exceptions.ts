import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ArchException { rule: string; pattern: string; until: string; source: string }

const LINE_RE = /^-\s*exception:\s*(\S+)\s+(\S+)\s+until\s+(\d{4}-\d{2}-\d{2})\s*$/;

export function loadExceptions(root: string, today: Date = new Date()): { active: ArchException[]; expired: ArchException[] } {
  const dir = join(root, 'docs', 'adr');
  const active: ArchException[] = [];
  const expired: ArchException[] = [];
  if (!existsSync(dir)) return { active, expired };
  const todayKey = today.toISOString().slice(0, 10);
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      const m = LINE_RE.exec(line.trim());
      if (!m?.[1] || !m[2] || !m[3]) continue;
      const exception = { rule: m[1], pattern: m[2], until: m[3], source: name };
      (exception.until >= todayKey ? active : expired).push(exception);
    }
  }
  return { active, expired };
}

export function isExcepted(active: ArchException[], rule: string, relPath: string): boolean {
  return active.some((e) => e.rule === rule && (e.pattern === relPath || new Bun.Glob(e.pattern).match(relPath)));
}
