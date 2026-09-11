/** ID 为带前缀的 UUIDv7 十六进制：时间有序、可按前缀识别对象类型。 */
export function newId(prefix: string): string {
  return `${prefix}_${hex32()}`;
}

/** traceId 为 32 位十六进制，与 OpenTelemetry trace_id 形状一致，便于关联。 */
export function newTraceId(): string {
  return hex32();
}

function hex32(): string {
  return Bun.randomUUIDv7().replace(/-/g, '');
}
