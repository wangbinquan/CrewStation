import { PREVIEW_LOG_LIMITS, PreviewActionSchema } from '@crewstation/contracts';
import { z } from 'zod';
import type { McpToolDefinition } from '../protocol/definitions';
import { toolFactory } from '../protocol/definitions';
import type { OperationsContext } from './operationsContext';

const tool = toolFactory<OperationsContext>();

/**
 * RFC-016 预览进程：改坏了能自己看、自己修。
 *
 * 三个工具说的都是**开发会话容器里按 Manifest 开发命令跑起来的进程**，不是 preview 部署槽；
 * 这句消歧写进每个工具的描述里，因为两者同名而语义完全不同。
 */
export function previewTools(): Array<McpToolDefinition<OperationsContext>> {
  return [readPreviewStatus(), controlPreview(), readPreviewLogs()];
}

/** 改开发命令要重建会话才生效——三个工具都要提醒这一条，否则 Agent 会重启到死也等不到新命令。 */
const MANIFEST_NOTE = '预览命令、端口与健康路径在开会话时由 crewstation.yaml 推导并固化进容器：改了它们要重建开发会话才生效，重启预览不会生效。';
const SLOT_NOTE = '这里的「预览」是开发容器里的预览进程，与 preview 部署槽无关。';

function readPreviewStatus(): McpToolDefinition<OperationsContext> {
  return tool({
    name: 'read_preview_status',
    title: '查看预览状态',
    description: [
      '一次看两件事：开发会话预览进程的状态（含端口、已重启次数与上次失败原因），',
      '以及 preview／prod 两个部署槽当前是哪个 Release、副本是否就绪。改完代码先看这里，再决定要不要发布。',
      '容器内自测请直接访问 `http://127.0.0.1:<port>`；返回的 url 是给浏览器用的协议相对地址。',
      SLOT_NOTE,
    ].join(''),
    input: {},
    run: async (_args, ctx) => {
      const project = await ctx.project();
      const client = ctx.client();
      const [session, slots, preview] = await Promise.all([
        client.devSession.get(project.projectId),
        client.services.listSlots(project.serviceId),
        client.devSession.previewStatus(project.projectId),
      ]);
      return { devSession: { state: session.state, branch: session.branch }, preview, slots: slots.items };
    },
  });
}

function controlPreview(): McpToolDefinition<OperationsContext> {
  return tool({
    name: 'control_preview',
    title: '启动／停止／重启预览进程',
    description: [
      '控制开发会话的预览进程。`restart` 用于改完代码后重来，也能把连续失败后停在 crashed 的预览救回来；',
      '`stop` 停掉监督进程并腾出端口，停了就不会自动拉起，适合你要在终端里自己跑一次开发服务器看原始输出；',
      '`start` 在停止或崩溃后重新拉起，已经在跑会被拒绝。',
      '返回动作后的状态：start／restart 只保证命令已受理，ready 要等健康探测通过，所以这时通常还是 starting——',
      '过几秒用 read_preview_status 再看一次。停止期间开发预览域名会返回 502，别忘了启回来。',
      MANIFEST_NOTE,
      SLOT_NOTE,
    ].join(''),
    input: {
      action: PreviewActionSchema.describe('start 启动、stop 停止、restart 重启'),
    },
    run: async (args, ctx) => {
      const project = await ctx.project();
      return ctx.client().devSession.controlPreview(project.projectId, args.action);
    },
  });
}

function readPreviewLogs(): McpToolDefinition<OperationsContext> {
  return tool({
    name: 'read_preview_logs',
    title: '读取预览进程输出',
    description: [
      '读开发会话预览进程自己的 stdout／stderr，不含 Runner 与其他 CLI 的输出——预览起不来时先看这里。',
      '缓冲跨重启保留，每行带 attempt 标出是第几次运行，所以崩溃前那一次的输出仍然读得到；',
      'dropped 大于 0 说明更早的行已经被挤掉了。要看平台聚合日志（部署槽、构建、迁移）请用 tail_logs。',
      SLOT_NOTE,
    ].join(''),
    input: {
      limit: z.number().int().min(1).max(PREVIEW_LOG_LIMITS.maxLines).optional().describe(`最多返回多少行，缺省 ${PREVIEW_LOG_LIMITS.defaultLimit}，取最近的`),
      stream: z.enum(['stdout', 'stderr']).optional().describe('只看一路输出；缺省两路都要'),
    },
    run: async (args, ctx) => {
      const project = await ctx.project();
      return ctx.client().devSession.previewLogs(project.projectId, {
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(args.stream === undefined ? {} : { stream: args.stream }),
      });
    },
  });
}
