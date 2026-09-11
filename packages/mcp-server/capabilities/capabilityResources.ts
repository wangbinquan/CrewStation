import type { McpResourceDefinition } from '../protocol/definitions';
import { defineResource, jsonResource } from '../protocol/definitions';
import type { CapabilityContext } from './capabilityContext';
import { conventionGuide } from './conventionGuide';

type Resource = McpResourceDefinition<CapabilityContext>;

const uri = (section: string): string => `cs://capability/${section}`;

/** 按能力说明的分段拆成多个 resource：Agent 通常只需要其中一两段，整包读回来反而挤占上下文。 */
export function capabilityResources(): Resource[] {
  return [
    jsonResource<CapabilityContext>({
      name: 'service-identity', uri: uri('service'), title: '本服务身份',
      description: '调用方数字人的服务身份 `<project>/<service>`、slug 与所在命名空间。',
      read: async (ctx) => (await ctx.description()).service,
    }),
    jsonResource<CapabilityContext>({
      name: 'hosts', uri: uri('hosts'), title: '域名与平台 API 地址',
      description: 'prod／preview／开发会话预览的用户域主机、本服务的服务域主机与平台 API 地址。',
      read: async (ctx) => (await ctx.description()).hosts,
    }),
    jsonResource<CapabilityContext>({
      name: 'conventions', uri: uri('conventions'), title: '身份头、环境变量与路径约定',
      description: '网关注入的身份头、容器内可读的环境变量、固定路径与事件头的名字表。',
      read: async (ctx) => (await ctx.description()).conventions,
    }),
    jsonResource<CapabilityContext>({
      name: 'config-keys', uri: uri('config-keys'), title: '配置键',
      description: '开发组与生产组已登记的配置与 Secret 键名；Secret 只写不读，这里没有值。',
      read: async (ctx) => (await ctx.description()).config,
    }),
    jsonResource<CapabilityContext>({
      name: 'data-resources', uri: uri('data-resources'), title: '数据资源',
      description: '本服务的生产数据资源与开发库；开发会话经数据访问绑定使用，绑定模式与审批在工作台申请。',
      read: async (ctx) => (await ctx.description()).data,
    }),
    jsonResource<CapabilityContext>({
      name: 'callable-operations', uri: uri('operations'), title: '可调用的内部 API 操作',
      description: '接口目录中对本服务可见的操作：操作键、方法、路径、开放策略与是否已放行。',
      read: async (ctx) => (await ctx.description()).operations,
    }),
    jsonResource<CapabilityContext>({
      name: 'event-subscriptions', uri: uri('subscriptions'), title: '事件订阅',
      description: '本服务已登记的事件订阅与处理路径；事件只推送到当前承接生产流量的槽。',
      read: async (ctx) => (await ctx.description()).subscriptions,
    }),
    jsonResource<CapabilityContext>({
      name: 'quota-and-plan', uri: uri('quota-and-plan'), title: '配额与套餐',
      description: '并发任务配额（含当前占用）与服务套餐的规格；超配额一律拒绝，不排队。',
      read: async (ctx) => {
        const description = await ctx.description();
        return { quota: description.quota, plan: description.plan };
      },
    }),
    jsonResource<CapabilityContext>({
      name: 'mcp-endpoints', uri: uri('mcp'), title: '平台 MCP 地址',
      description: '能力说明 MCP 与操作 MCP 的 Streamable HTTP 地址。',
      read: async (ctx) => (await ctx.description()).mcp,
    }),
    jsonResource<CapabilityContext>({
      name: 'business-task-api', uri: uri('business-task-api'), title: '业务任务 API',
      description: '业务服务以自身身份创建业务任务、提交子任务与读取产物的接口摘要。',
      read: async (ctx) => (await ctx.description()).businessTaskApi,
    }),
    jsonResource<CapabilityContext>({
      name: 'capability-description', uri: uri('description'), title: '能力说明全文',
      description: '上述各段的完整聚合，与工作台能力页同源。需要一次看全时读它。',
      read: (ctx) => ctx.description(),
    }),
    defineResource<CapabilityContext>({
      name: 'integration-guide', uri: 'cs://guide/integration', title: '业务接入约定说明',
      description: '身份头、服务域调用、环境变量、域名形态、事件与发布链的约定；静态内容，不需要调用方身份。',
      mimeType: 'text/markdown',
      read: async () => ({ mimeType: 'text/markdown', text: conventionGuide() }),
    }),
  ];
}
