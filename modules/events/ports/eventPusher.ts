import type { EventDelivery } from '@crewstation/contracts';

export interface PushResult {
  readonly ok: boolean;
  readonly status?: number;
  readonly error?: string;
}

/** 向订阅方处理路径 POST 投递信封；2xx 为成功，其余（含超时与网络错误）为失败。 */
export interface EventPusher {
  push(url: string, body: EventDelivery, headers: Record<string, string>): Promise<PushResult>;
}
