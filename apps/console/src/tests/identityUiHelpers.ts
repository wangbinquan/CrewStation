import './domSetup';
import { act } from 'react';

export function identityField(label: string): HTMLInputElement | HTMLSelectElement {
  const node = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')]
    .find((element) => element.closest('label')?.textContent?.includes(label) || element.getAttribute('aria-label') === label);
  if (!node) throw new Error(`没有找到字段 ${label}`);
  return node;
}
export async function setIdentityField(label: string, value: string) {
  const node = identityField(label);
  await act(async () => {
    node.focus();
    const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
}
export async function clickIdentityField(label: string) {
  await act(async () => { identityField(label).click(); });
}
export async function clickIdentitySelector(selector: string) {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`没有找到 ${selector}`);
  await act(async () => { node.click(); });
}
