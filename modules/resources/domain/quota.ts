import { QUOTA_RESOURCE_PHASES } from '@crewstation/contracts';

/**
 * 占额度的阶段（设计 §3、B3）：在运行的，加上还在回收子对象的结束中。额度不做减法：
 * 阶段一离开这个集合，额度自然回来——计数器与实况对不上的那类问题（audit §1）因此不会再有。
 */
export const QUOTA_PHASES: readonly string[] = QUOTA_RESOURCE_PHASES;
