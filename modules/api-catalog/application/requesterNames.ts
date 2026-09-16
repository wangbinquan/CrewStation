import type { UserId } from '@crewstation/contracts';
import type { UserDirectory } from '../ports/userDirectory';

interface Attributed { readonly requestedBy: UserId; readonly decidedBy?: UserId }

/** 给申请人／审批人补可辨识名字：目录缺失、查不到或出错时省略字段，不阻塞列表，界面回退到 ID。 */
export async function withRequesterNames<T extends Attributed>(users: UserDirectory | undefined, items: T[]): Promise<Array<T & { requestedByName?: string; decidedByName?: string }>> {
  if (!users || items.length === 0) return items;
  const ids = [...new Set(items.flatMap((item) => [item.requestedBy, ...(item.decidedBy ? [item.decidedBy] : [])]))];
  const names = new Map<UserId, string>();
  await Promise.all(ids.map(async (id) => { try { const name = await users.displayName(id); if (name) names.set(id, name); } catch { /* 目录不可用时保留原始 ID */ } }));
  return items.map((item) => ({
    ...item,
    ...(names.has(item.requestedBy) ? { requestedByName: names.get(item.requestedBy) } : {}),
    ...(item.decidedBy && names.has(item.decidedBy) ? { decidedByName: names.get(item.decidedBy) } : {}),
  }));
}
