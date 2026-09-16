import { integer, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { projectSchema } from './schema';

export const projects = projectSchema.table('projects', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  namespace: text('namespace').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  state: text('state').notNull(),
  template: text('template').notNull(),
  initialPlan: text('initial_plan'),
  message: text('message'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const services = projectSchema.table('services', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  identity: text('identity').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const memberships = projectSchema.table('memberships', {
  projectId: text('project_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.projectId, t.userId] })]);

export const taskQuotas = projectSchema.table('task_quotas', {
  projectId: text('project_id').primaryKey(),
  maxConcurrentTasks: integer('max_concurrent_tasks').notNull(),
});

export const servicePlans = projectSchema.table('service_plans', {
  name: text('name').primaryKey(),
  cpu: text('cpu').notNull(),
  memory: text('memory').notNull(),
  maxReplicas: integer('max_replicas').notNull(),
  description: text('description').notNull().default(''),
});

/** 算力档位（RFC-001）：driver 与 model 是平台的采购信息，租户面不返回。 */
export const computeProfiles = projectSchema.table('compute_profiles', {
  name: text('name').primaryKey(),
  driver: text('driver').notNull(),
  model: text('model').notNull(),
  taskProfile: text('task_profile'),
  description: text('description').notNull().default(''),
  /** RFC-004：绑定的运行环境；null 即部署配置模式。 */
  runtimeConfigId: text('runtime_config_id'),
  revision: integer('revision').notNull().default(0),
});

export const taskProfiles = projectSchema.table('task_profiles', {
  name: text('name').primaryKey(),
  cpu: text('cpu').notNull(),
  memory: text('memory').notNull(),
  storage: text('storage').notNull(),
  description: text('description').notNull().default(''),
});
