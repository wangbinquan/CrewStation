import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ClaudeTranscriptNode } from './nativeTurnEvidence';

const id = z.string().min(1).max(96);
const hookSchema = z.object({
  hook_event_name: z.enum(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'StopFailure', 'ConfigChange']),
  session_id: id, agent_id: id.optional(), prompt_id: id.optional(), transcript_path: z.string().max(4096).optional(),
  tool_use_id: id.optional(), tool_name: z.string().max(256).optional(), tool_input: z.unknown().optional(), is_interrupt: z.boolean().optional(),
});

export interface ClaudeNativeHook {
  type: z.infer<typeof hookSchema>['hook_event_name'];
  sessionId: string;
  child: boolean;
  promptId?: string;
  transcriptPath?: string;
  toolId?: string;
  toolName?: string;
  inputHash?: string;
  interrupted?: boolean;
}

/** HTTP body 只在容器内短暂解析；离开解析器仅有关联字段，不能持久化提示词或工具参数。 */
export function parseClaudeNativeHook(value: unknown): ClaudeNativeHook {
  const raw = hookSchema.parse(value);
  return {
    type: raw.hook_event_name, sessionId: raw.session_id, child: Boolean(raw.agent_id),
    ...(raw.prompt_id ? { promptId: raw.prompt_id } : {}),
    ...(raw.transcript_path ? { transcriptPath: raw.transcript_path } : {}),
    ...(raw.tool_use_id ? { toolId: raw.tool_use_id } : {}),
    ...(raw.tool_name ? { toolName: raw.tool_name } : {}),
    ...(raw.tool_input !== undefined ? { inputHash: createHash('sha256').update(canonicalInput(raw.tool_input)).digest('hex') } : {}),
    ...(raw.is_interrupt !== undefined ? { interrupted: raw.is_interrupt } : {}),
  };
}

function canonicalInput(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error('Native hook input nesting exceeds observer capacity');
  if (Array.isArray(value)) return `[${value.map((item) => canonicalInput(item, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalInput(item, depth + 1)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

const nodeSchema = z.object({
  uuid: id, parentUuid: id.nullable(), sessionId: id, version: z.literal('2.1.268'),
  type: z.string(), subtype: z.string().optional(), promptId: id.optional(),
  isSidechain: z.boolean().optional(), agentId: id.optional(), interruptedMessageId: id.optional(), isApiErrorMessage: z.boolean().optional(),
  origin: z.object({ kind: z.string() }).optional(),
  message: z.object({ stop_reason: z.string().nullable().optional() }).passthrough().optional(),
});

export function parseClaudeTranscriptNode(value: unknown): ClaudeTranscriptNode | undefined {
  if (!value || typeof value !== 'object' || !('uuid' in value)) return;
  const node = nodeSchema.parse(value);
  if (node.isSidechain || node.agentId) return;
  return {
    id: node.uuid, parentId: node.parentUuid, sessionId: node.sessionId,
    humanPrompt: node.type === 'user' && node.origin?.kind === 'human', assistant: node.type === 'assistant',
    turnDuration: node.type === 'system' && node.subtype === 'turn_duration',
    ...(node.promptId ? { promptId: node.promptId } : {}),
    ...(node.message?.stop_reason ? { assistantFinish: node.message.stop_reason } : {}),
    ...(node.isApiErrorMessage ? { apiError: true } : {}),
    ...(node.interruptedMessageId ? { interrupted: true } : {}),
  };
}
