import './domSetup';
import { act, useState } from 'react';
import { describe, expect, test } from 'bun:test';
import { SplitGrid } from '../shared/ui/split/SplitGrid';
import { adjustSplit, splitWeights } from '../shared/ui/split/splitGeometry';
import { renderElement } from './renderElement';

describe('工作台分屏', () => {
  test('相邻分屏调整保持总占比，不挤掉其他窗口；比例数量随可见窗口适配', () => {
    expect(adjustSplit([0.3, 0.3, 0.4], 0, 0.1, 0.1)).toEqual([0.4, 0.19999999999999996, 0.4]);
    expect(adjustSplit([0.5, 0.5], 0, -1, 0.2)).toEqual([0.2, 0.8]);
    expect(splitWeights([1, 3], 2)).toEqual([0.25, 0.75]);
    expect(splitWeights([1, 3], 1)).toEqual([1]);
  });
  test('真实控件方向键调整尺寸，三窗最后一窗横跨下排', async () => {
    function Example() {
      const [ratios, setRatios] = useState({ columns: [1, 1], rows: [1, 1] });
      return <SplitGrid mode="grid" ratios={ratios} onResize={setRatios} separatorLabel={(axis) => axis} items={['A', 'B', 'C'].map((id) => ({ id, content: <span>{id}</span> }))} />;
    }
    const page = await renderElement(<Example />, {});
    try {
      const separator = page.host.querySelector('[role="separator"][aria-label="columns"]')!;
      expect(separator.getAttribute('aria-valuenow')).toBe('50');
      await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
      expect(separator.getAttribute('aria-valuenow')).toBe('53');
      const third = [...page.host.querySelectorAll<HTMLDivElement>('.pane')][2]!;
      expect(third.style.gridColumn).toBe('1 / -1');
    } finally { page.unmount(); }
  });
});
