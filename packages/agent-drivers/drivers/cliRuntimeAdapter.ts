// 两个 CLI 共用的运行时适配面：把「装配」与「运行」分开，运行循环（chainedRun／residentRun）
// 因此对具体 CLI 一无所知。源里没有这层抽象（agent-workflow 的 RuntimeDriver 把装配、解析、
// 会话捕获、清单读取全挂在一个对象上）；这里只留 CrewStation 实际要的四件事。

import type { AgentDriver as AgentDriverName } from '@crewstation/contracts';
import type { NormalizedEvent } from '../contract/normalizedEvent';
import type { DriverAgentSpec, DriverLaunchContext } from '../contract/agentDriver';
import type { SpawnPlan } from '../contract/spawnPlan';

export interface TurnInput {
  prompt: string;
  /** 上一轮捕获到的原生会话 id，或调用方传入的 resumeSessionId。 */
  resumeSessionId?: string;
  /** true = 这次拉起要用常驻输入流（只有支持的适配器会收到 true）。 */
  resident: boolean;
}

export interface PreparedRuntime {
  /** 组装一次拉起的 argv／env／stdin 约定。 */
  plan(input: TurnInput): SpawnPlan;
  parseEvent(line: string): NormalizedEvent | null;
  /** `--resume`／`--session` 的目标不存在时的 stderr 判定。 */
  detectSessionNotFound(stderrTail: string): boolean;
  /** 常驻流下把一条用户消息编码成一帧 stdin 输入；不支持常驻的适配器不实现。 */
  encodeStreamFrame?(text: string): string;
  /** 清理本次运行的私有目录。 */
  dispose(): void;
}

export interface CliRuntimeAdapter {
  readonly name: AgentDriverName;
  /** 用于 available() 与诊断文案的可执行文件记号：默认是 PATH 上的名字，被 binaryPath 覆盖时是该路径。 */
  readonly binary: string;
  /** CLI 是否真的支持「进程常驻、持续读 stdin」；false 时交互式退化为链式 one-shot。 */
  readonly supportsResidentStream: boolean;
  prepare(spec: DriverAgentSpec, context: DriverLaunchContext): Promise<PreparedRuntime>;
}

/** 自定义二进制路径（不在 PATH 上、或 fork 版本）；缺省用 CLI 的协议默认名。 */
export interface CliAdapterOptions {
  binaryPath?: string;
}
