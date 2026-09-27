export interface LegacyRecoveryProof {
  /** Query the cluster by immutable controller Pod UID; an API failure is not absence. */
  ownerGone(podUid: string): Promise<boolean>;
}
