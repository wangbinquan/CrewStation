import type { ClusterAccess, ClusterResult } from './clusterAccess';

/**
 * 真实实现：外挂 kubectl 子进程。不引 Kubernetes 客户端库，是因为 apps/cli 的依赖白名单
 * 只有 contracts／api-client／kernel（tools/arch policy），而运维机上必有 kubectl。
 */
export function createKubectlAccess(options: { readonly context: string | undefined; readonly binary?: string }): ClusterAccess {
  const binary = options.binary ?? 'kubectl';
  const prefix = options.context === undefined ? [] : ['--context', options.context];
  return {
    target: [binary, ...prefix].join(' '),
    run: async (args, input) => spawnKubectl(binary, [...prefix, ...args], input),
  };
}

async function spawnKubectl(binary: string, args: readonly string[], input: string | undefined): Promise<ClusterResult> {
  try {
    const child = Bun.spawn([binary, ...args], { stdout: 'pipe', stderr: 'pipe', stdin: input === undefined ? 'ignore' : new Blob([input]) });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, stdout, stderr };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { code: 127, stdout: '', stderr: `无法执行 ${binary}：${message}` };
  }
}
