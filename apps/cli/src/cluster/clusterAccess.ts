import { CliFailure } from '../runtime/cliError';

export interface ClusterResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * 与 Kubernetes 对话的唯一出口。install／upgrade／status／verify 的命令逻辑只依赖它，
 * 因此可以在没有集群的机器上完整测试；真实实现在 kubectlAccess.ts。
 */
export interface ClusterAccess {
  /** 人读的目标描述，进报告用，例如 `kubectl --context docker-desktop`。 */
  readonly target: string;
  /** input 经标准输入交给 kubectl，例如 `apply -f -` 的清单。 */
  run(args: readonly string[], input?: string): Promise<ClusterResult>;
}

export function ok(result: ClusterResult): boolean {
  return result.code === 0;
}

/** 第一行 stderr 通常就是 kubectl 的原因，比整段输出更适合进报告。 */
export function firstProblem(result: ClusterResult): string {
  const line = result.stderr.split('\n').map((item) => item.trim()).find((item) => item.length > 0);
  return line ?? `kubectl 退出码 ${result.code}`;
}

/** 取 JSON 输出；kubectl 失败或输出不是 JSON 都算可处理失败，退出码 1。 */
export async function clusterJson<T>(cluster: ClusterAccess, args: readonly string[]): Promise<T> {
  const result = await cluster.run(args);
  if (!ok(result)) throw new CliFailure(`kubectl ${args.join(' ')} 失败`, ['  ' + firstProblem(result)]);
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new CliFailure(`kubectl ${args.join(' ')} 的输出不是 JSON`);
  }
}

/** 集群不可用时的占位实现：每次调用都说明原因，而不是伪装成功。 */
export function unavailableCluster(reason: string): ClusterAccess {
  return {
    target: '（不可用）',
    run: async () => ({ code: 127, stdout: '', stderr: reason }),
  };
}
