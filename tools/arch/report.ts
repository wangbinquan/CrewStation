import type { ArchException } from './exceptions';
import type { Violation } from './archModel';

export function printReport(violations: Violation[], expired: ArchException[], root: string): void {
  for (const e of expired) console.log(`⚠ 例外已过期（${e.source}）：${e.rule} ${e.pattern} until ${e.until}`);
  if (violations.length === 0) {
    console.log('✓ arch:check 通过，无违规');
    return;
  }
  const byRule = new Map<string, Violation[]>();
  for (const v of violations) byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v]);
  for (const [rule, list] of byRule) {
    console.log(`\n✗ ${rule}（${list.length}）`);
    for (const v of list) console.log(`  ${v.file.replace(`${root}/`, '')}: ${v.message}`);
  }
  console.log(`\n共 ${violations.length} 项违规`);
}
