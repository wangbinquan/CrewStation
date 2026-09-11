// 两个平台 MCP 的全部实现；apps/mcp-* 只读配置、装配并启动。唯一公开入口，其余文件不直接 import。
export type {
  McpResourceBody, McpResourceDefinition, McpServerDefinition, McpToolDefinition, ToolInputCheck, ToolSpec,
} from './protocol/definitions';
export { defineResource, defineTool, jsonResource, toolFactory } from './protocol/definitions';
export { buildMcpServer } from './protocol/buildServer';
export type { McpEndpointOptions } from './protocol/httpEndpoint';
export { createMcpRequestHandler } from './protocol/httpEndpoint';
export type { McpAppOptions } from './protocol/mcpApp';
export { createMcpApp, mcpPathFrom } from './protocol/mcpApp';
export type { McpTextResult } from './protocol/toolFailure';
export { describeFailure, errorResult, runTool, textResult } from './protocol/toolFailure';
export type { McpCaller } from './caller/callerIdentity';
export { callerForwardHeaders, callerFromHeaders, platformCallHeaders, requireCaller } from './caller/callerIdentity';
export type { CallerProject } from './caller/callerProject';
export { callerProjectResolver } from './caller/callerProject';
export type { PlatformAccess } from './caller/platformClient';
export { platformClientFor } from './caller/platformClient';
export type { CapabilityContext } from './capabilities/capabilityContext';
export { capabilityContextFor } from './capabilities/capabilityContext';
export { capabilityResources } from './capabilities/capabilityResources';
export { conventionGuide } from './capabilities/conventionGuide';
export { capabilitiesServerDefinition } from './capabilities/capabilitiesServer';
export type { InternalApiCall, OperationsAccess, OperationsContext } from './operations/operationsContext';
export { operationsContextFor } from './operations/operationsContext';
export { operationsServerDefinition } from './operations/operationsServer';
export { internalApiTools } from './operations/internalApiTools';
export { observabilityTools } from './operations/observabilityTools';
export { releaseTools } from './operations/releaseTools';
