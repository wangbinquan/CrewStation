// ← agent-workflow `runtime/head.ts`（`pickRuntimeHead`），改名后原样复制（复制清单 §11.2）。
// 自定义二进制路径优先于协议默认命令头；空值回落到内置头，于是默认拉起逐字节不变。

export function pickRuntimeHead(binaryPath: string | null | undefined, fallback: string[]): string[] {
  return binaryPath !== null && binaryPath !== undefined && binaryPath.length > 0 ? [binaryPath] : fallback;
}
