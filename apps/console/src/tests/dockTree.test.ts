import { describe, expect, test } from 'bun:test';
import type { DockNode } from '../shared/ui/dock/dockTree';
import { alignGroups, dockGroups, equalizeSizes, minimumSize, nodeAt, removeGroup, setSizes, splitGroup, tidy, withinLimits } from '../shared/ui/dock/dockTree';
import { boxPixels, boxStyle, placeDock } from '../shared/ui/dock/dockPlacement';
import type { DockGeometry } from '../shared/ui/dock/dockDrop';
import { resolveDrop } from '../shared/ui/dock/dockDrop';

const row = (children: DockNode[], sizes = children.map(() => 1)): DockNode => ({ direction: 'row', children, sizes });
const column = (children: DockNode[], sizes = children.map(() => 1)): DockNode => ({ direction: 'column', children, sizes });

describe('分屏树（CLI 标签组的排列）', () => {
  test('分屏：同方向的父分支里插在旁边、两块平分原来的大小；方向不同把目标换成新的二分支；根是叶子时同理', () => {
    expect(splitGroup({ group: 'a' }, 'a', 'right', 'b')).toEqual(row([{ group: 'a' }, { group: 'b' }]));
    expect(splitGroup({ group: 'a' }, 'a', 'top', 'b')).toEqual(column([{ group: 'b' }, { group: 'a' }]));
    // a 占 2/3：分出的 c 与 a 各拿一半，b 不动。
    expect(splitGroup(row([{ group: 'a' }, { group: 'b' }], [2, 1]), 'a', 'right', 'c')).toEqual(row([{ group: 'a' }, { group: 'c' }, { group: 'b' }]));
    expect(splitGroup(row([{ group: 'a' }, { group: 'b' }]), 'b', 'bottom', 'c')).toEqual(row([{ group: 'a' }, column([{ group: 'b' }, { group: 'c' }])]));
    expect(splitGroup({ group: 'a' }, 'missing', 'left', 'b')).toBeUndefined();
  });

  test('分屏超出契约上限（8 层、每层 16 个、64 个节点）时拒绝，而不是造出保存不了的树', () => {
    let deep: DockNode = { group: 'g0' };
    for (let i = 1; i < 8; i++) deep = splitGroup(deep, `g${i - 1}`, i % 2 ? 'right' : 'bottom', `g${i}`)!;
    expect(withinLimits(deep)).toBe(true);
    // g7 的父分支是左右排开的：再往右分只是插在旁边，往下分要多一层，超过 8 层。
    expect(splitGroup(deep, 'g7', 'right', 'g8')).toBeDefined();
    expect(splitGroup(deep, 'g7', 'bottom', 'g8')).toBeUndefined();
    const wide = row(Array.from({ length: 16 }, (_, i) => ({ group: `w${i}` })));
    expect(splitGroup(wide, 'w0', 'right', 'w16')).toBeUndefined();
    expect(splitGroup(wide, 'w0', 'bottom', 'w16')).toBeDefined();
  });

  test('去掉一组：前一个兄弟接过它的大小（打头的交给下一个）；只剩一个子项的分支由子项取代，同方向的嵌套随之压平', () => {
    expect(removeGroup(row([{ group: 'a' }, { group: 'b' }, { group: 'c' }], [1, 2, 5]), 'b')).toEqual(row([{ group: 'a' }, { group: 'c' }], [0.75, 1.25]));
    expect(removeGroup(row([{ group: 'a' }, { group: 'b' }, { group: 'c' }], [2, 1, 1]), 'a')).toEqual(row([{ group: 'b' }, { group: 'c' }], [1.5, 0.5]));
    expect(removeGroup(row([{ group: 'a' }, { group: 'b' }], [1, 3]), 'a')).toEqual({ group: 'b' });
    expect(removeGroup(row([{ group: 'a' }, column([{ group: 'b' }, { group: 'c' }])]), 'c')).toEqual(row([{ group: 'a' }, { group: 'b' }]));
    expect(removeGroup(row([{ group: 'x' }, column([{ group: 'y' }, row([{ group: 'z' }, { group: 'w' }])])]), 'y')).toEqual(row([{ group: 'x' }, { group: 'z' }, { group: 'w' }], [1, 0.5, 0.5].map((value) => Math.round(value / 2 * 3 * 1e4) / 1e4)));
    expect(removeGroup({ group: 'a' }, 'a')).toBeUndefined();
  });

  test('与页签对齐：去掉不认识和重复的叶子，缺的组补在最右边；规整是幂等的', () => {
    expect(alignGroups(row([{ group: 'a' }, { group: 'gone' }]), ['a', 'b'])).toEqual(row([{ group: 'a' }, { group: 'b' }], [1, 1]));
    expect(alignGroups(row([{ group: 'a' }, { group: 'a' }, { group: 'b' }]), ['a', 'b'])).toEqual(row([{ group: 'b' }, { group: 'a' }]));
    expect(alignGroups(undefined, ['a'])).toEqual({ group: 'a' });
    expect(alignGroups(undefined, [])).toBeUndefined();
    const messy = row([row([{ group: 'a' }, { group: 'b' }], [1, 3]), column([{ group: 'c' }])], [2, 2]);
    const once = tidy(messy);
    expect(once).toEqual(row([{ group: 'a' }, { group: 'b' }, { group: 'c' }], [0.375, 1.125, 1.5]));
    expect(tidy(once)).toEqual(once); expect(dockGroups(once)).toEqual(['a', 'b', 'c']);
  });

  test('改大小与均分只动指定分支；路径不是分支或数量不符时原样返回', () => {
    const tree = row([{ group: 'a' }, column([{ group: 'b' }, { group: 'c' }])]);
    expect(nodeAt(tree, [1, 0])).toEqual({ group: 'b' });
    const resized = setSizes(tree, [1], [3, 1]);
    expect(resized).toEqual(row([{ group: 'a' }, column([{ group: 'b' }, { group: 'c' }], [1.5, 0.5])]));
    expect(equalizeSizes(resized, [1])).toEqual(tree);
    expect(setSizes(tree, [1], [1, 1, 1])).toBe(tree); expect(setSizes(tree, [0], [1, 1])).toBe(tree);
    expect(minimumSize(tree, { width: 260, height: 160 }, 6)).toEqual({ width: 526, height: 326 });
  });
});

