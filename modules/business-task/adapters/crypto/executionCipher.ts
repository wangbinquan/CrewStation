import { decryptString, encryptString } from '@crewstation/secretbox';
import { precondition } from '@crewstation/kernel';
import type { ExecutionPayloadCipher } from '../../domain/executionSubtask';

export function executionCipher(key: string | undefined): ExecutionPayloadCipher {
  const required = () => { if (!key) throw precondition('执行材料加密密钥尚未配置', { code: 'unsupported_capability' }); return key; };
  return { seal: (plain) => encryptString(required(), plain), open: (sealed) => decryptString(required(), sealed) };
}
