/** bootstrap 成功后安装原 API，再导入同一正式 renderer/main.tsx。 */
import { createDesktopApi } from '../preload/api.ts'
import { selectedImageUse } from './images.ts'
import { createFormalTransport } from './transport.ts'
import { nativeBridge, installWindowDrag } from './native.ts'
import { seedCredentialedState, seedActiveRuns } from './bootstrap-state.ts'
import { installPersistence } from './persistence.ts'
import { i18n, setAppLanguage } from '../renderer/lib/i18n.ts'

const credentialErrors: Partial<Record<string, keyof typeof import('../renderer/locales/en/errors.json').desktopRuntime>> = {
 imageEditOnly:'imageEditOnly',imageNotFound:'imageNotFound',imageProviderFailed:'imageFailed',imageProviderUnavailable:'imageFailed',invalidImageResponse:'imageFailed',
 probeCancelled:'invalid',credentialRequired:'credentialRequired',credentialMissing:'credentialRequired',credentialBindingMismatch:'credentialBinding',credentialBindingRequired:'credentialBinding',credentialReplacementRequired:'credentialReplacement',
 vaultDenied:'vaultDenied',vaultUnavailable:'vaultUnavailable',vaultWriteFailed:'vaultUnavailable',vaultWriteUncertain:'recoveryRequired',unsupportedPlatform:'vaultUnavailable',
 helperBusy:'helperBusy',helperTimeout:'helperBusy',helperUnavailable:'helperBusy',helperUnauthorized:'vaultDenied',
 invalidEndpoint:'invalidEndpoint',invalidChannel:'invalidChannel',invalidCredential:'invalidCredential',invalidQaCredential:'invalidCredential',unsupportedProvider:'unsupported',unsupportedEffort:'unsupportedEffort',
 revisionConflict:'revisionConflict',mutationConflict:'revisionConflict',channelConflict:'revisionConflict',channelNotFound:'modelUnavailable',
 mutationPending:'mutationPending',stageUncertain:'stageUncertain',stageConflict:'stageUncertain',stageExpired:'stageUncertain',stageMissing:'stageUncertain',stageMismatch:'stageUncertain',
 recoveryRequired:'recoveryRequired',storageLimit:'storageLimit',stageLimit:'storageLimit',helperLimit:'storageLimit',storeIo:'storeIo',catalogUnavailable:'catalogUnavailable',resolverUnavailable:'catalogUnavailable',
}
const translate = (code: string): string => {
  const key = credentialErrors[code] ?? (code === 'catalogValidated' ? 'catalogValidated' : code === 'modelUnavailable' ? 'modelUnavailable' : ['permissionNotFound', 'permissionConflict', 'permissionExpired'].includes(code) ? 'permission' : code === 'responseFailed' ? 'failed' : code === 'unsupported' ? 'unsupported' : ['invalidParams', 'runBusy', 'closing'].includes(code) ? 'invalid' : 'transport')
  return i18n.t(`desktopRuntime.${key}`, { ns: 'errors' })
}
try {
  const transport = await createFormalTransport(nativeBridge(), translate)
  window.electronAPI = createDesktopApi(transport)
  window.__INITIAL_THEME__ = transport.bootstrap.platformSnapshot.theme
  window.__DESKTOP_RUNTIME_PREVIEW__ = true
  window.__TAURI_QUEUEING__ = transport.bootstrap.queueing === true
  const persistence = installPersistence(transport)
  window.__TAURI_FORMAL__ = { hydrated: persistence.hydrated, nativeImages: transport.bootstrap.nativeImages === true, selectedImageUse: transport.bootstrap.nativeImages ? selectedImageUse : undefined }
  seedCredentialedState(transport.bootstrap)
  seedActiveRuns(transport.bootstrap.activeRuns)
  await setAppLanguage(transport.bootstrap.platformSnapshot.settings.language ?? 'en')
  installWindowDrag(transport.bootstrap.generation)
  await import('../renderer/main.tsx')
} catch (error) {
  console.error('[原生预览] 启动失败', error)
  document.getElementById('root')!.textContent = translate('runtimeUnavailable')
}
