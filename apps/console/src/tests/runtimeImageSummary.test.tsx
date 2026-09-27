import './domSetup';
import { expect, test } from 'bun:test';
import { RuntimeImageSummary } from '../shared/runtime-images/RuntimeImageSummary';
import { renderElement } from './renderElement';

test('历史执行展示固定镜像，摘要可读且完整地址可访问；未知值不冒充当前默认', async () => {
  const image = `registry.example.test/project/tools@sha256:${'a'.repeat(64)}`;
  const page = await renderElement(<><RuntimeImageSummary image={image} compact /><RuntimeImageSummary image="registry/tools:legacy" compact /><RuntimeImageSummary /><RuntimeImageSummary compact /></>, {});
  try {
    const codes = page.host.querySelectorAll('code');
    expect(codes).toHaveLength(2);
    expect(codes[0]?.textContent?.trim()).toBe(`sha256:${'a'.repeat(12)}`);
    expect(codes[0]?.title).toBe(image);
    expect(codes[0]?.getAttribute('aria-label')).toBe(`运行镜像: ${image}`);
    expect(codes[1]?.textContent?.trim()).toBe('registry/tools:legacy');
    expect(page.text()).toContain('—');
    expect(page.text()).not.toContain('默认');
  } finally { page.unmount(); }
});
