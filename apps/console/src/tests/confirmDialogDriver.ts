import { act } from 'react';

/** 当前打开的确认弹窗；没有就抛，免得断言在「什么都没弹出来」上通过。 */
export function openDialog(): HTMLDialogElement {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
  if (!dialog) throw new Error('没有打开的确认弹窗');
  return dialog;
}

/**
 * 在打开的确认弹窗里输入确认词：受控输入要走原生 setter 再派发事件，React 才收得到。
 * happy-dom 下 React 的 onChange 退回按键事件探测变化，所以 input 之外还要补一个 keyup（与其他用例的输入助手一致）。
 */
export async function typeConfirmWord(value: string): Promise<void> {
  const input = openDialog().querySelector('input');
  if (!input) throw new Error('确认弹窗里没有输入框');
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
}

/** 弹窗里的确认键（第一个按钮）。 */
export function dialogConfirmButton(): HTMLButtonElement {
  const button = openDialog().querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) throw new Error('确认弹窗里没有确认键');
  return button;
}
