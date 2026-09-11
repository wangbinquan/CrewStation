import type { BranchDto } from '@crewstation/contracts';

/**
 * 未选择时的缺省分支：优先仓库默认分支，否则第一个。
 * 用计算值而不是在分支加载完后 setState，避免用户已经选过又被覆盖。
 */
export function defaultBranchName(branches: readonly BranchDto[]): string {
  return (branches.find((branch) => branch.isDefault) ?? branches[0])?.name ?? '';
}

/** 落后数为 null 表示该槽还没有部署过，界面显示为“—”。 */
export function behindText(value: number | null): string {
  return value === null ? '—' : String(value);
}
