import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';

/**
 * jsonb 列的统一写法：drizzle 自带的 jsonb() 在 Bun 内置 SQL 下会把对象落成 JSON 字符串（jsonb_typeof = 'string'）；
 * 换成 postgres.js 后（RFC-023），drizzle 把 json 的序列化器换成原样透传，直接传对象会被驱动拒绝。
 * 这里以 text 参数传 JSON 文本、库内 ::jsonb 解析，任何 JSON 值都能原样落库，与驱动无关。
 * 读出时驱动可能给字符串也可能给对象，fromDriver 统一成对象。
 */
export const jsonDocument = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'jsonb',
  toDriver: (value) => sql`${JSON.stringify(value)}::text::jsonb`,
  fromDriver: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
});
