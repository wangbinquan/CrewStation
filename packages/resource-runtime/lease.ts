/** 租约端口（由资源中心提供，时间按数据库 now()）。 */
export interface LeasePort {
  acquire(resourceId: string, holder: string, ttlMs: number): Promise<boolean>;
  renew(resourceId: string, holder: string, ttlMs: number): Promise<boolean>;
  release(resourceId: string, holder: string): Promise<void>;
}

export type LeaseOutcome<T> = { readonly acquired: false } | { readonly acquired: true; readonly value: T };

/**
 * 在租约下处理一条资源（设计 §6.3）：抢不到就跳过（持有者会处理）；处理中每三分之一持有期续约一次，
 * 续约失败（被别的副本接手）就中止信号，处理者应尽快停手；结束时释放。
 */
export async function withLease<T>(leases: LeasePort, resourceId: string, holder: string, ttlMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<LeaseOutcome<T>> {
  if (!(await leases.acquire(resourceId, holder, ttlMs))) return { acquired: false };
  const lost = new AbortController();
  const timer = setInterval(() => {
    void leases.renew(resourceId, holder, ttlMs).then((ok) => { if (!ok) lost.abort(); }).catch(() => lost.abort());
  }, Math.max(10, Math.floor(ttlMs / 3)));
  try {
    return { acquired: true, value: await fn(lost.signal) };
  } finally {
    clearInterval(timer);
    await leases.release(resourceId, holder).catch(() => undefined);
  }
}
