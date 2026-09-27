/** Opaque stamp hashes randomized ciphertext, never a guessable plaintext credential. */
export interface CredentialVersion {
  profileId: string;
  revision: number;
  stamp: string;
  credentials: Array<{ id: string; name: string; cipherText: string }>;
  revoked: boolean;
}
