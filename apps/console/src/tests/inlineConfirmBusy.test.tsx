import './domSetup';
import { expect, test } from 'bun:test';
import { useState } from 'react';
import { renderElement } from './renderElement';
import { Button } from '../shared/ui/Button';
import { InlineConfirm } from '../shared/ui/InlineConfirm';

test('确认已展开后外部动作开始执行，确认按钮仍必须遵守 busy', async () => {
  let calls = 0;
  function Example() {
    const [busy, setBusy] = useState(false);
    return <><InlineConfirm label="变更策略" question="确认变更？" busy={busy} onConfirm={() => { calls++; }} /><Button onClick={() => setBusy(true)}>开始另一项</Button></>;
  }
  const view = await renderElement(<Example />, {});
  try {
    await view.click('变更策略'); await view.click('开始另一项');
    // 原组件只禁用展开前的按钮；多个接口已展开确认时，仍能发起第二笔写操作。
    expect(view.button('确认').disabled).toBe(true);
    await view.click('确认'); expect(calls).toBe(0);
  } finally { view.unmount(); }
});
