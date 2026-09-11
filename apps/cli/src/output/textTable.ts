/**
 * 终端表格：按显示宽度而不是码点数补空格，否则中文项目名与中文表头会把列撑歪。
 * 只做左对齐与两空格列距，不画边框，方便 awk／cut 继续处理。
 */
const COLUMN_GAP = '  ';

/** 东亚宽字符与 emoji 占两列；其余按一列计。组合记号（U+0300–U+036F）不占列。 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x0300 && code <= 0x036f) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

export function padRight(text: string, width: number): string {
  const missing = width - displayWidth(text);
  return missing > 0 ? text + ' '.repeat(missing) : text;
}

/** 表头加数据行 → 每行一个字符串；行尾不留空格。空数据只输出表头。 */
export function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = headers.map((header, index) => columnWidth(header, rows, index));
  return [headers, ...rows].map((cells) => renderRow(cells, widths));
}

function renderRow(cells: readonly string[], widths: readonly number[]): string {
  const parts = cells.map((cell, index) => (index === cells.length - 1 ? cell : padRight(cell, widths[index] ?? 0)));
  return parts.join(COLUMN_GAP).replace(/\s+$/, '');
}

function columnWidth(header: string, rows: readonly (readonly string[])[], index: number): number {
  let width = displayWidth(header);
  for (const row of rows) width = Math.max(width, displayWidth(row[index] ?? ''));
  return width;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0x303e) || (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) || (code >= 0x1f900 && code <= 0x1f9ff) || (code >= 0x20000 && code <= 0x3fffd)
  );
}
