// 用法：bun run tools/arch/check.ts  （CI 第一道门；任何违规 exit 1）
import { relative, resolve } from 'node:path';
import { isExcepted, loadExceptions } from './exceptions';
import { printReport } from './report';
import { RULES } from './ruleSet';
import { loadWorkspace } from './workspace';

const root = resolve(import.meta.dir, '..', '..');
const ws = loadWorkspace(root);
const { active, expired } = loadExceptions(root);
const violations = RULES.flatMap((rule) => rule(ws)).filter((v) => !isExcepted(active, v.rule, relative(root, v.file)));
printReport(violations, expired, root);
console.log(`已检查 ${ws.units.length} 个单元、${ws.files.length} 个源码文件`);
process.exit(violations.length === 0 ? 0 : 1);