describe('分屏的位置与落点', () => {
  test('各组按树算成 calc(百分比 ± 像素)，分隔条固定像素；换算回像素与容器尺寸一致', () => {
    const placement = placeDock(row([{ group: 'a' }, column([{ group: 'b' }, { group: 'c' }])], [1, 1]), 6);
    expect(placement.groups.map((group) => group.id)).toEqual(['a', 'b', 'c']);
    expect(boxStyle(placement.groups[0]!.box)).toEqual({ left: '0%', top: '0%', width: 'calc(50% - 3px)', height: '100%' });
    expect(boxStyle(placement.groups[2]!.box)).toEqual({ left: 'calc(50% + 3px)', top: 'calc(50% + 3px)', width: 'calc(50% - 3px)', height: 'calc(50% - 3px)' });
    expect(placement.dividers.map((divider) => [divider.key, divider.direction, divider.index])).toEqual([[':0', 'row', 0], ['1:0', 'column', 0]]);
    expect(boxPixels(placement.dividers[0]!.box, 1006, 606)).toEqual({ left: 500, top: 0, width: 6, height: 606 });
    expect(boxPixels(placement.groups[2]!.box, 1006, 606)).toEqual({ left: 506, top: 306, width: 500, height: 300 });
  });

  const geometry: DockGeometry = { groups: [
    { id: 'left', bar: { left: 0, top: 0, right: 600, bottom: 30 }, body: { left: 0, top: 30, right: 600, bottom: 630 }, tabs: [{ id: 't1', rect: { left: 0, top: 0, right: 100, bottom: 30 } }, { id: 't2', rect: { left: 100, top: 0, right: 200, bottom: 30 } }] },
    { id: 'small', bar: { left: 606, top: 0, right: 900, bottom: 30 }, body: { left: 606, top: 30, right: 900, bottom: 230 }, tabs: [] },
  ] };
  const options = { minWidth: 260, minHeight: 160 };

  test('标签栏上按标签中线定插入位置；画面靠边的四分之一分到那一边，中间并入；放不下两半的方向只能并入；落在别处没有目标', () => {
    expect(resolveDrop(40, 10, geometry, options)).toEqual({ kind: 'tab', group: 'left', index: 0 });
    expect(resolveDrop(160, 10, geometry, options)).toEqual({ kind: 'tab', group: 'left', index: 2 });
    expect(resolveDrop(560, 300, geometry, options)).toEqual({ kind: 'split', group: 'left', side: 'right' });
    expect(resolveDrop(300, 60, geometry, options)).toEqual({ kind: 'split', group: 'left', side: 'top' });
    expect(resolveDrop(300, 330, geometry, options)).toEqual({ kind: 'center', group: 'left' });
    // 294×200 的组：左右、上下都放不下两个最小组，靠边也只能并入。
    expect(resolveDrop(890, 220, geometry, options)).toEqual({ kind: 'center', group: 'small' });
    expect(resolveDrop(950, 300, geometry, options)).toBeUndefined();
  });
});
