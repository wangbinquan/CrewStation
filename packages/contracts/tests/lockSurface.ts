// 用法：bun run contracts:lock [--breaking "<作者批准的依据>"]
import { buildContractSurface } from './contractSurface';
import { describeDrift } from './surfaceDiff';
import { lockSurface } from './surfaceGolden';

const at = process.argv.indexOf('--breaking');
const breakingBasis = at >= 0 ? process.argv[at + 1] : undefined;
if (at >= 0 && (breakingBasis === undefined || breakingBasis.trim().length === 0)) {
  console.error('--breaking 后面要跟依据，例如：--breaking "RFC-010 能力影响清单第 2 项"');
  process.exit(2);
}

const outcome = lockSurface(buildContractSurface(), { today: new Date().toISOString().slice(0, 10), ...(breakingBasis ? { breakingBasis } : {}) });
if (outcome.status === 'unchanged') console.log('业务契约面没有变化，金样未改动');
if (outcome.status === 'refused') {
  console.error(describeDrift(outcome.drift));
  console.error('\n金样未改动。');
  process.exit(1);
}
if (outcome.status === 'locked') {
  for (const line of [...outcome.drift.breaking, ...outcome.drift.additive]) console.log(line);
  console.log(`金样已更新：破坏性 ${outcome.drift.breaking.length} 处${breakingBasis ? `（依据：${breakingBasis}）` : ''}，新增 ${outcome.drift.additive.length} 处。把金样与契约改动放在同一笔提交里。`);
}
