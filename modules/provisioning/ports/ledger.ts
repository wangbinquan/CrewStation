import type { NamespaceDeclaration, NetworkPolicyDeclaration } from '../domain/namespaceProjection';

/** 台账记录里开通链用得到的部分：阶段、原因与子对象的观测（等不到运行中时据此说明还缺什么）。 */
export interface NamespaceRecordView {
  readonly id: string;
  readonly phase: string;
  readonly reason?: { readonly message: string };
  readonly children: readonly { readonly kind: string; readonly name: string; readonly phase: string }[];
}

/** 资源中心（RFC-025）的写入口：provisioning 写命名空间与网络策略的期望，实况由资源中心写。由组合根接到 resources 模块。 */
export interface NamespaceLedger {
  declare(input: NamespaceDeclaration | NetworkPolicyDeclaration): Promise<{ readonly id: string }>;
  get(id: string): Promise<NamespaceRecordView | undefined>;
}
