import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';

/**
 * jsonb 列的统一写法：drizzle 自带的 jsonb() 与 Bun SQL 组合会把对象落成 JSON 字符串（jsonb_typeof = 'string'），
 * 直接传对象又会让数字、布尔带上驱动类型被拒。这里以 text 参数传 JSON 文本、库内 ::jsonb 解析，任何 JSON 值都能原样落库。
 * 读出时驱动可能给字符串也可能给对象，fromDriver 统一成对象。
 */
export const jsonDocument = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'jsonb',
  toDriver: (value) => sql`${JSON.stringify(value)}::text::jsonb`,
  fromDriver: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
});
