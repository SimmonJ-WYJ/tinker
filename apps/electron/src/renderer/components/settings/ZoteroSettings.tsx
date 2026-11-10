/** 旧 Zotero 设置入口仅保留退役说明，不读取或修改集成配置。 */
import type { ReactElement } from 'react'
import { useT } from '@/hooks/useT'

export function ZoteroSettings(): ReactElement {
  const { t } = useT('settings')
  return <div className="p-4 text-sm text-muted-foreground">{t('zotero.retiredReadOnly')}</div>
}
