/** 原投递进程的物理身份；连接、租约或 Pod 缺失都不能充当退出证明。 */
export interface DeliveryProcess { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string }
export interface DeliveryProcessOwners {
  /** 开始外部推送前，固定原容器并保护 Pod，使实际停止证据可持久保存。 */
  protectCurrent(): Promise<DeliveryProcess>;
  /** 同 Pod 重启仅接受原 containerID 的真实终止状态；删 Pod 须等所有容器退出。 */
  sweep(accept: { stopped(process: DeliveryProcess, proofDigest: string): Promise<void>; releasable(podUid: string): Promise<boolean> }): Promise<void>;
}
