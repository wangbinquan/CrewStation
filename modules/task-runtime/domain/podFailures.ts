/**
 * 主容器的等待／终止原因归类（RFC-006 §5.3、§6.2）：镜像拉不下来与容器起不来是两类原因，管理员的处置不同。
 * 档位测试与执行环境对账共用这一份表。
 */
export const IMAGE_PULL_FAILURES: ReadonlySet<string> = new Set(['ErrImagePull', 'ImagePullBackOff', 'InvalidImageName', 'ErrImageNeverPull', 'RegistryUnavailable', 'SignatureValidationFailed']);
export const CONTAINER_START_FAILURES: ReadonlySet<string> = new Set(['CreateContainerError', 'CreateContainerConfigError', 'RunContainerError', 'StartError', 'ContainerCannotRun', 'CrashLoopBackOff']);

export const RUNNER_UNAVAILABLE_HINT = '镜像里可能没有平台 Runner 启动路径 /opt/crewstation/bin/task-runner，请基于平台底座镜像构建';
