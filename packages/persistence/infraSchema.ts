import { pgSchema } from 'drizzle-orm/pg-core';

/** 基础设施表（outbox、队列、迁移记录）所在 schema；任何领域表都不得放在这里。 */
export const platformInfraSchema = pgSchema('platform_infra');
