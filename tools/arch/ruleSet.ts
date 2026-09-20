import { cycles } from './rules/cycles';
import { declaredDependencies } from './rules/declaredDependencies';
import { dependencyDirection } from './rules/dependencyDirection';
import { migrationLock } from './rules/migrationLock';
import { moduleTemplate } from './rules/moduleTemplate';
import { persistenceOwnership } from './rules/persistenceOwnership';
import { sizeAndNaming } from './rules/sizeAndNaming';
import { testDiscipline } from './rules/testDiscipline';
import type { Rule } from './archModel';

/** 门禁执行的全部规则；check.ts 与「真实仓库零违规」用例共用这一份，加规则只改这里。 */
export const RULES: readonly Rule[] = [
  dependencyDirection, moduleTemplate, persistenceOwnership, sizeAndNaming, declaredDependencies, cycles,
  testDiscipline, migrationLock,
];
