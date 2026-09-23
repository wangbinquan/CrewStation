import type { StartupProgress, StartupStage, StartupStageKind } from '@crewstation/contracts';

/** RFC-022 启动过程的段名（作者裁定的原话；命令行只有中文）。工作台按段种类取自己的文案，两边同名。 */
const STAGE_NAME: Record<StartupStageKind, string> = {
  queue: '排队分配容器', replace: '替换旧容器', container: '容器启动中（调度、拉取镜像）', checkout: '检出代码', connect: '容器已启动，等待连接',
  prepare: '准备环境（启动前步骤）', agent: 'Agent 启动中', ready: '已就绪',
};
const ICON: Record<StartupStage['state'], string> = { succeeded: '✓', running: '●', pending: '○', failed: '✕', skipped: '–' };
const OVERALL: Record<StartupProgress['state'], string> = { running: '启动中', ready: '已就绪', failed: '启动失败', cancelled: '已取消' };

/** 用时：10 秒内一位小数，一分钟内整秒，更长写几分几秒。 */
export function durationText(ms: number): string {
  if (ms < 10_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)} 秒`;
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
}

function stageName(stage: StartupStage): string {
  if (stage.kind === 'checkout' && stage.subject) return `检出代码（分支 ${stage.subject}）`;
  if (stage.kind === 'prepare' && stage.count) return `准备环境（启动前步骤 ${stage.count.done}/${stage.count.total}）`;
  return STAGE_NAME[stage.kind];
}

/** 一段一行：状态、名称、用时，其后是失败原因、警告或细节（按这个顺序取第一条）。 */
export function startupLines(startup: StartupProgress): string[] {
  const total = startup.endedAt ? `，共 ${durationText(Math.max(0, Date.parse(startup.endedAt) - Date.parse(startup.startedAt)))}` : '';
  return [`启动过程（${OVERALL[startup.state]}${total}）`, ...startup.stages.map((stage) => {
    const note = stage.error?.message ?? stage.warning ?? (stage.state === 'pending' ? undefined : stage.detail);
    return `  ${ICON[stage.state]} ${stageName(stage)}${stage.durationMs === undefined ? '' : `  ${durationText(stage.durationMs)}`}${note ? `  ${note}` : ''}`;
  })];
}
