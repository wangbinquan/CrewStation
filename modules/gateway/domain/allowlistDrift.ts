import type { AllowlistDocument } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';

type AllowlistContent = Pick<AllowlistDocument, 'operationRoutes' | 'defaultOpen' | 'entries'>;

/** 放行表内容的差异：有出入的调用方；默认开放的操作或操作路由变了影响所有调用方，记为 global。 */
export interface AllowlistDrift {
  readonly callers: readonly string[];
  readonly global: boolean;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const entryKey = (entry: AllowlistContent['entries'][number]): string =>
  jsonHash({ ...entry, operations: [...entry.operations].sort(byText), platformHosts: [...entry.platformHosts].sort(byText) });
const routesKey = (routes: AllowlistContent['operationRoutes']): string => jsonHash([...routes].sort((a, b) => byText(a.id, b.id)));

/**
 * 放行表的定时核对（RFC-025 设计 §7.4）：按当前授权推导的内容与最新一版比，不看先后（库里读回的与重新推导的次序可能不同）。
 * 没有最新一版时全部算不一致。
 */
export function allowlistDrift(latest: AllowlistContent | undefined, current: AllowlistContent): AllowlistDrift {
  if (!latest) return { callers: current.entries.map((entry) => entry.caller).sort(byText), global: true };
  const global = jsonHash([...latest.defaultOpen].sort(byText)) !== jsonHash([...current.defaultOpen].sort(byText)) || routesKey(latest.operationRoutes) !== routesKey(current.operationRoutes);
  const before = new Map(latest.entries.map((entry) => [entry.caller, entryKey(entry)]));
  const after = new Map(current.entries.map((entry) => [entry.caller, entryKey(entry)]));
  const callers = [...new Set([...before.keys(), ...after.keys()])].filter((caller) => before.get(caller) !== after.get(caller)).sort(byText);
  return { callers, global };
}
