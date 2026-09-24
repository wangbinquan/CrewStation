import type { Clock, Logger } from '@crewstation/kernel';
import type { DataSettings, ProjectAuthorizer, ServiceResolver } from '../ports/platform';
import type { DataCredentials } from '../ports/credentials';
import type { DataLedger } from '../ports/ledger';
import type { PostgresProvider, SecretCipher } from '../ports/providers';
import type { DataResourceRepository, TaskDataBindingRepository } from '../ports/repositories';
import type { UserDirectory } from '../ports/userDirectory';

export interface DataUseCaseDeps {
  resources: DataResourceRepository;
  bindings: TaskDataBindingRepository;
  postgres: PostgresProvider;
  cipher: SecretCipher;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  settings: DataSettings;
  clock: Clock;
  logger: Logger;
  /** 可选：申请人／审批人名字；缺省时绑定 DTO 只有 ID。 */
  users?: UserDirectory;
  /**
   * RFC-025 I28：生产库、开发库由 data-control 建——受理只写期望（标明由它建），等记录就绪；连接串里的口令经端口要，
   * data 自己不存。不给就照旧由本模块建（用例、回退）。等待时限与轮询间隔可调短（用例）。
   */
  provisioning?: { credentials: DataCredentials; ledger: Pick<DataLedger, 'get'>; dsnOf(role: string, password: string, database: string): string; waitMs?: number; pollMs?: number };
}
