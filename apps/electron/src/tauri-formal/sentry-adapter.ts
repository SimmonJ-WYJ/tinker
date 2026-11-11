/** 预览入口在原 Sentry 初始化前返回；误调用明确失败，绝不加载 Electron 遥测。 */
export function init(): never { throw new Error('unsupported') }
