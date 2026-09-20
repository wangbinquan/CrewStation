// 规则的取值全部集中在这里；改数字要走 ADR（docs/engineering/repository-structure.md §11）。
import type { LayerDir } from './archModel';

export const CAPS = { sourceLines: 600, testLines: 1000, filesPerDir: 20 } as const;

/** 第三方工具要求默认导出的配置文件（vite.config.ts 等），是禁默认导出规则唯一的结构性例外。 */
export const DEFAULT_EXPORT_ALLOWED = /\.config\.(ts|js|mjs)$/;

export const BANNED_BASENAMES = new Set([
  'utils.ts', 'helpers.ts', 'common.ts', 'misc.ts', 'shared.ts',
  'utils.tsx', 'helpers.tsx', 'common.tsx', 'misc.tsx', 'shared.tsx',
]);

/** 模块目录下允许出现的子目录与根文件。 */
export const MODULE_DIRS = new Set(['api', 'domain', 'application', 'ports', 'adapters', 'http', 'workers', 'tests']);
export const MODULE_ROOT_ENTRIES = new Set(['index.ts', 'wiring.ts', 'package.json', 'README.md', 'node_modules']);

/** 模块内：某层的文件可以 import 同模块哪些层。 */
export const INTRA_MODULE_ALLOWED: Record<LayerDir, readonly LayerDir[]> = {
  api: ['api'],
  domain: ['domain'],
  ports: ['ports', 'domain'],
  application: ['application', 'domain', 'ports', 'api'],
  adapters: ['adapters', 'ports', 'domain', 'api'],
  http: ['http', 'application', 'api'],
  workers: ['workers', 'application', 'ports', 'api'],
  wiring: ['api', 'domain', 'application', 'ports', 'adapters', 'http', 'workers'],
  index: ['api', 'wiring'],
  tests: ['api', 'domain', 'application', 'ports', 'adapters', 'http', 'workers', 'wiring', 'index', 'tests'],
  other: [],
};

/** 模块内：某层的文件可以 import 哪些技术包（'any' 表示不限）。 */
export const PACKAGES_ALLOWED_BY_LAYER_DIR: Record<LayerDir, readonly string[] | 'any'> = {
  api: ['kernel', 'contracts'],
  domain: ['kernel', 'contracts'],
  ports: ['kernel', 'contracts'],
  application: ['kernel', 'contracts', 'eventbus'],
  adapters: 'any',
  http: ['kernel', 'contracts', 'http'],
  workers: ['kernel', 'contracts', 'eventbus', 'queue', 'k8s'],
  wiring: 'any',
  index: [],
  tests: 'any',
  other: [],
};

/** 只有这些位置的文件可以 import 其他模块（且只能 import 根入口）。 */
export const OTHER_MODULE_IMPORT_ALLOWED_FROM: readonly LayerDir[] = ['wiring', 'tests'];

/** 单元级依赖白名单：键为相对仓库根的目录，值为允许依赖的技术包短名。 */
export const UNIT_WHITELISTS: Record<string, readonly string[]> = {
  'runtimes/task': ['contracts', 'kernel', 'ws', 'agent-drivers'],
  'apps/console': ['contracts', 'api-client'],
  'apps/cli': ['contracts', 'api-client', 'kernel'],
  'apps/mcp-capabilities': ['contracts', 'api-client', 'kernel', 'http', 'mcp-server'],
  'apps/mcp-operations': ['contracts', 'api-client', 'kernel', 'http', 'mcp-server'],
};

/** 不依赖任何其他工作区包的叶子技术包。 */
export const LEAF_PACKAGES: readonly string[] = ['contracts', 'kernel'];

/** 只允许特定单元使用的技术包。 */
export const RESTRICTED_PACKAGES: Record<string, readonly string[]> = {
  'agent-drivers': ['runtimes/task'],
};

/** 允许调用 pgSchema 的非模块单元及其 schema 名。 */
export const INFRA_SCHEMA_OWNERS: Record<string, string> = {
  'packages/persistence': 'platform_infra',
  'packages/queue': 'platform_infra',
};

/**
 * 仓库根 `tests/` 只放跨单元的用例层，一层一个目录（ADR-0007、docs/engineering/testing.md §2）。
 * 单元自己的用例留在单元里；这里不允许出现清单之外的目录，也不允许散放文件。
 */
export const ROOT_TEST_TIERS: readonly string[] = ['contracts', 'e2e', 'security', 'scale', 'upgrade', 'architecture'];
export const ROOT_TEST_LOOSE_FILES: readonly string[] = ['README.md'];

/** 不在工作区里、但同样由根 `bun test` 收进来的用例所在目录；用例纪律对它们一视同仁。 */
export const EXTRA_TEST_ROOTS: readonly string[] = ['tests', 'integrations', 'templates', 'deploy'];

/** 迁移锁文件：已入锁的迁移不可修改、删除或插队（ADR-0007）。 */
export const MIGRATION_LOCK_FILE = 'tools/arch/migrations.lock.json';

export function moduleSchemaName(shortName: string): string {
  return shortName.replace(/-/g, '_');
}
