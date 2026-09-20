/** RFC-013：平台资源身份，保留完整 UUIDv7，不拼前缀或截断。 */
export function newResourceId(): string {
  return Bun.randomUUIDv7();
}

/** Compatible call signature for existing callers; resource type never changes the UUID format. */
export function newId(_prefix: string): string {
  return newResourceId();
}

/** traceId 为 32 位十六进制，与 OpenTelemetry trace_id 形状一致，便于关联。 */
export function newTraceId(): string {
  return hex32();
}

function hex32(): string {
  return newResourceId().replace(/-/g, '');
}
