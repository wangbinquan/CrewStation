// ← agent-workflow `runtime/opencode/util.ts`（禁用文件名，按复制清单 §11.2 改名为 probe.ts）。
// 保留 `probeOpencode`（探测成功即登记版本，供 flag 拼写版本门查表）与 `detectOpencodeSessionNotFound`。
// 源里对 semver 与 ProbeOpts 的再导出不复制（那是为兼容旧 import 点存在的）。

import type { ProcessHost } from '../../contract/processHost';
import { DEFAULT_VERSION_PROBE_TIMEOUT_MS, spawnVersionProbe } from '../../process/versionProbe';
import { extractVersion } from '../../process/semver';
import type { CliProbeResult, ProbeOptions } from '../claudeCode/probe';
import { getOpencodeBinaryVersion, recordOpencodeBinaryVersion } from './versionRegistry';

export async function probeOpencode(host: ProcessHost, head: readonly string[], options: ProbeOptions): Promise<CliProbeResult> {
  const binary = head[0] ?? '';
  const log = options.logger;
  const result = await spawnVersionProbe(host, head, {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs ?? DEFAULT_VERSION_PROBE_TIMEOUT_MS,
  });
  if (result.timedOut) {
    log?.warn('opencode --version timed out', { binary, timeoutMs: options.timeoutMs });
    return { binary, version: null, compatible: false };
  }
  if (result.exitCode !== 0) {
    log?.warn('opencode --version non-zero exit', { binary, exitCode: result.exitCode });
    return { binary, version: null, compatible: false };
  }
  const version = extractVersion(result.stdout);
  // 只在 exit 0 时登记：一次瞬时失败不应该把好记录覆盖成 null。
  recordOpencodeBinaryVersion(binary, version);
  return { binary, version, compatible: true };
}

/** 同一二进制最多探一次：即使探测失败（版本按未知处理）也不再重试。 */
const probed = new Map<string, Promise<string | null>>();

/**
 * 装配 argv 前把 flag 拼写的版本门喂饱。
 * 源里这件事由 daemon 的 doctor／status 路径预热注册表完成；CrewStation 的任务容器没有那些路径，
 * 于是在第一次装配时就地探一次（结果进注册表，之后所有 Agent 直接查表）。
 */
export async function ensureOpencodeBinaryVersion(host: ProcessHost, head: readonly string[], options: ProbeOptions): Promise<string | null> {
  const binary = head[0] ?? '';
  const known = getOpencodeBinaryVersion(binary);
  if (known !== null) return known;
  let pending = probed.get(binary);
  if (pending === undefined) {
    pending = probeOpencode(host, head, options).then((result) => result.version, () => null);
    probed.set(binary, pending);
  }
  return pending;
}

/** 仅测试卫生用。 */
export function resetOpencodeProbes(): void {
  probed.clear();
}

/**
 * opencode 拒绝 `--session <id>` 时的 stderr 措辞集。
 * 刻意多条：措辞在各个 minor 版本之间漂移过；发现新形态时在此扩列，不要把字符串散落到调用点。
 */
const SESSION_NOT_FOUND_PATTERNS: readonly RegExp[] = [
  /\bsession not found\b/i,
  /\bsession\b[^\n]*\bdoes not exist\b/i,
  /\bunknown session\s*id?\b/i,
  /\bno such session\b/i,
];

export function detectOpencodeSessionNotFound(stderrTail: string): boolean {
  if (stderrTail.length === 0) return false;
  return SESSION_NOT_FOUND_PATTERNS.some((re) => re.test(stderrTail));
}
