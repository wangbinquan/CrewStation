export interface EventsSettings {
  /** 一条投递最多尝试的次数，超过进入 dead。 */
  readonly maxAttempts: number;
  readonly pushTimeoutMs: number;
}
