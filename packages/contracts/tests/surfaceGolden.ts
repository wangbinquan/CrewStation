import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ContractSurface } from './contractSurface';
import type { SurfaceDrift } from './surfaceDiff';
import { diffSurface } from './surfaceDiff';

export const GOLDEN_PATH = join(import.meta.dir, 'golden', 'contractSurface.json');

export interface BreakingRecord {
  readonly date: string;
  /** 作者批准的依据：RFC 的能力影响清单或裁定编号。 */
  readonly basis: string;
  readonly changes: readonly string[];
}

export interface SurfaceGolden {
  readonly note: string;
  readonly surface: ContractSurface;
  /** 每一次破坏性改动的依据都留在这里，只增不删。 */
  readonly breakingChanges: readonly BreakingRecord[];
}

export interface LockOutcome {
  readonly status: 'unchanged' | 'locked' | 'refused';
  readonly drift: SurfaceDrift;
}

const NOTE = '业务契约面金样：已部署的数字人与业务仓库依赖的那部分契约。不要手改；规则见 docs/engineering/testing.md §6。';
const EMPTY: ContractSurface = { constants: {}, schemas: {} };

export function readGolden(path: string = GOLDEN_PATH): SurfaceGolden | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SurfaceGolden) : undefined;
}

/**
 * 纯新增直接入锁；含破坏性变化时必须给出依据，否则拒绝且不写文件。
 * 首次建锁（还没有金样）不算破坏：那时没有任何既有业务依赖它。
 */
export function lockSurface(current: ContractSurface, options: { readonly today: string; readonly breakingBasis?: string; readonly path?: string }): LockOutcome {
  const path = options.path ?? GOLDEN_PATH;
  const golden = readGolden(path);
  const drift = diffSurface(golden?.surface ?? EMPTY, current);
  if (golden && drift.additive.length === 0 && drift.breaking.length === 0) return { status: 'unchanged', drift };
  const basis = options.breakingBasis?.trim() ?? '';
  const isBreaking = golden !== undefined && drift.breaking.length > 0;
  if (isBreaking && basis.length === 0) return { status: 'refused', drift };
  const breakingChanges = [...(golden?.breakingChanges ?? []), ...(isBreaking ? [{ date: options.today, basis, changes: drift.breaking }] : [])];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ note: NOTE, surface: current, breakingChanges } satisfies SurfaceGolden, null, 2)}\n`);
  return { status: 'locked', drift };
}
