import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import violating from './fixtures/violatingWorkspace.json';

/** 夹具内容放在 JSON 里而不是源码里：源码中的 import 字样会被检查器当成真实依赖。 */
export function createViolatingWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'crewstation-arch-'));
  for (const [rel, content] of Object.entries(violating as Record<string, string>)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}
