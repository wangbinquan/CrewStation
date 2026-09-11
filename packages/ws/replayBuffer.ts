export interface ReplayEntry<T> {
  readonly seq: number;
  readonly item: T;
}

/**
 * 按 seq 有序、容量有界的重放缓冲：发送端保留最近 `capacity` 条，重连时按对端确认的 seq 补发。
 * seq 必须严格递增；超过容量时丢弃最旧的条目。
 */
export class ReplayBuffer<T> {
  private entries: ReplayEntry<T>[] = [];

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`capacity 必须是正整数，实际 ${capacity}`);
  }

  get size(): number {
    return this.entries.length;
  }

  get firstSeq(): number | undefined {
    return this.entries[0]?.seq;
  }

  get lastSeq(): number | undefined {
    return this.entries[this.entries.length - 1]?.seq;
  }

  push(seq: number, item: T): void {
    const last = this.lastSeq;
    if (last !== undefined && seq <= last) throw new RangeError(`seq 必须严格递增：${seq} ≤ ${last}`);
    this.entries.push({ seq, item });
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
  }

  /** seq 严格大于 `seq` 的全部条目（升序）。 */
  since(seq: number): ReplayEntry<T>[] {
    return this.entries.slice(this.firstIndexAfter(seq));
  }

  /** 丢弃 seq 小于 `beforeSeq` 的条目（对端已确认的部分）；返回丢弃数量。 */
  drop(beforeSeq: number): number {
    const count = this.firstIndexAfter(beforeSeq - 1);
    this.entries.splice(0, count);
    return count;
  }

  /** 对端要求从 `seq` 之后补发时，缓冲区是否仍完整覆盖（否则中间已有事件被淘汰）。 */
  canReplayFrom(seq: number): boolean {
    const first = this.firstSeq;
    return first === undefined || seq >= first - 1;
  }

  private firstIndexAfter(seq: number): number {
    let low = 0;
    let high = this.entries.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((this.entries[mid]?.seq ?? Number.POSITIVE_INFINITY) <= seq) low = mid + 1;
      else high = mid;
    }
    return low;
  }
}
