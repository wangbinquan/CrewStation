import { z } from 'zod';
import type { McpToolDefinition } from '../protocol/definitions';
import { toolFactory } from '../protocol/definitions';
import type { OperationsContext } from './operationsContext';

const tool = toolFactory<OperationsContext>();

const MethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** 内部 API：目录来自 cs-api，调用走服务域；两处的放行判定都在平台侧，本文件不做任何权限判断。 */
export function internalApiTools(): Array<McpToolDefinition<OperationsContext>> {
  return [listInternalApis(), callInternalApi()];
}

function listInternalApis(): McpToolDefinition<OperationsContext> {
  return tool({
    name: 'list_internal_apis',
    title: '列出可调用的内部 API 操作',
    description: [
      '列出接口目录中对本服务可见的操作：操作键（代理名＋方法＋路径）、开放策略与是否已对本服务放行。',
      'granted 为 false 的定向开放操作需要项目在工作台提交申请、由管理员批准后才能调用。',
    ].join(''),
    input: {
      proxy: z.string().optional().describe('只看某个代理名下的操作；缺省列出全部'),
    },
    run: async (args, ctx) => {
      const project = await ctx.project();
      const page = await ctx.client().apiCatalog.listOperations({ serviceId: project.serviceId });
      return args.proxy === undefined ? page.items : page.items.filter((operation) => operation.proxy === args.proxy);
    },
  });
}

function callInternalApi(): McpToolDefinition<OperationsContext> {
  return tool({
    name: 'call_internal_api',
    title: '以本服务身份调用内部 API',
    description: [
      '经服务域调用一条已放行的内部 API，网关按本服务的放行表判定，与部署后的授权完全一致——',
      '开发期在这里调得通，上线后就调得通。凭据由平台按需下发，调用方不需要也拿不到任何令牌。',
      '未放行会返回 403；先用 list_internal_apis 确认操作键与 granted。',
    ].join(''),
    input: {
      proxy: z.string().min(1).describe('代理名，即操作键的第一段'),
      method: MethodSchema.describe('HTTP 方法，需与目录中登记的一致'),
      path: z.string().min(1).describe('代理之后的上游路径，如 /projects/1/issues；可直接带查询串'),
      body: z.string().optional().describe('请求体，JSON 文本；GET 不要给'),
    },
    run: async (args, ctx) => {
      const response = await ctx.callInternalApi({
        method: args.method,
        url: `${args.proxy}/${args.path.replace(/^\/+/, '')}`,
        body: args.body,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`内部 API 返回 HTTP ${response.status}：${text || '（空响应体）'}`);
      return { status: response.status, contentType: response.headers.get('content-type') ?? '', body: text };
    },
  });
}
