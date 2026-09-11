// 用法：bun run tools/arch/check.ts  （CI 第一道门；任何违规 exit 1）
import { relative, resolve } from 'node:path';
import { isExcepted, loadExceptions } from './exceptions';
import { printReport } from './report';
import { cycles } from './rules/cycles';
import { declaredDependencies } from './rules/declaredDependencies';
import { dependencyDirection } from './rules/dependencyDirection';
import { moduleTemplate } from './rules/moduleTemplate';
import { persistenceOwnership } from './rules/persistenceOwnership';
import { sizeAndNaming } from './rules/sizeAndNaming';
import type { Rule } from './archModel';
import { loadWorkspace } from './workspace';

const RULES: Rule[] = [dependencyDirection, moduleTemplate, persistenceOwnership, sizeAndNaming, declaredDependencies, cycles];

const root = resolve(import.meta.dir, '..', '..');
const ws = loadWorkspace(root);
const { active, expired } = loadExceptions(root);
const violations = RULES.flatMap((rule) => rule(ws)).filter((v) => !isExcepted(active, v.rule, relative(root, v.file)));
printReport(violations, expired, root);
console.log(`已检查 ${ws.units.length} 个单元、${ws.files.length} 个源码文件`);
process.exit(violations.length === 0 ? 0 : 1);
