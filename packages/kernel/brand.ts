/** 名义类型：让 ProjectId 与 ServiceId 在编译期不可互换。 */
export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export function brand<T, Name extends string>(value: T): Brand<T, Name> {
  return value as Brand<T, Name>;
}
