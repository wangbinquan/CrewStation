import type { McpServerDefinition } from '../protocol/definitions';
import type { CapabilityContext } from './capabilityContext';
import { capabilityResources } from './capabilityResources';

const INSTRUCTIONS = [
  '能力说明 MCP：只读。这里给出本数字人当前可用的一切——身份头与域名、平台 API 地址、配置键、数据资源、',
  '可调用的内部 API、事件订阅、配额与套餐、两个平台 MCP 的地址，以及业务接入约定说明。',
  '动手改任何东西之前先读 `cs://guide/integration`，再读与手头任务相关的那一段 `cs://capability/*`。',
  '本服务器没有工具；发布、调内部 API、看预览与日志请用操作 MCP。',
].join('');

export function capabilitiesServerDefinition(version: string): McpServerDefinition<CapabilityContext> {
  return {
    name: 'crewstation-capabilities',
    version,
    instructions: INSTRUCTIONS,
    resources: capabilityResources(),
    tools: [],
  };
}
