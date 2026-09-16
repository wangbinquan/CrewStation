import type { RuntimeConfigSummary } from '../domain/plans';

/**
 * 由 agent-runtime（L3）经组合根提供（ADR-0004）：档位绑定运行环境时校验引用与驱动，
 * 租户投影据此给出“是否可用”。缺省实现回答 undefined，即所有绑定都视为不存在。
 */
export interface RuntimeConfigDirectory {
  describe(configId: string): Promise<RuntimeConfigSummary | undefined>;
}
