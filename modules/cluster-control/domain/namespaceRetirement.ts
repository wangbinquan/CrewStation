export interface RetirementChild { readonly kind: string; readonly name: string; readonly uid: string; readonly namespace?: string }
export interface NamespaceRetirement { readonly uid: string; readonly children: readonly RetirementChild[] }
