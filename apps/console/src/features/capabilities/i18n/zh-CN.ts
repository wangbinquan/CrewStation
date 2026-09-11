import type { Messages } from '../../../shared/lib/i18n';

export const messages = {
  'capabilities.title': '能力说明',
  'capabilities.line1': '聚合本服务当前可用的能力：已授权的接口操作、数据资源绑定、事件订阅、并发任务配额与服务套餐。',
  'capabilities.line2': '与能力说明 MCP 提供给 Agent 的内容一致，并附业务集成约定表。',
  'capabilities.emptyTitle': '尚无能力数据',
  'capabilities.emptyDescription': '各模块的公开查询接入后，此处显示聚合视图。',
} satisfies Messages;
