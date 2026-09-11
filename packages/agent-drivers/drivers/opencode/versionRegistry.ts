// ← agent-workflow `runtime/opencode/versionRegistry.ts`，原样复制。
//
// 存在的理由（源的 2026-07-21 机器级故障）：opencode 1.18.0 把
// `run --dangerously-skip-permissions` 改名为 `--auto`（纯改名，旧拼写被整个移除）。
// 顶层解析器是 `.strict()`，未知 flag 只 showHelp 不打印错误行，于是在 1.18 二进制上每次拉起
// 都以「stderr 只有一整块 run usage ＋ exit 1」收场，极难归因。
// argv 组装是同步纯函数、不能现场探测，这张进程内表就是桥：每次 `--version` 探测成功即记录。

/** binary 记号（PATH 上就是 'opencode'，覆写时是绝对路径）→ 最近一次成功探测到的版本。 */
const versions = new Map<string, string | null>();

export function recordOpencodeBinaryVersion(binary: string, version: string | null): void {
  versions.set(binary, version);
}

/** null ⇒ 从未探测过，或探测到但解析不出版本 —— 调用方一律按「未知」处理。 */
export function getOpencodeBinaryVersion(binary: string): string | null {
  return versions.get(binary) ?? null;
}

/** 仅测试卫生用。 */
export function resetOpencodeBinaryVersions(): void {
  versions.clear();
}
