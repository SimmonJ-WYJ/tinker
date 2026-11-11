/** 先完整初始化正式宿主，再加载只用于验收的atom探针，避免改变初始化顺序。 */
await import('./entry.ts')
await import('./qa-probe.ts')
export {}
