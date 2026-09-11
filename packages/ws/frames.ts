import type { Result } from '@crewstation/kernel';
import { err, ok } from '@crewstation/kernel';

/**
 * 帧校验钩子的结构型接口：zod 4 的任意 schema 天然满足（`safeParse`），本包因此不依赖 zod，
 * 也不知道任何协议形状；协议 Schema 由调用方（contracts）提供。
 */
export interface FrameSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

export type FrameDecodeReason = 'invalid_json' | 'invalid_frame';

export class FrameDecodeError extends Error {
  constructor(readonly reason: FrameDecodeReason, message: string) {
    super(message);
    this.name = 'FrameDecodeError';
  }
}

/** WebSocket `message` 事件可能给出的原始载荷形态（Bun 客户端默认为 Buffer——Uint8Array 的子类，服务端可能是 string）。 */
export type RawFrame = string | ArrayBuffer | Uint8Array;

const decoder = new TextDecoder();

export function encodeFrame(value: unknown): string {
  return JSON.stringify(value);
}

export function rawFrameToText(raw: RawFrame): string {
  if (typeof raw === 'string') return raw;
  return decoder.decode(raw);
}

/** JSON 解码后交给 schema 校验；两步失败分别以 `invalid_json`／`invalid_frame` 区分，便于调用方决定是否回错误帧。 */
export function decodeFrame<T>(raw: RawFrame, schema: FrameSchema<T>): Result<T, FrameDecodeError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawFrameToText(raw));
  } catch (error) {
    return err(new FrameDecodeError('invalid_json', error instanceof Error ? error.message : String(error)));
  }
  const checked = schema.safeParse(parsed);
  return checked.success ? ok(checked.data) : err(new FrameDecodeError('invalid_frame', checked.error.message));
}

/** 不做完整校验，只读出判别字段（如 `type`、`id`），用于对无效帧仍能按 id 回错误。 */
export function peekFrameField(raw: RawFrame, field: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(rawFrameToText(raw));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const value = (parsed as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}
