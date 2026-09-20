import type { FileChange } from './changedLines';
import type { Coverage } from './lcovReport';

export interface PatchFile {
  readonly file: string;
  /** 改动行里可执行的行数，与其中被用例执行到的行数。 */
  readonly executable: number;
  readonly covered: number;
  readonly uncoveredLines: readonly number[];
  /** 有可执行逻辑，却没有被任何用例加载过。 */
  readonly unprotected: boolean;
}

export interface PatchVerdict {
  readonly files: readonly PatchFile[];
  readonly executable: number;
  readonly covered: number;
  /** 没有可执行的改动行时为 undefined（纯类型、纯文档、纯用例的推送）。 */
  readonly percent: number | undefined;
  readonly violations: readonly string[];
}

export interface PatchInputs {
  readonly changes: readonly FileChange[];
  readonly coverage: Coverage;
  /** 该文件是否在闸门范围内（生产源码、非入口、未被 ADR 例外）。 */
  readonly inScope: (file: string) => boolean;
  /** 该文件是否含可执行逻辑；只对不在覆盖率里的文件调用。 */
  readonly hasLogic: (file: string) => boolean;
  readonly minPercent: number;
}

/**
 * 新增代码防护：只看本次推送改动的行，所以不需要任何存量基线。
 * 两条判定——改到的生产文件必须被至少一个用例加载；改动的可执行行被执行到的比例不低于下限。
 */
export function evaluatePatch(inputs: PatchInputs): PatchVerdict {
  const files = inputs.changes.filter((change) => inputs.inScope(change.file) && change.addedLines.length > 0).map((change) => measure(change, inputs));
  const executable = files.reduce((sum, file) => sum + file.executable, 0);
  const covered = files.reduce((sum, file) => sum + file.covered, 0);
  const percent = executable === 0 ? undefined : (covered / executable) * 100;
  const violations = files.filter((file) => file.unprotected).map((file) => `${file.file}：有可执行逻辑，但没有任何用例加载它`);
  if (percent !== undefined && percent < inputs.minPercent) {
    violations.push(`本次改动的可执行行只有 ${percent.toFixed(1)}% 被用例执行到（${covered}／${executable}），下限 ${inputs.minPercent}%`);
  }
  return { files, executable, covered, percent, violations };
}

function measure(change: FileChange, inputs: PatchInputs): PatchFile {
  const hits = inputs.coverage.get(change.file);
  if (!hits) return { file: change.file, executable: 0, covered: 0, uncoveredLines: [], unprotected: inputs.hasLogic(change.file) };
  const executableLines = change.addedLines.filter((line) => hits.has(line));
  const uncoveredLines = executableLines.filter((line) => (hits.get(line) ?? 0) === 0);
  return { file: change.file, executable: executableLines.length, covered: executableLines.length - uncoveredLines.length, uncoveredLines, unprotected: false };
}
