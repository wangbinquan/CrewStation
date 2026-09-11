import type { McpServerDefinition } from '../protocol/definitions';
import { internalApiTools } from './internalApiTools';
import { observabilityTools } from './observabilityTools';
import type { OperationsContext } from './operationsContext';
import { releaseTools } from './releaseTools';

const INSTRUCTIONS = [
  '操作 MCP：对当前数字人做事的工具。每次调用都由 cs-api 按本开发会话的授权判定，会话释放后一律拒绝；',
  '被拒绝时错误文本里是平台的原话，按它说的去补条件，不要换个工具绕。',
  '只读的能力目录、约定说明与本服务现状在能力说明 MCP，不在这里。',
].join('');

export function operationsServerDefinition(version: string): McpServerDefinition<OperationsContext> {
  return {
    name: 'crewstation-operations',
    version,
    instructions: INSTRUCTIONS,
    resources: [],
    tools: [...releaseTools(), ...internalApiTools(), ...observabilityTools()],
  };
}
