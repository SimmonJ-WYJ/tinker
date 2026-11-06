/**
 * ASCI 法律政策外链 · 单一真源
 *
 * Privacy Policy / Terms of Use 页面托管在 OPENSCI GitBook 的独立 ASCI 子路径下。
 * 客户端（About 页 / Login 页）的入口统一引用这里的常量，GitBook 页 slug 调整时
 * 只改这一处，避免散落漂移（参照 github-repo.ts 的收口做法）。
 *
 * 注意：政策正文由 GitBook / 法务侧维护，工程侧只负责外链入口与跳转；
 * 页面内容上线前链接可能暂为占位（issue #721：先打通入口交互，内容后续填充）。
 */

const ASCI_GITBOOK_BASE = 'https://opensci.gitbook.io/asci/agreement'

export const ASCI_PRIVACY_POLICY_URL = `${ASCI_GITBOOK_BASE}/privacy-policy`
export const ASCI_TERMS_OF_USE_URL = `${ASCI_GITBOOK_BASE}/term-of-use`
