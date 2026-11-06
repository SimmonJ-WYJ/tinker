/**
 * GitHub 仓库标识 · 单一真源
 *
 * 之前散落在三处（electron-builder.yml / github-release-service.ts /
 * AboutSettings.tsx），各写各的导致漂移。集中到这里防止下次再错位。
 *
 * 注意：electron-builder.yml 的 publish 段是 yaml，无法直接 import 这里的常量；
 * 改名时需同步手改 yml。CI 可加一致性校验。
 */

export const GITHUB_REPO = {
  owner: 'OPENSCI-Labs',
  repo: 'ASCI-Alpha',
} as const

export const GITHUB_RELEASES_URL =
  `https://github.com/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}/releases`
