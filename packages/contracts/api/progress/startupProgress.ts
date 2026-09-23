import { z } from 'zod';

/**
 * RFC-022 启动进度：一个容器从受理到可用经过的阶段，由后端按阶段产出并存库，刷新不丢、所有人看到同一份。
 * 开发会话、「＋ CLI」与档位测试共用；段名不进契约，工作台按 kind 取文案，命令行有自己的中文名。
 */
/** RFC-024：`interface` 在 `agent`（进程拉起）与 `ready` 之间，到 CLI 画出界面为止；只有新开 CLI 有这一段。 */
export const StartupStageKindSchema = z.enum(['queue', 'replace', 'container', 'checkout', 'connect', 'prepare', 'agent', 'interface', 'ready']);
export const StartupStageStateSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']);
export const StartupStateSchema = z.enum(['running', 'ready', 'failed', 'cancelled']);

/** 失败归类；给人看的原话在 message。只有平台判定失败时才有，Kubernetes 仍在重试的问题记在 warning。 */
export const StartupErrorCodeSchema = z.enum([
  'admission-rejected', 'pod-create-failed', 'image-pull-failed', 'container-start-failed', 'checkout-failed', 'pod-exited', 'pod-missing',
  'connect-timeout', 'runner-protocol-mismatch', 'replace-failed', 'before-start-failed', 'agent-start-failed', 'workspace-lost',
]);

export const StartupStageSchema = z.object({
  kind: StartupStageKindSchema,
  state: StartupStageStateSchema,
  startedAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
  durationMs: z.number().int().min(0).optional(),
  /** 段名里的参数：检出的分支。 */
  subject: z.string().max(300).optional(),
  /** 准备环境的 x/y：已成功的步数与总步数。 */
  count: z.object({ done: z.number().int().min(0), total: z.number().int().min(0) }).optional(),
  /** 平台写的一句细节：节点、镜像与拉取用时、当前步骤名。不含凭据、脚本源码与文件正文。 */
  detail: z.string().max(1024).optional(),
  /** 仍在进行、Kubernetes 正在重试的问题：调度资源不足、镜像拉取退避。 */
  warning: z.string().max(1024).optional(),
  error: z.object({ code: StartupErrorCodeSchema, message: z.string().max(4096) }).optional(),
  /** 判定失败后、回收容器前留下的日志尾部：最多 100 行，已按凭据形状打码。 */
  logTail: z.string().max(16_384).optional(),
});

export const StartupProgressSchema = z.object({
  state: StartupStateSchema,
  stages: z.array(StartupStageSchema).max(16),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  /** 服务器给出这份进度的时刻：页面据此校正本机时钟偏差。库里不存，读出时填。 */
  observedAt: z.iso.datetime(),
});

export type StartupStageKind = z.infer<typeof StartupStageKindSchema>;
export type StartupStageState = z.infer<typeof StartupStageStateSchema>;
export type StartupState = z.infer<typeof StartupStateSchema>;
export type StartupErrorCode = z.infer<typeof StartupErrorCodeSchema>;
export type StartupStage = z.infer<typeof StartupStageSchema>;
export type StartupProgress = z.infer<typeof StartupProgressSchema>;
/** 库里存的形状：读出时才补 observedAt。 */
export type StartupRecord = Omit<StartupProgress, 'observedAt'>;

/** 当前段：失败的那段；否则第一个进行中的；否则第一个未开始的；否则最后一段。档位测试的段也适用。 */
export function currentStage<S extends { readonly state: StartupStageState }>(stages: readonly S[]): S | undefined {
  return stages.find((stage) => stage.state === 'failed') ?? stages.find((stage) => stage.state === 'running') ?? stages.find((stage) => stage.state === 'pending') ?? stages.at(-1);
}

/**
 * 开发会话失败在检出代码或更早、且不是重建：工作卷里还没有可用的仓库，也没有任何人的改动。
 * 工作台据此按原分支重新开始（RFC-022 Q1）；重新开始时平台把失败的那个会话连同容器与工作卷一并回收（2026-09-23 修订）。
 */
export function restartsFromScratch(startup: { readonly stages: readonly { readonly kind: string; readonly state: StartupStageState }[] } | undefined): boolean {
  const stages = startup?.stages ?? [], failed = stages.find((stage) => stage.state === 'failed');
  return !!failed && !stages.some((stage) => stage.kind === 'replace') && ['queue', 'container', 'checkout'].includes(failed.kind);
}
