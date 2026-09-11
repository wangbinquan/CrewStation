import type { FileEntry, PreviewState, RunnerCommand, RunnerEvent } from '@crewstation/contracts';
import { buildUrl, segment } from './requestUrl';

/**
 * 工作台到任务的流 `GET /v1/tasks/:taskId/stream`（WebSocket 升级）。
 * baseUrl 为空时返回同源相对路径，由调用方按页面地址补全 ws(s) 协议；为 http(s) 绝对地址时改写为 ws(s)。
 * 断线重连时 sinceSeq 传最后看到的 seq：服务端回放 seq 严格大于它的事件。
 */
export function taskStreamUrl(baseUrl: string, taskId: string, sinceSeq = 0): string {
  return buildUrl(baseUrl, `/v1/tasks/${segment(taskId)}/stream`, { sinceSeq }).replace(/^http(s?):/i, 'ws$1:');
}

/** 浏览器发出的命令帧：与 TaskRunner 命令同形，`id` 由客户端生成并用于匹配 result／error。 */
export type TaskStreamCommand = RunnerCommand;

/** 去掉 id 的命令输入（按联合成员分别 Omit，避免联合坍缩）。 */
export type TaskStreamCommandInput = RunnerCommand extends infer C ? (C extends { id: string } ? Omit<C, 'id'> : never) : never;

export interface TaskStreamEventFrame {
  readonly type: 'event';
  readonly seq: number;
  readonly at: string;
  readonly event: RunnerEvent;
}

export interface TaskStreamReadyFrame {
  readonly type: 'streamReady';
  /** TaskRunner 当前是否已连到 cs-session。 */
  readonly connected: boolean;
  /** 本次连接回放的持久事件数。 */
  readonly replayed: number;
}

export interface TaskStreamResultFrame {
  readonly type: 'result';
  readonly id: string;
  readonly payload: unknown;
}

export interface TaskStreamErrorFrame {
  readonly type: 'error';
  /** 对应命令的 id；连接被拒时为 `open`。 */
  readonly id: string;
  readonly code: string;
  readonly message: string;
}

export type TaskStreamFrame = TaskStreamEventFrame | TaskStreamReadyFrame | TaskStreamResultFrame | TaskStreamErrorFrame;

/** 结果载荷（contracts `RunnerResultPayloads` 的类型形式）。 */
export interface ListFilesResult { readonly path: string; readonly entries: FileEntry[] }
/** version 为内容 sha256，写入时作 expectedVersion 做乐观并发。 */
export interface ReadFileResult { readonly path: string; readonly content: string; readonly version: string; readonly size: number }
export interface WriteFileResult { readonly path: string; readonly version: string }
export interface PreviewStatusResult { readonly state: PreviewState; readonly port?: number; readonly restarts: number; readonly lastError?: string }

/** 只做结构判断，不做 Schema 校验：流式帧数量大，且形状由同一仓库的 session 模块产生。 */
export function parseTaskStreamFrame(raw: unknown): TaskStreamFrame | undefined {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const frame = value as Record<string, unknown>;
  switch (frame.type) {
    case 'event':
      return typeof frame.seq === 'number' && typeof frame.event === 'object' && frame.event !== null ? (frame as unknown as TaskStreamEventFrame) : undefined;
    case 'streamReady':
      return frame as unknown as TaskStreamReadyFrame;
    case 'result':
      return typeof frame.id === 'string' ? (frame as unknown as TaskStreamResultFrame) : undefined;
    case 'error':
      return typeof frame.id === 'string' && typeof frame.message === 'string' ? (frame as unknown as TaskStreamErrorFrame) : undefined;
    default:
      return undefined;
  }
}
