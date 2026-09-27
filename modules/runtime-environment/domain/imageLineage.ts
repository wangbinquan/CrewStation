import { precondition } from '@crewstation/kernel';

/** OCI rootfs diff_ids 不能靠用户自定义 label 伪造；最终清单及 config 内容先经过仓库摘要校验。 */
export function verifyImageLineage(base: readonly string[], derived: readonly string[]): void {
  if (!base.length || derived.length < base.length || base.some((digest, index) => derived[index] !== digest)) throw precondition('构建产物没有继承所选平台底座的基础层', { code: 'image_base_mismatch' });
}
