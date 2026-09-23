import type { ReleaseDto, SlotDto } from '@crewstation/contracts';

/**
 * 可以部署到待命槽的版本（服务端算好的 `redeployable`），新到旧（2026-09-23 裁定：待验证版本可以选版本部署）。
 * `keep` 是弹窗里正选着的版本：它刚变得不可部署（别人先部署了）时仍留在列表里，免得选择框跳走，确认键另行置灰。
 */
export function redeployCandidates(releases: readonly ReleaseDto[], keep?: string): ReleaseDto[] {
  return releases.filter((release) => release.redeployable || release.id === keep).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** 待命槽空着时「部署版本…」默认选中的版本：刚从这个槽下线的那个还能部署就选它，否则选最新的可部署版本；一个都没有时不给入口。 */
export function defaultRedeployTarget(slot: SlotDto, releases: readonly ReleaseDto[]): ReleaseDto | undefined {
  const candidates = redeployCandidates(releases);
  return candidates.find((release) => release.id === slot.offline?.releaseId) ?? candidates[0];
}
