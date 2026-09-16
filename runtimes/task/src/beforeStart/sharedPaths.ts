import { BeforeStartFailure } from './failure';

interface Occupancy { agentId: string; hash: string }

/**
 * 共享固定路径的占用登记：两个活跃 Agent 用不同内容写同一个绝对路径时，后来者拿到 file_path_in_use，
 * 不能静默覆盖前者正在使用的配置（RFC-004 §5.1）。私有路径不登记。
 */
export class SharedPathRegistry {
  private readonly byPath = new Map<string, Occupancy[]>();

  claim(path: string, hash: string, agentId: string, stepId: string): void {
    const holders = this.byPath.get(path) ?? [];
    const other = holders.find((h) => h.agentId !== agentId && h.hash !== hash);
    if (other) throw new BeforeStartFailure('file_path_in_use', `路径 ${path} 正被另一个运行中的 Agent 以不同内容使用`, stepId);
    if (!holders.some((h) => h.agentId === agentId)) holders.push({ agentId, hash });
    else for (const holder of holders) if (holder.agentId === agentId) holder.hash = hash;
    this.byPath.set(path, holders);
  }

  release(agentId: string): void {
    for (const [path, holders] of this.byPath) {
      const rest = holders.filter((h) => h.agentId !== agentId);
      if (rest.length === 0) this.byPath.delete(path); else this.byPath.set(path, rest);
    }
  }

  holders(path: string): readonly Occupancy[] {
    return this.byPath.get(path) ?? [];
  }
}
