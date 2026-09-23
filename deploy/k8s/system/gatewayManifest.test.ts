import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// RFC-021 实机（2026-09-23）：没有 allowEmptyServices 时，待命槽下线后（Service 还在、没有 endpoint）Traefik 丢掉整条路由、
// 回裸 404，ForwardAuth 不执行，平台的「未部署」说明页出不来。
test('Traefik 保留没有 endpoint 的路由，让 ForwardAuth 先应答', () => {
  const manifest = readFileSync(join(import.meta.dir, '32-traefik.yaml'), 'utf8');
  expect(manifest).toContain('- --providers.kubernetescrd.allowEmptyServices=true');
  expect(manifest).toContain('- --providers.kubernetescrd.allowCrossNamespace=true');
});
