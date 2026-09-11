import { pgSchema } from 'drizzle-orm/pg-core';

/** 本模块唯一允许使用的 PostgreSQL schema；所有表都定义在它之下。 */
export const configSchema = pgSchema('config');
