/** 按界面语言格式化时间；无法解析的值显示为 `—`。 */
export function formatDateTime(value: string | number | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
