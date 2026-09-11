import { isApiClientError } from '@crewstation/api-client';
import { isPlatformError } from '@crewstation/kernel';

export interface McpTextResult {
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
  readonly isError?: boolean;
  [key: string]: unknown;
}

/**
 * 平台拒绝的原话必须原样到达 Agent：授权、配额与前置条件都由 cs-api 判定，
 * 这里只做搬运，不改写也不吞掉，否则 Agent 无从知道该改什么。
 */
export function describeFailure(error: unknown): string {
  if (isApiClientError(error)) {
    const head = `平台拒绝（${error.kind}，HTTP ${error.status}）：${error.message}`;
    const keys = Object.keys(error.details);
    return keys.length === 0 ? head : `${head}\n细节：${JSON.stringify(error.details)}`;
  }
  if (isPlatformError(error)) {
    const keys = Object.keys(error.details);
    const head = `${error.kind}：${error.message}`;
    return keys.length === 0 ? head : `${head}\n细节：${JSON.stringify(error.details)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function textResult(value: unknown): McpTextResult {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  return { content: [{ type: 'text', text }] };
}

export function errorResult(error: unknown): McpTextResult {
  return { content: [{ type: 'text', text: describeFailure(error) }], isError: true };
}

/** 工具一律返回“成功文本”或“错误文本”，不抛到 JSON-RPC 层：Agent 能读到原因才能自行纠正。 */
export async function runTool(run: () => Promise<unknown>): Promise<McpTextResult> {
  try {
    return textResult(await run());
  } catch (error) {
    return errorResult(error);
  }
}
