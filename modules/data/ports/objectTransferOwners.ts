/** Positive infrastructure evidence only. A missing Pod, expired lease or failed probe is not termination. */
export interface ObjectTransferOwners {
  readonly podUid?: string;
  sweep(accept: (podUid: string, proofDigest: string) => Promise<void>): Promise<void>;
}
