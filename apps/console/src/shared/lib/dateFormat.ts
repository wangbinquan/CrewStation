/** 按界面语言格式化时间；无法解析的值显示为 `—`。`second` 精确到秒，给几十秒就变一次的值（如形态图的观测时间）。 */
export function formatDateTime(value: string | number | Date, locale: string, precision: 'minute' | 'second' = 'minute'): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: precision === 'second' ? 'medium' : 'short' }).format(date);
}
