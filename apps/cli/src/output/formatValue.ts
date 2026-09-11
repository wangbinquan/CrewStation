/** 表格里的取值收敛：空值统一成 `-`，时间截到分钟，SHA 截到 12 位。 */
export function dash(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return '-';
  const text = String(value);
  return text.length === 0 ? '-' : text;
}

/** ISO 时间 → `YYYY-MM-DD HH:mm`（UTC）。不做本地时区换算：运维看日志要的是同一把尺子。 */
export function shortTime(iso: string | undefined): string {
  if (iso === undefined || iso.length === 0) return '-';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toISOString().slice(0, 16).replace('T', ' ');
}

export function shortSha(sha: string | undefined): string {
  return sha === undefined || sha.length === 0 ? '-' : sha.slice(0, 12);
}

export function yesNo(value: boolean): string {
  return value ? '是' : '否';
}
