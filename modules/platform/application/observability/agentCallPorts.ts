// RFC-034 v2 §4 —— 组合根把各 owner 声明的受理端口与 Session 的转交端口接到 observability 的 Agent 执行记录器。
// observability 晚于 owner 装配（late 绑定）：未装配时受理失败（owner 不派发），转交只告警（不影响执行）。
import { createHash } from 'node:crypto';
import type { AgentUsageSnapshot, ProjectId } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { precondition } from '@crewstation/kernel';
import type { AgentCallEnding, AgentCallRecorderPort, AgentCallRecorderSource, AgentCallTargetRef } from '../../ports/agentCalls';

type Recorder = AgentCallRecorderSource;
const recorderOf = (recorder: Recorder): AgentCallRecorderPort => {
  const current = recorder();
  if (!current) throw precondition('Agent 执行记录尚未装配', { code: 'agent_call_recorder_unavailable' });
  return current;
};

/** 同一业务尝试的重复派发得到同一执行行 ID（受理幂等）；新的尝试是新的一行。 */
export function stableCallId(...parts: readonly (string | number)[]): string {
  const hex = createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

interface ProfileRef { readonly id: string; readonly revision: number; readonly name: string | null }

export function businessCallPorts(recorder: Recorder) {
  return { accept: async (call: { projectId: ProjectId; taskId: string; taskLabel: string; subtaskId: string; attempt: number; runtimeTaskId: string; agentId: string;
    agentKey: string; agentLabel: string; profile: ProfileRef; protocol: string }) => {
    await recorderOf(recorder).accept({ id: stableCallId('business', call.agentId, call.attempt), projectId: call.projectId, source: 'business', kind: 'subtask',
      taskId: call.taskId, taskLabel: call.taskLabel, subtaskId: call.subtaskId, attempt: call.attempt, runtimeTaskId: call.runtimeTaskId, agentId: call.agentId,
      agentKey: call.agentKey, agentLabel: call.agentLabel, profile: call.profile, protocol: call.protocol });
  } };
}

export function developmentCallPorts(recorder: Recorder) {
  return {
    accept: async (call: { kind: 'agent' | 'cli'; projectId: ProjectId; sessionId: string; sessionLabel: string; runtimeTaskId: string; agentId: string; profile: ProfileRef; protocol: string }) => {
      const name = call.profile.name ?? call.profile.id;
      await recorderOf(recorder).accept({ id: stableCallId('development', call.agentId), projectId: call.projectId, source: 'development', kind: call.kind,
        taskId: call.sessionId, taskLabel: call.sessionLabel, subtaskId: null, attempt: null, runtimeTaskId: call.runtimeTaskId, agentId: call.agentId,
        agentKey: `${call.kind}:${call.profile.id}`, agentLabel: `${call.kind === 'cli' ? 'CLI' : 'Agent'} · ${name}`, profile: call.profile, protocol: call.protocol });
    },
    fail: async (target: AgentCallTargetRef) => { await recorderOf(recorder).finish(target, { status: 'failed', at: new Date() }); },
  };
}

export function profileTestCallPorts(recorder: Recorder, profileName: (id: string) => Promise<string | null>) {
  return { accept: async (call: { testId: string; runtimeTaskId: string; agentId: string; step: 'protocol' | 'business'; profile: { id: string; revision: number }; protocol: string }) => {
    const name = await profileName(call.profile.id);
    await recorderOf(recorder).accept({ id: stableCallId('profile-test', call.testId, call.agentId), projectId: null, source: 'platform', kind: 'profile-test',
      taskId: call.testId, taskLabel: `${name ?? call.profile.id} · r${call.profile.revision}`, subtaskId: null, attempt: null, runtimeTaskId: call.runtimeTaskId,
      agentId: call.agentId, agentKey: `profile-test:${call.step}`, agentLabel: call.step === 'protocol' ? '协议轮次' : '业务能力实测',
      profile: { ...call.profile, name }, protocol: call.protocol });
  } };
}

/** Session 收到快照与终态后转交；记录器未装配或写入失败只告警，不影响执行与事件持久化。 */
export function sessionCallSink(recorder: Recorder, logger: Logger) {
  const warn = (operation: string, target: AgentCallTargetRef) => (error: unknown) =>
    logger.warn('agent call observation unavailable', { operation, ...target, error: String(error) });
  return {
    usage: async (target: AgentCallTargetRef, snapshot: AgentUsageSnapshot) => {
      const current = recorder(); if (!current) return;
      await current.usage(target, snapshot).catch(warn('usage', target));
    },
    finish: async (target: AgentCallTargetRef, outcome: AgentCallEnding) => {
      const current = recorder(); if (!current) return;
      await current.finish(target, outcome).catch(warn('finish', target));
    },
  };
}

