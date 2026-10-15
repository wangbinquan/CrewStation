// RFC-034 v2 §3.3–§3.4 —— 价格线、档位目录、项目费用可见性与项目名称的端口。

import type { Actor, ProjectId } from '@crewstation/contracts';
import type { PriceVersion } from '../domain/agentCallPricing';

export interface PriceStore {
  /** 一条（档位, 模型）价格线的全部版本，旧到新。 */
  line(profileId: string, model: string): Promise<readonly PriceVersion[]>;
  /** 全部价格线的全部版本（体量小：每次保存一行）。 */
  all(): Promise<readonly PriceVersion[]>;
  /** 这条线的最新版本仍是 `expectedLatestId` 时追加。 */
  append(version: PriceVersion, expectedLatestId: string | null): Promise<'appended' | 'conflict'>;
}

export interface PricingProfile {
  readonly id: string;
  readonly name: string;
  readonly protocol: string;
  /** 档位修订配置的模型；交给二进制默认时为 null。 */
  readonly model: string | null;
}

/** 算力档位的展示元数据（不含启动材料或凭据），由 agent-runtime 经组合根提供。 */
export interface PricingProfileDirectory {
  list(actor: Actor): Promise<readonly PricingProfile[]>;
}

export interface CostVisibilityRecord {
  readonly projectId: ProjectId;
  readonly visible: boolean;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}

export interface CostVisibilityStore {
  read(projectId: ProjectId): Promise<CostVisibilityRecord | undefined>;
  write(record: CostVisibilityRecord): Promise<CostVisibilityRecord>;
}

/** 项目展示名（系统页的项目排行与项目表）。 */
export interface ObservationProjectNames {
  names(ids: readonly ProjectId[]): Promise<ReadonlyMap<ProjectId, string>>;
}
