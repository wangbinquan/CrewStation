import type { ReleaseId, ServiceId, SlotName } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

/** 蓝绿两个物理槽；prod／preview 只是角色（G15）：active 指向的物理槽承接 prod 域，另一个是待命槽承接 preview 域。 */
export type PhysicalSlot = 'blue' | 'green';
export type SlotHealth = 'empty' | 'deploying' | 'ready' | 'degraded' | 'failed';

export interface SlotState {
  readonly physical: PhysicalSlot;
  readonly releaseId?: ReleaseId;
  readonly state: SlotHealth;
  readonly replicas: number;
  readonly readyReplicas: number;
  readonly updatedAt: Date;
}

export interface ServiceSlots {
  readonly serviceId: ServiceId;
  readonly active: PhysicalSlot;
  readonly blue: SlotState;
  readonly green: SlotState;
  readonly updatedAt: Date;
}

export function standbyOf(active: PhysicalSlot): PhysicalSlot {
  return active === 'blue' ? 'green' : 'blue';
}

export function initialSlots(serviceId: ServiceId, now: Date): ServiceSlots {
  const empty = (physical: PhysicalSlot): SlotState => ({ physical, state: 'empty', replicas: 0, readyReplicas: 0, updatedAt: now });
  return { serviceId, active: 'blue', blue: empty('blue'), green: empty('green'), updatedAt: now };
}

export function roleOf(slots: ServiceSlots, physical: PhysicalSlot): SlotName {
  return slots.active === physical ? 'prod' : 'preview';
}

export function physicalOf(slots: ServiceSlots, role: SlotName): PhysicalSlot {
  return role === 'prod' ? slots.active : standbyOf(slots.active);
}

export function withSlot(slots: ServiceSlots, state: SlotState, now: Date): ServiceSlots {
  return { ...slots, [state.physical]: state, updatedAt: now };
}

/** 切流：待命槽必须就绪；给了 expectedActiveRelease 就必须与当前 active 槽一致（迟到切流不覆盖，R36）。 */
export function switchTraffic(slots: ServiceSlots, toRole: SlotName, expectedActiveRelease: ReleaseId | undefined, now: Date): ServiceSlots {
  const target = physicalOf(slots, toRole);
  if (target === slots.active) throw precondition(`${toRole} 已经是当前线上槽`);
  const standby = slots[target];
  if (standby.state !== 'ready' || !standby.releaseId) throw precondition('待命槽尚未就绪，不能切流', { state: standby.state });
  const current = slots[slots.active];
  if (expectedActiveRelease && current.releaseId !== expectedActiveRelease) {
    throw precondition('当前线上发布已变化，请刷新后再切流', { expected: expectedActiveRelease, actual: current.releaseId });
  }
  return { ...slots, active: target, updatedAt: now };
}
